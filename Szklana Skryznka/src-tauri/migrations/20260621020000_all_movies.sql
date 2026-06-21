-- Migration to create all_movies reference table for suggestions
CREATE TABLE IF NOT EXISTS all_movies (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    year INTEGER NOT NULL,
    director TEXT NOT NULL,
    cast_actors TEXT NOT NULL,
    synopsis TEXT NOT NULL,
    rating REAL NOT NULL,
    poster_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_all_movies_title ON all_movies(title);
