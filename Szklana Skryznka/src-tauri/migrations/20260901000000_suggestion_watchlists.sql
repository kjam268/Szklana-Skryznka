-- Suggestion Watchlists: stores movies from all_movies reference DB that the user wants to acquire
CREATE TABLE IF NOT EXISTS suggestion_watchlists (
    id TEXT PRIMARY KEY,
    all_movie_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    year INTEGER,
    director TEXT,
    synopsis TEXT,
    rating REAL,
    poster_path TEXT,
    added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
