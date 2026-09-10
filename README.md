<p align="center">
  <img src="Szklana Skryznka/.github/banner.jpg" alt="Szklana Skrzynka — Personal Broadcast Automation" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/YOUR_USERNAME/szklana-skrzynka/releases">
    <img src="https://img.shields.io/badge/version-0.8.0-06b6d4?style=for-the-badge&logo=semanticrelease&logoColor=white" alt="Version" />
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/platform-macOS-lightgrey?style=for-the-badge&logo=apple&logoColor=white" alt="Platform" />
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/built_with-Tauri_2-FFC131?style=for-the-badge&logo=tauri&logoColor=white" alt="Tauri" />
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  </a>
  <a href="#">
    <img src="https://img.shields.io/badge/backend-Rust-CE422B?style=for-the-badge&logo=rust&logoColor=white" alt="Rust" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge" alt="License" />
  </a>
</p>

<p align="center">
  <strong>Run your own TV channel from your personal media collection.</strong><br/>
  A fully local, offline-first broadcast automation station — built with Tauri, Rust, and React.
</p>

<p align="center">
  <a href="#-features">Features</a> ·
  <a href="#-installation">Installation</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-keyboard-shortcuts">Shortcuts</a> ·
  <a href="DOCUMENTATION.md">Full Docs</a>
</p>

---

## ✨ What is Szklana Skrzynka?

**Szklana Skrzynka** (Polish for *Glass Box*) is a personal **broadcast automation station** that turns your local media library into a fully programmable TV channel. Point it at a folder, and it will scan, enrich, schedule, and playout your content — automatically.

> No subscriptions. No cloud. No data leaves your machine. Everything runs locally.

---

## 🚀 Features

### 📺 Live Broadcast Playout
- Real-time playout engine driven by a precise schedule — it knows *exactly* what should be on air at any second
- HLS transcoding via FFmpeg with four quality presets (Low / Standard / High / Passthrough)
- Dedicated fullscreen TV window for secondary monitor / TV output
- Multi-channel support — run several themed channels simultaneously

### 🗓️ Schedule Editor (The Grid)
- Visual 7-day programme guide editor
- Drag-and-drop items from your library onto any time slot
- **Lock** entries to protect them from auto-fill overwrite
- **Schedule Templates** — define reusable weekly blueprints and apply them to any channel with a single click
- Channel profiles: Classic Movie, Documentary, Anime, Educational, Mixed Family

### 📚 Smart Media Library
- Recursive filesystem scanner with FFprobe-powered technical probing
- Automatic metadata enrichment from **TMDb**, **OMDb**, and **AniList**
- **Advanced filter panel** — filter by genre, year range, resolution, codec, quality score, subtitle availability
- **Bulk actions** — select multiple items and re-scan, quality-score, or remove them in one batch
- TV show grouping with season/episode hierarchy
- Custom poster art upload

### 🎯 AI Content Recommendations
- Analyses your library's genre profile, director preferences, and ratings
- Recommends complementary titles not yet in your library
- One-click add to **Watchlist** for future acquisition tracking

### 📊 Station Analytics
- Broadcast stats leaderboard (most-played items)
- Library health metrics: poster, backdrop, synopsis, and subtitle coverage
- Integrity audit: missing artwork, duplicate files, duplicate metadata
- **Genre affinity heatmap** — see which genres air on which days of the week
- Full playback history log

### 🎬 Professional Media Handling
- **Video Quality Score (VQS)** — 7-dimension composite quality score (0–100) per file
- Multi-track audio switching mid-playback (triggers HLS retranscode)
- Subtitle track cycling with runtime sync offset adjustment
- **OpenSubtitles.org** integration — search and download subtitles directly
- EBU R128 loudness measurement, VMAF score, HDR detection

### ⌨️ Keyboard-First UX
- Full keyboard shortcut system with input-suppression logic
- Global `?` cheatsheet modal
- Esc to clear search & all filters in Library

