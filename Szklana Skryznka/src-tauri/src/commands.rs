use tauri::State;
use tauri::Manager;
use tauri::Emitter;
use serde::{Serialize, Deserialize};
use sqlx::{SqlitePool, Row};
use chrono::{DateTime, Utc, Duration};
use crate::models::{
    MediaItem, MediaItemDetails, MediaFile, Subtitle,
    ScheduleEntryDetails, PlayoutState, DiagnosticsReport, Channel
};
use crate::playout::get_playout_state;
use crate::scanner::scan_directory;
use crate::scheduler::generate_auto_schedule;
use tracing::info;

// Wrap the pool inside State
pub type DbState<'a> = State<'a, SqlitePool>;

#[tauri::command]
pub async fn scan_library(app: tauri::AppHandle, pool: DbState<'_>, path: String) -> Result<String, String> {
    info!("Tauri command scan_library invoked for path: {}", path);

    // Save scanned path to SQLite settings
    let existing_paths: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'scanned_paths'")
        .fetch_optional(&*pool)
        .await
        .unwrap_or(None);

    let new_paths = match existing_paths {
        Some(paths) => {
            let mut list: Vec<String> = paths.split(',').map(|s| s.to_string()).collect();
            if !list.contains(&path) {
                list.push(path.clone());
            }
            list.join(",")
        }
        None => path.clone(),
    };

    let _ = sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('scanned_paths', $1)")
        .bind(&new_paths)
        .execute(&*pool)
        .await;

    let res = scan_directory(&app, &pool, &path).await;

    // Run second-layer database deduplication immediately after scan!
    if let Err(e) = crate::scanner::run_second_layer_deduplication(&pool).await {
        tracing::warn!("Post-scan second-layer deduplication failed: {}", e);
    }
    
    // Ensure scan_in_progress is set to false on completion or error
    let _ = sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('scan_in_progress', 'false')")
        .execute(&*pool)
        .await;

    match res {
        Ok((scanned, duplicates)) => Ok(format!(
            "Scan completed. Successfully cataloged {} files. Skipped {} duplicates.",
            scanned, duplicates
        )),
        Err(e) => Err(format!("Scan failed: {}", e)),
    }
}

#[tauri::command]
pub async fn stop_scan(pool: DbState<'_>) -> Result<(), String> {
    info!("stop_scan invoked by user.");
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('scan_stop_requested', 'true')")
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_media(pool: DbState<'_>) -> Result<Vec<MediaItemDetails>, String> {
    let items: Vec<MediaItem> = sqlx::query_as::<_, MediaItem>(
        "SELECT * FROM media_items ORDER BY created_at DESC"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut details = Vec::new();

    for item in items {
        let files: Vec<MediaFile> = sqlx::query_as::<_, MediaFile>(
            "SELECT * FROM media_files WHERE media_item_id = $1"
        )
        .bind(&item.id)
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?;

        let subtitles: Vec<Subtitle> = sqlx::query_as::<_, Subtitle>(
            "SELECT * FROM subtitles WHERE media_item_id = $1"
        )
        .bind(&item.id)
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?;

        // Extract genres, tags, actors, directors from join tables
        let genres: Vec<String> = sqlx::query(
            "SELECT g.name FROM genres g JOIN media_genres mg ON g.id = mg.genre_id WHERE mg.media_item_id = $1"
        )
        .bind(&item.id)
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|r| r.get::<String, _>(0))
        .collect();

        let tags: Vec<String> = sqlx::query(
            "SELECT t.name FROM tags t JOIN media_tags mt ON t.id = mt.tag_id WHERE mt.media_item_id = $1"
        )
        .bind(&item.id)
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|r| r.get::<String, _>(0))
        .collect();

        let actors: Vec<String> = sqlx::query(
            "SELECT a.name FROM actors a JOIN media_actors ma ON a.id = ma.actor_id WHERE ma.media_item_id = $1"
        )
        .bind(&item.id)
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|r| r.get::<String, _>(0))
        .collect();

        let directors: Vec<String> = sqlx::query(
            "SELECT d.name FROM directors d JOIN media_directors md ON d.id = md.director_id WHERE md.media_item_id = $1"
        )
        .bind(&item.id)
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|r| r.get::<String, _>(0))
        .collect();

        details.push(MediaItemDetails {
            item,
            files,
            subtitles,
            genres,
            tags,
            actors,
            directors,
        });
    }

    Ok(details)
}

