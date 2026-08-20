-- Migration to create background analysis jobs queue table
CREATE TABLE IF NOT EXISTS analysis_jobs (
    id TEXT PRIMARY KEY,
    media_file_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress_percent INTEGER DEFAULT 0,
    result_json TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_file_id) REFERENCES media_files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status ON analysis_jobs(status);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_file ON analysis_jobs(media_file_id);
