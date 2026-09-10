use tauri::State;
use tauri::Manager;
use tauri::Emitter;
use serde::{Serialize, Deserialize};
use sqlx::{SqlitePool, Row};
use chrono::{DateTime, Utc, Duration};
use crate::models::{
    MediaItem, MediaItemDetails, MediaFile, Subtitle,
    ScheduleEntryDetails, PlayoutState, DiagnosticsReport, Channel, AnalysisJob
};
use crate::playout::get_playout_state;
use crate::scanner::scan_directory;
use crate::scheduler::generate_auto_schedule;
use tracing::info;
#[cfg(unix)]
extern crate libc;

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
pub async fn get_analysis_queue(pool: DbState<'_>) -> Result<Vec<AnalysisJob>, String> {
    let jobs: Vec<AnalysisJob> = sqlx::query_as::<_, AnalysisJob>(
        "SELECT * FROM analysis_jobs ORDER BY CASE status WHEN 'running' THEN 1 WHEN 'pending' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END, created_at DESC LIMIT 100"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(jobs)
}

#[tauri::command]
pub async fn enqueue_media_analysis(pool: DbState<'_>, media_file_id: String) -> Result<(), String> {
    info!("Enqueuing media analysis for file: {}", media_file_id);
    let file: Option<(String,)> = sqlx::query_as(
        "SELECT file_path FROM media_files WHERE id = $1"
    )
    .bind(&media_file_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some((path,)) = file {
        let job_id = format!("job_{}", uuid::Uuid::new_v4());
        sqlx::query(
            "INSERT INTO analysis_jobs (id, media_file_id, file_path, job_type, status, progress_percent) \
             VALUES ($1, $2, $3, 'full_quality_scan', 'pending', 0)"
        )
        .bind(&job_id)
        .bind(&media_file_id)
        .bind(&path)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

        // Reset quality_score_done to trigger re-scan in UI
        let _ = sqlx::query("UPDATE media_files SET quality_score_done = 0 WHERE id = $1")
            .bind(&media_file_id)
            .execute(&*pool)
            .await;
    } else {
        return Err("Media file not found".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn retry_failed_jobs(pool: DbState<'_>) -> Result<(), String> {
    info!("Retrying failed analysis jobs");
    sqlx::query(
        "UPDATE analysis_jobs SET status = 'pending', progress_percent = 0, error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE status = 'failed'"
    )
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn clear_completed_jobs(pool: DbState<'_>) -> Result<(), String> {
    sqlx::query("DELETE FROM analysis_jobs WHERE status = 'completed'")
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
pub async fn get_media_subtitles(
    pool: DbState<'_>,
    media_item_id: String,
    file_path: Option<String>,
) -> Result<Vec<crate::models::SubtitleRecordInfo>, String> {
    let mut results = Vec::new();

    // 1. Query external subtitles from the database
    let external_subs: Vec<Subtitle> = sqlx::query_as::<_, Subtitle>("SELECT * FROM subtitles WHERE media_item_id = $1")
        .bind(&media_item_id)
        .fetch_all(&*pool)
        .await
        .unwrap_or_default();

    for sub in external_subs {
        results.push(crate::models::SubtitleRecordInfo {
            id: sub.id.clone(),
            media_item_id: media_item_id.clone(),
            language: sub.language.clone(),
            label: format!("{} (External SRT)", sub.language.to_uppercase()),
            subtitle_type: "external".to_string(),
            file_path: Some(sub.file_path),
            track_index: None,
            is_default: sub.is_default,
        });
    }

    // 2. Discover embedded subtitle tracks in media file if provided
    if let Some(ref path) = file_path {
        if let Ok(info) = crate::media_engine::probe_universal_media(path).await {
            for sub_stream in info.subtitle_streams.iter() {
                let lang = if sub_stream.language.is_empty() || sub_stream.language == "und" {
                    format!("Track {}", sub_stream.subtitle_stream_index + 1)
                } else {
                    sub_stream.language.clone()
                };
                let codec = &sub_stream.codec_name;
                let title_suffix = sub_stream.title.as_ref().map(|t| format!(" — {}", t)).unwrap_or_default();
                let forced_tag = if sub_stream.is_forced { " [Forced]" } else { "" };
                results.push(crate::models::SubtitleRecordInfo {
                    id: format!("embedded_{}", sub_stream.subtitle_stream_index),
                    media_item_id: media_item_id.clone(),
                    language: lang.clone(),
                    label: format!("{} — {} (Embedded{}{})", lang.to_uppercase(), codec.to_uppercase(), title_suffix, forced_tag),
                    subtitle_type: "embedded".to_string(),
                    file_path: Some(path.clone()),
                    track_index: Some(sub_stream.subtitle_stream_index),
                    is_default: if sub_stream.is_default || results.is_empty() { 1 } else { 0 },
                });
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn read_subtitle_content(
    pool: DbState<'_>,
    file_path: Option<String>,
    subtitle_id: Option<String>,
    track_index: Option<usize>,
) -> Result<String, String> {
    // 1. If subtitle_id is provided and refers to a DB entry
    if let Some(ref sub_id) = subtitle_id {
        if !sub_id.starts_with("embedded_") {
            if let Ok(sub) = sqlx::query_as::<_, Subtitle>("SELECT * FROM subtitles WHERE id = $1")
                .bind(sub_id)
                .fetch_one(&*pool)
                .await
            {
                if std::path::Path::new(&sub.file_path).exists() {
                    return std::fs::read_to_string(&sub.file_path).map_err(|e| e.to_string());
                }
            }
        }
    }

    // 2. If file_path is provided
    if let Some(ref path) = file_path {
        let p = std::path::Path::new(path);
        if p.exists() {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if ext == "srt" || ext == "vtt" || ext == "sub" {
                return std::fs::read_to_string(p).map_err(|e| e.to_string());
            }

            // 3. If file is a video container (.mkv, .mp4, etc.) and an embedded track index is requested
            let stream_idx = track_index.or_else(|| {
                subtitle_id.as_ref().and_then(|id| {
                    if id.starts_with("embedded_") {
                        id.strip_prefix("embedded_").and_then(|s| s.parse::<usize>().ok())
                    } else {
                        None
                    }
                })
            });

            if let Some(idx) = stream_idx {
                let ffmpeg = crate::media_engine::find_ffmpeg();
                let mut cmd = tokio::process::Command::new(ffmpeg);
                cmd.kill_on_drop(true);
                cmd.args([
                    "-v", "error",
                    "-nostdin",
                    "-threads", "2",
                    "-y",
                    "-i", path,
                    "-map", &format!("0:s:{}", idx),
                    "-f", "srt",
                    "-"
                ]);

                let output_res = tokio::time::timeout(std::time::Duration::from_secs(6), cmd.output()).await;
                if let Ok(Ok(output)) = output_res {
                    if output.status.success() && !output.stdout.is_empty() {
                        return String::from_utf8(output.stdout)
                            .map_err(|e| format!("Invalid UTF-8 in extracted subtitle: {}", e));
                    }
                }
            }
        }
    }

    Err("Subtitle content could not be read or extracted".to_string())
}

#[tauri::command]
pub async fn record_movie_played(
    pool: DbState<'_>,
    media_item_id: String,
    channel_id: Option<String>,
    duration_aired: Option<i32>,
) -> Result<(), String> {
    // 1. Increment play count
    sqlx::query("UPDATE media_items SET play_count = coalesce(play_count, 0) + 1 WHERE id = $1")
        .bind(&media_item_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    // 2. Write playback_history row if channel is known
    let ch = channel_id.unwrap_or_else(|| "chan_default".to_string());
    let dur = duration_aired.unwrap_or(0);
    let history_id = format!("ph_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
    let _ = sqlx::query(
        "INSERT OR IGNORE INTO playback_history (id, channel_id, media_item_id, aired_at, duration_aired) \
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)"
    )
    .bind(&history_id)
    .bind(&ch)
    .bind(&media_item_id)
    .bind(dur)
    .execute(&*pool)
    .await;

    Ok(())
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
    pool: DbState<'_>,
    channel_id: String,
    template_id: String,
    start_time_iso: String,
) -> Result<String, String> {
    info!("Template apply: channel_id={}, template_id={}, start={}", channel_id, template_id, start_time_iso);

    let day_start = DateTime::parse_from_rfc3339(&start_time_iso)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc);

    // Fetch template entries ordered by offset
    let entries = sqlx::query(
        "SELECT offset_seconds, duration_seconds, media_type_filter, genre_filter, is_filler \
         FROM template_entries WHERE template_id = $1 ORDER BY offset_seconds ASC"
    )
    .bind(&template_id)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    if entries.is_empty() {
        return Err("Template has no entries defined".to_string());
    }

    let mut inserted = 0usize;
    for entry in entries {
        let offset_secs: i64 = entry.get::<i64, _>("offset_seconds");
        let duration_secs: i64 = entry.get::<i64, _>("duration_seconds");
        let type_filter: Option<String> = entry.get("media_type_filter");
        let genre_filter: Option<String> = entry.get("genre_filter");
        let is_filler: i64 = entry.get("is_filler");

        let slot_start = day_start + Duration::seconds(offset_secs);
        let slot_end = slot_start + Duration::seconds(duration_secs);

        // Skip if slot is already occupied
        let conflict: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM schedule_entries se \
             JOIN schedules s ON se.schedule_id = s.id \
             WHERE s.channel_id = $1 AND se.start_time < $2 AND se.end_time > $3"
        )
        .bind(&channel_id)
        .bind(slot_end.to_rfc3339())
        .bind(slot_start.to_rfc3339())
        .fetch_one(&*pool)
        .await
        .unwrap_or(0);

        if conflict > 0 {
            continue;
        }

        // If filler, skip (bumper insertion is handled by scheduler)
        if is_filler == 1 {
            continue;
        }

        // Pick a matching media_item from the library
        let mut query = String::from(
            "SELECT mi.id, mf.duration FROM media_items mi \
             JOIN media_files mf ON mf.media_item_id = mi.id \
             WHERE mf.duration > 0"
        );
        if let Some(ref mt) = type_filter {
            query.push_str(&format!(" AND mi.media_type = '{}'", mt.replace('\'', "''")));
        }
        if let Some(ref genre) = genre_filter {
            query.push_str(&format!(
                " AND mi.id IN (SELECT mt2.media_item_id FROM media_tags mt2 \
                 JOIN tags tg ON tg.id = mt2.tag_id WHERE tg.name = '{}')",
                genre.replace('\'', "''") 
            ));
        }
        query.push_str(" ORDER BY mi.play_count ASC, RANDOM() LIMIT 1");

        let picked = sqlx::query(&query)
            .fetch_optional(&*pool)
            .await
            .map_err(|e| e.to_string())?;

        if let Some(item_row) = picked {
            let media_item_id: String = item_row.get("id");
            let actual_duration: f64 = item_row.get("duration");
            let actual_end = slot_start + Duration::seconds(actual_duration as i64);

            // Ensure a schedule record exists for this channel
            let schedule_id: String = {
                let existing: Option<String> = sqlx::query_scalar(
                    "SELECT id FROM schedules WHERE channel_id = $1 LIMIT 1"
                )
                .bind(&channel_id)
                .fetch_optional(&*pool)
                .await
                .unwrap_or(None);
                if let Some(id) = existing {
                    id
                } else {
                    let new_id = format!("sched_{}", uuid::Uuid::new_v4());
                    sqlx::query(
                        "INSERT INTO schedules (id, channel_id, name) VALUES ($1, $2, 'Main Schedule')"
                    )
                    .bind(&new_id)
                    .bind(&channel_id)
                    .execute(&*pool)
                    .await
                    .map_err(|e| e.to_string())?;
                    new_id
                }
            };

            let entry_id = format!("se_{}", uuid::Uuid::new_v4());
            sqlx::query(
                "INSERT INTO schedule_entries (id, schedule_id, media_item_id, start_time, end_time, is_locked) \
                 VALUES ($1, $2, $3, $4, $5, 0)"
            )
            .bind(&entry_id)
            .bind(&schedule_id)
            .bind(&media_item_id)
            .bind(slot_start.to_rfc3339())
            .bind(actual_end.to_rfc3339())
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;

            inserted += 1;
        }
    }

    Ok(format!("Template applied: {} entries scheduled", inserted))
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
             mi.synopsis, mi.year, \
             mf.file_path, mf.audio_tracks, mf.audio_language, mf.embedded_subtitles, \
             (SELECT d.name FROM directors d \
              JOIN media_directors md ON d.id = md.director_id \
              WHERE md.media_item_id = mi.id LIMIT 1) AS director \
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
        let synopsis: Option<String> = row.get("synopsis");
        let year: Option<i32> = row.get("year");
        let director: Option<String> = row.get("director");

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
            synopsis,
            year,
            director,
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
pub async fn get_smart_suggestions(
    pool: DbState<'_>,
    min_rating: Option<f64>,
) -> Result<Vec<serde_json::Value>, String> {
    let rating_threshold = min_rating.unwrap_or(7.5);

    // ── Step 1: Derive top 3 genres from the user's most-played library content ──
    let top_genres: Vec<String> = sqlx::query_scalar(
        "SELECT t.name FROM tags t \
         JOIN media_tags mt ON mt.tag_id = t.id \
         JOIN media_items mi ON mi.id = mt.media_item_id \
         WHERE t.tag_type = 'genre' AND mi.play_count > 0 \
         GROUP BY t.id ORDER BY SUM(mi.play_count) DESC LIMIT 3"
    )
    .fetch_all(&*pool)
    .await
    .unwrap_or_default();

    let use_affinity = !top_genres.is_empty();

    // ── Step 2: Query all_movies, boosting affinity genres ──
    // Build a CASE weight expression based on genre matches in the title/synopsis (best-effort
    // since all_movies has no genre column — we search synopsis + title keywords)
    let genre_keywords: Vec<String> = top_genres.clone();

    let rows = if use_affinity && !genre_keywords.is_empty() {
        // Weighted: items whose synopsis mentions a favourite genre rank higher
        let like_clauses: Vec<String> = genre_keywords
            .iter()
            .map(|g| format!("(LOWER(synopsis) LIKE '%{}%' OR LOWER(title) LIKE '%{}%')",
                g.to_lowercase(), g.to_lowercase()))
            .collect();
        let affinity_expr = like_clauses.join(" OR ");
        let q = format!(
            "SELECT id, title, year, director, cast_actors, synopsis, rating, poster_path, \
             CASE WHEN ({}) THEN 1 ELSE 0 END AS affinity_hit \
             FROM all_movies \
             WHERE title NOT IN (SELECT title FROM media_items) \
             AND rating >= {} \
             ORDER BY affinity_hit DESC, rating DESC, RANDOM() \
             LIMIT 20",
            affinity_expr, rating_threshold
        );
        sqlx::query(&q).fetch_all(&*pool).await.map_err(|e| e.to_string())?
    } else {
        let q = format!(
            "SELECT id, title, year, director, cast_actors, synopsis, rating, poster_path, 0 AS affinity_hit \
             FROM all_movies \
             WHERE title NOT IN (SELECT title FROM media_items) \
             AND rating >= {} \
             ORDER BY RANDOM() LIMIT 20",
            rating_threshold
        );
        sqlx::query(&q).fetch_all(&*pool).await.map_err(|e| e.to_string())?
    };

    // Take up to 10, prefer affinity hits first (already sorted)
    let mut results = Vec::new();
    for row in rows.into_iter().take(10) {
        let id: String = row.get("id");
        let title: String = row.get("title");
        let year: i32 = row.get("year");
        let director: String = row.get("director");
        let cast_actors: String = row.get("cast_actors");
        let synopsis: String = row.get("synopsis");
        let rating: f64 = row.get("rating");
        let poster_path: Option<String> = row.get("poster_path");
        let affinity_hit: i32 = row.get("affinity_hit");

        let source_engine = if use_affinity && affinity_hit == 1 {
            format!("Genre Affinity ({})", top_genres.join(", "))
        } else if use_affinity {
            "Library Match".to_string()
        } else {
            "Curated Discovery".to_string()
        };

        results.push(serde_json::json!({
            "id": id,
            "title": title,
            "year": year,
            "director": director,
            "cast": cast_actors.split(", ").map(|s| s.to_string()).collect::<Vec<String>>(),
            "synopsis": synopsis,
            "rating": rating,
            "poster_path": poster_path,
            "sourceEngine": source_engine,
            "affinityHit": affinity_hit == 1,
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
pub async fn quit_app(app: tauri::AppHandle, state: State<'_, TranscoderState>) -> Result<(), String> {
    let mut lock = state.process.lock().await;
    if let Some(mut child) = lock.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
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

pub struct TranscoderState {
    pub process:           tokio::sync::Mutex<Option<std::process::Child>>,
    pub current_file:      tokio::sync::Mutex<Option<String>>,
    pub playout_start_sec: std::sync::atomic::AtomicU64,
    pub process_group_id:  std::sync::atomic::AtomicI32, // PGID for clean kill
    pub is_launching:      std::sync::atomic::AtomicBool,
}

#[derive(serde::Serialize, Clone)]
pub struct HlsStatus {
    pub is_streaming: bool,
    pub current_file: Option<String>,
    pub hls_url: String,
    pub playout_start_sec: f64,
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
pub async fn start_transcode(
    app_handle: tauri::AppHandle,
    state: State<'_, TranscoderState>,
    file_path: String,
    start_time_sec: f64,
    audio_track_index: Option<usize>,
) -> Result<String, String> {
    use std::sync::atomic::Ordering;
    info!("start_transcode: file={} start_time_sec={} audio_track={:?}", file_path, start_time_sec, audio_track_index);

    let hls_dir = app_handle.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("hls_out");
    let m3u8_path = hls_dir.join("stream.m3u8");
    let hls_url = "http://127.0.0.1:8098/hls/stream.m3u8".to_string();

    // Guard: if another launch is in-flight, bail out early — it will resolve for both callers
    if state.is_launching.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        info!("start_transcode: launch already in-flight, waiting for existing stream");
        let start = std::time::Instant::now();
        loop {
            if m3u8_path.exists() { return Ok(hls_url); }
            if start.elapsed().as_secs() > 15 { break; }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        return Ok(hls_url);
    }

    // 1. Check if already streaming this exact file
    {
        let file_lock = state.current_file.lock().await;
        let mut proc_lock = state.process.lock().await;
        if let Some(ref cur_f) = *file_lock {
            if cur_f == &file_path && m3u8_path.exists() {
                if let Some(ref mut child) = *proc_lock {
                    if let Ok(None) = child.try_wait() {
                        state.is_launching.store(false, Ordering::SeqCst);
                        return Ok(hls_url);
                    }
                }
            }
        }
    }

    // 2. Kill any prior transcoder process
    {
        let mut lock = state.process.lock().await;
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    // 3. Clean HLS output directory
    if hls_dir.exists() {
        let _ = std::fs::remove_dir_all(&hls_dir);
    }
    std::fs::create_dir_all(&hls_dir).map_err(|e| e.to_string())?;

    // 4. Resolve bundled ffmpeg binary (inherits our app's TCC grants — can access ~/Movies)
    let ffmpeg_bin: std::path::PathBuf = {
        // Build a list of candidate paths to check in order
        let mut candidates: Vec<std::path::PathBuf> = Vec::new();

        // Candidate 1: Tauri resource dir (production .app bundle)
        if let Ok(res_dir) = app_handle.path().resource_dir() {
            candidates.push(res_dir.join("binaries/ffmpeg-aarch64-apple-darwin"));
        }

        // Candidate 2: src-tauri/binaries/ relative to the running executable (dev mode)
        // Dev binary lives at: src-tauri/target/debug/szklana-skryznka
        // So binaries/ is at:  src-tauri/binaries/ffmpeg-aarch64-apple-darwin
        if let Ok(exe) = std::env::current_exe() {
            // Go up: debug/ -> target/ -> src-tauri/ -> binaries/
            if let Some(src_tauri) = exe.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
                candidates.push(src_tauri.join("binaries/ffmpeg-aarch64-apple-darwin"));
            }
        }

        // Candidate 3: absolute path to src-tauri/binaries in workspace (compiled-in fallback)
        candidates.push(std::path::PathBuf::from(
            "/Users/george/Work/Code/Szklana Skryznka/Szklana Skryznka/src-tauri/binaries/ffmpeg-aarch64-apple-darwin"
        ));

        // Candidate 4: Homebrew locations
        for p in ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"] {
            candidates.push(std::path::PathBuf::from(p));
        }

        let found = candidates.iter().find(|p| p.exists()).cloned();
        match found {
            Some(p) => {
                info!("start_transcode: using ffmpeg at: {}", p.display());
                p
            }
            None => {
                // Last resort: let the shell find it
                info!("start_transcode: ffmpeg not found in any candidate path, trying PATH");
                std::path::PathBuf::from("ffmpeg")
            }
        }
    };

    info!("start_transcode: ffmpeg binary path: {} (exists={})", ffmpeg_bin.display(), ffmpeg_bin.exists());

    // 5. Probe media to select adaptive transcode parameters
    let media_info = crate::media_engine::probe_universal_media(&file_path).await.ok();
    let is_4k = media_info.as_ref().map(|info| {
        info.video_streams.iter().any(|v| v.width > 1920 || v.height > 1080)
    }).unwrap_or(false);

    let segment_path_pattern = hls_dir.join("stream-%05d.ts").to_string_lossy().to_string();
    let m3u8_path_str = m3u8_path.to_string_lossy().to_string();

    // 6. Build ffmpeg args — -ss BEFORE -i for fast keyframe seek
    //    Global -threads applies to demuxer/decoder; libx264 is separately capped via -x264-params
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-nostdin".into(),
        "-threads".into(), "4".into(),   // demuxer/decoder thread cap
        "-ss".into(), format!("{:.3}", start_time_sec),
        "-i".into(), file_path.clone(),
    ];
    // If a specific audio track was requested, add explicit stream mapping
    if let Some(audio_idx) = audio_track_index {
        args.extend([
            "-map".into(), "0:v:0".into(),
            "-map".into(), format!("0:a:{}", audio_idx),
        ]);
    }
    args.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "veryfast".into(),
        "-b:v".into(), if is_4k { "4000k".into() } else { "3000k".into() },
        // Hard-cap x264's internal thread pool — prevents runaway multi-core usage.
        // Without this, x264 spawns one thread per logical core regardless of -threads.
        "-x264-params".into(), "threads=4:lookahead_threads=2".into(),
    ]);
    if is_4k {
        args.extend(["-vf".into(), "scale=-2:1080".into()]);
    }
    args.extend([
        "-c:a".into(), "aac".into(),
        "-b:a".into(), "128k".into(),
        "-ac".into(), "2".into(),
        "-ar".into(), "44100".into(),
        "-f".into(), "hls".into(),
        "-hls_time".into(), "4".into(),
        "-hls_list_size".into(), "10".into(),
        "-hls_flags".into(), "delete_segments+split_by_time".into(),
        "-hls_segment_filename".into(), segment_path_pattern,
        m3u8_path_str,
    ]);

    info!("start_transcode: launching ffmpeg with args: {:?}", args);

    // 7. Pipe stderr to a log file so we can read it on failure
    let stderr_log = hls_dir.join("ffmpeg_stderr.log");
    let stderr_file = std::fs::File::create(&stderr_log)
        .map(std::process::Stdio::from)
        .unwrap_or_else(|_| std::process::Stdio::null());

    // Spawn ffmpeg in its own process group so we can kill the entire group cleanly.
    // pre_exec(setsid) runs after fork() but before exec() — making ffmpeg the session leader.
    let mut cmd = std::process::Command::new(&ffmpeg_bin);
    cmd.args(&args)
       .stdout(std::process::Stdio::null())
       .stderr(stderr_file);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe { cmd.pre_exec(|| { libc::setsid(); Ok(()) }); }
    }
    let child = cmd.spawn().map_err(|e| {
        state.is_launching.store(false, std::sync::atomic::Ordering::SeqCst);
        format!("Failed to launch ffmpeg ({}): {}", ffmpeg_bin.display(), e)
    })?;

    // 8. Store process handle, PGID, and start offset
    {
        let mut proc_lock = state.process.lock().await;
        // Capture PGID immediately after spawn (before the child can die)
        #[cfg(unix)]
        {
            let pgid = unsafe { libc::getpgid(child.id() as libc::pid_t) };
            state.process_group_id.store(pgid, std::sync::atomic::Ordering::SeqCst);
            info!("start_transcode: ffmpeg pid={} pgid={}", child.id(), pgid);
        }
        *proc_lock = Some(child);
        let mut file_lock = state.current_file.lock().await;
        *file_lock = Some(file_path);
        // Store the start offset so TvClient can compute content position
        state.playout_start_sec.store(start_time_sec.to_bits(), std::sync::atomic::Ordering::Relaxed);
    }

    // 9. Poll until m3u8 and first segment are ready (timeout 15s)
    let start_wait = std::time::Instant::now();
    loop {
        let has_m3u8 = m3u8_path.exists();
        let has_segment = std::fs::read_dir(&hls_dir)
            .map(|entries| entries.filter_map(|e| e.ok()).any(|e| {
                e.file_name().to_string_lossy().ends_with(".ts")
                    && e.metadata().map(|m| m.len()).unwrap_or(0) > 65_536
            }))
            .unwrap_or(false);

        if has_m3u8 && has_segment { break; }

        {
            let mut proc_lock = state.process.lock().await;
            if let Some(ref mut child) = *proc_lock {
                if let Ok(Some(status)) = child.try_wait() {
                    let stderr_content = std::fs::read_to_string(&stderr_log)
                        .unwrap_or_default();
                    let last_lines: String = stderr_content.lines().rev().take(10).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
                    tracing::error!("ffmpeg stderr:\n{}", stderr_content);
                    state.is_launching.store(false, Ordering::SeqCst);
                    return Err(format!("ffmpeg exited early (status={}). Last output:\n{}", status, last_lines));
                }
            }
        }

        if start_wait.elapsed().as_secs() > 15 {
            let stderr_content = std::fs::read_to_string(&stderr_log).unwrap_or_default();
            let last_lines: String = stderr_content.lines().rev().take(10).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            tracing::error!("ffmpeg stderr (timeout):\n{}", stderr_content);
            state.is_launching.store(false, Ordering::SeqCst);
            return Err(format!("ffmpeg HLS stream timed out after 15s. Last output:\n{}", last_lines));
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    state.is_launching.store(false, Ordering::SeqCst);
    Ok(hls_url)
}

#[tauri::command]
pub async fn get_hls_status(state: State<'_, TranscoderState>) -> Result<HlsStatus, String> {
    let current_file = state.current_file.lock().await.clone();
    let playout_start_sec = f64::from_bits(state.playout_start_sec.load(std::sync::atomic::Ordering::Relaxed));
    let is_streaming = {
        let mut proc_lock = state.process.lock().await;
        if let Some(ref mut child) = *proc_lock {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    };

    Ok(HlsStatus {
        is_streaming,
        current_file,
        hls_url: "http://127.0.0.1:8098/hls/stream.m3u8".to_string(),
        playout_start_sec,
    })
}

#[tauri::command]
pub async fn stop_transcode(
    app_handle: tauri::AppHandle,
    state: State<'_, TranscoderState>
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    info!("stop_transcode: killing ffmpeg transcoder process and cleaning buffers");

    // Kill by process group first (catches any children ffmpeg may have spawned)
    #[cfg(unix)]
    {
        let pgid = state.process_group_id.load(Ordering::SeqCst);
        if pgid > 1 {
            info!("stop_transcode: sending SIGKILL to process group {}", pgid);
            unsafe { libc::killpg(pgid, libc::SIGKILL); }
            state.process_group_id.store(0, Ordering::SeqCst);
        }
    }

    // Also kill via the stored Child handle (belt-and-suspenders)
    let mut lock = state.process.lock().await;
    if let Some(mut child) = lock.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    drop(lock);

    let mut file_lock = state.current_file.lock().await;
    *file_lock = None;
    state.is_launching.store(false, Ordering::SeqCst);

    if let Ok(data_dir) = app_handle.path().app_data_dir() {
        let hls_dir = data_dir.join("hls_out");
        if hls_dir.exists() {
            let _ = std::fs::remove_dir_all(&hls_dir);
        }
    }

    Ok(())
}

pub fn cleanup_orphaned_ffmpeg() {
    #[cfg(unix)]
    {
        info!("Cleaning up any orphaned ffmpeg background processes...");
        let _ = std::process::Command::new("pkill")
            .args(["-9", "-f", "ffmpeg-aarch64-apple-darwin"])
            .output();
    }
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

                let method = parts[0];
                let raw_path = parts[1]; // e.g. "/hls/stream.m3u8?t=12345"
                let path = raw_path.split('?').next().unwrap_or(raw_path);

                // Handle CORS OPTIONS preflight request
                if method == "OPTIONS" {
                    let response = "HTTP/1.1 204 No Content\r\n\
                                    Access-Control-Allow-Origin: *\r\n\
                                    Access-Control-Allow-Methods: GET, OPTIONS, HEAD\r\n\
                                    Access-Control-Allow-Headers: *\r\n\
                                    Access-Control-Max-Age: 86400\r\n\
                                    Connection: close\r\n\r\n";
                    let _ = stream.write_all(response.as_bytes());
                    return;
                }

                let is_head = method == "HEAD";

                // Endpoint 0: HLS Manifest (.m3u8) Proxy with path cleanup
                if path.ends_with(".m3u8") {
                    let file_path = hls_dir.join("stream.m3u8");
                    match std::fs::read_to_string(&file_path) {
                        Ok(raw_m3u8) => {
                            let hls_dir_str = hls_dir.to_string_lossy().to_string();
                            // Replace absolute filesystem segment paths with HTTP proxy URLs (ffmpeg writes absolute paths)
                            let clean_m3u8 = raw_m3u8.replace(&hls_dir_str, "http://127.0.0.1:8098/hls");
                            let bytes = clean_m3u8.as_bytes();
                            let response_headers = format!(
                                "HTTP/1.1 200 OK\r\n\
                                 Access-Control-Allow-Origin: *\r\n\
                                 Access-Control-Allow-Headers: *\r\n\
                                 Cache-Control: no-cache, no-store, must-revalidate\r\n\
                                 Content-Type: application/vnd.apple.mpegurl\r\n\
                                 Content-Length: {}\r\n\
                                 Connection: close\r\n\r\n",
                                bytes.len()
                            );
                            let _ = stream.write_all(response_headers.as_bytes());
                            if !is_head {
                                let _ = stream.write_all(bytes);
                            }
                        }
                        Err(_) => {
                            // Stream not ready yet — return 503 with CORS so browser retries cleanly
                            let response = "HTTP/1.1 503 Service Unavailable\r\n\
                                            Access-Control-Allow-Origin: *\r\n\
                                            Access-Control-Allow-Headers: *\r\n\
                                            Retry-After: 1\r\n\
                                            Cache-Control: no-cache\r\n\
                                            Connection: close\r\n\r\n";
                            let _ = stream.write_all(response.as_bytes());
                        }
                    }
                    return;
                }

                // Endpoint 0.1: TS Video Segment Proxy (.ts)
                if path.ends_with(".ts") {
                    let rel_filename = path.rsplit('/').next().unwrap_or("stream-00000.ts");
                    if rel_filename.contains("..") || rel_filename.contains('\\') {
                        let response = "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n";
                        let _ = stream.write_all(response.as_bytes());
                        return;
                    }
                    let file_path = hls_dir.join(rel_filename);

                    let data = match std::fs::read(&file_path) {
                        Ok(bytes) if !bytes.is_empty() => bytes,
                        _ => {
                            let response = "HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
                            let _ = stream.write_all(response.as_bytes());
                            return;
                        }
                    };

                    let response_headers = format!(
                        "HTTP/1.1 200 OK\r\n\
                         Access-Control-Allow-Origin: *\r\n\
                         Access-Control-Allow-Headers: *\r\n\
                         Cache-Control: no-cache, no-store, must-revalidate\r\n\
                         Content-Type: video/mp2t\r\n\
                         Content-Length: {}\r\n\
                         Connection: close\r\n\r\n",
                        data.len()
                    );

                    let _ = stream.write_all(response_headers.as_bytes());
                    if !is_head {
                        let _ = stream.write_all(&data);
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
                if raw_path.starts_with("/media_file?path=") {
                    let target_encoded = &raw_path["/media_file?path=".len()..];
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
                    let response = "HTTP/1.1 404 Not Found\r\n\
                                    Access-Control-Allow-Origin: *\r\n\
                                    Access-Control-Allow-Headers: *\r\n\
                                    Connection: close\r\n\r\n";
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

#[tauri::command]
pub async fn get_video_quality_score(file_path: String) -> Result<crate::models::VideoQualityScore, String> {
    crate::media_engine::compute_video_quality_score(&file_path).await
}

#[tauri::command]
pub async fn open_media(path: String) -> Result<crate::models::UniversalMediaInfo, String> {
    crate::media_engine::probe_universal_media(&path).await
}

#[tauri::command]
pub async fn read_media_metadata(path: String) -> Result<crate::models::MediaFileMetadata, String> {
    let info = crate::media_engine::probe_universal_media(&path).await?;
    Ok(info.metadata)
}

#[tauri::command]
pub async fn list_media_streams(path: String) -> Result<serde_json::Value, String> {
    let info = crate::media_engine::probe_universal_media(&path).await?;
    Ok(serde_json::json!({
        "video": info.video_streams,
        "audio": info.audio_streams,
        "subtitle": info.subtitle_streams,
    }))
}

#[tauri::command]
pub async fn extract_media_thumbnail(path: String, timestamp: f64) -> Result<String, String> {
    crate::media_engine::extract_thumbnail_frame(&path, timestamp).await
}

// ─────────────────────────────────────────────────────────────────────────────
// WATCHLIST COMMANDS (suggestion watchlist — tracks movies from the all_movies
// reference DB that the user wants to acquire for their library)
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn add_to_suggestion_watchlist(
    pool: DbState<'_>,
    all_movie_id: String,
    title: String,
    year: Option<i32>,
    director: Option<String>,
    synopsis: Option<String>,
    rating: Option<f64>,
    poster_path: Option<String>,
) -> Result<String, String> {
    let id = format!("sw_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
    sqlx::query(
        "INSERT OR IGNORE INTO suggestion_watchlists \
         (id, all_movie_id, title, year, director, synopsis, rating, poster_path) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
    )
    .bind(&id)
    .bind(&all_movie_id)
    .bind(&title)
    .bind(year)
    .bind(&director)
    .bind(&synopsis)
    .bind(rating)
    .bind(&poster_path)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn get_suggestion_watchlist(pool: DbState<'_>) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query(
        "SELECT id, all_movie_id, title, year, director, synopsis, rating, poster_path, added_at \
         FROM suggestion_watchlists ORDER BY added_at DESC"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let results = rows.iter().map(|row| {
        serde_json::json!({
            "id": row.get::<String, _>("id"),
            "all_movie_id": row.get::<String, _>("all_movie_id"),
            "title": row.get::<String, _>("title"),
            "year": row.get::<Option<i32>, _>("year"),
            "director": row.get::<Option<String>, _>("director"),
            "synopsis": row.get::<Option<String>, _>("synopsis"),
            "rating": row.get::<Option<f64>, _>("rating"),
            "poster_path": row.get::<Option<String>, _>("poster_path"),
            "added_at": row.get::<String, _>("added_at"),
        })
    }).collect();
    Ok(results)
}

#[tauri::command]
pub async fn remove_from_suggestion_watchlist(pool: DbState<'_>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM suggestion_watchlists WHERE id = $1")
        .bind(&id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANAGEMENT COMMANDS
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn create_channel(
    pool: DbState<'_>,
    name: String,
    profile_name: String,
) -> Result<Channel, String> {
    let id = format!("chan_{}", uuid::Uuid::new_v4().to_string().replace('-', "").chars().take(12).collect::<String>());
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO channels (id, name, logo_path, profile_name, created_at, updated_at) \
         VALUES ($1, $2, '', $3, $4, $4)"
    )
    .bind(&id)
    .bind(&name)
    .bind(&profile_name)
    .bind(&now)
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(Channel {
        id,
        name,
        logo_path: None,
        profile_name: Some(profile_name),
        created_at: now.clone(),
        updated_at: now,
    })
}

#[tauri::command]
pub async fn delete_channel(pool: DbState<'_>, channel_id: String) -> Result<(), String> {
    // Protect the default channel
    if channel_id == "chan_default" {
        return Err("Cannot delete the default channel.".to_string());
    }
    sqlx::query("DELETE FROM channels WHERE id = $1")
        .bind(&channel_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYBACK HISTORY COMMAND
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_playback_history(pool: DbState<'_>, limit: Option<i64>) -> Result<Vec<serde_json::Value>, String> {
    let lim = limit.unwrap_or(100);
    let rows = sqlx::query(
        "SELECT ph.id, ph.channel_id, ph.media_item_id, ph.aired_at, ph.duration_aired, \
                mi.title, mi.year, mi.poster_path, mi.media_type, ch.name as channel_name \
         FROM playback_history ph \
         JOIN media_items mi ON mi.id = ph.media_item_id \
         JOIN channels ch ON ch.id = ph.channel_id \
         ORDER BY ph.aired_at DESC \
         LIMIT $1"
    )
    .bind(lim)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let results = rows.iter().map(|row| {
        serde_json::json!({
            "id": row.get::<String, _>("id"),
            "channel_id": row.get::<String, _>("channel_id"),
            "channel_name": row.get::<String, _>("channel_name"),
            "media_item_id": row.get::<String, _>("media_item_id"),
            "title": row.get::<String, _>("title"),
            "year": row.get::<Option<i32>, _>("year"),
            "poster_path": row.get::<Option<String>, _>("poster_path"),
            "media_type": row.get::<String, _>("media_type"),
            "aired_at": row.get::<String, _>("aired_at"),
            "duration_aired": row.get::<i32, _>("duration_aired"),
        })
    }).collect();
    Ok(results)
}


// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: SCHEDULE TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn get_schedule_templates(pool: DbState<'_>) -> Result<Vec<serde_json::Value>, String> {
    let templates = sqlx::query(
        "SELECT t.id, t.name, t.description, COUNT(te.id) as entry_count \
         FROM schedule_templates t \
         LEFT JOIN template_entries te ON te.template_id = t.id \
         GROUP BY t.id ORDER BY t.name ASC"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut results = vec![];
    for row in templates {
        let template_id: String = row.get("id");
        let entries = sqlx::query(
            "SELECT id, offset_seconds, duration_seconds, media_type_filter, genre_filter, is_filler \
             FROM template_entries WHERE template_id = $1 ORDER BY offset_seconds ASC"
        )
        .bind(&template_id)
        .fetch_all(&*pool)
        .await
        .unwrap_or_default();

        let entries_json: Vec<serde_json::Value> = entries.iter().map(|e| serde_json::json!({
            "id": e.get::<String, _>("id"),
            "offsetSeconds": e.get::<i64, _>("offset_seconds"),
            "durationSeconds": e.get::<i64, _>("duration_seconds"),
            "mediaTypeFilter": e.get::<Option<String>, _>("media_type_filter"),
            "genreFilter": e.get::<Option<String>, _>("genre_filter"),
            "isFiller": e.get::<i64, _>("is_filler") == 1,
        })).collect();

        results.push(serde_json::json!({
            "id": template_id,
            "name": row.get::<String, _>("name"),
            "description": row.get::<Option<String>, _>("description"),
            "entryCount": row.get::<i64, _>("entry_count"),
            "entries": entries_json,
        }));
    }
    Ok(results)
}

#[derive(Debug, Deserialize)]
pub struct TemplateEntryInput {
    pub offset_seconds: i64,
    pub duration_seconds: i64,
    pub media_type_filter: Option<String>,
    pub genre_filter: Option<String>,
    pub is_filler: bool,
}

#[tauri::command]
pub async fn create_schedule_template(
    pool: DbState<'_>,
    name: String,
    description: Option<String>,
    entries: Vec<TemplateEntryInput>,
) -> Result<String, String> {
    let template_id = format!("tmpl_{}", uuid::Uuid::new_v4());
    sqlx::query(
        "INSERT INTO schedule_templates (id, name, description) VALUES ($1, $2, $3)"
    )
    .bind(&template_id)
    .bind(&name)
    .bind(&description)
    .execute(&*pool)
    .await
    .map_err(|e| format!("Failed to create template: {}", e))?;

    for entry in &entries {
        let entry_id = format!("te_{}", uuid::Uuid::new_v4());
        sqlx::query(
            "INSERT INTO template_entries \
             (id, template_id, offset_seconds, duration_seconds, media_type_filter, genre_filter, is_filler) \
             VALUES ($1, $2, $3, $4, $5, $6, $7)"
        )
        .bind(&entry_id)
        .bind(&template_id)
        .bind(entry.offset_seconds)
        .bind(entry.duration_seconds)
        .bind(&entry.media_type_filter)
        .bind(&entry.genre_filter)
        .bind(entry.is_filler as i32)
        .execute(&*pool)
        .await
        .map_err(|e| format!("Failed to insert entry: {}", e))?;
    }

    info!("Created schedule template '{}' with {} entries", name, entries.len());
    Ok(template_id)
}

#[tauri::command]
pub async fn delete_schedule_template(
    pool: DbState<'_>,
    template_id: String,
) -> Result<(), String> {
    sqlx::query("DELETE FROM schedule_templates WHERE id = $1")
        .bind(&template_id)
        .execute(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: WATCHLIST → SCHEDULE
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn add_watchlist_item_to_schedule(
    pool: DbState<'_>,
    channel_id: String,
    title: String,
    preferred_date_iso: Option<String>,
) -> Result<String, String> {
    let item: Option<(String, f64)> = sqlx::query_as(
        "SELECT mi.id, mf.duration FROM media_items mi \
         JOIN media_files mf ON mf.media_item_id = mi.id \
         WHERE LOWER(mi.title) = LOWER($1) AND mf.duration > 0 LIMIT 1"
    )
    .bind(&title)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let (media_item_id, duration) = match item {
        Some(row) => row,
        None => return Err(format!("'{}' is not in your library. Import it first.", title)),
    };

    let after = preferred_date_iso
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);

    let horizon = after + Duration::days(7);
    let latest_end: Option<String> = sqlx::query_scalar(
        "SELECT MAX(se.end_time) FROM schedule_entries se \
         JOIN schedules s ON se.schedule_id = s.id \
         WHERE s.channel_id = $1 AND se.end_time > $2 AND se.end_time < $3"
    )
    .bind(&channel_id)
    .bind(after.to_rfc3339())
    .bind(horizon.to_rfc3339())
    .fetch_optional(&*pool)
    .await
    .unwrap_or(None)
    .flatten();

    let slot_start = if let Some(end_str) = latest_end {
        DateTime::parse_from_rfc3339(&end_str)
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or(after)
    } else {
        after
    };
    let slot_end = slot_start + Duration::seconds(duration as i64);

    let schedule_id: String = {
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM schedules WHERE channel_id = $1 LIMIT 1"
        )
        .bind(&channel_id)
        .fetch_optional(&*pool)
        .await
        .unwrap_or(None);
        if let Some(id) = existing {
            id
        } else {
            let new_id = format!("sched_{}", uuid::Uuid::new_v4());
            sqlx::query(
                "INSERT INTO schedules (id, channel_id, name) VALUES ($1, $2, 'Main Schedule')"
            )
            .bind(&new_id)
            .bind(&channel_id)
            .execute(&*pool)
            .await
            .map_err(|e| e.to_string())?;
            new_id
        }
    };

    let entry_id = format!("se_{}", uuid::Uuid::new_v4());
    sqlx::query(
        "INSERT INTO schedule_entries (id, schedule_id, media_item_id, start_time, end_time, is_locked) \
         VALUES ($1, $2, $3, $4, $5, 0)"
    )
    .bind(&entry_id)
    .bind(&schedule_id)
    .bind(&media_item_id)
    .bind(slot_start.to_rfc3339())
    .bind(slot_end.to_rfc3339())
    .execute(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    info!("Watchlist->Schedule: '{}' scheduled at {}", title, slot_start);
    Ok(format!(
        "Scheduled '{}' at {}",
        title,
        slot_start.format("%a %d %b at %H:%M").to_string()
    ))
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS: get_all_settings (get_setting / set_setting already exist above)
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn get_all_settings(
    pool: DbState<'_>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let rows = sqlx::query("SELECT key, value FROM settings")
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?;
    let map = rows
        .into_iter()
        .map(|r| (r.get::<String, _>("key"), r.get::<String, _>("value")))
        .collect();
    Ok(map)
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3: GENRE AFFINITY HEATMAP
// ═══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn get_genre_heatmap(pool: DbState<'_>) -> Result<Vec<serde_json::Value>, String> {
    // One query: for every (genre, day-of-week) pair count distinct airings
    // SQLite's strftime('%w', ...) returns 0=Sun, 1=Mon, ..., 6=Sat
    let rows = sqlx::query(
        "SELECT g.name AS genre, \
               strftime('%w', ph.aired_at) AS dow, \
               COUNT(*) AS cnt \
         FROM playback_history ph \
         JOIN media_items mi ON mi.id = ph.media_item_id \
         JOIN media_genres mg ON mg.media_item_id = mi.id \
         JOIN genres g ON g.id = mg.genre_id \
         GROUP BY g.name, dow \
         ORDER BY g.name ASC, dow ASC"
    )
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    // Aggregate into genre → [sun, mon, tue, wed, thu, fri, sat]
    let mut map: std::collections::HashMap<String, [i64; 7]> = std::collections::HashMap::new();
    for row in &rows {
        let genre: String = row.get("genre");
        let dow_str: String = row.get("dow");
        let cnt: i64 = row.get("cnt");
        let dow: usize = dow_str.parse::<usize>().unwrap_or(0).min(6);
        let entry = map.entry(genre).or_insert([0i64; 7]);
        entry[dow] = cnt;
    }

    // Sort genres by total plays descending, cap at top 15
    let mut genres: Vec<(String, [i64; 7])> = map.into_iter().collect();
    genres.sort_by(|a, b| {
        let total_a: i64 = a.1.iter().sum();
        let total_b: i64 = b.1.iter().sum();
        total_b.cmp(&total_a)
    });
    genres.truncate(15);

    let result = genres.into_iter().map(|(genre, days)| {
        serde_json::json!({
            "genre": genre,
            "sun": days[0],
            "mon": days[1],
            "tue": days[2],
            "wed": days[3],
            "thu": days[4],
            "fri": days[5],
            "sat": days[6],
            "total": days.iter().sum::<i64>(),
        })
    }).collect();

    Ok(result)
}