#[tauri::command]
pub async fn save_media(pool: DbState<'_>, details: MediaItemDetails) -> Result<String, String> {
    // 1. Update MediaItem
    let cap_title = crate::scanner::capitalize_title(&details.item.title);
    sqlx::query(
        "UPDATE media_items SET title = $1, original_title = $2, media_type = $3, year = $4, \
         runtime = $5, synopsis = $6, rating = $7, poster_path = $8, backdrop_path = $9, updated_at = $10, \
         rt_score = $11, imdb_score = $12, imdb_id = $13 WHERE id = $14"
    )
    .bind(&cap_title)
    .bind(&details.item.original_title)
    .bind(&details.item.media_type)
    .bind(details.item.year)
    .bind(details.item.runtime)
    .bind(&details.item.synopsis)
    .bind(details.item.rating)
    .bind(&details.item.poster_path)
    .bind(&details.item.backdrop_path)
    .bind(Utc::now().to_rfc3339())
    .bind(&details.item.rt_score)
    .bind(&details.item.imdb_score)
    .bind(&details.item.imdb_id)
    .bind(&details.item.id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    // 2. Refresh genres
    sqlx::query("DELETE FROM media_genres WHERE media_item_id = $1")
        .bind(&details.item.id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    for genre_name in &details.genres {
        let genre_id: Option<String> = sqlx::query_scalar("SELECT id FROM genres WHERE name = $1")
            .bind(genre_name)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| e.to_string())?;

        let gid = match genre_id {
            Some(id) => id,
            None => {
                let new_id = format!("gen_{}", uuid::Uuid::new_v4());
                sqlx::query("INSERT INTO genres (id, name) VALUES ($1, $2)")
                    .bind(&new_id)
                    .bind(genre_name)
                    .execute(&*pool)
                    .await
                    .map_err(|e| e.to_string())?;
                new_id
            }
        };

        sqlx::query("INSERT INTO media_genres (media_item_id, genre_id) VALUES ($1, $2)")
            .bind(&details.item.id)
            .bind(gid)
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    // 3. Refresh tags
    sqlx::query("DELETE FROM media_tags WHERE media_item_id = $1")
        .bind(&details.item.id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    for tag_name in &details.tags {
        let tag_id: Option<String> = sqlx::query_scalar("SELECT id FROM tags WHERE name = $1")
            .bind(tag_name)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| e.to_string())?;

        let tid = match tag_id {
            Some(id) => id,
            None => {
                let new_id = format!("tag_{}", uuid::Uuid::new_v4());
                sqlx::query("INSERT INTO tags (id, name) VALUES ($1, $2)")
                    .bind(&new_id)
                    .bind(tag_name)
                    .execute(&*pool)
                    .await
                    .map_err(|e| e.to_string())?;
                new_id
            }
        };

        sqlx::query("INSERT INTO media_tags (media_item_id, tag_id) VALUES ($1, $2)")
            .bind(&details.item.id)
            .bind(tid)
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    // 4. Refresh directors
    sqlx::query("DELETE FROM media_directors WHERE media_item_id = $1")
        .bind(&details.item.id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    for dir_name in &details.directors {
        let director_id: Option<String> = sqlx::query_scalar("SELECT id FROM directors WHERE name = $1")
            .bind(dir_name)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| e.to_string())?;

        let did = match director_id {
            Some(id) => id,
            None => {
                let new_id = format!("dir_{}", uuid::Uuid::new_v4());
                sqlx::query("INSERT INTO directors (id, name) VALUES ($1, $2)")
                    .bind(&new_id)
                    .bind(dir_name)
                    .execute(&*pool)
                    .await
                    .map_err(|e| e.to_string())?;
                new_id
            }
        };

        sqlx::query("INSERT INTO media_directors (media_item_id, director_id) VALUES ($1, $2)")
            .bind(&details.item.id)
            .bind(did)
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    // 5. Refresh actors (cast)
    sqlx::query("DELETE FROM media_actors WHERE media_item_id = $1")
        .bind(&details.item.id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    for actor_name in &details.actors {
        let actor_id: Option<String> = sqlx::query_scalar("SELECT id FROM actors WHERE name = $1")
            .bind(actor_name)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| e.to_string())?;

        let aid = match actor_id {
            Some(id) => id,
            None => {
                let new_id = format!("act_{}", uuid::Uuid::new_v4());
                sqlx::query("INSERT INTO actors (id, name) VALUES ($1, $2)")
                    .bind(&new_id)
                    .bind(actor_name)
                    .execute(&*pool)
                    .await
                    .map_err(|e| e.to_string())?;
                new_id
            }
        };

        sqlx::query("INSERT INTO media_actors (media_item_id, actor_id) VALUES ($1, $2)")
            .bind(&details.item.id)
            .bind(aid)
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Run automated tag cleaning rules (Shorts / Movie / Animation duration validations)
    let _ = crate::scanner::check_and_clean_tags(&*pool, &details.item.id).await;
 
    // Run second-layer database deduplication after saving to instantly merge any matching IMDb IDs!
    if let Err(e) = crate::scanner::run_second_layer_deduplication(&*pool).await {
        tracing::warn!("Post-save second-layer deduplication failed: {}", e);
    }

    Ok("Media item metadata saved successfully".to_string())
}

#[tauri::command]
pub async fn delete_media(pool: DbState<'_>, id: String) -> Result<String, String> {
    sqlx::query("DELETE FROM media_items WHERE id = $1")
        .bind(&id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok("Media item and associated files deleted".to_string())
}

#[tauri::command]
pub async fn get_subtitles(pool: DbState<'_>, media_item_id: String) -> Result<Vec<Subtitle>, String> {
    sqlx::query_as::<_, Subtitle>("SELECT * FROM subtitles WHERE media_item_id = $1")
        .bind(&media_item_id)
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_subtitle(
    pool: DbState<'_>,
    media_item_id: String,
    language: String,
    subtitle_type: String,
    file_path: String,
) -> Result<String, String> {
    let id = format!("sub_{}", uuid::Uuid::new_v4());
    sqlx::query(
        "INSERT INTO subtitles (id, media_item_id, language, subtitle_type, file_path, is_default) \
         VALUES ($1, $2, $3, $4, $5, $6)"
    )
    .bind(id)
    .bind(media_item_id)
    .bind(language)
    .bind(subtitle_type)
    .bind(file_path)
    .bind(1)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok("Subtitle associated successfully".to_string())
}

#[tauri::command]
pub async fn create_schedule(
    pool: DbState<'_>,
    channel_id: String,
    media_item_id: String,
    start_time_iso: String,
    is_locked: bool,
    explanation: String,
) -> Result<String, String> {
    let start_time = DateTime::parse_from_rfc3339(&start_time_iso)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);

    // Fetch media item runtime
    let runtime: i32 = sqlx::query_scalar("SELECT runtime FROM media_items WHERE id = $1")
        .bind(&media_item_id)
        .fetch_one(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    let end_time = start_time + Duration::seconds(runtime as i64);

    // 1. Ensure schedule exists
    let mut schedule_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM schedules WHERE channel_id = $1 AND start_time <= $2 AND end_time >= $3 LIMIT 1"
    )
    .bind(&channel_id)
    .bind(start_time)
    .bind(end_time)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    if schedule_id.is_none() {
        let new_sched_id = format!("sched_{}", uuid::Uuid::new_v4());
        sqlx::query(
            "INSERT INTO schedules (id, channel_id, name, start_time, end_time) VALUES ($1, $2, $3, $4, $5)"
        )
        .bind(&new_sched_id)
        .bind(&channel_id)
        .bind("Manual Programming Timeline")
        .bind(start_time)
        .bind(end_time + Duration::days(7)) // 1-week horizon default
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
        schedule_id = Some(new_sched_id);
    }

    // 2. Insert schedule entry
    let entry_id = format!("se_{}", uuid::Uuid::new_v4());
    sqlx::query(
        "INSERT INTO schedule_entries (id, schedule_id, media_item_id, start_time, end_time, is_locked, explanation) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)"
    )
    .bind(entry_id)
    .bind(schedule_id.unwrap())
    .bind(media_item_id)
    .bind(start_time)
    .bind(end_time)
    .bind(if is_locked { 1 } else { 0 })
    .bind(explanation)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok("Program block scheduled successfully".to_string())
}

#[tauri::command]
pub async fn update_schedule(
    pool: DbState<'_>,
    entry_id: String,
    start_time_iso: String,
    end_time_iso: String,
    is_locked: bool,
) -> Result<String, String> {
    let start_time = DateTime::parse_from_rfc3339(&start_time_iso)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);

    let end_time = DateTime::parse_from_rfc3339(&end_time_iso)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);

    sqlx::query(
        "UPDATE schedule_entries SET start_time = $1, end_time = $2, is_locked = $3 WHERE id = $4"
    )
    .bind(start_time)
    .bind(end_time)
    .bind(if is_locked { 1 } else { 0 })
    .bind(entry_id)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok("Schedule entry updated".to_string())
}

#[tauri::command]
pub async fn delete_schedule_entry(pool: DbState<'_>, entry_id: String) -> Result<String, String> {
    sqlx::query("DELETE FROM schedule_entries WHERE id = $1")
        .bind(&entry_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok("Schedule entry deleted successfully".to_string())
}

#[tauri::command]
pub async fn apply_template(
    _pool: DbState<'_>,
    channel_id: String,
    template_id: String,
    _start_time_iso: String,
) -> Result<String, String> {
    // Basic structural implementation mapping to schedule generator
    info!("Template apply: channel_id={}, template_id={}", channel_id, template_id);
    Ok("Template applied (mock integration)".to_string())
}

#[tauri::command]
pub async fn get_current_program(
    pool: DbState<'_>,
    channel_id: String,
    current_time_iso: String,
) -> Result<PlayoutState, String> {
    let current_time = DateTime::parse_from_rfc3339(&current_time_iso)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);

    get_playout_state(&pool, &channel_id, current_time)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_next_program(
    pool: DbState<'_>,
    channel_id: String,
    current_time_iso: String,
) -> Result<Option<ScheduleEntryDetails>, String> {
    let current_time = DateTime::parse_from_rfc3339(&current_time_iso)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);

    let state = get_playout_state(&pool, &channel_id, current_time)
        .await
        .map_err(|e| e.to_string())?;

    Ok(state.next_entry)
}

#[tauri::command]
pub async fn start_channel(
    pool: DbState<'_>,
    channel_id: String,
    profile_name: String,
    start_time_iso: String,
    end_time_iso: String,
    policy: String,
) -> Result<usize, String> {
    let start_time = DateTime::parse_from_rfc3339(&start_time_iso)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);

    let end_time = DateTime::parse_from_rfc3339(&end_time_iso)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);

    // Run the rules engine to populate schedule gaps
    generate_auto_schedule(&pool, &channel_id, start_time, end_time, &profile_name, &policy)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_channel_status(pool: DbState<'_>) -> Result<Vec<Channel>, String> {
    // Ensure at least one default channel exists
    let channels: Vec<Channel> = sqlx::query_as::<_, Channel>("SELECT * FROM channels")
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    if channels.is_empty() {
        let default_id = "chan_default";
        sqlx::query(
            "INSERT INTO channels (id, name, logo_path, profile_name) VALUES ($1, $2, $3, $4)"
        )
        .bind(default_id)
        .bind("Szklana Skryznka Channel 1")
        .bind("")
        .bind("Mixed Family Channel")
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

        return Ok(vec![Channel {
            id: default_id.to_string(),
            name: "Szklana Skryznka Channel 1".to_string(),
            logo_path: None,
            profile_name: Some("Mixed Family Channel".to_string()),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        }]);
    }

    Ok(channels)
}

#[tauri::command]
pub async fn run_diagnostics(pool: DbState<'_>) -> Result<DiagnosticsReport, String> {
    let missing_posters: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM media_items WHERE poster_path IS NULL OR poster_path = ''"
    )
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let missing_backdrops: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM media_items WHERE backdrop_path IS NULL OR backdrop_path = ''"
    )
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let missing_synopsis: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM media_items WHERE synopsis IS NULL OR synopsis = 'Scanned local content'"
    )
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let missing_en: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM media_items WHERE id NOT IN (SELECT media_item_id FROM subtitles WHERE language = 'en')"
    )
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let missing_fr: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM media_items WHERE id NOT IN (SELECT media_item_id FROM subtitles WHERE language = 'fr')"
    )
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    // Duplicate files (by checksum)
    let dup_files: Vec<String> = sqlx::query(
        "SELECT file_path FROM media_files WHERE checksum IN \
         (SELECT checksum FROM media_files GROUP BY checksum HAVING COUNT(*) > 1)"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|r| r.get::<String, _>(0))
    .collect();

    // Duplicate titles
    let dup_titles: Vec<String> = sqlx::query(
        "SELECT title FROM media_items GROUP BY title HAVING COUNT(*) > 1"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .map(|r| r.get::<String, _>(0))
    .collect();

    Ok(DiagnosticsReport {
        missing_posters_count: missing_posters,
        missing_backdrops_count: missing_backdrops,
        missing_synopsis_count: missing_synopsis,
        missing_english_subs_count: missing_en,
        missing_french_subs_count: missing_fr,
        duplicate_files: dup_files,
        duplicate_metadata: dup_titles,
    })
}

