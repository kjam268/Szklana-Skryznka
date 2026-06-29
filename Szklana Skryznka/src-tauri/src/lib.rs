pub mod db;
pub mod models;
pub mod playout;
pub mod scanner;
pub mod scheduler;
pub mod commands;

use tauri::Manager;
use tauri::Emitter;
use tauri::Listener;
use tauri::menu::{Menu, MenuItem, Submenu, CheckMenuItem};

pub struct RecentHistory {
    pub items: std::sync::Mutex<Vec<(String, String)>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            
            // Build native macOS menus and append Settings submenu
            if let Ok(menu) = Menu::default(&handle) {
                if let Ok(settings_submenu) = Submenu::with_id(&handle, "settings_menu", "Settings", true) {
                    let api_key_item = MenuItem::with_id(&handle, "tmdb_api_key", "TMDb API Key...", true, None::<&str>).unwrap();
                    let purge_item = MenuItem::with_id(&handle, "purge_database", "Purge Library & Database...", true, None::<&str>).unwrap();
                    let _ = settings_submenu.append(&api_key_item);
                    let _ = settings_submenu.append(&purge_item);
                    let _ = menu.append(&settings_submenu);
                    let _ = app.set_menu(menu);
                }
            }

            // Create tray icon in macOS Finder menu bar
            let icon_bytes = include_bytes!("../icons/Szklana_Skryznka.png");
            let tray_image = tauri::image::Image::from_bytes(icon_bytes).expect("Failed to load tray icon");

            let status_item = MenuItem::with_id(&handle, "status", "Szklana Skryznka: Idle", false, None::<&str>).unwrap();
            let progress_item = MenuItem::with_id(&handle, "progress", "", false, None::<&str>).unwrap();
            let tmdb_status_item = MenuItem::with_id(&handle, "tmdb_status", "TMDb: Checking...", false, None::<&str>).unwrap();
            let anilist_status_item = MenuItem::with_id(&handle, "anilist_status", "AniList: Checking...", false, None::<&str>).unwrap();

            let pause_scans_item = CheckMenuItem::with_id(&handle, "pause_scans", "Pause Background Scans", true, false, None::<&str>).unwrap();

            let history_submenu = Submenu::with_id(&handle, "history", "Recent Analyses", true).unwrap();
            let recent_1 = MenuItem::with_id(&handle, "recent_1", "None", true, None::<&str>).unwrap();
            let recent_2 = MenuItem::with_id(&handle, "recent_2", "None", true, None::<&str>).unwrap();
            let recent_3 = MenuItem::with_id(&handle, "recent_3", "None", true, None::<&str>).unwrap();
            let _ = history_submenu.append(&recent_1);
            let _ = history_submenu.append(&recent_2);
            let _ = history_submenu.append(&recent_3);

            let tray_menu = Menu::with_items(&handle, &[
                &status_item,
                &progress_item,
                &tauri::menu::PredefinedMenuItem::separator(&handle).unwrap(),
                &tmdb_status_item,
                &anilist_status_item,
                &pause_scans_item,
                &history_submenu,
                &tauri::menu::PredefinedMenuItem::separator(&handle).unwrap(),
                &MenuItem::with_id(&handle, "open", "Open Szklana Skryznka", true, None::<&str>).unwrap(),
                &MenuItem::with_id(&handle, "quit", "Quit", true, None::<&str>).unwrap(),
            ]).unwrap();

            let _tray = tauri::tray::TrayIconBuilder::with_id("main-tray")
                .icon(tray_image)
                .menu(&tray_menu)
                .build(app)?;

            // Listen to scan-progress event to display initial importation stats inside the status tray
            let status_item_progress = status_item.clone();
            let progress_item_progress = progress_item.clone();
            let handle_progress = handle.clone();
            let _ = handle.listen("scan-progress", move |event| {
                if let Ok(pct) = serde_json::from_str::<i32>(event.payload()) {
                    let _ = status_item_progress.set_text(format!("Importing: {}%", pct));
                    let filled = pct / 10;
                    let mut bar = String::new();
                    for i in 0..10 {
                        if i < filled {
                            bar.push('▰');
                        } else {
                            bar.push('▱');
                        }
                    }
                    let _ = progress_item_progress.set_text(format!("[{}] {}%", bar, pct));
                    if let Some(tray) = handle_progress.tray_by_id("main-tray") {
                        let _ = tray.set_tooltip(Some(format!("Importing: {}%", pct)));
                    }
                }
            });

