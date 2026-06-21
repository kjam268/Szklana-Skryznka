use sqlx::SqlitePool;
use chrono::{DateTime, Utc, Duration, Timelike};
use crate::models::{MediaItem, ScheduleEntry};
use tracing::warn;

#[derive(Debug, Clone)]
pub struct ChannelProfile {
    pub name: String,
    pub preferred_media_types: Vec<String>,
    pub target_genres: Vec<(String, f64)>, // (genre_name, target_percentage)
    pub forbid_horror_before_hour: u32,
    pub documentaries_only_after_hour: u32,
    pub educational_only_between: Option<(u32, u32)>,
}

impl ChannelProfile {
    pub fn get_profile_by_name(name: &str) -> Self {
        match name {
            "Classic Movie Channel" => Self {
                name: name.to_string(),
                preferred_media_types: vec!["Movie".to_string()],
                target_genres: vec![("Action".to_string(), 0.2), ("Drama".to_string(), 0.4), ("Comedy".to_string(), 0.3)],
                forbid_horror_before_hour: 20, // Strict night horror
                documentaries_only_after_hour: 24, // None
                educational_only_between: None,
            },
            "Documentary Channel" => Self {
                name: name.to_string(),
                preferred_media_types: vec!["Documentary".to_string(), "Educational".to_string()],
                target_genres: vec![("History".to_string(), 0.3), ("Science".to_string(), 0.4), ("Nature".to_string(), 0.3)],
                forbid_horror_before_hour: 24,
                documentaries_only_after_hour: 0, // All times
                educational_only_between: None,
            },
            "Anime Channel" => Self {
                name: name.to_string(),
                preferred_media_types: vec!["Anime".to_string(), "Episode".to_string()],
                target_genres: vec![("Action".to_string(), 0.3), ("Sci-Fi".to_string(), 0.3), ("Fantasy".to_string(), 0.4)],
                forbid_horror_before_hour: 22,
                documentaries_only_after_hour: 24,
                educational_only_between: None,
            },
            "Educational Channel" => Self {
                name: name.to_string(),
                preferred_media_types: vec!["Educational".to_string(), "Documentary".to_string()],
                target_genres: vec![("Science".to_string(), 0.5), ("Technology".to_string(), 0.3), ("Math".to_string(), 0.2)],
                forbid_horror_before_hour: 24,
                documentaries_only_after_hour: 24,
                educational_only_between: Some((8, 16)), // 8 AM to 4 PM
            },
            _ => Self { // Mixed / Retro Channel
                name: "Mixed Family Channel".to_string(),
                preferred_media_types: vec!["Movie".to_string(), "TVShow".to_string(), "Episode".to_string(), "Documentary".to_string()],
                target_genres: vec![("Family".to_string(), 0.3), ("Comedy".to_string(), 0.3), ("Adventure".to_string(), 0.4)],
                forbid_horror_before_hour: 19,
                documentaries_only_after_hour: 22,
                educational_only_between: Some((9, 12)),
            },
        }
    }
}

pub struct SchedulingGap {
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
}

/// Retrieve list of gaps in schedule for a channel over a date range
pub async fn find_schedule_gaps(
    pool: &SqlitePool,
    channel_id: &str,
    start_time: DateTime<Utc>,
    end_time: DateTime<Utc>,
) -> Result<Vec<SchedulingGap>, sqlx::Error> {
    // 1. Fetch all schedule entries for this channel overlapping the range, ordered by start_time
    let entries: Vec<ScheduleEntry> = sqlx::query_as::<_, ScheduleEntry>(
        "SELECT se.* FROM schedule_entries se \
         JOIN schedules s ON se.schedule_id = s.id \
         WHERE s.channel_id = $1 AND se.end_time > $2 AND se.start_time < $3 \
         ORDER BY se.start_time ASC"
    )
    .bind(channel_id)
    .bind(start_time)
    .bind(end_time)
    .fetch_all(pool)
    .await?;

    let mut gaps = Vec::new();
    let mut current_point = start_time;

    for entry in entries {
        if entry.start_time > current_point {
            gaps.push(SchedulingGap {
                start_time: current_point,
                end_time: entry.start_time,
            });
        }
        if entry.end_time > current_point {
            current_point = entry.end_time;
        }
    }

    if current_point < end_time {
        gaps.push(SchedulingGap {
            start_time: current_point,
            end_time,
        });
    }

    Ok(gaps)
}

/// Check rotation constraint details
async fn get_last_airing(pool: &SqlitePool, media_item_id: &str) -> Option<DateTime<Utc>> {
    let aired: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT aired_at FROM playback_history WHERE media_item_id = $1 ORDER BY aired_at DESC LIMIT 1"
    )
    .bind(media_item_id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None);
    aired
}