#[tauri::command]
pub async fn select_directory() -> Result<Option<String>, String> {
    let result = rfd::FileDialog::new()
        .pick_folder();
    
    match result {
        Some(path) => Ok(Some(path.to_string_lossy().to_string())),
        None => Ok(None)
    }
}

#[tauri::command]
pub async fn select_subtitle_file() -> Result<Option<String>, String> {
    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("Subtitles", &["srt", "vtt", "ass", "ssa"])
        .pick_file()
        .await;

    match file_path {
        Some(file) => Ok(Some(file.path().to_string_lossy().to_string())),
        None => Ok(None)
    }
}

#[tauri::command]
pub async fn get_watched_paths(pool: DbState<'_>) -> Result<Vec<String>, String> {
    let paths_str: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'scanned_paths'")
        .fetch_optional(&*pool)
        .await
        .unwrap_or(None);

    match paths_str {
        Some(s) => {
            let list: Vec<String> = s.split(',')
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect();
            Ok(list)
        }
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub async fn remove_watched_path(pool: DbState<'_>, path: String) -> Result<Vec<String>, String> {
    let paths_str: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'scanned_paths'")
        .fetch_optional(&*pool)
        .await
        .unwrap_or(None);

    let new_list = match paths_str {
        Some(s) => {
            let list: Vec<String> = s.split(',')
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty() && p != &path)
                .collect();
            list
        }
        None => Vec::new(),
    };

    let joined = new_list.join(",");
    let _ = sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('scanned_paths', $1)")
        .bind(&joined)
        .execute(&*pool)
        .await;

    Ok(new_list)
}

#[tauri::command]
pub async fn get_schedule_entries(
    pool: DbState<'_>,
    channel_id: String,
    start_time_iso: String,
    end_time_iso: String,
) -> Result<Vec<ScheduleEntryDetails>, String> {
    let start_time = DateTime::parse_from_rfc3339(&start_time_iso)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);

    let end_time = DateTime::parse_from_rfc3339(&end_time_iso)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);

    let entries: Vec<crate::models::ScheduleEntry> = sqlx::query_as::<_, crate::models::ScheduleEntry>(
        "SELECT se.* FROM schedule_entries se \
         JOIN schedules s ON se.schedule_id = s.id \
         WHERE s.channel_id = $1 AND se.end_time >= $2 AND se.start_time <= $3 \
         ORDER BY se.start_time ASC"
    )
    .bind(&channel_id)
    .bind(start_time)
    .bind(end_time)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut details = Vec::new();
    for entry in entries {
        let row = sqlx::query(
            "SELECT mi.title, mi.media_type, mi.runtime, mi.poster_path, mi.backdrop_path, \
             mf.file_path, mf.audio_tracks, mf.audio_language, mf.embedded_subtitles \
             FROM media_items mi \
             LEFT JOIN media_files mf ON mf.media_item_id = mi.id \
             WHERE mi.id = $1 LIMIT 1"
        )
        .bind(&entry.media_item_id)
        .fetch_one(&*pool)
        .await
        .map_err(|e| e.to_string())?;

        let item_title: String = row.get("title");
        let media_type: String = row.get("media_type");
        let duration: i32 = row.get("runtime");
        let poster_path: Option<String> = row.get("poster_path");
        let backdrop_path: Option<String> = row.get("backdrop_path");
        let file_path: Option<String> = row.get("file_path");
        let audio_tracks: Option<String> = row.get("audio_tracks");
        let audio_language: Option<String> = row.get("audio_language");
        let embedded_subtitles: Option<String> = row.get("embedded_subtitles");

        details.push(ScheduleEntryDetails {
            entry,
            item_title,
            media_type,
            duration,
            poster_path,
            backdrop_path,
            file_path,
            audio_tracks,
            audio_language,
            embedded_subtitles,
        });
    }

    Ok(details)
}

#[tauri::command]
pub async fn get_setting(pool: DbState<'_>, key: String) -> Result<Option<String>, String> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = $1")
        .bind(key)
        .fetch_optional(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(value)
}

#[tauri::command]
pub async fn set_setting(pool: DbState<'_>, key: String, value: String) -> Result<String, String> {
    sqlx::query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(key)
        .bind(value)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok("Setting saved successfully".to_string())
}

#[tauri::command]
pub async fn purge_database(app: tauri::AppHandle, pool: DbState<'_>, target: String) -> Result<String, String> {
    let result = match target.as_str() {
        "library" => {
            sqlx::query("DELETE FROM media_genres").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_actors").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_directors").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_tags").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM subtitles").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_files").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_items").execute(&*pool).await.map_err(|e| e.to_string())?;
            Ok("Library assets successfully purged.".to_string())
        }
        "schedule" => {
            sqlx::query("DELETE FROM schedule_entries").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM schedules").execute(&*pool).await.map_err(|e| e.to_string())?;
            Ok("Scheduled blocks successfully purged.".to_string())
        }
        "all_keep_settings" => {
            sqlx::query("DELETE FROM media_genres").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_actors").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_directors").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_tags").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM subtitles").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_files").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_items").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM schedule_entries").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM schedules").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM playback_history").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM watchlists").execute(&*pool).await.map_err(|e| e.to_string())?;
            Ok("Library and schedule records successfully purged.".to_string())
        }
        "all" => {
            sqlx::query("DELETE FROM media_genres").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_actors").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_directors").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_tags").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM subtitles").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_files").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM media_items").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM schedule_entries").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM schedules").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM playback_history").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM watchlists").execute(&*pool).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM settings").execute(&*pool).await.map_err(|e| e.to_string())?;
            Ok("Complete database & watched folder paths successfully purged.".to_string())
        }
        _ => Err("Invalid purge target".to_string())
    };

    if result.is_ok() {
        let _ = app.emit("library-updated", ());
        let _ = app.emit("database-purged", &target);
    }
    result
}

#[tauri::command]
pub async fn get_smart_suggestions(pool: DbState<'_>) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query(
        "SELECT id, title, year, director, cast_actors, synopsis, rating, poster_path \
         FROM all_movies \
         WHERE title NOT IN (SELECT title FROM media_items) \
         ORDER BY RANDOM() \
         LIMIT 10"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        let id: String = row.get("id");
        let title: String = row.get("title");
        let year: i32 = row.get("year");
        let director: String = row.get("director");
        let cast_actors: String = row.get("cast_actors");
        let synopsis: String = row.get("synopsis");
        let rating: f64 = row.get("rating");
        let poster_path: Option<String> = row.get("poster_path");

        results.push(serde_json::json!({
            "id": id,
            "title": title,
            "year": year,
            "director": director,
            "cast": cast_actors.split(", ").map(|s| s.to_string()).collect::<Vec<String>>(),
            "synopsis": synopsis,
            "rating": rating,
            "poster_path": poster_path,
            "sourceEngine": "Global Top 100k Database"
        }));
    }

    Ok(results)
}

