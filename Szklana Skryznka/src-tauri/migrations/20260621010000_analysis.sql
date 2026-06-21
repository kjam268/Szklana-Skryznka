-- Migration to add advanced video/audio analysis columns to media_files table
ALTER TABLE media_files ADD COLUMN video_bitrate INTEGER;
ALTER TABLE media_files ADD COLUMN frame_rate REAL;
ALTER TABLE media_files ADD COLUMN audio_channels INTEGER;
ALTER TABLE media_files ADD COLUMN audio_language TEXT;
