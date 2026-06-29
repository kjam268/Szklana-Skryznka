-- Migration to add quality_score_done column to media_files table
ALTER TABLE media_files ADD COLUMN quality_score_done INTEGER DEFAULT 0;