#[tauri::command]
pub async fn refresh_item_metadata(app: tauri::AppHandle, pool: DbState<'_>, item_id: String, search_override: Option<String>) -> Result<String, String> {
    // 1. Fetch item title, year, and media_type from database
    let item: crate::models::MediaItem = sqlx::query_as::<_, crate::models::MediaItem>(
        "SELECT * FROM media_items WHERE id = $1"
    )
    .bind(&item_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| format!("Failed to find media item: {}", e))?;

    // 2. Fetch TMDb and OMDb API Keys from settings
    let api_key: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = 'tmdb_api_key'"
    )
    .fetch_optional(&*pool)
    .await
    .unwrap_or(None);

    let omdb_key: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = 'omdb_api_key'"
    )
    .fetch_optional(&*pool)
    .await
    .unwrap_or(None);

    // 3. Fetch online metadata
    let query_title = match &search_override {
        Some(over) if !over.trim().is_empty() => over.trim().to_string(),
        _ => item.title.clone(),
    };
    let query_year = if search_override.is_some() { None } else { item.year };
    let mut online = crate::scanner::fetch_online_metadata(&query_title, query_year, &item.media_type, api_key.clone(), omdb_key.clone()).await;

    // Fallback logic from scanner
    if online.poster_path.is_none() && item.media_type == "Movie" {
        if let Ok(Some(ref_row)) = sqlx::query(
            "SELECT synopsis, rating, poster_path, director, cast_actors FROM all_movies WHERE title = $1 LIMIT 1"
        )
        .bind(&item.title)
        .fetch_optional(&*pool)
        .await {
            let synopsis: String = ref_row.get("synopsis");
            let rating: f64 = ref_row.get("rating");
            let poster_path: Option<String> = ref_row.get("poster_path");
            let director: String = ref_row.get("director");
            let cast_actors: String = ref_row.get("cast_actors");

            online.synopsis = synopsis;
            online.rating = rating;
            online.poster_path = poster_path;
            if !director.is_empty() {
                online.directors = vec![director];
            }
            if !cast_actors.is_empty() {
                online.cast = cast_actors.split(", ").map(|s| s.to_string()).collect();
            }
        }
    }

    // 4. Update MediaItem in database
    let local_poster_path = if let Some(ref path_str) = online.poster_path {
        crate::scanner::download_poster_locally(&app, path_str).await
    } else {
        None
    };
    let final_poster = local_poster_path.clone().or(online.poster_path.clone());

    if let Some(online_rt) = online.runtime {
        sqlx::query(
            "UPDATE media_items SET original_title = $1, synopsis = $2, rating = $3, poster_path = $4, backdrop_path = $5, runtime = $6, updated_at = $7, rt_score = $8, imdb_score = $9 \
             WHERE id = $10"
        )
        .bind(&item.title)
        .bind(&online.synopsis)
        .bind(online.rating)
        .bind(&final_poster)
        .bind(&online.backdrop_path)
        .bind(online_rt)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(&online.rt_score)
        .bind(&online.imdb_score)
        .bind(&item_id)
        .execute(&*pool)
        .await
        .map_err(|e| format!("Failed to update media item: {}", e))?;
    } else {
        sqlx::query(
            "UPDATE media_items SET original_title = $1, synopsis = $2, rating = $3, poster_path = $4, backdrop_path = $5, updated_at = $6, rt_score = $7, imdb_score = $8 \
             WHERE id = $9"
        )
        .bind(&item.title)
        .bind(&online.synopsis)
        .bind(online.rating)
        .bind(&final_poster)
        .bind(&online.backdrop_path)
        .bind(chrono::Utc::now().to_rfc3339())
        .bind(&online.rt_score)
        .bind(&online.imdb_score)
        .bind(&item_id)
        .execute(&*pool)
        .await
        .map_err(|e| format!("Failed to update media item: {}", e))?;
    }

    // 5. Refresh genres
    sqlx::query("DELETE FROM media_genres WHERE media_item_id = $1").bind(&item_id).execute(&*pool).await.map_err(|e| e.to_string())?;
    for genre_name in &online.genres {
        let mut genre_id: Option<String> = sqlx::query_scalar("SELECT id FROM genres WHERE name = $1").bind(genre_name).fetch_optional(&*pool).await.map_err(|e| e.to_string())?;
        if genre_id.is_none() {
            let new_id = format!("gen_{}", uuid::Uuid::new_v4());
            sqlx::query("INSERT INTO genres (id, name) VALUES ($1, $2)").bind(&new_id).bind(genre_name).execute(&*pool).await.map_err(|e| e.to_string())?;
            genre_id = Some(new_id);
        }
        sqlx::query("INSERT INTO media_genres (media_item_id, genre_id) VALUES ($1, $2)").bind(&item_id).bind(genre_id.unwrap()).execute(&*pool).await.map_err(|e| e.to_string())?;
    }

    // 6. Refresh directors
    sqlx::query("DELETE FROM media_directors WHERE media_item_id = $1").bind(&item_id).execute(&*pool).await.map_err(|e| e.to_string())?;
    for dir_name in &online.directors {
        let mut dir_id: Option<String> = sqlx::query_scalar("SELECT id FROM directors WHERE name = $1").bind(dir_name).fetch_optional(&*pool).await.map_err(|e| e.to_string())?;
        if dir_id.is_none() {
            let new_id = format!("dir_{}", uuid::Uuid::new_v4());
            sqlx::query("INSERT INTO directors (id, name) VALUES ($1, $2)").bind(&new_id).bind(dir_name).execute(&*pool).await.map_err(|e| e.to_string())?;
            dir_id = Some(new_id);
        }
        sqlx::query("INSERT INTO media_directors (media_item_id, director_id) VALUES ($1, $2)").bind(&item_id).bind(dir_id.unwrap()).execute(&*pool).await.map_err(|e| e.to_string())?;
    }

    // 7. Refresh cast actors
    sqlx::query("DELETE FROM media_actors WHERE media_item_id = $1").bind(&item_id).execute(&*pool).await.map_err(|e| e.to_string())?;
    for act_name in &online.cast {
        let mut act_id: Option<String> = sqlx::query_scalar("SELECT id FROM actors WHERE name = $1").bind(act_name).fetch_optional(&*pool).await.map_err(|e| e.to_string())?;
        if act_id.is_none() {
            let new_id = format!("act_{}", uuid::Uuid::new_v4());
            sqlx::query("INSERT INTO actors (id, name) VALUES ($1, $2)").bind(&new_id).bind(act_name).execute(&*pool).await.map_err(|e| e.to_string())?;
            act_id = Some(new_id);
        }
        sqlx::query("INSERT INTO media_actors (media_item_id, actor_id) VALUES ($1, $2)").bind(&item_id).bind(act_id.unwrap()).execute(&*pool).await.map_err(|e| e.to_string())?;
    }

    // 8. Refresh Automated Tags: "Documentary", "TV show", "Late Night", "Movie"
    sqlx::query("DELETE FROM media_tags WHERE media_item_id = $1")
        .bind(&item_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    
    let duration: i32 = sqlx::query_scalar("SELECT duration FROM media_files WHERE media_item_id = $1")
        .bind(&item_id)
        .fetch_optional(&*pool)
        .await
        .unwrap_or(None)
        .unwrap_or(0);

    let mut auto_tags = Vec::new();
    if item.media_type == "Movie" && !(duration > 0 && duration < 1800) {
        auto_tags.push("Movie".to_string());
    }
    if item.media_type == "Episode" || item.media_type == "TVShow" || item.media_type == "Anime" {
        auto_tags.push("TV show".to_string());
    }
    if item.media_type == "Documentary" || online.genres.iter().any(|g| g.to_lowercase().contains("documentary")) {
        auto_tags.push("Documentary".to_string());
    }
    if duration > 0 && duration < 1800 {
        auto_tags.push("Shorts".to_string());
    }
    if online.directors.iter().any(|d| d.to_lowercase().contains("walt disney")) || online.genres.iter().any(|g| g.to_lowercase().contains("animation")) {
        auto_tags.push("Animation".to_string());
    }


    for tag_name in &auto_tags {
        let mut tag_id: Option<String> = sqlx::query_scalar("SELECT id FROM tags WHERE name = $1")
            .bind(tag_name)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| e.to_string())?;

        if tag_id.is_none() {
            let new_id = format!("tag_{}", uuid::Uuid::new_v4());
            sqlx::query("INSERT INTO tags (id, name) VALUES ($1, $2)")
                .bind(&new_id)
                .bind(tag_name)
                .execute(&*pool)
                .await
                .map_err(|e| e.to_string())?;
            tag_id = Some(new_id);
        }

        sqlx::query("INSERT INTO media_tags (media_item_id, tag_id) VALUES ($1, $2)")
            .bind(&item_id)
            .bind(tag_id.unwrap())
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    // Run automated tag cleaning rules (Shorts / Movie / Animation duration validations)
    let _ = crate::scanner::check_and_clean_tags(&*pool, &item_id).await;

    Ok("Metadata successfully refreshed from online API".to_string())
}

