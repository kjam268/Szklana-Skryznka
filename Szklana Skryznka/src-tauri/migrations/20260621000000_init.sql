-- Enable foreign key support
PRAGMA foreign_keys = ON;

-- 1. Channels
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    logo_path TEXT,
    profile_name TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. People (Actors and Directors)
CREATE TABLE IF NOT EXISTS actors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS directors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

-- 3. Media Items
CREATE TABLE IF NOT EXISTS media_items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    original_title TEXT,
    media_type TEXT NOT NULL, -- Movie, TVShow, Episode, Anime, Documentary, Educational, ShortFilm, Trailer, Commercial, Bumper, StationID, MusicVideo, Custom
    year INTEGER,
    runtime INTEGER NOT NULL, -- in seconds
    synopsis TEXT,
    rating REAL,
    poster_path TEXT,
    backdrop_path TEXT,
    director_id TEXT, -- Main director reference
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (director_id) REFERENCES directors(id) ON DELETE SET NULL
);

-- 4. Media Files
CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,
    media_item_id TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_size INTEGER NOT NULL,
    checksum TEXT,
    video_codec TEXT,
    audio_codec TEXT,
    resolution TEXT,
    duration INTEGER NOT NULL, -- in seconds
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
);

-- 5. Join Tables for Actors/Directors
CREATE TABLE IF NOT EXISTS media_actors (
    media_item_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    PRIMARY KEY (media_item_id, actor_id),
    FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_directors (
    media_item_id TEXT NOT NULL,
    director_id TEXT NOT NULL,
    PRIMARY KEY (media_item_id, director_id),
    FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE,
    FOREIGN KEY (director_id) REFERENCES directors(id) ON DELETE CASCADE
);

-- 6. Genres
CREATE TABLE IF NOT EXISTS genres (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS media_genres (
    media_item_id TEXT NOT NULL,
    genre_id TEXT NOT NULL,
    PRIMARY KEY (media_item_id, genre_id),
    FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE,
    FOREIGN KEY (genre_id) REFERENCES genres(id) ON DELETE CASCADE
);

-- 7. Tags
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS media_tags (
    media_item_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (media_item_id, tag_id),
    FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- 8. Subtitles
CREATE TABLE IF NOT EXISTS subtitles (
    id TEXT PRIMARY KEY,
    media_item_id TEXT NOT NULL,
    language TEXT NOT NULL, -- 'en', 'fr', etc.
    subtitle_type TEXT NOT NULL, -- 'internal', 'external', 'forced', 'sdh'
    file_path TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
);

-- 9. Schedules
CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    name TEXT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

-- 10. Schedule Entries
CREATE TABLE IF NOT EXISTS schedule_entries (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    media_item_id TEXT NOT NULL,
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    is_locked INTEGER NOT NULL DEFAULT 0, -- 0 = false, 1 = true
    explanation TEXT,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
);

-- 11. Schedule Templates
CREATE TABLE IF NOT EXISTS schedule_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT
);

-- 12. Template Entries
CREATE TABLE IF NOT EXISTS template_entries (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    offset_seconds INTEGER NOT NULL, -- seconds offset from schedule day start (e.g. 0 for 00:00)
    duration_seconds INTEGER NOT NULL,
    media_type_filter TEXT, -- e.g. 'Movie', 'Episode', 'Documentary', etc.
    genre_filter TEXT, -- optional filter by genre ID or name
    is_filler INTEGER NOT NULL DEFAULT 0, -- 0 = false, 1 = true (bumper/station id/trailer filler)
    FOREIGN KEY (template_id) REFERENCES schedule_templates(id) ON DELETE CASCADE
);

-- 13. Playback History
CREATE TABLE IF NOT EXISTS playback_history (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    media_item_id TEXT NOT NULL,
    aired_at DATETIME NOT NULL,
    duration_aired INTEGER NOT NULL,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
);

-- 14. Watchlists
CREATE TABLE IF NOT EXISTS watchlists (
    id TEXT PRIMARY KEY,
    media_item_id TEXT NOT NULL,
    added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
);

-- 15. Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_media_items_title ON media_items(title);
CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(media_type);
CREATE INDEX IF NOT EXISTS idx_media_files_item_id ON media_files(media_item_id);
CREATE INDEX IF NOT EXISTS idx_schedule_entries_schedule_id ON schedule_entries(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_entries_time ON schedule_entries(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_playback_history_aired ON playback_history(aired_at);
CREATE INDEX IF NOT EXISTS idx_subtitles_item_id ON subtitles(media_item_id);
