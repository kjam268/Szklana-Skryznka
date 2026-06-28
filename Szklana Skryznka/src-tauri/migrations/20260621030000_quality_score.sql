-- Migration to add quality_score column to media_files table
ALTER TABLE media_files ADD COLUMN quality_score REAL;
