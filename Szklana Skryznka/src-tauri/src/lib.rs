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

            // Initialize SQLite DB programmatically in block_on
            tauri::async_runtime::block_on(async move {
                let pool = db::init_db(&handle).await.expect("Failed to initialize database");
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
        .invoke_handler(tauri::generate_handler![
            commands::scan_library,
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