            tauri::async_runtime::block_on(async move {
                let pool = db::init_db(&handle).await.expect("Failed to initialize database");
                
                // Migration cleanup: remove Movie tag from Shorts (duration > 0 and < 1800)
                let _ = sqlx::query(
                    "DELETE FROM media_tags WHERE tag_id = (SELECT id FROM tags WHERE name = 'Movie') \
                     AND media_item_id IN (SELECT media_item_id FROM media_files WHERE duration > 0 AND duration < 1800)"
                )
                .execute(&pool)
                .await;
                // Database update check: find all existing media files lacking metadata properties
                // due to the previous codec_type extraction bug, and re-extract their values.
                if let Ok(pending_rows) = sqlx::query(
                    "SELECT id, file_path FROM media_files WHERE video_codec IS NULL OR video_codec = ''"
                )
                .fetch_all(&pool)
                .await {
                    for row in pending_rows {
                        use sqlx::Row;
                        let id: String = row.get("id");
                        let file_path: String = row.get("file_path");
                        let path = std::path::Path::new(&file_path);
                        if path.exists() {
                            let (duration, resolution, video_codec, audio_codec, video_bitrate, frame_rate, audio_channels, audio_language, audio_tracks, embedded_subtitles) = scanner::extract_metadata(path);
                            let _ = sqlx::query(
                                "UPDATE media_files SET duration = $1, resolution = $2, video_codec = $3, audio_codec = $4, \
                                 video_bitrate = $5, frame_rate = $6, audio_channels = $7, audio_language = $8, \
                                 audio_tracks = $9, embedded_subtitles = $10 WHERE id = $11"
                            )
                            .bind(duration)
                            .bind(&resolution)
                            .bind(&video_codec)
                            .bind(&audio_codec)
                            .bind(video_bitrate)
                            .bind(frame_rate)
                            .bind(audio_channels)
                            .bind(&audio_language)
                            .bind(&audio_tracks)
                            .bind(&embedded_subtitles)
                            .bind(&id)
                            .execute(&pool)
                            .await;
                            
                            // Get the parent item_id to clean tags
                            let item_id: Option<String> = sqlx::query_scalar(
                                "SELECT media_item_id FROM media_files WHERE id = $1"
                            )
                            .bind(&id)
                            .fetch_optional(&pool)
                            .await
                            .unwrap_or(None);

                            if let Some(ref mid) = item_id {
                                let _ = scanner::check_and_clean_tags(&pool, mid).await;
                            }
                        }
                    }
                }

                // Spawn background worker thread for quality score processing
                let worker_pool = pool.clone();
                let worker_handle = handle.clone();
                let status_item_clone = status_item.clone();
                let progress_item_clone = progress_item.clone();
                let tmdb_status_item_clone = tmdb_status_item.clone();
                let anilist_status_item_clone = anilist_status_item.clone();
                let pause_scans_item_clone = pause_scans_item.clone();
                let recent_1_clone = recent_1.clone();
                let recent_2_clone = recent_2.clone();
                let recent_3_clone = recent_3.clone();

                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

                        // Check Connection Statuses
                        let tmdb_key: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'tmdb_api_key'")
                            .fetch_optional(&worker_pool)
                            .await
                            .unwrap_or(None);
                        let anilist_key: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'anilist_api_key'")
                            .fetch_optional(&worker_pool)
                            .await
                            .unwrap_or(None);

                        let tmdb_status = if tmdb_key.is_some() && !tmdb_key.unwrap().trim().is_empty() {
                            "TMDb: Connected ✓"
                        } else {
                            "TMDb: Not Configured ✗"
                        };
                        let anilist_status = if anilist_key.is_some() && !anilist_key.unwrap().trim().is_empty() {
                            "AniList: Connected ✓"
                        } else {
                            "AniList: Not Configured ✗"
                        };

                        let _ = tmdb_status_item_clone.set_text(tmdb_status);
                        let _ = anilist_status_item_clone.set_text(anilist_status);

                        // Check if low resource mode/pause is enabled
                        let pause_scans: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'pause_background_scans'")
                            .fetch_optional(&worker_pool)
                            .await
                            .unwrap_or(None);
                        
                        let is_paused = pause_scans.unwrap_or_default() == "true";
                        let _ = pause_scans_item_clone.set_checked(is_paused);

                        // Update Recent Analyses list
                        if let Ok(recents) = sqlx::query(
                            "SELECT mi.id as item_id, mi.title, mf.quality_score \
                             FROM media_files mf \
                             JOIN media_items mi ON mf.media_item_id = mi.id \
                             WHERE mf.quality_score_done = 1 \
                             ORDER BY mf.created_at DESC LIMIT 3"
                        )
                        .fetch_all(&worker_pool)
                        .await {
                            let mut mappings = Vec::new();
                            for (idx, row) in recents.iter().enumerate() {
                                use sqlx::Row;
                                let item_id: String = row.get("item_id");
                                let title: String = row.get("title");
                                let score: f64 = row.get("quality_score");
                                let text = format!("{} (Score: {})", title, score.round() as i32);
                                
                                if idx == 0 {
                                    let _ = recent_1_clone.set_text(&text);
                                    mappings.push(("recent_1".to_string(), item_id));
                                } else if idx == 1 {
                                    let _ = recent_2_clone.set_text(&text);
                                    mappings.push(("recent_2".to_string(), item_id));
                                } else if idx == 2 {
                                    let _ = recent_3_clone.set_text(&text);
                                    mappings.push(("recent_3".to_string(), item_id));
                                }
                            }
                            
                            // Write mappings to shared RecentHistory state
                            {
                                let history = worker_handle.state::<RecentHistory>();
                                let lock_res = history.items.lock();
                                if let Ok(mut items_guard) = lock_res {
                                    *items_guard = mappings;
                                }
                            }
                        }

                        if is_paused {
                            let _ = status_item_clone.set_text("Scans Paused (Low Resource)");
                            let _ = progress_item_clone.set_text("");
                            continue;
                        }

                        // Check if library scan is currently in progress
                        let scan_in_progress: Option<String> = sqlx::query_scalar(
                            "SELECT value FROM settings WHERE key = 'scan_in_progress'"
                        )
                        .fetch_optional(&worker_pool)
                        .await
                        .unwrap_or(None);

                        if let Some(val) = scan_in_progress {
                            if val == "true" {
                                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                                continue;
                            }
                        }

                        let pending_files = sqlx::query(
                            "SELECT id, file_path, resolution, video_bitrate, audio_channels, video_codec, audio_codec \
                             FROM media_files WHERE quality_score_done = 0 OR quality_score_done IS NULL"
                        )
                        .fetch_all(&worker_pool)
                        .await;

                        if let Ok(rows) = pending_files {
                            if rows.is_empty() {
                                if let Some(tray) = worker_handle.tray_by_id("main-tray") {
                                    let _ = tray.set_tooltip(Some("Szklana Skryznka: Idle".to_string()));
                                }
                                let _ = status_item_clone.set_text("Szklana Skryznka: Idle");
                                let _ = progress_item_clone.set_text("");
                            } else {
                                for row in rows {
                                    use sqlx::Row;
                                    let id: String = row.get("id");
                                    let file_path: String = row.get("file_path");

                                    let filename = std::path::Path::new(&file_path)
                                        .file_name()
                                        .and_then(|n| n.to_str())
                                        .unwrap_or(&file_path);

                                    tracing::info!("Background worker processing Phase 1 (ffprobe metadata) & Phase 2 (visual quality check) for: {}", file_path);

                                    // Load parent item_id
                                    let item_id: Option<String> = sqlx::query_scalar(
                                        "SELECT media_item_id FROM media_files WHERE id = $1"
                                    )
                                    .bind(&id)
                                    .fetch_optional(&worker_pool)
                                    .await
                                    .unwrap_or(None);

                                    if let Some(item_id) = item_id {

                                        // --- PHASE 1: Extract file metadata via ffprobe ---
                                        let path = std::path::Path::new(&file_path);
                                        let (duration, resolution, video_codec, audio_codec, video_bitrate, frame_rate, audio_channels, audio_language, audio_tracks, embedded_subtitles) = scanner::extract_metadata(path);

                                        // Update database table media_files with these details
                                        let _ = sqlx::query(
                                            "UPDATE media_files SET duration = $1, resolution = $2, video_codec = $3, audio_codec = $4, \
                                             video_bitrate = $5, frame_rate = $6, audio_channels = $7, audio_language = $8, \
                                             audio_tracks = $9, embedded_subtitles = $10 WHERE id = $11"
                                        )
                                        .bind(duration)
                                        .bind(&resolution)
                                        .bind(&video_codec)
                                        .bind(&audio_codec)
                                        .bind(video_bitrate)
                                        .bind(frame_rate)
                                        .bind(audio_channels)
                                        .bind(&audio_language)
                                        .bind(&audio_tracks)
                                        .bind(&embedded_subtitles)
                                        .bind(&id)
                                        .execute(&worker_pool)
                                        .await;

                                        // Update runtime on media_items if not set yet
                                        let _ = sqlx::query(
                                            "UPDATE media_items SET runtime = $1 WHERE id = $2 AND (runtime = 0 OR runtime IS NULL)"
                                        )
                                        .bind(duration)
                                        .bind(&item_id)
                                        .execute(&worker_pool)
                                        .await;

                                        // Run automated tag cleaning rules (e.g. Shorts/Animation/Movie conflicts)
                                        let _ = scanner::check_and_clean_tags(&worker_pool, &item_id).await;

                                        // --- PHASE 2: Fast Keyframe Sampling visual analysis using FFmpeg ---
                                        let visual_score = evaluate_visual_quality(
                                            &file_path,
                                            duration,
                                            filename,
                                            &status_item_clone,
                                            &progress_item_clone,
                                            &worker_handle,
                                        );

                                        let metadata_score = scanner::calculate_quality_score(
                                            &resolution,
                                            video_bitrate,
                                            audio_channels,
                                            &video_codec,
                                            &audio_codec,
                                        );

                                        let score = match visual_score {
                                            Some(vis) => ((metadata_score * 0.4) + (vis * 0.6)).clamp(0.0, 100.0),
                                            None => metadata_score,
                                        };

                                        // Write final score and set quality_score_done = 1
                                        let _ = sqlx::query(
                                            "UPDATE media_files SET quality_score = $1, quality_score_done = 1 WHERE id = $2"
                                        )
                                        .bind(score)
                                        .bind(&id)
                                        .execute(&worker_pool)
                                        .await;

                                        // Trigger a database deduplication pass to clean up lower quality duplicate records
                                        let _ = scanner::deduplicate_database(&worker_pool).await;

                                        // Notify frontend
                                        let _ = worker_handle.emit("library-updated", ());
                                    }
                                }
                                if let Some(tray) = worker_handle.tray_by_id("main-tray") {
                                    let _ = tray.set_tooltip(Some("Szklana Skryznka: Idle".to_string()));
                                }
                                let _ = status_item_clone.set_text("Szklana Skryznka: Idle");
                                let _ = progress_item_clone.set_text("");
                            }
                        } else {
                            if let Some(tray) = worker_handle.tray_by_id("main-tray") {
                                let _ = tray.set_tooltip(Some("Szklana Skryznka: Idle".to_string()));
                            }
                            let _ = status_item_clone.set_text("Szklana Skryznka: Idle");
                            let _ = progress_item_clone.set_text("");
                        }
                    }
                });

                 handle.manage(pool);
                 handle.manage(RecentHistory {
                     items: std::sync::Mutex::new(Vec::new()),
                 });
             });
             Ok(())
         })
         .on_menu_event(|app, event| {
             if event.id() == "tmdb_api_key" {
                 let _ = app.emit("menu-set-api-key", ());
             } else if event.id() == "purge_database" {
                 let _ = app.emit("menu-purge-database", ());
             } else if event.id() == "open" {
                 if let Some(window) = app.get_webview_window("main") {
                     let _ = window.show();
                     let _ = window.set_focus();
                 }
             } else if event.id() == "quit" {
                 app.exit(0);
             } else if event.id() == "pause_scans" {
                 let handle = app.clone();
                 tauri::async_runtime::block_on(async move {
                     if let Ok(pool) = db::init_db(&handle).await {
                         let val: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'pause_background_scans'")
                             .fetch_optional(&pool)
                             .await
                             .unwrap_or(None);
                         let new_val = if val.unwrap_or_default() == "true" { "false" } else { "true" };
                         let _ = sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('pause_background_scans', $1)")
                             .bind(new_val)
                             .execute(&pool)
                             .await;
                     }
                 });
             } else if event.id() == "recent_1" || event.id() == "recent_2" || event.id() == "recent_3" {
                 let id_str = event.id().0.as_str();
                 let history = app.state::<RecentHistory>();
                 let item_id = {
                     let items = history.items.lock().unwrap();
                     items.iter().find(|(menu_id, _)| menu_id == id_str).map(|(_, item_id)| item_id.clone())
                 };

                 if let Some(item_id) = item_id {
                     if let Some(window) = app.get_webview_window("main") {
                         let _ = window.show();
                         let _ = window.set_focus();
                         let _ = app.emit("select-media-item", item_id);
                     }
                 }
             }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_library,
            commands::stop_scan,
            commands::get_media,
            commands::save_media,
            commands::delete_media,
            commands::get_subtitles,
            commands::import_subtitle,
            commands::create_schedule,
            commands::update_schedule,
            commands::apply_template,
            commands::get_current_program,
            commands::get_next_program,
            commands::start_channel,
            commands::get_channel_status,
            commands::run_diagnostics,
            commands::select_directory,
            commands::get_schedule_entries,
            commands::get_setting,
            commands::set_setting,
            commands::purge_database,
            commands::get_smart_suggestions,
            commands::refresh_item_metadata,
            commands::open_app_window,
            commands::quit_app,
            commands::select_custom_poster,
            commands::search_opensubtitles,
            commands::download_opensubtitles
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn evaluate_visual_quality<R: tauri::Runtime>(
    file_path: &str,
    duration: i32,
    filename: &str,
    status_item: &MenuItem<R>,
    progress_item: &MenuItem<R>,
    app_handle: &tauri::AppHandle<R>,
) -> Option<f64> {
    if duration <= 0 {
        return None;
    }

    let mut total_blur = 0.0;
    let mut total_block = 0.0;
    let mut count = 0;

    let ffmpeg_paths = [
        "ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ];

    let mut ffmpeg_exe = "ffmpeg";
    for path in &ffmpeg_paths {
        if std::path::Path::new(path).exists() || *path == "ffmpeg" {
            if std::process::Command::new(path)
                .arg("-version")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok()
            {
                ffmpeg_exe = path;
                break;
            }
        }
    }

    // Fast Keyframe Sampling on 20 specific keyframes (every 5% of the video duration)
    for i in 1..=20 {
        let pct = (i as f64) * 0.05;
        let timestamp = (duration as f64) * pct;

        // Run FFmpeg to parse blur and blocking artifacts for a single frame
        let output = std::process::Command::new(ffmpeg_exe)
            .args(&[
                "-ss", &format!("{:.2}", timestamp),
                "-i", file_path,
                "-vframes", "1",
                "-vf", "blurdetect,blockdetect,metadata=print:file=-",
                "-f", "null",
                "-"
            ])
            .output();

        let progress = ((i as f64) / 20.0 * 100.0) as i32;
        let tooltip = format!("Processing: {} ({}%)", filename, progress);
        if let Some(tray) = app_handle.tray_by_id("main-tray") {
            let _ = tray.set_tooltip(Some(tooltip));
        }

        // Render Unicode progress bar
        let filled_blocks = progress / 10;
        let empty_blocks = 10 - filled_blocks;
        let bar = format!("{}{} {}%", "█".repeat(filled_blocks as usize), "░".repeat(empty_blocks as usize), progress);
        let _ = status_item.set_text(format!("Processing: {}", filename));
        let _ = progress_item.set_text(bar);

        #[derive(serde::Serialize, Clone)]
        struct VisualProgressPayload {
            filename: String,
            progress: i32,
        }
        let _ = app_handle.emit("visual-progress", VisualProgressPayload {
            filename: filename.to_string(),
            progress,
        });

        if let Ok(out) = output {
            let stdout_str = String::from_utf8_lossy(&out.stdout);
            let stderr_str = String::from_utf8_lossy(&out.stderr);
            let merged = format!("{}\n{}", stdout_str, stderr_str);

            let mut blur_val = None;
            let mut block_val = None;

            for line in merged.lines() {
                if line.contains("lavfi.blur=") {
                    if let Some(val_str) = line.split('=').nth(1) {
                        if let Ok(val) = val_str.trim().parse::<f64>() {
                            blur_val = Some(val);
                        }
                    }
                }
                if line.contains("lavfi.block=") {
                    if let Some(val_str) = line.split('=').nth(1) {
                        if let Ok(val) = val_str.trim().parse::<f64>() {
                            block_val = Some(val);
                        }
                    }
                }
            }

            if let (Some(bl), Some(bk)) = (blur_val, block_val) {
                total_blur += bl;
                total_block += bk;
                count += 1;
            }
        }
    }

    if count == 0 {
        return None;
    }

    let avg_blur = total_blur / (count as f64);
    let avg_block = total_block / (count as f64);

    // Map to scores out of 100
    // Higher blur -> lower score. Standard blur values: 0 (sharp) to 100 (blurry).
    let sharpness_score = (100.0 - avg_blur).clamp(0.0, 100.0);
    // Higher blockiness -> lower score. Blockiness is usually very low (0.0 to 5.0).
    let blockiness_score = (100.0 - (avg_block * 20.0)).clamp(0.0, 100.0);

    let visual_score = (sharpness_score * 0.6) + (blockiness_score * 0.4);
    Some(visual_score)
}