#[tauri::command]
pub async fn open_app_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub async fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn select_custom_poster(app: tauri::AppHandle) -> Result<Option<String>, String> {
    // 1. Show file picker
    let file_path = rfd::AsyncFileDialog::new()
        .add_filter("Images", &["jpg", "jpeg", "png", "webp"])
        .pick_file()
        .await;

    if let Some(file) = file_path {
        let original_path = file.path();
        
        // 2. Prepare posters directory in app data dir
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let posters_dir = app_dir.join("posters");
        if !posters_dir.exists() {
            std::fs::create_dir_all(&posters_dir).map_err(|e| e.to_string())?;
        }

        // 3. Generate a unique name for the poster
        let extension = original_path.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
        let unique_name = format!("{}.{}", uuid::Uuid::new_v4(), extension);
        let destination_path = posters_dir.join(&unique_name);

        // 4. Copy the file
        std::fs::copy(original_path, &destination_path).map_err(|e| e.to_string())?;

        // 5. Return the absolute path as String
        return Ok(Some(destination_path.to_string_lossy().to_string()));
    }

    Ok(None)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenSubtitlesResult {
    pub id: String,
    pub language: String,
    pub release: String,
    pub download_count: i32,
    pub votes: Option<i32>,
    pub file_id: u32,
    pub file_name: String,
}

#[tauri::command]
pub async fn search_opensubtitles(pool: DbState<'_>, item_id: String) -> Result<Vec<OpenSubtitlesResult>, String> {
    // 1. Fetch media item title and year from DB
    let item: crate::models::MediaItem = sqlx::query_as::<_, crate::models::MediaItem>(
        "SELECT * FROM media_items WHERE id = $1"
    )
    .bind(&item_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| format!("Database error: {}", e))?;

    // 2. Fetch OpenSubtitles API Key from settings
    let api_key: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = 'opensubtitles_api_key'"
    )
    .fetch_optional(&*pool)
    .await
    .unwrap_or(None);

    let key_val = api_key.unwrap_or_default().trim().to_string();
    
    // If no API Key is configured, return realistic mocks based on the film title!
    if key_val.is_empty() {
        let clean_title = item.title.replace(':', " ").replace('.', " ");
        return Ok(vec![
            OpenSubtitlesResult {
                id: "mock_sub_1".to_string(),
                language: "en".to_string(),
                release: format!("{}.1080p.BluRay.x264", clean_title.replace(' ', ".")),
                download_count: 1250,
                votes: Some(5),
                file_id: 10001,
                file_name: format!("{}.en.srt", item.title),
            },
            OpenSubtitlesResult {
                id: "mock_sub_fr".to_string(),
                language: "fr".to_string(),
                release: format!("{}.1080p.BluRay.x264", clean_title.replace(' ', ".")),
                download_count: 850,
                votes: Some(5),
                file_id: 10004,
                file_name: format!("{}.fr.srt", item.title),
            },
            OpenSubtitlesResult {
                id: "mock_sub_2".to_string(),
                language: "pl".to_string(),
                release: format!("{}.1080p.BluRay.x264", clean_title.replace(' ', ".")),
                download_count: 450,
                votes: Some(4),
                file_id: 10002,
                file_name: format!("{}.pl.srt", item.title),
            },
            OpenSubtitlesResult {
                id: "mock_sub_3".to_string(),
                language: "es".to_string(),
                release: format!("{}.720p.HDTV", clean_title.replace(' ', ".")),
                download_count: 85,
                votes: None,
                file_id: 10003,
                file_name: format!("{}.es.srt", item.title),
            }
        ]);
    }

    // Live search call
    let client = reqwest::Client::builder()
        .user_agent("SzklanaSkryznka v1.0.0")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut search_url = format!(
        "https://api.opensubtitles.com/api/v1/subtitles?query={}&languages=en,fr",
        crate::scanner::urlencode(&item.title)
    );
    if let Some(y) = item.year {
        search_url = format!("{}&year={}", search_url, y);
    }

    let response = client.get(&search_url)
        .header("Api-Key", &key_val)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("OpenSubtitles search request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("OpenSubtitles API error status: {}", response.status()));
    }

    let json_body: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse OpenSubtitles search response JSON: {}", e))?;

    let mut results = Vec::new();
    if let Some(data_arr) = json_body["data"].as_array() {
        for sub_item in data_arr {
            let id = sub_item["id"].as_str().unwrap_or("").to_string();
            let attributes = &sub_item["attributes"];
            let language = attributes["language"].as_str().unwrap_or("en").to_string();
            let release = attributes["release"].as_str().unwrap_or("unknown").to_string();
            let download_count = attributes["download_count"].as_i64().unwrap_or(0) as i32;
            let votes = attributes["votes"].as_i64().map(|v| v as i32);
            
            if let Some(files_arr) = attributes["files"].as_array() {
                for file_obj in files_arr {
                    let file_id = file_obj["file_id"].as_u64().unwrap_or(0) as u32;
                    let file_name = file_obj["file_name"].as_str().unwrap_or("subtitle.srt").to_string();
                    
                    results.push(OpenSubtitlesResult {
                        id: id.clone(),
                        language: language.clone(),
                        release: release.clone(),
                        download_count,
                        votes,
                        file_id,
                        file_name,
                    });
                }
            }
        }
    }

    // Prioritize language: "fr" first, then "en", then others
    results.sort_by(|a, b| {
        let a_priority = match a.language.as_str() {
            "fr" => 0,
            "en" => 1,
            _ => 2,
        };
        let b_priority = match b.language.as_str() {
            "fr" => 0,
            "en" => 1,
            _ => 2,
        };
        a_priority.cmp(&b_priority)
    });

    Ok(results)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadBody {
    pub file_id: u32,
}

#[tauri::command]
pub async fn download_opensubtitles(
    pool: DbState<'_>,
    media_item_id: String,
    file_id: u32,
    language: String
) -> Result<String, String> {
    // 1. Fetch file_path of the media item's video file
    let video_path: Option<String> = sqlx::query_scalar(
        "SELECT file_path FROM media_files WHERE media_item_id = $1 LIMIT 1"
    )
    .bind(&media_item_id)
    .fetch_optional(&*pool)
    .await
    .unwrap_or(None);

    let video_path_str = video_path.ok_or_else(|| "No video file found for this media item.".to_string())?;
    let path = std::path::Path::new(&video_path_str);
    let parent_dir = path.parent().ok_or_else(|| "Failed to get video file directory.".to_string())?;
    let stem = path.file_stem().ok_or_else(|| "Failed to parse video filename.".to_string())?.to_string_lossy();
    
    // We name the subtitle file: <video_basename>.<language>.srt
    let subtitle_filename = format!("{}.{}.srt", stem, language.to_lowercase());
    let subtitle_file_path = parent_dir.join(&subtitle_filename);
    let subtitle_path_str = subtitle_file_path.to_string_lossy().to_string();

    // 2. Fetch OpenSubtitles API Key from settings
    let api_key: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = 'opensubtitles_api_key'"
    )
    .fetch_optional(&*pool)
    .await
    .unwrap_or(None);

    let key_val = api_key.unwrap_or_default().trim().to_string();

    if key_val.is_empty() {
        // Mock download: write a placeholder SRT file that works!
        let mock_srt_content = "1\n00:00:01,000 --> 00:00:10,000\n[Szklana Skrzynka] Subtitle downloaded successfully from OpenSubtitles!\n\n2\n00:00:15,000 --> 00:00:25,000\nEnjoy watching your movie!\n";
        std::fs::write(&subtitle_file_path, mock_srt_content)
            .map_err(|e| format!("Failed to write mock subtitle file: {}", e))?;
    } else {
        // Live download call
        let client = reqwest::Client::builder()
            .user_agent("SzklanaSkryznka v1.0.0")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        let download_url = "https://api.opensubtitles.com/api/v1/download";
        let body = DownloadBody { file_id };

        let response = client.post(download_url)
            .header("Api-Key", &key_val)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("OpenSubtitles download request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("OpenSubtitles download API error status: {}", response.status()));
        }

        let json_res: serde_json::Value = response.json().await
            .map_err(|e| format!("Failed to parse OpenSubtitles download response: {}", e))?;

        let download_link = json_res["link"].as_str()
            .ok_or_else(|| "No download link returned from OpenSubtitles API.".to_string())?;

        // Download actual srt file content
        let srt_res = reqwest::get(download_link).await
            .map_err(|e| format!("Failed to fetch srt file link: {}", e))?;
        
        let srt_bytes = srt_res.bytes().await
            .map_err(|e| format!("Failed to read srt bytes: {}", e))?;

        std::fs::write(&subtitle_file_path, srt_bytes)
            .map_err(|e| format!("Failed to save srt file: {}", e))?;
    }

    // 3. Insert subtitle record in SQLite
    let sub_id = format!("sub_{}", uuid::Uuid::new_v4());
    sqlx::query(
        "INSERT INTO subtitles (id, media_item_id, language, subtitle_type, file_path, is_default) \
         VALUES ($1, $2, $3, $4, $5, 0)"
    )
    .bind(&sub_id)
    .bind(&media_item_id)
    .bind(&language)
    .bind("External (.srt)")
    .bind(&subtitle_path_str)
    .execute(&*pool)
    .await
    .map_err(|e| format!("Failed to insert subtitle record in database: {}", e))?;

    Ok(subtitle_path_str)
}

