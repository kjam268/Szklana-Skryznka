# Szklana Skrzynka — Complete Software Documentation

> **Version:** 0.8.0 · **Platform:** macOS (desktop) · **Runtime:** Tauri 2 + React 19

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Application Pages](#4-application-pages)
   - 4.1 [On Air — Live Playout Monitor](#41-on-air--live-playout-monitor)
   - 4.2 [The Grid — Broadcast Schedule Editor](#42-the-grid--broadcast-schedule-editor)
   - 4.3 [Library — Media Asset Manager](#43-library--media-asset-manager)
   - 4.4 [Statistics — Station Analytics](#44-statistics--station-analytics)
   - 4.5 [Suggestions — AI Recommendations](#45-suggestions--ai-recommendations)
   - 4.6 [Watchlist — Acquisition Queue](#46-watchlist--acquisition-queue)
   - 4.7 [Settings — Configuration Panel](#47-settings--configuration-panel)
   - 4.8 [Database Viewer](#48-database-viewer)
   - 4.9 [Splash Screen](#49-splash-screen)
   - 4.10 [TV Client — Fullscreen Player](#410-tv-client--fullscreen-player)
   - 4.11 [Tray View — System Tray Mini Dashboard](#411-tray-view--system-tray-mini-dashboard)
5. [Database Schema](#5-database-schema)
6. [Backend Modules](#6-backend-modules)
   - 6.1 [Scanner](#61-scanner)
   - 6.2 [Scheduler](#62-scheduler)
   - 6.3 [Playout Engine](#63-playout-engine)
   - 6.4 [Media Engine](#64-media-engine)
7. [Tauri Command Reference](#7-tauri-command-reference)
8. [State Management](#8-state-management)
9. [Data Models](#9-data-models)
10. [Keyboard Shortcuts](#10-keyboard-shortcuts)
11. [Settings Reference](#11-settings-reference)
12. [Channel Profiles](#12-channel-profiles)
13. [Media Types Supported](#13-media-types-supported)
14. [Quality Scoring System](#14-quality-scoring-system)
15. [File Formats and Codec Support](#15-file-formats-and-codec-support)
16. [External API Integrations](#16-external-api-integrations)

---

## 1. Overview

**Szklana Skrzynka** (Polish: *Glass Box*) is a full-featured **personal broadcast automation station** — a desktop application that lets you build, schedule, and playout a real television channel from your own local media library.

It combines:
- A **media library manager** with automatic metadata enrichment (TMDb, OMDb, AniList, OpenSubtitles)
- A **broadcast scheduler** with template-based weekly grid management
- A **live playout engine** that streams your schedule in real-time via HLS transcoding
- **Analytics** including station telemetry, playback history, and genre affinity heatmaps
- A **recommendation engine** that suggests content based on what is already in your library

The application runs entirely **offline and locally** — there is no cloud dependency. The SQLite database and all media files stay on your machine.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       FRONTEND (React 19)                       │
│                                                                 │
│  App.tsx  →  Sidebar  →  [11 Pages]                            │
│                                                                 │
│  State: Zustand stores (Library, Schedule, Channel, Player…)   │
│  Events: Tauri event listeners + window custom events          │
└───────────────────────────┬─────────────────────────────────────┘
                            │  Tauri IPC (invoke / emit)
┌───────────────────────────▼─────────────────────────────────────┐
│                    TAURI 2 RUNTIME (Rust)                       │
│                                                                 │
│  commands.rs    <- All ~60 IPC handler functions               │
│  scheduler.rs   <- Channel profiles, gap-fill logic            │
│  playout.rs     <- Real-time playout state calculation         │
│  scanner.rs     <- File system scan + online metadata fetch    │
│  media_engine.rs <- FFprobe wrappers, quality scoring          │
│  db.rs          <- SQLite pool initialisation + migrations     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
       ┌────────────────────┼────────────────────┐
       │                    │                    │
┌──────▼──────┐    ┌────────▼──────┐    ┌───────▼──────┐
│  SQLite DB  │    │  FFmpeg/probe │    │ HLS Server   │
│ (sqlx 0.8)  │    │  (subprocess) │    │ (port 8098)  │
└─────────────┘    └───────────────┘    └──────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| Tauri 2 over Electron | ~10x smaller binary, native Rust backend, no Chromium bundled |
| SQLite via sqlx async | Zero-config embedded DB; migrations auto-run at startup |
| HLS transcoding via FFmpeg | Universal browser compatibility; supports hardware decode |
| Zustand for state | Lightweight, no boilerplate, selector-based re-renders |
| React 19 | Concurrent features, improved Suspense for async data |

---

## 3. Technology Stack

### Frontend

| Package | Version | Purpose |
|---|---|---|
| `react` | ^19.1.0 | UI framework |
| `zustand` | ^5.0.3 | Global state management |
| `lucide-react` | ^0.468.0 | Icon library |
| `date-fns` | ^4.1.0 | Date/time formatting |
| `ag-grid-react` | ^33.0.4 | High-performance data grid (Database viewer) |
| `@tauri-apps/api` | ^2 | Tauri IPC, event system, file dialogs |
| `@tanstack/react-query` | ^5.62.2 | Async data fetching and caching |

### Backend (Rust)

| Crate | Purpose |
|---|---|
| `tauri 2` | Desktop runtime, window management, tray icon, IPC |
| `sqlx 0.8` | Async SQLite queries with compile-time checking |
| `chrono 0.4` | Date/time types and timezone handling |
| `tokio 1` | Async runtime |
| `serde / serde_json` | Serialization for IPC data transfer |
| `uuid 1.8` | UUID v4 generation for all entity IDs |
| `reqwest 0.12` | HTTP client for TMDb, OMDb, AniList, OpenSubtitles APIs |
| `notify 6.1.1` | File system watcher for library hot-reload |
| `rfd 0.15` | Native file/directory picker dialogs |
| `regex 1` | Filename parsing for metadata inference |
| `md5 0.7` | File checksum calculation |
| `tracing` | Structured logging |

---

## 4. Application Pages

### 4.1 On Air — Live Playout Monitor

**Navigation key:** `onair`

The primary operational view. Displays the live broadcast state of all channels in real time.

#### Features

- **Live video player** — plays the currently scheduled item via HLS stream (`http://127.0.0.1:8098/hls/stream.m3u8`) with WebKit direct playout fallback
- **Playout position tracking** — calculates where in the current item playback is based on `aired_at` timestamp + elapsed time
- **Inspector panel** — right-side sidebar showing the current, next, and previous schedule entries with full metadata (synopsis, year, director, poster)
- **Timeline strip** — horizontal scrollable row of upcoming schedule items colour-coded by media type
- **Audio track cycling** — for items with multiple audio streams, switch between them (triggers HLS retranscode with the selected track index)
- **Subtitle track selection** — cycle through all available subtitle tracks (external SRT/VTT files + embedded streams); renders as custom WebVTT overlay
- **Subtitle sync offset** — adjust subtitle timing ±N seconds at runtime
- **Mute toggle** — per-session mute applied to the video element
- **Telemetry panel** (collapsible) — shows active codec, resolution, audio format, HLS buffer health, stream URL, encoding quality preset
- **Multi-channel support** — if multiple channels exist, they appear as tabs; each channel gets its own playout state
- **Schedule gap detection** — warns visually when the schedule has no item at the current time
- **Open TV window** — launches a borderless fullscreen player window (TvClient)

#### Keyboard Shortcuts (in this view)

| Key | Action |
|---|---|
| `Space` | Toggle audio mute |
| `S` | Cycle to next subtitle track |
| `A` | Cycle to next audio track |

---

### 4.2 The Grid — Broadcast Schedule Editor

**Navigation key:** `grid`

A week-by-week visual schedule editor — the programme guide for your station.

#### Features

- **7-day grid view** — columns = Monday through Sunday, rows = channels
- **Schedule entries** displayed as coloured blocks proportional to runtime
- **Week navigation** — jump backward/forward by 7 days; `T` returns to the current week
- **Library drawer** — slides in from the right; search and drag items from the library onto the grid
- **Context menu on entries** — Edit start time, lock entry, delete entry
- **Lock mode** — locked entries are protected from template overwrite operations
- **Templates panel** — toggle via the TEMPLATES button; manage reusable weekly schedule templates
  - Create templates with named slots (offset in seconds from day start, duration, media type filter, genre filter, filler flag)
  - Apply a template to any channel for any date range — auto-fills gaps using matching library content
- **Gap indicators** — empty time blocks shown in red/amber
- **Automatic schedule refresh** — after template application the grid auto-reloads

#### Keyboard Shortcuts (in this view)

| Key | Action |
|---|---|
| `←` | Previous week |
| `→` | Next week |
| `T` | Jump to this week |
| `L` | Toggle Library drawer |

---

### 4.3 Library — Media Asset Manager

**Navigation key:** `library`

The central catalogue of all indexed media items.

#### Scanning and Indexing

- **Directory scan** — enter a local path and click SCAN LIBRARY; the scanner recursively walks the directory, identifies video files, reads codec/resolution/duration via FFprobe, and upserts the records
- **Watched paths** — previously scanned paths are remembered and can be re-triggered
- **Online metadata enrichment** — after file discovery, the scanner calls TMDb (movies), AniList (anime), or OMDb for titles, synopsis, poster, backdrop, ratings, cast, directors, genres
- **Poster downloading** — artwork is downloaded and stored in the app data directory

#### Browsing

- **Tab filters** — All / Movie / TV Show / Documentary / Animation / Shorts / Favorites / Kids / Classic / Not Found
- **Search** — full-text search across title and original title; `Esc` clears the query
- **Sort by** — Alphabetical, Quality Score, IMDb Score, Rotten Tomatoes, Duration, Release Date
- **Sort direction** — Ascending / Descending toggle
- **TV Show grouping** — Episodes are grouped under show names; clicking a show expands to show seasons and episodes

#### Advanced Filter Panel

Opened via the **FILTERS** button, which shows an active filter count badge:

| Filter | Control |
|---|---|
| Genres | Multi-chip select (derived from library data) |
| Year Range | Dual number inputs (min/max year from library) |
| Resolution | Checkboxes: 4K / 1080p / 720p / SD |
| Video Codec | Checkboxes: H.264 / H.265 / AV1 / VP9 / Other |
| Min Quality Score | Slider 0–100 |
| Has Subtitles | Toggle (checks subtitles array length) |
| Has Poster Art | Toggle (checks for HTTP poster URL) |

- `Esc` keyboard shortcut clears search and all filters simultaneously
- Active filter count badge appears on the FILTERS button

#### Bulk Actions

- **SELECT MODE** button — enters selection mode; cards show a circular checkbox overlay
- Click any card to toggle selection; selected cards get cyan border glow
- **Bulk toolbar** appears when one or more items are selected:
  - `SELECT ALL` / `DESELECT ALL`
  - `RE-SCAN METADATA` — calls `refresh_item_metadata` per selected item sequentially
  - `QUALITY SCORE` — enqueues quality analysis for each item's first file
  - `REMOVE (N)` — confirms then removes items from the database
- Live progress indicator shown during batch operations

#### Detail Panel (right sidebar)

Clicking a card opens a detail panel with:

- Poster / backdrop artwork display
- Editable fields: Title, Original Title, Year, Runtime, Synopsis, Genres, Tags, Actors, Directors, IMDb ID, IMDb Score, Rotten Tomatoes
- **REFRESH METADATA** — re-fetches from TMDb with optional search override
- **Custom poster upload** — pick a local image file as poster
- **Quality Score display** — the computed VQS score with breakdown categories
- **Technical file info** — codec, resolution, bitrate, frame rate, audio channels, EBU R128 loudness, VMAF score
- **Subtitles section** — lists all known subtitle tracks; OpenSubtitles.org search and download
- **Subtitle import** — import a local SRT/VTT file with language tag
- **Add to Schedule** — quick-add from library detail to a specific channel schedule slot
- **Delete from library** — removes from database (does not delete the physical file)

---

### 4.4 Statistics — Station Analytics

**Navigation key:** `health`

A five-tab analytics dashboard for library and broadcast health.

#### Tabs

##### BROADCAST STATS
- Most-played items leaderboard (top 10 by `play_count`)
- Each entry shows rank, poster, title, year, media type, and play count bar

##### HEALTH METRICS
- KPI cards: Total Broadcast Plays, Catalog Runtime (hours/days), Indexed Assets, Overall Health %
- Metadata coverage bars: Poster, Backdrop, Synopsis, EN Subtitles, FR Subtitles
- Overall station health score = average of all 5 coverage percentages

##### INTEGRITY AUDIT
- Missing posters count
- Missing backdrops count
- Missing synopsis count
- Missing subtitle counts (EN, FR)
- Duplicate files list (same checksum)
- Duplicate metadata list (same title + year)

##### AIR HISTORY
- Chronological list of all aired items (up to 200 most recent)
- Shows channel name, poster thumbnail, title, type, air date/time, duration aired

##### GENRE HEATMAP
- A 7-column × N-row grid (days Mon–Sun × top 15 genres by total airings)
- Cell intensity = number of airings, colour-scaled from transparent to full cyan
- Zero cells shown as muted dots
- Row totals (right column) and column day totals (bottom row)
- Gradient legend in the header
- Data source: `playback_history` joined with `media_genres` and `genres`

---

### 4.5 Suggestions — AI Recommendations

**Navigation key:** `suggestions`

An intelligent content recommendation engine.

#### Features

- Calls `get_smart_suggestions` which analyses the existing library's genres, directors, and ratings to find complementary content
- Returns recommendations with an **affinity score** showing how well they match library patterns
- **Min Rating slider** — filter to only show recommendations above a threshold rating
- **Affinity badges** — items matching your library's dominant genres are highlighted
- **Add to Watchlist** — one-click to save a recommendation to the Watchlist for future acquisition
- Cards show: poster (or placeholder), title, year, director, synopsis, rating stars, affinity badge
- Source engine attribution (TMDb-based, AniList-based, etc.)

---

### 4.6 Watchlist — Acquisition Queue

**Navigation key:** `watchlist`

A queue of titles you want to acquire and add to your library.

#### Features

- Shows all items added via Suggestions or manually
- Each entry shows poster, title, year, director, synopsis, rating
- **ADD TO SCHEDULE** — if the item already exists in the library (checked by ID match), it can be added directly to a channel schedule with date/time picker; if not in library, shows a warning
- **Remove** — delete from watchlist
- Library membership check runs on each item to show a checkmark badge when the item is already indexed

---

### 4.7 Settings — Configuration Panel

**Navigation key:** `settings`

Persistent application settings stored in the `settings` table.

#### Tabs

##### METADATA APIs
- **TMDb API Key** — The Movie Database key for movie metadata, posters, cast
- **OMDb API Key** — Open Movie Database key for IMDb scores, Rotten Tomatoes
- **AniList API Key** — AniList.co key for anime metadata
- **Test Connection** — verifies TMDb key with a live request
- Keys are persisted individually via `set_setting`

##### BROADCAST
- **HLS Quality Preset** — selects FFmpeg encoding profile:
  - `Low` — 720p · 1.5 Mbps (weak hardware)
  - `Standard` — 1080p · 3 Mbps (default)
  - `High` — 1080p · 6 Mbps (quality-first)
  - `Passthrough` — no transcode, direct HLS mux (fastest, most compatible)
- **Default Subtitle Language** — preferred subtitle track language code (e.g. `en`, `fr`)
- **Default Audio Language** — preferred audio track selection language code

##### LIBRARY
- **Watched Paths** — list of previously scanned directories; shows path + remove button
- **Database Maintenance** — danger-zone operations:
  - Purge Orphaned Files — removes DB records where the file no longer exists on disk
  - Purge All Media — removes all media items while keeping channels and schedules
  - Full Database Reset — drops all tables and re-runs migrations from scratch

##### ABOUT
- App name, version (0.8.0), technology credits

---

### 4.8 Database Viewer

**Navigation key:** `database`

A raw SQL table explorer for power users and debugging.

#### Features

- AG Grid-powered table view of any database table
- Table selector dropdown (all tables listed)
- Column auto-sizing
- Read-only mode (no inline editing to prevent corruption)
- Useful for inspecting raw schedule entries, settings values, playback history records, etc.

---

### 4.9 Splash Screen

Shown on first boot before the main interface appears. Displays:
- Application logo and name
- Boot sequence animation
- Version number
- Transitions automatically after animation completes

---

### 4.10 TV Client — Fullscreen Player

Launched via `open_tv_window` command or the TV icon in On Air. Opens a **separate native window** running a borderless fullscreen video player:

- Plays the active channel's current item
- No controls visible by default (hover to reveal)
- Subtitle overlay rendered as WebVTT
- Designed for secondary monitor or TV output use case

---

### 4.11 Tray View — System Tray Mini Dashboard

A compact view rendered in the system tray popover window:

- **Library stats**: total item count, average quality score, "not found" metadata count
- **Scan progress bar** — live progress from the background scan process
- Minimal UI (~200px wide), refreshes automatically via Tauri events

---

## 5. Database Schema

The SQLite database is created at the Tauri app data directory and auto-migrated on startup via sqlx. All IDs are UUID v4 strings.

### Tables Overview

| Table | Description |
|---|---|
| `channels` | Broadcast channels (name, logo, profile) |
| `media_items` | Core catalogue entries (title, type, year, runtime, metadata) |
| `media_files` | Physical files linked to items (path, codec, resolution, quality) |
| `actors` | Actor name registry |
| `directors` | Director name registry |
| `media_actors` | M:N join between media_items and actors |
| `media_directors` | M:N join between media_items and directors |
| `genres` | Genre name registry |
| `media_genres` | M:N join between media_items and genres |
| `tags` | Tag name registry (Favorites, Classic, Kids, etc.) |
| `media_tags` | M:N join between media_items and tags |
| `subtitles` | Subtitle files linked to items (language, type, path) |
| `schedules` | Schedule containers (channel, name, start/end time) |
| `schedule_entries` | Individual programme slots (media_item, start/end, locked) |
| `schedule_templates` | Reusable schedule blueprints (name, description) |
| `template_entries` | Slots within a template (offset_sec, duration_sec, filters) |
| `playback_history` | Audit log of every aired item (channel, item, aired_at) |
| `watchlists` | Acquisition watchlist items |
| `settings` | Key-value persistent settings store |
| `analysis_jobs` | Background quality scoring job queue |

### Entity Relationships

```
channels ──< schedules ──< schedule_entries >── media_items ──< media_files
channels ──< playback_history >── media_items
schedule_templates ──< template_entries
media_items ──< media_genres >── genres
media_items ──< media_actors >── actors
media_items ──< media_directors >── directors
media_items ──< media_tags >── tags
media_items ──< subtitles
```

### `media_items` — Key Fields

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID v4 |
| `title` | TEXT | Display title |
| `original_title` | TEXT | Original language title |
| `media_type` | TEXT | See Media Types section |
| `year` | INTEGER | Release year |
| `runtime` | INTEGER | Duration in seconds |
| `synopsis` | TEXT | Description |
| `rating` | REAL | General rating |
| `poster_path` | TEXT | Local file path or HTTPS URL |
| `backdrop_path` | TEXT | Local file path or HTTPS URL |
| `imdb_id` | TEXT | IMDb identifier (tt…) |
| `imdb_score` | TEXT | IMDb rating string |
| `rt_score` | TEXT | Rotten Tomatoes score string |
| `play_count` | INTEGER | Total times aired |

### `media_files` — Technical Fields

| Column | Type | Notes |
|---|---|---|
| `file_path` | TEXT UNIQUE | Absolute path to file |
| `file_size` | INTEGER | Bytes |
| `video_codec` | TEXT | e.g. h264, hevc, av1 |
| `audio_codec` | TEXT | e.g. aac, ac3, flac |
| `resolution` | TEXT | e.g. 1920x1080 |
| `duration` | INTEGER | Seconds |
| `quality_score` | REAL | 0.0–100.0 VQS score |
| `vmaf_score` | REAL | VMAF perceptual quality |
| `ebur128_loudness` | REAL | Integrated loudness (LUFS) |
| `frame_rate` | REAL | Frames per second |
| `video_bitrate` | INTEGER | Bits per second |
| `audio_channels` | INTEGER | e.g. 2, 6, 8 |
| `color_space` | TEXT | e.g. bt709, bt2020nc |
| `color_transfer` | TEXT | e.g. smpte2084 for HDR |
| `color_primaries` | TEXT | e.g. bt2020 |
| `embedded_subtitles` | TEXT | JSON array of embedded subtitle tracks |
| `audio_tracks` | TEXT | JSON array of audio streams |

### Performance Indexes

```sql
idx_media_items_title     -- (title)
idx_media_items_type      -- (media_type)
idx_media_files_item_id   -- (media_item_id)
idx_schedule_entries_time -- (start_time, end_time)
idx_playback_history_aired -- (aired_at)
idx_subtitles_item_id     -- (media_item_id)
```

---

## 6. Backend Modules

### 6.1 Scanner (`scanner.rs`)

Responsible for indexing media from the filesystem:

1. **File discovery** — recursive walk of a directory for video file extensions (`.mp4`, `.mkv`, `.avi`, `.mov`, `.ts`, `.m2ts`, `.webm`, `.flv`, `.wmv`, and others)
2. **File hashing** — MD5 checksum for duplicate detection; skips already-known files by path + checksum comparison
3. **Technical probing** — calls `ffprobe -v quiet -print_format json -show_streams -show_format` to extract codec, resolution, frame rate, duration, audio and subtitle stream data
4. **Filename parsing** — regex patterns to infer title, year, season, and episode number from common naming conventions such as `Movie.Title.2024.mkv` or `Show.S01E03.mkv`
5. **Online metadata fetch** — sequential attempt: TMDb → OMDb → AniList depending on media type; downloads poster/backdrop artwork to the app data directory
6. **Database upsert** — inserts or updates `media_items`, `media_files`, `genres`, `media_genres`, `directors`, and `actors` using SQLite `INSERT OR REPLACE`
7. **Progress events** — emits `scan-progress` Tauri events with `{ filename, progress, total }` for live UI feedback
8. **Metadata refresh** — `refresh_item_metadata` re-fetches online data for an existing item, with an optional search query override

### 6.2 Scheduler (`scheduler.rs`)

The scheduling intelligence layer:

**Channel profiles** are named presets controlling what content gets scheduled and when:

| Profile | Content Types | Genre Mix | Time Rules |
|---|---|---|---|
| Classic Movie Channel | Movies | Drama 40%, Comedy 30%, Action 20% | Horror after 20:00 only |
| Documentary Channel | Documentary, Educational | Science 40%, History 30%, Nature 30% | All hours |
| Anime Channel | Anime, Episode | Fantasy 40%, Action 30%, Sci-Fi 30% | Horror after 22:00 |
| Educational Channel | Educational, Documentary | Science 50%, Technology 30%, Math 20% | Educational 08:00–16:00 only |
| Mixed Family Channel | Movie, TVShow, Episode | Adventure 40%, Comedy 30%, Family 30% | Horror after 19:00; Educational 09:00–12:00 |

**Gap detection** — `find_schedule_gaps` identifies unscheduled time ranges in a channel's schedule.

**Auto-fill logic** — `fill_schedule_gaps` selects items from the library to fill each gap, respecting:
- Channel profile's preferred media types and genre distribution targets
- Time-of-day rules
- Item runtime fit (avoids items that would overflow the gap)
- Already-scheduled repetition avoidance

**Template application** — `apply_template` maps a `ScheduleTemplate` onto a date range, instantiating `ScheduleEntry` records for each `TemplateEntry` slot by picking matching content from the library.

### 6.3 Playout Engine (`playout.rs`)

Real-time broadcast state computation:

- **`get_playout_state`** — given `(channel_id, now)`:
  1. Finds which `schedule_entry` is active at the current moment
  2. Calculates `playout_position_ms = (now - entry.start_time).as_millis()`
  3. Retrieves the next and previous entries
  4. Joins with `media_items` and `media_files` for full detail
  5. Returns `PlayoutState { current_time, active_entry, next_entry, previous_entry, playout_position_ms }`

- **`record_movie_played`** — called when a new item starts; inserts a `playback_history` row and increments `play_count` on `media_items`

### 6.4 Media Engine (`media_engine.rs`)

FFmpeg/FFprobe wrapper functions:

- **`open_media`** — runs `ffprobe` and parses full `UniversalMediaInfo` (container, all video/audio/subtitle streams, metadata tags)
- **`list_media_streams`** — lighter probe returning only stream list (used for track switching in OnAir)
- **`extract_media_thumbnail`** — runs `ffmpeg -ss {timestamp} -frames:v 1` to extract a JPEG frame as base64
- **`read_media_metadata`** — reads embedded metadata tags (title, encoder, creation time, writing library)
- **`start_transcode`** — launches background `ffmpeg` process:
  - Output: HLS segments to `{app_data}/hls/` directory
  - Quality preset applied (CRF, resolution scaling, audio normalisation)
  - Starts from `start_time_sec` seek offset
  - Selects audio track by `audio_track_index`
- **`stop_transcode`** — kills the FFmpeg subprocess, cleans up segment files
- **`get_hls_status`** — returns `{ is_running, segment_count, current_file }`
- **HLS server** — a minimal tokio HTTP server on port 8098 serving `.m3u8` playlists and `.ts` segments

---

## 7. Tauri Command Reference

All commands are called from the frontend via `invoke("command_name", { params })`.

### Library and Scanning

| Command | Parameters | Returns | Description |
|---|---|---|---|
| `scan_library` | `path: String` | `String` | Starts recursive scan of a directory |
| `stop_scan` | — | `()` | Cancels the running scan |
| `get_media` | — | `Vec<MediaItemDetails>` | Returns all library items with full detail |
| `get_watched_paths` | — | `Vec<String>` | Returns saved scan directories |
| `remove_watched_path` | `path: String` | `Vec<String>` | Removes a watched path |
| `select_directory` | — | `Option<String>` | Opens native directory picker |
| `refresh_item_metadata` | `item_id: String, search_override: Option<String>` | `String` | Re-fetches metadata from online APIs |
| `purge_database` | `target: String` | `String` | Accepts `"orphans"`, `"all_media"`, or `"full_reset"` |

### Media Metadata

| Command | Parameters | Returns | Description |
|---|---|---|---|
| `save_media` | `details: MediaItemDetails` | `String` | Saves edits to a media item and all relations |
| `delete_media` | `id: String` | `String` | Removes a media item from the database |
| `open_media` | `path: String` | `UniversalMediaInfo` | Full FFprobe analysis of a file |
| `read_media_metadata` | `path: String` | `MediaFileMetadata` | Reads embedded metadata tags |
| `list_media_streams` | `path: String` | `JSON` | Stream list for track switching |
| `extract_media_thumbnail` | `path: String, timestamp: f64` | `String` (base64 JPEG) | Extracts a video frame |
| `select_custom_poster` | — | `Option<String>` | Opens image file picker; copies to app data |

### Scheduling

| Command | Parameters | Returns | Description |
|---|---|---|---|
| `get_schedule_entries` | `channel_id, start, end` | `Vec<ScheduleEntryDetails>` | Returns schedule entries for a date range |
| `create_schedule` | `channel_id, name, start_time, end_time, entries[]` | `String` (schedule ID) | Creates a schedule with entries |
| `update_schedule` | `entry_id, start_time, end_time, is_locked` | `String` | Updates an existing entry |
| `delete_schedule_entry` | `entry_id: String` | `String` | Removes a single schedule slot |
| `apply_template` | `template_id, channel_id, start_date, end_date` | `String` | Applies a template to fill a date range |
| `get_schedule_templates` | — | `Vec<TemplateWithEntries>` | Lists all templates with their slots |
| `create_schedule_template` | `name, description, entries[]` | `String` (template ID) | Creates a new template |
| `delete_schedule_template` | `template_id: String` | `()` | Removes a template and its entries |
| `add_watchlist_item_to_schedule` | `item_id, channel_id, start_time` | `String` | Quick-adds a library item to a schedule slot |

### Channels and Playout

| Command | Parameters | Returns | Description |
|---|---|---|---|
| `get_channel_status` | — | `Vec<Channel>` | Lists all channels |
| `create_channel` | `name, logo_path, profile_name` | `String` (channel ID) | Creates a new broadcast channel |
| `delete_channel` | `channel_id: String` | `()` | Deletes a channel and all its schedules |
| `start_channel` | `channel_id: String` | `String` | Starts playout for a channel |
| `get_current_program` | `channel_id: String` | `Option<ScheduleEntryDetails>` | Active program at current time |
| `get_next_program` | `channel_id: String` | `Option<ScheduleEntryDetails>` | Next scheduled program |
| `record_movie_played` | `channel_id, media_item_id, duration_aired` | `()` | Records an airing event |
| `open_tv_window` | — | `()` | Opens the fullscreen TV player window |

### Subtitles and Subtitle Search

| Command | Parameters | Returns | Description |
|---|---|---|---|
| `get_subtitles` | `media_item_id: String` | `Vec<Subtitle>` | Database subtitles for an item |
| `get_media_subtitles` | `media_item_id, file_path` | `Vec<SubtitleRecordInfo>` | All subtitles (DB + embedded) |
| `read_subtitle_content` | `subtitle_id, file_path, track_index` | `String` (WebVTT) | Extracts and converts subtitle to WebVTT |
| `import_subtitle` | `media_item_id, file_path, language, is_default` | `String` | Imports a local subtitle file |
| `search_opensubtitles` | `item_id: String` | `Vec<OpenSubtitlesResult>` | Searches OpenSubtitles.org API |
| `download_opensubtitles` | `subtitle_id, media_item_id, language, file_name` | `String` | Downloads and saves a subtitle |
| `select_subtitle_file` | — | `Option<String>` | Opens native file picker for subtitle files |

### Transcoding and HLS

| Command | Parameters | Returns | Description |
|---|---|---|---|
| `start_transcode` | `file_path, start_time_sec, audio_track_index` | `String` | Starts FFmpeg HLS transcoding |
| `stop_transcode` | — | `()` | Stops FFmpeg and cleans up segments |
| `get_hls_status` | — | `HlsStatus` | Returns `{ is_running, segment_count, current_file }` |

### Analysis and Quality Scoring

| Command | Parameters | Returns | Description |
|---|---|---|---|
| `enqueue_media_analysis` | `media_file_id: String` | `()` | Adds a file to the quality analysis queue |
| `get_analysis_queue` | — | `Vec<AnalysisJob>` | Returns all pending/active/done analysis jobs |
| `retry_failed_jobs` | — | `()` | Re-queues all failed analysis jobs |
| `clear_completed_jobs` | — | `()` | Removes completed jobs from the queue |
| `get_video_quality_score` | `file_path: String` | `VideoQualityScore` | Runs synchronous quality scoring on a file |
| `run_diagnostics` | — | `DiagnosticsReport` | Produces the library health report |

### Suggestions and Watchlist

| Command | Parameters | Returns | Description |
|---|---|---|---|
| `get_smart_suggestions` | `min_rating: f64` | `Vec<RecommendedItem>` | AI recommendations based on library analysis |
| `add_to_suggestion_watchlist` | `id, title, year, director, synopsis, rating, poster_path` | `String` | Saves to watchlist |
| `get_suggestion_watchlist` | — | `Vec<WatchlistItem>` | Returns all watchlist items |
| `remove_from_suggestion_watchlist` | `id: String` | `()` | Removes from watchlist |

### Settings and Configuration

| Command | Parameters | Returns | Description |
|---|---|---|---|
| `get_setting` | `key: String` | `Option<String>` | Reads a single setting value |
| `set_setting` | `key: String, value: String` | `String` | Persists a setting |
| `get_all_settings` | — | `Record<String, String>` | Returns all settings as a flat map |

### Statistics and Reporting

| Command | Parameters | Returns | Description |
|---|---|---|---|
| `get_playback_history` | `limit: Option<i64>` | `Vec<PlaybackHistoryEntry>` | Returns recent airings |
| `get_genre_heatmap` | — | `Vec<HeatmapRow>` | Airings per genre per day of week (top 15 genres) |

### System and Window Management

| Command | Parameters | Returns | Description |
|---|---|---|---|
| `open_app_window` | — | `()` | Brings main window to front |
| `quit_app` | — | `()` | Stops transcode, closes the application |
| `open_tv_window` | — | `()` | Opens fullscreen TV player window |

---

## 8. State Management

All frontend state is managed with **Zustand**. Stores are singletons accessed by any component via hooks.

| Store Hook | Purpose | Key State |
|---|---|---|
| `useLibraryStore` | Media library catalogue | `items`, `isLoading`, `isScanning`, `scanProgress`, `scanLogs`, `searchQuery` |
| `useScheduleStore` | Weekly schedule grid | `entries`, `selectedChannelId`, `weekStart` |
| `useChannelStore` | Channel list and playout state | `channels`, `playoutState`, `activeChannelId` |
| `usePlayerStore` | Video player control | `isMuted`, `volume`, `subtitleOffset` |
| `useSettingsStore` | UI preferences | `sidebarCollapsed`, `theme` |
| `useDiagnosticsStore` | Health report data | `report`, `isLoading` |
| `useNotificationStore` | Toast notifications | `toasts`, `showToast`, `dismissToast` |
| `useAnalysisStore` | Quality job tracking | `activeProgress`, `updateJobProgress` |
| `useWatchlistStore` | Suggestion watchlist | `items`, `addItem`, `isInWatchlist` |

### Cross-Component Events

For decoupled navigation and updates between components, the app uses Tauri events and window custom events:

| Event | Payload | Purpose |
|---|---|---|
| `library-updated` | — | Trigger silent library refresh |
| `select-media-item` | `string` (item ID) | Open an item's detail panel in Library |
| `analysis-job-progress` | `{ job_id, media_file_id, filename, progress, stage }` | Real-time quality score progress |
| `scan-progress` | `{ filename, progress, total }` | Library scan progress bar update |

---

## 9. Data Models

### MediaItemDetails (composite)

```typescript
interface MediaItemDetails {
  item: MediaItem;          // Core metadata
  files: MediaFile[];       // Physical file records
  subtitles: Subtitle[];    // Known subtitle files
  genres: string[];         // Genre names
  tags: string[];           // Tag names (Favorites, Classic, etc.)
  actors: string[];         // Actor names
  directors: string[];      // Director names
}
```

### PlayoutState

```typescript
interface PlayoutState {
  channel_id: string;
  current_time: string;                       // ISO 8601
  active_entry: ScheduleEntryDetails | null;  // What is on now
  next_entry: ScheduleEntryDetails | null;    // What is on next
  previous_entry: ScheduleEntryDetails | null;
  playout_position_ms: number;                // Seek offset into active item
}
```

### VideoQualityScore

```typescript
interface VideoQualityScore {
  overall: number;            // 0–100 composite score
  visual_quality: number;
  audio_quality: number;
  encoding_quality: number;
  container_quality: number;
  integrity: number;
  compatibility: number;
  archival_quality: number;
  confidence: number;
  qualitative_rating: string; // "Excellent" | "Good" | "Fair" | "Poor"
  deductions: QualityIssue[];
  recommendations: Recommendation[];
}
```

### ScheduleEntryDetails

```typescript
interface ScheduleEntryDetails {
  id: string;
  schedule_id: string;
  media_item_id: string;
  start_time: string;         // ISO 8601
  end_time: string;           // ISO 8601
  is_locked: number;          // 0 or 1
  explanation?: string;
  item_title: string;
  media_type: string;
  duration: number;           // seconds
  poster_path?: string;
  backdrop_path?: string;
  file_path?: string;
  audio_tracks?: string;      // JSON
  embedded_subtitles?: string; // JSON
  synopsis?: string;
  year?: number;
  director?: string;
}
```

---

## 10. Keyboard Shortcuts

Shortcuts are automatically suppressed when focus is inside an `<input>`, `<textarea>`, `<select>`, or `contentEditable` element.

| Key | Active View | Action |
|---|---|---|
| `←` | The Grid | Navigate to previous week |
| `→` | The Grid | Navigate to next week |
| `T` | The Grid | Jump to current week |
| `L` | The Grid | Toggle Library drawer |
| `Space` | On Air | Toggle audio mute |
| `S` | On Air | Cycle to next subtitle track |
| `A` | On Air | Cycle to next audio track |
| `Esc` | Library | Clear search query and all active filters |
| `?` | Global | Open keyboard shortcut cheatsheet modal |
| `Esc` | Global | Close the cheatsheet modal |

---

## 11. Settings Reference

All settings are stored as key-value strings in the `settings` SQLite table.

| Key | Default | Description |
|---|---|---|
| `tmdb_api_key` | `""` | The Movie Database API v3 key |
| `omdb_api_key` | `""` | Open Movie Database API key |
| `anilist_api_key` | `""` | AniList GraphQL API key |
| `hls_quality` | `"standard"` | HLS encoding preset: `low`, `standard`, `high`, or `passthrough` |
| `default_subtitle_lang` | `"en"` | BCP-47 language code for default subtitle track selection |
| `default_audio_lang` | `"en"` | BCP-47 language code for default audio track selection |

---

## 12. Channel Profiles

Channel profiles are named presets that govern automatic scheduling behaviour. The profile is assigned when creating a channel and affects which content the auto-fill and template engines select.

| Profile Name | Content Focus | Genre Targets | Time Restrictions |
|---|---|---|---|
| Classic Movie Channel | Movies | Action 20%, Drama 40%, Comedy 30% | Horror after 20:00 only |
| Documentary Channel | Documentaries, Educational | History 30%, Science 40%, Nature 30% | No restrictions |
| Anime Channel | Anime, Episodes | Action 30%, Sci-Fi 30%, Fantasy 40% | Horror after 22:00 only |
| Educational Channel | Educational, Documentary | Science 50%, Technology 30%, Math 20% | Educational content 08:00–16:00 only |
| Mixed Family Channel | Movies, TV, Documentary | Family 30%, Comedy 30%, Adventure 40% | Horror after 19:00; Educational 09:00–12:00 |

---

## 13. Media Types Supported

| Type | Description |
|---|---|
| `Movie` | Feature-length films |
| `TVShow` | TV series container (parent of Episodes) |
| `Episode` | Individual TV show episode |
| `Anime` | Animated series or films sourced via AniList |
| `Documentary` | Non-fiction documentary films |
| `Educational` | Educational content |
| `ShortFilm` | Short films typically under 40 minutes |
| `Trailer` | Movie or show trailers |
| `Commercial` | Advertisements |
| `Bumper` | Short channel ident clips |
| `StationID` | Station identification spots |
| `MusicVideo` | Music video content |
| `Custom` | User-defined content type |

---

## 14. Quality Scoring System

The **Video Quality Score (VQS)** is a composite 0–100 score computed from a file's technical properties as reported by FFprobe. It is stored in `media_files.quality_score` and can be computed on-demand or queued as a background job.

### Score Dimensions

| Dimension | Factors Considered |
|---|---|
| `visual_quality` | Resolution, bit depth, HDR presence, VMAF score, video bitrate |
| `audio_quality` | Audio codec quality hierarchy, channel count, bitrate, EBU R128 loudness level |
| `encoding_quality` | Codec efficiency (AV1 > H.265 > H.264 > MPEG-4), encoding profile and level |
| `container_quality` | Container type (MKV/MP4 preferred over AVI/WMV), streaming compatibility |
| `integrity` | File completeness, valid duration, no corruption indicators |
| `compatibility` | Browser and device compatibility of the codec + container combination |
| `archival_quality` | Presence of lossless audio tracks, minimal lossy re-encoding artefacts |

### Qualitative Ratings

| Score Range | Rating |
|---|---|
| 85–100 | Excellent |
| 70–84 | Good |
| 50–69 | Fair |
| 0–49 | Poor |

### Background Job Lifecycle

Quality scoring jobs follow the state machine:

```
pending → running → done
              └──→ failed
```

Jobs are queued via `enqueue_media_analysis`, processed asynchronously, and report progress via the `analysis-job-progress` Tauri event. Failed jobs can be re-queued with `retry_failed_jobs`.

---

## 15. File Formats and Codec Support

### Container Formats (recognised during scanning)

`.mp4`, `.mkv`, `.avi`, `.mov`, `.ts`, `.m2ts`, `.webm`, `.flv`, `.wmv`, `.ogv`, `.3gp`

### Video Codecs

H.264 (AVC), H.265 (HEVC), AV1, VP9, VP8, MPEG-4, MPEG-2, ProRes, DNxHD, Theora, and any other codec reported by FFprobe.

### Audio Codecs

AAC, AC3 (Dolby Digital), EAC3 (Dolby Digital Plus), DTS, DTS-HD MA, TrueHD, FLAC, MP3, Opus, Vorbis, PCM variants.

### Subtitle Formats

| Format | Support |
|---|---|
| `.srt` (SubRip) | Full import and playback |
| `.vtt` (WebVTT) | Full import and playback |
| `.ass` / `.ssa` | Imported and converted to WebVTT for playback |
| Embedded tracks | Extracted via FFmpeg from MKV containers |

### HLS Transcoding Output

FFmpeg produces:
- `stream.m3u8` — HLS master playlist
- `segment_NNN.ts` — MPEG-TS video segments (approximately 6-second duration per segment)
- Audio output: AAC stereo, normalised to broadcast standard loudness
- Container: MPEG-TS wrapped segments delivered via HLS protocol

---

## 16. External API Integrations

### The Movie Database (TMDb)

- **Base URL:** `https://api.themoviedb.org/3`
- **Used for:** Movie and TV show metadata, poster/backdrop images, cast, crew, genres, ratings
- **Requires:** `tmdb_api_key` setting to be configured
- **Search flow:** title string → `search/movie` or `search/tv` → first result → detail fetch + image download

### Open Movie Database (OMDb)

- **Endpoint:** `http://www.omdbapi.com/`
- **Used for:** IMDb ID, IMDb user score, Rotten Tomatoes critic score
- **Requires:** `omdb_api_key` setting to be configured
- **Called after TMDb** to enrich scores using the IMDb ID when available

### AniList

- **Endpoint:** `https://graphql.anilist.co`
- **Used for:** Anime title metadata, cover art, average community score, genres, studios
- **Requires:** `anilist_api_key` setting to be configured
- **Triggered automatically** when a file is classified as the `Anime` media type

### OpenSubtitles.org

- **REST API v1:** `https://api.opensubtitles.com/api/v1`
- **Used for:** Searching and downloading subtitle files by IMDb ID or title + year
- **Authentication:** API key passed as a request header
- **Commands:** `search_opensubtitles`, `download_opensubtitles`
- Downloaded files are saved to the app data directory and registered in the `subtitles` table

---

*Documentation generated for Szklana Skrzynka v0.8.0 · September 2026*
