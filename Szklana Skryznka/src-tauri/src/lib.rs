pub mod db;
pub mod models;
pub mod playout;
pub mod scanner;
pub mod scheduler;
pub mod commands;

use tauri::Manager;
use tauri::Emitter;
use tauri::menu::{Menu, MenuItem, Submenu};

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

            let tray_menu = Menu::with_items(&handle, &[
                &status_item,
                &progress_item,
                &tauri::menu::PredefinedMenuItem::separator(&handle).unwrap(),
                &MenuItem::with_id(&handle, "open", "Open Szklana Skryznka", true, None::<&str>).unwrap(),
                &MenuItem::with_id(&handle, "quit", "Quit", true, None::<&str>).unwrap(),
            ]).unwrap();

            let _tray = tauri::tray::TrayIconBuilder::with_id("main-tray")
                .icon(tray_image)
                .menu(&tray_menu)
                .on_menu_event(|app, event| {
                    if event.id() == "open" {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    } else if event.id() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            // Initialize SQLite DB programmatically in block_on
            tauri::async_runtime::block_on(async move {
                let pool = db::init_db(&handle).await.expect("Failed to initialize database");
                
                // Spawn background worker thread for quality score processing
                let worker_pool = pool.clone();
                let worker_handle = handle.clone();
                let status_item_clone = status_item.clone();
                let progress_item_clone = progress_item.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

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
                                    let resolution: String = row.get("resolution");
                                    let video_bitrate: Option<i64> = row.get("video_bitrate");
                                    let audio_channels: Option<i32> = row.get("audio_channels");
                                    let video_codec: String = row.get("video_codec");
                                    let audio_codec: String = row.get("audio_codec");

                                    let filename = std::path::Path::new(&file_path)
                                        .file_name()
                                        .and_then(|n| n.to_str())
                                        .unwrap_or(&file_path);

                                    tracing::info!("Background worker processing visual quality check for: {}", file_path);

                                    // Retrieve file duration
                                    let duration_sec = sqlx::query_scalar::<_, i32>(
                                        "SELECT duration FROM media_files WHERE id = $1"
                                    )
                                    .bind(&id)
                                    .fetch_one(&worker_pool)
                                    .await
                                    .unwrap_or(0);

                                    let metadata_score = scanner::calculate_quality_score(
                                        &resolution,
                                        video_bitrate,
                                        audio_channels,
                                        &video_codec,
                                        &audio_codec,
                                    );

                                    // Run Fast Keyframe Sampling on 20 keyframes (every 5%) using FFmpeg
                                    let visual_score = evaluate_visual_quality(
                                        &file_path,
                                        duration_sec,
                                        filename,
                                        &status_item_clone,
                                        &progress_item_clone,
                                        &worker_handle,
                                    );

                                    let score = match visual_score {
                                        Some(vis) => ((metadata_score * 0.4) + (vis * 0.6)).clamp(0.0, 100.0),
                                        None => metadata_score,
                                    };

                                    let update_res = sqlx::query(
                                        "UPDATE media_files SET quality_score = $1, quality_score_done = 1 WHERE id = $2"
                                    )
                                    .bind(score)
                                    .bind(&id)
                                    .execute(&worker_pool)
                                    .await;

                                    if update_res.is_ok() {
                                        // Notify frontend to refresh UI
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
            });
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id() == "tmdb_api_key" {
                let _ = app.emit("menu-set-api-key", ());
            } else if event.id() == "purge_database" {
                let _ = app.emit("menu-purge-database", ());
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
            commands::refresh_item_metadata
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