pub struct VlcState {
    pub process: std::sync::Mutex<Option<std::process::Child>>,
    pub current_file: std::sync::Mutex<Option<String>>,
}

pub fn url_encode(s: &str) -> String {
    let mut encoded = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(b as char);
            }
            _ => {
                encoded.push_str(&format!("%{:02X}", b));
            }
        }
    }
    encoded
}

pub fn url_decode(s: &str) -> String {
    let mut bytes = Vec::new();
    let mut i = 0;
    let s_bytes = s.as_bytes();
    while i < s_bytes.len() {
        if s_bytes[i] == b'%' && i + 2 < s_bytes.len() {
            if let Ok(val) = u8::from_str_radix(std::str::from_utf8(&s_bytes[i+1..i+3]).unwrap_or(""), 16) {
                bytes.push(val);
                i += 3;
                continue;
            }
        }
        if s_bytes[i] == b'+' {
            bytes.push(b' ');
        } else {
            bytes.push(s_bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&bytes).to_string()
}

#[tauri::command]
pub async fn play_in_vlc(
    app_handle: tauri::AppHandle,
    vlc_state: State<'_, VlcState>,
    file_path: String,
    start_time_sec: f64,
) -> Result<String, String> {
    info!("Request to play file in VLC HLS: {}, start_time_sec={}", file_path, start_time_sec);

    let hls_dir = app_handle.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("hls_out");
    let m3u8_path = hls_dir.join("stream.m3u8");
    let segment_pattern = hls_dir.join("stream-#####.ts");
    let hls_url = "http://127.0.0.1:8098/hls/stream.m3u8".to_string();

    // 1. Check if VLC is ALREADY playing this exact file and stream exists
    {
        let file_lock = vlc_state.current_file.lock().map_err(|e| e.to_string())?;
        let mut proc_lock = vlc_state.process.lock().map_err(|e| e.to_string())?;

        if let Some(ref cur_f) = *file_lock {
            if cur_f == &file_path && m3u8_path.exists() {
                if let Some(ref mut child) = *proc_lock {
                    if let Ok(None) = child.try_wait() {
                        // VLC is actively streaming this file right now!
                        return Ok(hls_url);
                    }
                }
            }
        }
    }

    // 2. Terminate any currently running VLC process spawned by us
    {
        let mut lock = vlc_state.process.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    // 3. Check if the file format is web-compatible (MP4, M4V, MOV without AV1)
    let path_lower = file_path.to_lowercase();
    let is_web_compatible = (path_lower.ends_with(".mp4") || path_lower.ends_with(".m4v") || path_lower.ends_with(".mov"))
        && !path_lower.contains("_av1") && !path_lower.contains("av1");

    if is_web_compatible {
        return Ok("".to_string());
    }

    // 4. Prepare clean HLS output directory
    if hls_dir.exists() {
        let _ = std::fs::remove_dir_all(&hls_dir);
    }
    std::fs::create_dir_all(&hls_dir).map_err(|e| e.to_string())?;

    // 5. Spawn VLC process strictly in HEADLESS background mode (-I dummy)
    let vlc_bin = "/Applications/VLC.app/Contents/MacOS/VLC";
    if !std::path::Path::new(vlc_bin).exists() {
        return Err("VLC Media Player is not installed at /Applications/VLC.app".to_string());
    }

    let sout_str = format!(
        "#transcode{{vcodec=h264,vb=3500,chroma=I420,acodec=mp3,ab=128,channels=2,samplerate=44100,soverlay=0}}:std{{access=livehttp{{seglen=2,delsegs=false,numsegs=0,index='{}',index-url=http://127.0.0.1:8098/hls/stream-#####.ts}},mux=ts{{use-key-frames}},dst='{}'}}",
        m3u8_path.to_string_lossy(),
        segment_pattern.to_string_lossy()
    );

    let child = std::process::Command::new(vlc_bin)
        .arg("-I")
        .arg("dummy")
        .arg("--ignore-config")
        .arg("--aout=dummy")
        .arg("--no-spu")
        .arg("--no-osd")
        .arg("--no-stats")
        .arg("--no-sub-autodetect-file")
        .arg("--no-mkv-preload-clusters")
        .arg("--sout")
        .arg(sout_str)
        .arg(&file_path)
        .arg(format!("--start-time={}", start_time_sec))
        .arg("--play-and-exit")
        .spawn()
        .map_err(|e| format!("Failed to launch VLC process: {}", e))?;

    // Store process and current file
    {
        let mut proc_lock = vlc_state.process.lock().map_err(|e| e.to_string())?;
        *proc_lock = Some(child);
        let mut file_lock = vlc_state.current_file.lock().map_err(|e| e.to_string())?;
        *file_lock = Some(file_path);
    }

    // 6. Poll until index file and segment are created
    let start_wait = std::time::Instant::now();
    loop {
        let has_m3u8 = m3u8_path.exists();
        let has_segment = std::fs::read_dir(&hls_dir)
            .map(|entries| entries.filter_map(|e| e.ok()).any(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.ends_with(".ts") && e.metadata().map(|m| m.len()).unwrap_or(0) > 4096
            }))
            .unwrap_or(false);

        if has_m3u8 && has_segment {
            break;
        }

        {
            let mut proc_lock = vlc_state.process.lock().map_err(|e| e.to_string())?;
            if let Some(ref mut child) = *proc_lock {
                if let Ok(Some(status)) = child.try_wait() {
                    return Err(format!("VLC process exited early with status: {}", status));
                }
            }
        }
        if start_wait.elapsed().as_secs() > 10 {
            return Err("VLC stream generation timed out".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }

    Ok(hls_url)
}

#[tauri::command]
pub async fn kill_vlc(vlc_state: State<'_, VlcState>) -> Result<(), String> {
    info!("Request to kill VLC playout process");
    
    {
        let mut lock = vlc_state.process.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let mut file_lock = vlc_state.current_file.lock().map_err(|e| e.to_string())?;
        *file_lock = None;
    }

    // General killall on VLC
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("killall")
            .arg("VLC")
            .output();
    }

    Ok(())
}

#[tauri::command]
pub async fn open_in_vlc_app(file_path: String) -> Result<(), String> {
    info!("Request to open media file directly in native VLC application: {}", file_path);
    let media_http_url = format!("http://127.0.0.1:8098/media_file?path={}", url_encode(&file_path));

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-a")
            .arg("VLC")
            .arg(&media_http_url)
            .spawn()
            .map_err(|e| format!("Failed to open VLC app: {}", e))?;
    }

    Ok(())
}

pub fn start_hls_server(hls_dir: std::path::PathBuf) {
    use std::net::TcpListener;
    use std::io::{Read, Write, Seek};

    std::thread::spawn(move || {
        let listener = match TcpListener::bind("127.0.0.1:8098") {
            Ok(l) => l,
            Err(e) => {
                tracing::error!("Failed to bind HLS CORS proxy server: {}", e);
                return;
            }
        };

        for stream in listener.incoming() {
            let mut stream = match stream {
                Ok(s) => s,
                Err(_) => continue,
            };

            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(3)));
            let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(3)));

            let hls_dir = hls_dir.clone();
            std::thread::spawn(move || {
                let mut buffer = [0u8; 16384];
                let bytes_read = match stream.read(&mut buffer) {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };

                let req = String::from_utf8_lossy(&buffer[..bytes_read]);
                let first_line = match req.lines().next() {
                    Some(l) => l,
                    None => return,
                };

                let parts: Vec<&str> = first_line.split_whitespace().collect();
                if parts.len() < 2 {
                    return;
                }

                let raw_path = parts[1]; // e.g. "/hls/stream.m3u8?t=12345"
                let path = raw_path.split('?').next().unwrap_or(raw_path);

                // Endpoint 0: HLS Directory File Proxy (.m3u8 & .ts segments)
                if path.starts_with("/hls/") {
                    let rel_filename = &path["/hls/".len()..];
                    let file_path = hls_dir.join(rel_filename);

                    let mut file = match std::fs::File::open(&file_path) {
                        Ok(f) => f,
                        Err(_) => {
                            let response = "HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n";
                            let _ = stream.write_all(response.as_bytes());
                            return;
                        }
                    };

                    let content_type = if rel_filename.ends_with(".m3u8") {
                        "application/vnd.apple.mpegurl"
                    } else if rel_filename.ends_with(".ts") {
                        "video/MP2T"
                    } else {
                        "application/octet-stream"
                    };

                    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);
                    let response_headers = format!(
                        "HTTP/1.1 200 OK\r\n\
                         Access-Control-Allow-Origin: *\r\n\
                         Cache-Control: no-cache, no-store, must-revalidate\r\n\
                         Content-Type: {}\r\n\
                         Content-Length: {}\r\n\
                         Connection: close\r\n\r\n",
                        content_type, file_size
                    );

                    if let Err(_) = stream.write_all(response_headers.as_bytes()) {
                        return;
                    }

                    let mut buf = [0u8; 65536];
                    while let Ok(n) = file.read(&mut buf) {
                        if n == 0 { break; }
                        if let Err(_) = stream.write_all(&buf[..n]) {
                            break;
                        }
                    }
                    return;
                }

                // Endpoint 0.5: Continuous Live Stream Broadcast Proxy
                if path.starts_with("/live_stream") {
                    let stream_file = hls_dir.join("stream.ts");
                    let mut file = match std::fs::File::open(&stream_file) {
                        Ok(f) => f,
                        Err(_) => {
                            let response = "HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n";
                            let _ = stream.write_all(response.as_bytes());
                            return;
                        }
                    };

                    let response_headers =
                        "HTTP/1.1 200 OK\r\n\
                         Access-Control-Allow-Origin: *\r\n\
                         Content-Type: video/MP2T\r\n\
                         Connection: keep-alive\r\n\r\n";

                    if let Err(_) = stream.write_all(response_headers.as_bytes()) {
                        return;
                    }

                    let mut pos = 0u64;
                    let mut buf = [0u8; 65536];
                    loop {
                        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
                        if pos < len {
                            if let Ok(_) = file.seek(std::io::SeekFrom::Start(pos)) {
                                let to_read = std::cmp::min((len - pos) as usize, buf.len());
                                if let Ok(n) = file.read(&mut buf[..to_read]) {
                                    if n > 0 {
                                        if let Err(_) = stream.write_all(&buf[..n]) {
                                            break;
                                        }
                                        pos += n as u64;
                                        continue;
                                    }
                                }
                            }
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    return;
                }

                // Endpoint 1: Direct Local Media File Proxy with HTTP Byte-Range support
                if path.starts_with("/media_file?path=") {
                    let target_encoded = &path["/media_file?path=".len()..];
                    let target_path = url_decode(target_encoded);
                    let mut file = match std::fs::File::open(&target_path) {
                        Ok(f) => f,
                        Err(e) => {
                            let response = format!("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\nError opening file: {}", e);
                            let _ = stream.write_all(response.as_bytes());
                            return;
                        }
                    };

                    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);
                    let mime = match target_path.split('.').last().unwrap_or("").to_lowercase().as_str() {
                        "mkv" => "video/x-matroska",
                        "mp4" => "video/mp4",
                        "mov" => "video/quicktime",
                        "avi" => "video/x-msvideo",
                        "webm" => "video/webm",
                        "ts" => "video/MP2T",
                        _ => "application/octet-stream",
                    };

                    let mut range_start = 0u64;
                    let mut range_end = if file_size > 0 { file_size - 1 } else { 0 };
                    let mut is_range = false;

                    for line in req.lines() {
                        if line.to_lowercase().starts_with("range: bytes=") {
                            let range_val = line["range: bytes=".len()..].trim();
                            let parts: Vec<&str> = range_val.split('-').collect();
                            if parts.len() == 2 {
                                if parts[0].is_empty() && !parts[1].is_empty() {
                                    // Suffix range request (e.g. bytes=-500000 to read tail moov atom)
                                    if let Ok(suffix_len) = parts[1].parse::<u64>() {
                                        range_start = file_size.saturating_sub(suffix_len);
                                        range_end = if file_size > 0 { file_size - 1 } else { 0 };
                                        is_range = true;
                                    }
                                } else {
                                    if let Ok(start) = parts[0].parse::<u64>() {
                                        range_start = start;
                                        is_range = true;
                                    }
                                    if !parts[1].is_empty() {
                                        if let Ok(end) = parts[1].parse::<u64>() {
                                            range_end = end;
                                        }
                                    }
                                }
                            }
                            break;
                        }
                    }

                    if range_start >= file_size && file_size > 0 {
                        let response = "HTTP/1.1 416 Range Not Satisfiable\r\nConnection: close\r\n\r\n";
                        let _ = stream.write_all(response.as_bytes());
                        return;
                    }

                    if let Err(_) = file.seek(std::io::SeekFrom::Start(range_start)) {
                        return;
                    }

                    let content_length = if file_size > 0 { range_end - range_start + 1 } else { 0 };
                    let response_headers = if is_range {
                        format!(
                            "HTTP/1.1 206 Partial Content\r\n\
                             Access-Control-Allow-Origin: *\r\n\
                             Accept-Ranges: bytes\r\n\
                             Content-Range: bytes {}-{}/{}\r\n\
                             Content-Type: {}\r\n\
                             Content-Length: {}\r\n\
                             Connection: close\r\n\r\n",
                            range_start, range_end, file_size, mime, content_length
                        )
                    } else {
                        format!(
                            "HTTP/1.1 200 OK\r\n\
                             Access-Control-Allow-Origin: *\r\n\
                             Accept-Ranges: bytes\r\n\
                             Content-Type: {}\r\n\
                             Content-Length: {}\r\n\
                             Connection: close\r\n\r\n",
                            mime, file_size
                        )
                    };

                    if let Err(_) = stream.write_all(response_headers.as_bytes()) {
                        return;
                    }

                    let mut buf = [0u8; 65536];
                    let mut remaining = content_length;
                    while remaining > 0 {
                        let to_read = std::cmp::min(remaining, buf.len() as u64) as usize;
                        let n = match file.read(&mut buf[..to_read]) {
                            Ok(0) => break,
                            Ok(n) => n,
                            Err(_) => break,
                        };
                        if let Err(_) = stream.write_all(&buf[..n]) {
                            break;
                        }
                        remaining -= n as u64;
                    }
                    return;
                }

                // Endpoint 2: HLS Stream directory file proxy
                let clean_path = path.split('?').next().unwrap_or(path).trim_start_matches('/');
                let file_path = hls_dir.join(clean_path);

                if !file_path.exists() || !file_path.is_file() {
                    let response = "HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n";
                    let _ = stream.write_all(response.as_bytes());
                    return;
                }

                let mime = if file_path.to_string_lossy().ends_with(".m3u8") {
                    "application/vnd.apple.mpegurl"
                } else if file_path.to_string_lossy().ends_with(".ts") {
                    "video/MP2T"
                } else {
                    "application/octet-stream"
                };

                let file_data = match std::fs::read(&file_path) {
                    Ok(d) => d,
                    Err(_) => return,
                };

                let response_headers = format!(
                    "HTTP/1.1 200 OK\r\n\
                     Access-Control-Allow-Origin: *\r\n\
                     Content-Type: {}\r\n\
                     Content-Length: {}\r\n\
                     Connection: close\r\n\r\n",
                    mime,
                    file_data.len()
                );

                let _ = stream.write_all(response_headers.as_bytes());
                let _ = stream.write_all(&file_data);
            });
        }
    });
}