---

## 🖥️ Screenshots

> _Add your screenshots here — replace the placeholders below._

| On Air — Live Playout | The Grid — Schedule Editor |
|---|---|
| _(screenshot)_ | _(screenshot)_ |

| Library — Advanced Filters | Statistics — Genre Heatmap |
|---|---|
| _(screenshot)_ | _(screenshot)_ |

---

## 🛠️ Installation

### Prerequisites

| Requirement | Version |
|---|---|
| macOS | 13 Ventura or later |
| Node.js | 20+ |
| Rust | 1.77+ (via [rustup](https://rustup.rs)) |
| FFmpeg | 6.0+ (must be in `PATH` or bundled in `src-tauri/binaries/`) |

### Build from Source

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/szklana-skrzynka.git
cd szklana-skrzynka/Szklana\ Skryznka

# 2. Install frontend dependencies
npm install

# 3. Place FFmpeg binary (macOS arm64 example)
mkdir -p src-tauri/binaries
cp $(which ffmpeg) src-tauri/binaries/ffmpeg-aarch64-apple-darwin

# 4. Run in development mode
npm run tauri dev

# 5. Or build a release app bundle
npm run tauri build
```

The built `.app` bundle will appear in `src-tauri/target/release/bundle/macos/`.

---

## ⚡ Quick Start

1. **Launch the app** — you will see the Splash screen, then land on the _On Air_ view
2. **Go to Settings** → enter your **TMDb API key** (free at [themoviedb.org](https://www.themoviedb.org/settings/api))
3. **Go to Library** → enter a folder path and click **SCAN LIBRARY**
4. Wait for scanning to complete — metadata and artwork are fetched automatically
5. **Go to The Grid** → create a channel, then use **Apply Template** or drag items to build your schedule
6. Back on **On Air** → click **Start Channel** to begin live playout

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                  React 19 Frontend                  │
│                                                     │
│  11 Pages  ·  Zustand stores  ·  Tauri event bus   │
└──────────────────────┬──────────────────────────────┘
                       │  Tauri IPC (~60 commands)
┌──────────────────────▼──────────────────────────────┐
│                  Rust Backend                       │
│                                                     │
│  scanner.rs    — filesystem indexing + API fetch   │
│  scheduler.rs  — channel profiles + gap-fill logic │
│  playout.rs    — real-time broadcast state         │
│  media_engine.rs — FFprobe + FFmpeg wrappers       │
│  commands.rs   — all IPC handlers                  │
└────────────┬─────────────┬──────────────────────────┘
             │             │
       SQLite DB      FFmpeg → HLS server
       (sqlx 0.8)      (port 8098)
```

### Tech Stack

**Frontend**

| | Package | Purpose |
|---|---|---|
| ⚛️ | React 19 | UI framework |
| 🐻 | Zustand 5 | Global state |
| 🗡️ | Lucide React | Icons |
| 📅 | date-fns 4 | Date formatting |
| 📊 | AG Grid 33 | Database table viewer |

**Backend**

| | Crate | Purpose |
|---|---|---|
| 🦀 | Tauri 2 | Desktop runtime + IPC |
| 🗄️ | sqlx 0.8 | Async SQLite |
| ⏰ | chrono 0.4 | Date/time |
| 🌐 | reqwest 0.12 | HTTP client (API calls) |
| 🔍 | notify 6 | Filesystem watcher |
| 🆔 | uuid 1.8 | UUID v4 entity IDs |

---

## ⌨️ Keyboard Shortcuts

| Key | View | Action |
|---|---|---|
| `?` | Global | Open shortcut cheatsheet |
| `Esc` | Library | Clear search & all filters |
| `←` `→` | The Grid | Previous / next week |
| `T` | The Grid | Jump to current week |
| `L` | The Grid | Toggle library drawer |
| `Space` | On Air | Toggle mute |
| `S` | On Air | Cycle subtitle track |
| `A` | On Air | Cycle audio track |

> Shortcuts are automatically suppressed when typing in any input field.

---

## 🗄️ Database

Szklana Skrzynka uses an **embedded SQLite database** managed with `sqlx`. It is created at the Tauri app data directory and migrated automatically on every launch.

```
channels · media_items · media_files · genres · tags · actors · directors
schedules · schedule_entries · schedule_templates · template_entries
subtitles · playback_history · watchlists · settings · analysis_jobs
```

You can inspect raw data at any time using the built-in **Database Viewer** page.

---

## 🔌 External APIs

All API integrations are **optional**. The app functions fully without them — you just won't get automatic metadata enrichment.

| API | Purpose | Required? |
|---|---|---|
| [TMDb](https://www.themoviedb.org/) | Movie/TV metadata, posters, cast | Recommended |
| [OMDb](https://www.omdbapi.com/) | IMDb & Rotten Tomatoes scores | Optional |
| [AniList](https://anilist.co/) | Anime metadata | Optional |
| [OpenSubtitles](https://www.opensubtitles.com/) | Subtitle search & download | Optional |

Configure API keys under **Settings → Metadata APIs**.

---

## 📁 Project Structure

```
Szklana Skryznka/
├── src/                        # React frontend
│   ├── App.tsx                 # Root component + routing
│   ├── store.ts                # All Zustand stores
│   ├── index.css               # Global design system
│   ├── components/
│   │   ├── Sidebar.tsx         # Navigation sidebar
│   │   └── TemplatesPanel.tsx  # Schedule template manager
│   ├── hooks/
│   │   └── useKeyboardShortcuts.ts
│   └── pages/
│       ├── OnAir.tsx           # Live playout monitor
│       ├── Grid.tsx            # Schedule editor
│       ├── Library.tsx         # Media library manager
│       ├── Health.tsx          # Station analytics
│       ├── Suggestions.tsx     # AI recommendations
│       ├── Watchlist.tsx       # Acquisition queue
│       ├── Settings.tsx        # Configuration
│       ├── Database.tsx        # DB table viewer
│       ├── TvClient.tsx        # Fullscreen player
│       ├── TrayView.tsx        # System tray view
│       └── SplashScreen.tsx    # Boot animation
└── src-tauri/
    ├── src/
    │   ├── commands.rs         # All ~60 Tauri IPC commands
    │   ├── scheduler.rs        # Channel profiles + scheduling logic
    │   ├── playout.rs          # Real-time playout state
    │   ├── scanner.rs          # Filesystem scan + metadata fetch
    │   ├── media_engine.rs     # FFprobe/FFmpeg wrappers
    │   ├── models.rs           # Rust data structures
    │   ├── db.rs               # Database connection + migrations
    │   └── lib.rs              # Command registration
    ├── migrations/             # SQLite migration files
    ├── binaries/               # Bundled FFmpeg binary
    └── tauri.conf.json
```

---

## 🤝 Contributing

Contributions are welcome. Please open an issue first to discuss any significant changes.

```bash
# Fork the repository, then:
git checkout -b feature/your-feature-name
# Make your changes
npm run tauri dev   # Test in dev mode
git commit -m "feat: your feature description"
git push origin feature/your-feature-name
# Open a pull request
```

### Development Tips

- Run `npx tsc --noEmit` to check for TypeScript errors before committing
- Run `cargo build` inside `src-tauri/` to verify the Rust backend compiles
- The database auto-migrates — add new `.sql` files to `src-tauri/migrations/` following the timestamp naming convention

---

## 📄 License

MIT © 2026 — See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with ❤️ using
  <a href="https://tauri.app">Tauri</a> ·
  <a href="https://react.dev">React</a> ·
  <a href="https://www.rust-lang.org">Rust</a> ·
  <a href="https://ffmpeg.org">FFmpeg</a>
</p>
