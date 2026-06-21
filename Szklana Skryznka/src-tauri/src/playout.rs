use sqlx::{SqlitePool, Row};
use chrono::{DateTime, Utc};
use crate::models::{PlayoutState, ScheduleEntryDetails, ScheduleEntry};

/// Retrieves details for a specific schedule entry by its fields
async fn fetch_entry_details(
    pool: &SqlitePool,
    entry: ScheduleEntry,
) -> Result<ScheduleEntryDetails, sqlx::Error> {
    let row = sqlx::query(
        "SELECT mi.title, mi.media_type, mi.runtime, mi.poster_path, mi.backdrop_path, \
         (SELECT file_path FROM media_files WHERE media_item_id = mi.id LIMIT 1) as file_path \
         FROM media_items mi \
         WHERE mi.id = $1"
    )
    .bind(&entry.media_item_id)
    .fetch_one(pool)
    .await?;

    let item_title: String = row.get("title");
    let media_type: String = row.get("media_type");
    let duration: i32 = row.get("runtime");
    let poster_path: Option<String> = row.get("poster_path");
    let backdrop_path: Option<String> = row.get("backdrop_path");
    let file_path: Option<String> = row.get("file_path");

    Ok(ScheduleEntryDetails {
        entry,
        item_title,
        media_type,
        duration,
        poster_path,
        backdrop_path,
        file_path,
    })
}

pub async fn get_playout_state(
    pool: &SqlitePool,
    channel_id: &str,
    current_time: DateTime<Utc>,
) -> Result<PlayoutState, sqlx::Error> {
    // 1. Find the active entry: start_time <= current_time AND end_time > current_time
    let active_entry: Option<ScheduleEntry> = sqlx::query_as::<_, ScheduleEntry>(
        "SELECT se.* FROM schedule_entries se \
         JOIN schedules s ON se.schedule_id = s.id \
         WHERE s.channel_id = $1 AND se.start_time <= $2 AND se.end_time > $2 \
         LIMIT 1"
    )
    .bind(channel_id)
    .bind(current_time)
    .fetch_optional(pool)
    .await?;

    let active_details = match active_entry {
        Some(entry) => Some(fetch_entry_details(pool, entry).await?),
        None => None,
    };

    // Calculate position in milliseconds if something is playing
    let playout_position_ms = match &active_details {
        Some(details) => {
            let start = details.entry.start_time;
            let diff = current_time.signed_duration_since(start);
            diff.num_milliseconds().max(0)
        }
        None => 0,
    };

    // 2. Find the next entry: starting at or after current_time (or active entry's end_time)
    let next_search_time = match &active_details {
        Some(details) => details.entry.end_time,
        None => current_time,
    };

    let next_entry: Option<ScheduleEntry> = sqlx::query_as::<_, ScheduleEntry>(
        "SELECT se.* FROM schedule_entries se \
         JOIN schedules s ON se.schedule_id = s.id \
         WHERE s.channel_id = $1 AND se.start_time >= $2 \
         ORDER BY se.start_time ASC \
         LIMIT 1"
    )
    .bind(channel_id)
    .bind(next_search_time)
    .fetch_optional(pool)
    .await?;

    let next_details = match next_entry {
        Some(entry) => Some(fetch_entry_details(pool, entry).await?),
        None => None,
    };

    // 3. Find the previous entry: ending at or before current_time (or active entry's start_time)
    let prev_search_time = match &active_details {
        Some(details) => details.entry.start_time,
        None => current_time,
    };

    let previous_entry: Option<ScheduleEntry> = sqlx::query_as::<_, ScheduleEntry>(
        "SELECT se.* FROM schedule_entries se \
         JOIN schedules s ON se.schedule_id = s.id \
         WHERE s.channel_id = $1 AND se.end_time <= $2 \
         ORDER BY se.end_time DESC \
         LIMIT 1"
    )
    .bind(channel_id)
    .bind(prev_search_time)
    .fetch_optional(pool)
    .await?;

    let previous_details = match previous_entry {
        Some(entry) => Some(fetch_entry_details(pool, entry).await?),
        None => None,
    };

    Ok(PlayoutState {
        channel_id: channel_id.to_string(),
        current_time,
        active_entry: active_details,
        next_entry: next_details,
        previous_entry: previous_details,
        playout_position_ms,
    })
}
