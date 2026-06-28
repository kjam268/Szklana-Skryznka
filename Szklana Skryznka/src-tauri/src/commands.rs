use tauri::State;
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
    match scan_directory(&app, &pool, &path).await {
        Ok((scanned, duplicates)) => Ok(format!(
            "Scan completed. Successfully cataloged {} files. Skipped {} duplicates.",
            scanned, duplicates
        )),
        Err(e) => Err(format!("Scan failed: {}", e)),
    }
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
    sqlx::query(
        "UPDATE media_items SET title = $1, original_title = $2, media_type = $3, year = $4, \
         runtime = $5, synopsis = $6, rating = $7, poster_path = $8, backdrop_path = $9, updated_at = $10 \
         WHERE id = $11"
    )
    .bind(&details.item.title)
    .bind(&details.item.original_title)
    .bind(&details.item.media_type)
    .bind(details.item.year)
    .bind(details.item.runtime)
    .bind(&details.item.synopsis)
    .bind(details.item.rating)
    .bind(&details.item.poster_path)
    .bind(&details.item.backdrop_path)
    .bind(Utc::now().to_rfc3339())
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
         WHERE s.channel_id = $1 AND se.start_time >= $2 AND se.start_time <= $3 \
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
             (SELECT file_path FROM media_files WHERE media_item_id = mi.id LIMIT 1) as file_path \
             FROM media_items mi \
             WHERE mi.id = $1"
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

        details.push(ScheduleEntryDetails {
            entry,
            item_title,
            media_type,
            duration,
            poster_path,
            backdrop_path,
            file_path,
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
pub async fn purge_database(pool: DbState<'_>, target: String) -> Result<String, String> {
    match target.as_str() {
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
            Ok("Complete database purged.".to_string())
        }
        _ => Err("Invalid purge target".to_string())
    }
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
pub async fn refresh_item_metadata(pool: DbState<'_>, item_id: String) -> Result<String, String> {
    // 1. Fetch item title, year, and media_type from database
    let item: crate::models::MediaItem = sqlx::query_as::<_, crate::models::MediaItem>(
        "SELECT * FROM media_items WHERE id = $1"
    )
    .bind(&item_id)
    .fetch_one(&*pool)
    .await
    .map_err(|e| format!("Failed to find media item: {}", e))?;

    // 2. Fetch TMDb API Key from settings
    let api_key: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = 'tmdb_api_key'"
    )
    .fetch_optional(&*pool)
    .await
    .unwrap_or(None);

    // 3. Fetch online metadata
    let mut online = crate::scanner::fetch_online_metadata(&item.title, item.year, &item.media_type, api_key.clone()).await;

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
    sqlx::query(
        "UPDATE media_items SET original_title = $1, synopsis = $2, rating = $3, poster_path = $4, backdrop_path = $5, updated_at = $6 \
         WHERE id = $7"
    )
    .bind(&item.title)
    .bind(&online.synopsis)
    .bind(online.rating)
    .bind(&online.poster_path)
    .bind(&online.backdrop_path)
    .bind(chrono::Utc::now().to_rfc3339())
    .bind(&item_id)
    .execute(&*pool)
    .await
    .map_err(|e| format!("Failed to update media item: {}", e))?;

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

    Ok("Metadata successfully refreshed from online API".to_string())
}
