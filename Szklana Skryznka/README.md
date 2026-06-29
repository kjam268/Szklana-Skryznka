# Szklana Skrzynka (Glass Showcase)

A sleek, premium desktop media aggregator and library manager designed to index, analyze, and present your local movie and television collections. Built on top of **Tauri v2**, **React**, and **Rust (SQLx + SQLite)**.

## Key Features

* **High-Fidelity Automated Scanning**:
  * **Phase 1**: Quick file discovery and matching via name parsing and TMDb/AniList API search queries.
  * **Phase 2 (Visual Quality Assessment)**: Fast keyframe visual analysis using FFmpeg. Video resolution, video/audio codecs, audio channels, bitrates, frame rates, and embedded audio/subtitle languages are inspected and cataloged.
* **Premium Translucent UI**:
  * Rich dark mode layout featuring dynamic backdrop-blur effects and 20% transparency panels for both the navigation sidebar and Metadata Inspector drawer.
  * Click-outside auto-close capability on drawer overlays for seamless navigation.
* **Intelligent Scoring & De-duplication**:
  * Combines format metrics and visual checks to compute a visual quality **Crown Score** for each file.
  * Automatic **Double-Layer Deduplication**: Identifies identical assets sharing the same TMDb matches or IMDb IDs, merging duplicate library cards and retaining only the highest-scoring physical file copy.
* **Subtitle Downloader**:
  * Connected to the OpenSubtitles API with automatic language prioritization (French and English subtitles are sorted at the top).
  * Subtitle files are saved alongside the video file (e.g. `Movie.en.srt`) and registered inside the database.
* **Metadata Editor**:
  * Fully customizable metadata parameters including a hand-editable, comma-separated tags field that automatically creates tag chips in real time as you write.

## Prerequisites

* [Node.js](https://nodejs.org/) (v16+)
* [Rust & Cargo](https://www.rust-lang.org/)
* [FFmpeg](https://ffmpeg.org/) (installed and available in the system PATH for file analysis)

## Development Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Application in Development Mode**:
   ```bash
   npm run tauri dev
   ```

3. **Build Production Desktop App Bundle**:
   ```bash
   npm run tauri build
   ```

## Technical Architecture

* **Frontend**: React (TypeScript), Zustand (State Management), Tailwind CSS (Aesthetic Styling).
* **Backend**: Rust (Tauri Commands & Background Worker), SQLx (SQLite Database migrations & queries), FFmpeg/ffprobe wrapper tasks.
* **Database**: SQLite (local schema containing tables for `media_items`, `media_files`, `genres`, `tags`, `actors`, `directors`, and `subtitles`).