pub async fn generate_auto_schedule(
    pool: &SqlitePool,
    channel_id: &str,
    start_time: DateTime<Utc>,
    end_time: DateTime<Utc>,
    profile_name: &str,
    policy: &str, // "Strict", "Balanced", "Relaxed"
) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
    let profile = ChannelProfile::get_profile_by_name(profile_name);
    let gaps = find_schedule_gaps(pool, channel_id, start_time, end_time).await?;
    
    if gaps.is_empty() {
        return Ok(0);
    }

    // Ensure we have a schedule active for this range.
    // If not, create one.
    let mut schedule_id: Option<String> = sqlx::query_scalar(
        "SELECT id FROM schedules WHERE channel_id = $1 AND start_time <= $2 AND end_time >= $3 LIMIT 1"
    )
    .bind(channel_id)
    .bind(start_time)
    .bind(end_time)
    .fetch_optional(pool)
    .await?;

    if schedule_id.is_none() {
        let new_id = format!("sched_{}", uuid::Uuid::new_v4());
        sqlx::query(
            "INSERT INTO schedules (id, channel_id, name, start_time, end_time) VALUES ($1, $2, $3, $4, $5)"
        )
        .bind(&new_id)
        .bind(channel_id)
        .bind(format!("Auto Schedule - {}", profile.name))
        .bind(start_time)
        .bind(end_time)
        .execute(pool)
        .await?;
        schedule_id = Some(new_id);
    }

    let schedule_id_val = schedule_id.unwrap();
    let mut added_entries = 0;

    // Load candidate library items
    let library_items: Vec<MediaItem> = sqlx::query_as::<_, MediaItem>(
        "SELECT * FROM media_items"
    )
    .fetch_all(pool)
    .await?;

    if library_items.is_empty() {
        return Err("No media items available in library for scheduling".into());
    }

    // Keep track of the last station ID time to insert station IDs every 30 mins
    let mut last_station_id_time = start_time - Duration::minutes(30);

    for gap in gaps {
        let mut t = gap.start_time;
        while t < gap.end_time {
            let remaining_gap_seconds = (gap.end_time - t).num_seconds();
            if remaining_gap_seconds <= 10 {
                break; // Too small
            }

            // 1. Station ID Rule: every 30 minutes
            if (t - last_station_id_time).num_minutes() >= 30 {
                // Find a Station ID item
                if let Some(station_id_item) = library_items.iter().find(|i| i.media_type == "StationID") {
                    let entry_duration = Duration::seconds(station_id_item.runtime as i64);
                    let entry_end = (t + entry_duration).min(gap.end_time);
                    
                    sqlx::query(
                        "INSERT INTO schedule_entries (id, schedule_id, media_item_id, start_time, end_time, is_locked, explanation) \
                         VALUES ($1, $2, $3, $4, $5, $6, $7)"
                    )
                    .bind(format!("se_{}", uuid::Uuid::new_v4()))
                    .bind(&schedule_id_val)
                    .bind(&station_id_item.id)
                    .bind(t)
                    .bind(entry_end)
                    .bind(0)
                    .bind("Station Identity Rule (Runs every 30 minutes)")
                    .execute(pool)
                    .await?;

                    last_station_id_time = t;
                    t = entry_end;
                    added_entries += 1;
                    continue;
                }
            }

            // 2. Select main content or filler based on remaining gap
            let is_filler = remaining_gap_seconds < 600; // If less than 10 mins, treat as filler slot
            
            let mut best_candidate: Option<&MediaItem> = None;
            let mut best_score = -9999.0;
            let mut choice_explanation = String::new();

            for item in &library_items {
                // Filters
                if is_filler {
                    if item.media_type != "Bumper" && item.media_type != "Trailer" && item.media_type != "StationID" && item.media_type != "ShortFilm" {
                        continue;
                    }
                } else {
                    // Do not schedule bumpers or station IDs in main slots
                    if item.media_type == "Bumper" || item.media_type == "StationID" || item.media_type == "Trailer" {
                        continue;
                    }
                }

                // If strict/balanced, don't overshoot the gap
                if policy != "Relaxed" && item.runtime > remaining_gap_seconds as i32 {
                    continue; // Exceeds gap
                }

                // Time-of-day Content Rules
                let hour = t.hour();
                if item.media_type == "Movie" && hour < profile.forbid_horror_before_hour && is_horror_item(item) {
                    continue; // Horror restriction
                }
                if hour < profile.documentaries_only_after_hour && item.media_type == "Documentary" {
                    continue; // Documentary time-restriction
                }
                if let Some((start_h, end_h)) = profile.educational_only_between {
                    if (hour >= start_h && hour < end_h) && item.media_type != "Educational" && policy == "Strict" {
                        continue; // Strictly educational block
                    }
                }

                // Scoring
                let mut score = item.rating.unwrap_or(5.0);

                // Preference matches
                if profile.preferred_media_types.contains(&item.media_type) {
                    score += 5.0;
                }

                // Rotation rules
                let last_aired = get_last_airing(pool, &item.id).await;
                let mut days_since_aired = 999.0;
                if let Some(la) = last_aired {
                    let diff = t.signed_duration_since(la);
                    days_since_aired = diff.num_days() as f64;
                    
                    if item.media_type == "Movie" && days_since_aired < 30.0 {
                        if policy == "Strict" { continue; }
                        score -= 20.0; // Heavy penalty
                    } else if item.media_type == "Episode" && days_since_aired < 7.0 {
                        if policy == "Strict" { continue; }
                        score -= 15.0;
                    }
                }

                // Adjust based on how well it fits the remaining gap
                let size_diff = (remaining_gap_seconds as i32 - item.runtime).abs();
                score -= (size_diff as f64) * 0.001; // Tiny penalty for size misfit

                if score > best_score {
                    best_score = score;
                    best_candidate = Some(item);
                    choice_explanation = format!(
                        "Aired {} days ago. Base rating {}. Matches profile {}. {}",
                        if days_since_aired > 900.0 { "never".to_string() } else { format!("{:.1}", days_since_aired) },
                        item.rating.unwrap_or(5.0),
                        profile.name,
                        if is_filler { "Selected as gap-filling bumper/trailer." } else { "Matches program slot requirements." }
                    );
                }
            }

            // If we found a candidate, schedule it!
            if let Some(candidate) = best_candidate {
                // If a Movie and we have a Bumper, insert a bumper first!
                if candidate.media_type == "Movie" && !is_filler {
                    if let Some(bumper) = library_items.iter().find(|i| i.media_type == "Bumper") {
                        let bumper_duration = Duration::seconds(bumper.runtime as i64);
                        let bumper_end = (t + bumper_duration).min(gap.end_time);
                        sqlx::query(
                            "INSERT INTO schedule_entries (id, schedule_id, media_item_id, start_time, end_time, is_locked, explanation) \
                             VALUES ($1, $2, $3, $4, $5, $6, $7)"
                        )
                        .bind(format!("se_{}", uuid::Uuid::new_v4()))
                        .bind(&schedule_id_val)
                        .bind(&bumper.id)
                        .bind(t)
                        .bind(bumper_end)
                        .bind(0)
                        .bind("Bumper Identity Rule (Pre-film bumper)")
                        .execute(pool)
                        .await?;

                        t = bumper_end;
                        added_entries += 1;
                    }
                }

                let entry_duration = Duration::seconds(candidate.runtime as i64);
                let entry_end = (t + entry_duration).min(gap.end_time);

                sqlx::query(
                    "INSERT INTO schedule_entries (id, schedule_id, media_item_id, start_time, end_time, is_locked, explanation) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7)"
                )
                .bind(format!("se_{}", uuid::Uuid::new_v4()))
                .bind(&schedule_id_val)
                .bind(&candidate.id)
                .bind(t)
                .bind(entry_end)
                .bind(0)
                .bind(&choice_explanation)
                .execute(pool)
                .await?;

                // Add to history to support rotation calculations for the rest of generation
                sqlx::query(
                    "INSERT INTO playback_history (id, channel_id, media_item_id, aired_at, duration_aired) \
                     VALUES ($1, $2, $3, $4, $5)"
                )
                .bind(format!("hist_{}", uuid::Uuid::new_v4()))
                .bind(channel_id)
                .bind(&candidate.id)
                .bind(t)
                .bind(candidate.runtime)
                .execute(pool)
                .await?;

                t = entry_end;
                added_entries += 1;
            } else {
                // No candidate fit, step forward 1 minute to avoid infinite loops if database lacks matching contents
                warn!("No scheduling candidate found for gap at {}. Advancing 1 minute.", t);
                t = t + Duration::minutes(1);
            }
        }
    }

    Ok(added_entries)
}

fn is_horror_item(item: &MediaItem) -> bool {
    // Check synopsis or genres if available. For basic rules, search synopsis for horror words.
    if let Some(syn) = &item.synopsis {
        let l = syn.to_lowercase();
        return l.contains("horror") || l.contains("scary") || l.contains("blood") || l.contains("ghost");
    }
    false
}
