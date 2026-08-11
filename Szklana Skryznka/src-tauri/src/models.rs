use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub logo_path: Option<String>,
    pub profile_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Actor {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Director {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MediaItem {
    pub id: String,
    pub title: String,
    pub original_title: Option<String>,
    pub media_type: String, // Movie, TVShow, Episode, Anime, Documentary, Educational, ShortFilm, Trailer, Commercial, Bumper, StationID, MusicVideo, Custom
    pub year: Option<i32>,
    pub runtime: i32, // in seconds
    pub synopsis: Option<String>,
    pub rating: Option<f64>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub director_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub rt_score: Option<String>,
    pub imdb_score: Option<String>,
    pub imdb_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct MediaFile {
    pub id: String,
    pub media_item_id: String,
    pub file_path: String,
    pub file_size: i64,
    pub checksum: Option<String>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub resolution: Option<String>,
    pub duration: i32, // in seconds
    pub created_at: String,
    pub video_bitrate: Option<i64>,
    pub frame_rate: Option<f64>,
    pub audio_channels: Option<i32>,
    pub audio_language: Option<String>,
    pub quality_score: Option<f64>,
    pub quality_score_done: Option<i32>,
    pub audio_tracks: Option<String>,
    pub embedded_subtitles: Option<String>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub video_profile: Option<String>,
    pub video_level: Option<i64>,
    pub audio_sample_rate: Option<String>,
    pub ebur128_loudness: Option<f64>,
    pub vmaf_score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Genre {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Tag {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Subtitle {
    pub id: String,
    pub media_item_id: String,
    pub language: String,
    pub subtitle_type: String,
    pub file_path: String,
    pub is_default: i32, // sqlite representation of bool (0 or 1)
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Schedule {
    pub id: String,
    pub channel_id: String,
    pub name: String,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ScheduleEntry {
    pub id: String,
    pub schedule_id: String,
    pub media_item_id: String,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
    pub is_locked: i32, // 0 = false, 1 = true
    pub explanation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ScheduleTemplate {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TemplateEntry {
    pub id: String,
    pub template_id: String,
    pub offset_seconds: i32,
    pub duration_seconds: i32,
    pub media_type_filter: Option<String>,
    pub genre_filter: Option<String>,
    pub is_filler: i32, // 0 or 1
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PlaybackHistory {
    pub id: String,
    pub channel_id: String,
    pub media_item_id: String,
    pub aired_at: DateTime<Utc>,
    pub duration_aired: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Watchlist {
    pub id: String,
    pub media_item_id: String,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Setting {
    pub key: String,
    pub value: String,
}

// Custom compound structs for API returns
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaItemDetails {
    pub item: MediaItem,
    pub files: Vec<MediaFile>,
    pub subtitles: Vec<Subtitle>,
    pub genres: Vec<String>,
    pub tags: Vec<String>,
    pub actors: Vec<String>,
    pub directors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleEntryDetails {
    #[serde(flatten)]
    pub entry: ScheduleEntry,
    pub item_title: String,
    pub media_type: String,
    pub duration: i32,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
    pub file_path: Option<String>,
    pub audio_tracks: Option<String>,
    pub audio_language: Option<String>,
    pub embedded_subtitles: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayoutState {
    pub channel_id: String,
    pub current_time: DateTime<Utc>,
    pub active_entry: Option<ScheduleEntryDetails>,
    pub next_entry: Option<ScheduleEntryDetails>,
    pub previous_entry: Option<ScheduleEntryDetails>,
    pub playout_position_ms: i64, // Position in ms inside the active item
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsReport {
    pub missing_posters_count: i64,
    pub missing_backdrops_count: i64,
    pub missing_synopsis_count: i64,
    pub missing_english_subs_count: i64,
    pub missing_french_subs_count: i64,
    pub duplicate_files: Vec<String>,
    pub duplicate_metadata: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualityIssue {
    pub category: String,
    pub description: String,
    pub penalty: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recommendation {
    pub action: String,
    pub expected_gain: f32,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoQualityScore {
    pub overall: f32,                  // 0.0–100.0 (compressed toward central range)
    pub visual_quality: f32,
    pub audio_quality: f32,
    pub encoding_quality: f32,
    pub container_quality: f32,
    pub integrity: f32,
    pub compatibility: f32,
    pub archival_quality: f32,
    pub confidence: f32,
    pub qualitative_rating: String,
    pub deductions: Vec<QualityIssue>,
    pub recommendations: Vec<Recommendation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerInfo {
    pub format_name: String,
    pub format_long_name: String,
    pub duration_sec: f64,
    pub size_bytes: i64,
    pub bitrate: i64,
    pub start_time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoStreamInfo {
    pub index: usize,
    pub codec_name: String,
    pub codec_long_name: String,
    pub profile: String,
    pub level: i64,
    pub width: u32,
    pub height: u32,
    pub bit_depth: u32,
    pub frame_rate: f64,
    pub color_space: String,
    pub color_transfer: String,
    pub color_primaries: String,
    pub is_hdr: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioStreamInfo {
    pub index: usize,
    pub codec_name: String,
    pub codec_long_name: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub channel_layout: String,
    pub language: String,
    pub bitrate: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleStreamInfo {
    pub index: usize,
    pub codec_name: String,
    pub language: String,
    pub is_default: bool,
    pub is_forced: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaFileMetadata {
    pub title: Option<String>,
    pub encoder: Option<String>,
    pub creation_time: Option<String>,
    pub writing_library: Option<String>,
    pub custom_tags: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UniversalMediaInfo {
    pub file_path: String,
    pub container: ContainerInfo,
    pub video_streams: Vec<VideoStreamInfo>,
    pub audio_streams: Vec<AudioStreamInfo>,
    pub subtitle_streams: Vec<SubtitleStreamInfo>,
    pub metadata: MediaFileMetadata,
    pub is_valid: bool,
}