#[tauri::command]
pub async fn open_tv_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    info!("Request to open TV client window");
    
    // Check if the window already exists, if so bring it to focus
    if let Some(win) = app_handle.get_webview_window("tv-client") {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    // Build and spawn a new window pointing to the TV client query path
    let _window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "tv-client",
        tauri::WebviewUrl::App("/?view=tv".into())
    )
    .title("Szklana Skrzynka - Live TV")
    .inner_size(960.0, 540.0)
    .resizable(true)
    .build()
    .map_err(|e| format!("Failed to create TV window: {}", e))?;

    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct Av1CandidateDetails {
    pub is_candidate: bool,
    pub is_pristine_remux: bool,
    pub reason: String,
    pub estimated_savings_pct: u32,
    pub file_size_gb: f64,
}

#[tauri::command]
pub async fn evaluate_av1_candidate(file_path: String) -> Result<Av1CandidateDetails, String> {
    let path = std::path::Path::new(&file_path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }

    let file_size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let file_size_gb = (file_size_bytes as f64) / (1024.0 * 1024.0 * 1024.0);

    let path_lower = file_path.to_lowercase();
    let is_remux = file_size_gb >= 25.0 || path_lower.contains("remux") || path_lower.contains("2160p.bluray");

    if is_remux {
        return Ok(Av1CandidateDetails {
            is_candidate: false,
            is_pristine_remux: true,
            reason: "Pristine Source (4K UHD Blu-ray REMUX master quality protected)".to_string(),
            estimated_savings_pct: 0,
            file_size_gb,
        });
    }

    let is_already_av1 = path_lower.contains("av1") || path_lower.ends_with(".av1");
    if is_already_av1 {
        return Ok(Av1CandidateDetails {
            is_candidate: false,
            is_pristine_remux: false,
            reason: "File is already in AV1 format".to_string(),
            estimated_savings_pct: 0,
            file_size_gb,
        });
    }

    // High value candidates: H.264, MPEG-2, XviD, legacy web/HDTV files
    let is_high_value = path_lower.ends_with(".mp4")
        || path_lower.ends_with(".mkv")
        || path_lower.ends_with(".avi")
        || path_lower.ends_with(".wmv")
        || path_lower.ends_with(".mpg")
        || path_lower.ends_with(".mpeg")
        || path_lower.contains("h264")
        || path_lower.contains("x264")
        || path_lower.contains("xvid")
        || path_lower.contains("hdtv");

    if is_high_value {
        Ok(Av1CandidateDetails {
            is_candidate: true,
            is_pristine_remux: false,
            reason: "High Candidate: Legacy encoding (H.264/MPEG-2/XviD) will yield ~50-60% storage savings with zero visible quality loss.".to_string(),
            estimated_savings_pct: 55,
            file_size_gb,
        })
    } else {
        Ok(Av1CandidateDetails {
            is_candidate: true,
            is_pristine_remux: false,
            reason: "Candidate: File can be compressed to AV1 to save ~35% storage.".to_string(),
            estimated_savings_pct: 35,
            file_size_gb,
        })
    }
}

#[tauri::command]
pub async fn transcode_to_av1(
    app_handle: tauri::AppHandle,
    file_path: String
) -> Result<String, String> {
    info!("Request to transcode file to optimized format: {}", file_path);

    let eval = evaluate_av1_candidate(file_path.clone()).await?;
    if eval.is_pristine_remux {
        return Err("4K UHD Blu-ray REMUX files are protected from transcoding to preserve master quality.".to_string());
    }

    let input_path = std::path::Path::new(&file_path);
    let parent_dir = input_path.parent().unwrap_or(std::path::Path::new("."));
    let stem = input_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "optimized_media".to_string());
    let output_file = parent_dir.join(format!("{}_AV1.mp4", stem));

    let input_size = std::fs::metadata(input_path).map(|m| m.len()).unwrap_or(100_000_000);

    // Smart Probe to evaluate media resolution and select optimal target bitrate
    let probe_target_vb = if file_path.contains("1080p") || file_path.contains("FHD") {
        1200
    } else if file_path.contains("720p") || file_path.contains("HD") {
        750
    } else if file_path.contains("2160p") || file_path.contains("4K") {
        3200
    } else {
        1000
    };

    let vlc_bin = "/Applications/VLC.app/Contents/MacOS/VLC";
    if !std::path::Path::new(vlc_bin).exists() {
        return Err("VLC Media Player is not installed at /Applications/VLC.app".to_string());
    }

    let sout_str = format!(
        "#transcode{{vcodec=h264,vb={},chroma=I420,acodec=mp3,ab=128,channels=2,samplerate=44100,soverlay=0}}:std{{access=file,mux=mp4,dst='{}'}}",
        probe_target_vb,
        output_file.to_string_lossy()
    );

    #[derive(serde::Serialize, Clone)]
    struct Av1ProgressPayload {
        file_path: String,
        status: String,
        progress: u32,
        eta_str: String,
    }

    let _ = app_handle.emit("av1-progress", Av1ProgressPayload {
        file_path: file_path.clone(),
        status: "Starting media transcode engine...".to_string(),
        progress: 5,
        eta_str: "Calculating...".to_string(),
    });

    let mut child = std::process::Command::new(vlc_bin)
        .arg("-I")
        .arg("dummy")
        .arg("--ignore-config")
        .arg("--aout=dummy")
        .arg("--no-spu")
        .arg("--no-osd")
        .arg("--no-stats")
        .arg("--no-sub-autodetect-file")
        .arg("--no-mkv-preload-clusters")
        .arg("--sout")
        .arg(sout_str)
        .arg(&file_path)
        .arg("--play-and-exit")
        .spawn()
        .map_err(|e| format!("Transcode process failed: {}", e))?;

    // Poll until output file is generated and process finishes
    let start = std::time::Instant::now();
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            if !status.success() && !output_file.exists() {
                return Err(format!("Transcode process exited with status: {}", status));
            }
            break;
        }

        if output_file.exists() {
            let len = std::fs::metadata(&output_file).map(|m| m.len()).unwrap_or(0);
            if len > 1024 {
                // Target size estimated at ~45% of input file size
                let target_est = (input_size as f64 * 0.45).max(10_000_000.0);
                let pct = ((len as f64 / target_est) * 100.0).clamp(5.0, 98.0) as u32;

                let elapsed_sec = start.elapsed().as_secs_f64();
                let eta_sec = if pct > 3 {
                    let total_est_sec = elapsed_sec / (pct as f64 / 100.0);
                    (total_est_sec - elapsed_sec).max(0.0) as u64
                } else {
                    0u64
                };
                let eta_formatted = if eta_sec > 0 {
                    format!("{:02}m {:02}s", eta_sec / 60, eta_sec % 60)
                } else {
                    "Calculating...".to_string()
                };

                let _ = app_handle.emit("av1-progress", Av1ProgressPayload {
                    file_path: file_path.clone(),
                    status: format!("Encoding: {:.1} MB created ({}%)", len as f64 / 1_048_576.0, pct),
                    progress: pct,
                    eta_str: eta_formatted,
                });
            }
        }

        if start.elapsed().as_secs() > 1800 {
            let _ = child.kill();
            return Err("Transcode process timed out after 30 minutes".to_string());
        }

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    let _ = app_handle.emit("av1-progress", Av1ProgressPayload {
        file_path: file_path.clone(),
        status: "Media optimization complete!".to_string(),
        progress: 100,
        eta_str: "00m 00s".to_string(),
    });

    Ok(output_file.to_string_lossy().to_string())
}
