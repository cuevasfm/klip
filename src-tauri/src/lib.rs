use tauri::{AppHandle, Manager, Emitter, Listener, WindowEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, MouseButton, TrayIconEvent};
use sqlx::{sqlite::SqlitePoolOptions, Pool, Sqlite, Row};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use arboard::Clipboard;
use chrono::prelude::*;
use serde::{Serialize, Deserialize};
use uuid::Uuid;
use deunicode::deunicode_char;

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Clip {
    id: String,
    content: String,
    created_at: String, // ISO 8601
    is_favorite: bool,
    clip_type: String, // "text" or "image"
    image_path: Option<String>,
}

struct DbState {
    pool: Pool<Sqlite>,
}

const DB_FILENAME: &str = "clips.db";

fn normalize_text(text: &str) -> String {
    let mut normalized = String::with_capacity(text.len());
    for c in text.chars() {
        if let Some(d) = deunicode_char(c) {
            normalized.push_str(d);
        } else {
            normalized.push(c);
        }
    }
    normalized.to_lowercase()
}

async fn init_db(app_handle: &AppHandle) -> Result<Pool<Sqlite>, String> {
    let app_dir = app_handle.path().app_data_dir().unwrap_or(std::path::PathBuf::from("."));
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    let db_path = app_dir.join(DB_FILENAME);
    
    if !db_path.exists() {
        std::fs::File::create(&db_path).map_err(|e| e.to_string())?;
    }
    
    let db_url = format!("sqlite://{}", db_path.to_string_lossy());

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS clips (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_favorite BOOLEAN DEFAULT 0
        )"
    )
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;

    // Migration: Add search_content column if not exists
    let _ = sqlx::query("ALTER TABLE clips ADD COLUMN search_content TEXT").execute(&pool).await;

    // Migration: Add clip_type and image_path columns
    let _ = sqlx::query("ALTER TABLE clips ADD COLUMN clip_type TEXT DEFAULT 'text'").execute(&pool).await;
    let _ = sqlx::query("ALTER TABLE clips ADD COLUMN image_path TEXT").execute(&pool).await;
    
    // Backfill null search_content
    let rows_to_update: Vec<(String, String)> = sqlx::query_as("SELECT id, content FROM clips WHERE search_content IS NULL")
        .fetch_all(&pool)
        .await
        .unwrap_or_default();
        
    for (id, content) in rows_to_update {
        let normalized = normalize_text(&content);
        let _ = sqlx::query("UPDATE clips SET search_content = ? WHERE id = ?")
            .bind(normalized)
            .bind(id)
            .execute(&pool)
            .await;
    }

    // Ensure images directory exists
    let images_dir = app_dir.join("images");
    if !images_dir.exists() {
        std::fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    }

    // Retention policy
    let retention_date = Utc::now() - chrono::Duration::days(90);
    sqlx::query("DELETE FROM clips WHERE is_favorite = 0 AND created_at < ?")
        .bind(retention_date.to_rfc3339())
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(pool)
}

#[tauri::command]
async fn get_clips(state: tauri::State<'_, DbState>, search_text: Option<String>, date_filter: Option<String>) -> Result<Vec<Clip>, String> {
    let mut query = "SELECT id, content, created_at, is_favorite, clip_type, image_path FROM clips WHERE 1=1".to_string();
    let mut args = Vec::new();

    if let Some(search) = search_text {
        if !search.is_empty() {
             let normalized_search = normalize_text(&search);
             query.push_str(" AND search_content LIKE ?");
             args.push(format!("%{}%", normalized_search));
        }
    }
    
    if let Some(date) = date_filter {
        if !date.is_empty() {
            query.push_str(" AND strftime('%Y-%m-%d', created_at, 'localtime') = ?");
            args.push(date); 
        }
    }

    query.push_str(" ORDER BY created_at DESC LIMIT 50");

    let mut query_builder = sqlx::query_as::<_, Clip>(&query);
    for arg in args {
        query_builder = query_builder.bind(arg);
    }

    let rows = query_builder
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    
    Ok(rows)
}

#[tauri::command]
async fn get_dates_with_clips(state: tauri::State<'_, DbState>) -> Result<Vec<String>, String> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT DISTINCT strftime('%Y-%m-%d', created_at, 'localtime') FROM clips ORDER BY created_at DESC")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    let dates = rows.into_iter().map(|(date,)| date).collect();
    Ok(dates)
}

#[tauri::command]
async fn add_clip(state: tauri::State<'_, DbState>, content: String) -> Result<String, String> {
    // Check if content already exists TODAY
    let exists: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM clips WHERE content = ? AND strftime('%Y-%m-%d', created_at, 'localtime') = strftime('%Y-%m-%d', 'now', 'localtime') LIMIT 1"
    )
    .bind(&content)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    if exists.is_some() {
        return Ok("Duplicate".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let search_content = normalize_text(&content);
    
    sqlx::query("INSERT INTO clips (id, content, created_at, is_favorite, search_content, clip_type, image_path) VALUES (?, ?, ?, ?, ?, 'text', NULL)")
        .bind(&id)
        .bind(&content)
        .bind(&created_at)
        .bind(false)
        .bind(search_content)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
fn copy_to_clipboard(content: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn update_clip_content(state: tauri::State<'_, DbState>, id: String, content: String) -> Result<(), String> {
    let search_content = normalize_text(&content);
    sqlx::query("UPDATE clips SET content = ?, search_content = ? WHERE id = ?")
        .bind(content)
        .bind(search_content)
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn copy_image_to_clipboard(path: String) -> Result<(), String> {
    let img = image::open(&path).map_err(|e| e.to_string())?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let bytes = rgba.into_raw();

    let image_data = arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: std::borrow::Cow::Owned(bytes),
    };

    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_image(image_data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_clip(state: tauri::State<'_, DbState>, id: String) -> Result<(), String> {
    // Get image path first
    let row: Option<(Option<String>,)> = sqlx::query_as("SELECT image_path FROM clips WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    if let Some((image_path,)) = row {
        if let Some(path) = image_path {
             let _ = std::fs::remove_file(path);
        }
    }

    sqlx::query("DELETE FROM clips WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
        
    Ok(())
}

fn start_clipboard_monitor(app_handle: AppHandle) {
    let handle = app_handle.clone();
    
    thread::spawn(move || {
        let mut clipboard = match Clipboard::new() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Failed to init clipboard: {}", e);
                return;
            }
        };

        let mut last_content = String::new();
        // Track last image hash/size to avoid dups. Simple length check for now, can improve.
        let mut last_image_len: usize = 0; 

        if let Ok(text) = clipboard.get_text() {
             last_content = text;
        }

        loop {
            // Check for Text
            if let Ok(text) = clipboard.get_text() {
                if text != last_content && !text.trim().is_empty() {
                    last_content = text.clone();
                    
                    let handle_clone = handle.clone();
                    let text_clone = text.clone();
                    
                    // Run async DB insert
                    tauri::async_runtime::block_on(async move {
                         let state = handle_clone.state::<DbState>();
                         
                         // Check duplicates for today before inserting
                          let exists: Option<(i32,)> = sqlx::query_as(
                              "SELECT 1 FROM clips WHERE content = ? AND strftime('%Y-%m-%d', created_at, 'localtime') = strftime('%Y-%m-%d', 'now', 'localtime') LIMIT 1"
                          )
                          .bind(&text_clone)
                          .fetch_optional(&state.pool)
                          .await
                          .unwrap_or(None);

                          if exists.is_none() {
                                let id = Uuid::new_v4().to_string();
                                let created_at = Utc::now().to_rfc3339();
                                let search_content = normalize_text(&text_clone);

                                let _ = sqlx::query("INSERT INTO clips (id, content, created_at, is_favorite, search_content, clip_type, image_path) VALUES (?, ?, ?, ?, ?, 'text', NULL)")
                                .bind(id)
                                .bind(text_clone)
                                .bind(created_at)
                                .bind(false)
                                .bind(search_content)
                                .execute(&state.pool)
                                .await;
                                
                                let _ = handle_clone.emit("clipboard-changed", ());
                          }
                    });
                }
            }

            // Check for Image
            // if let Ok(image) = clipboard.get_image() {
            //     if image.bytes.len() != last_image_len && image.bytes.len() > 0 {
            //         last_image_len = image.bytes.len(); // Update last seen
            //         
            //         // Logic to process image...
            //         let width = image.width;
            //         let height = image.height;
            //         let bytes = image.bytes.into_owned(); // Clone bytes
            //         
            //         let handle_clone = handle.clone();
            //         let app_dir = handle_clone.path().app_data_dir().unwrap_or(std::path::PathBuf::from("."));
            //         
            //         tauri::async_runtime::block_on(async move {
            //              let state = handle_clone.state::<DbState>();
            //              let id = Uuid::new_v4().to_string();
            //              let created_at = Utc::now().to_rfc3339();
            //              let file_name = format!("{}.png", id);
            //              let file_path = app_dir.join("images").join(&file_name);
            //              
            //              // Save Image using `image` crate
            //              if let Some(img_buffer) = image::ImageBuffer::<image::Rgba<u8>, _>::from_raw(width as u32, height as u32, bytes) {
            //                  if let Ok(_) = img_buffer.save(&file_path) {
            //                       let image_path_str = file_path.to_string_lossy().to_string();
            //                       
            //                       // Insert into DB (content is empty for now, search_content null)
            //                       let _ = sqlx::query("INSERT INTO clips (id, content, created_at, is_favorite, search_content, clip_type, image_path) VALUES (?, '', ?, ?, NULL, 'image', ?)")
            //                         .bind(id)
            //                         .bind(created_at)
            //                         .bind(false)
            //                         .bind(image_path_str)
            //                         .execute(&state.pool)
            //                         .await;
            //
            //                       let _ = handle_clone.emit("clipboard-changed", ());
            //                  }
            //              }
            //         });
            //     }
            // }

            thread::sleep(Duration::from_millis(1000));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let pool = init_db(&handle).await.expect("failed to init db");
                handle.manage(DbState { pool });
            });
            
            start_clipboard_monitor(app.handle().clone());

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).unwrap();
            let show_i = MenuItem::with_id(app, "show", "Open Klip", true, None::<&str>).unwrap();
            let menu = Menu::with_items(app, &[&show_i, &quit_i]).unwrap();

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id.as_ref() {
                        "quit" => app.exit(0),
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                     if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                     }
                })
                .icon(app.default_window_icon().unwrap().clone())
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![get_clips, get_dates_with_clips, add_clip, copy_to_clipboard, update_clip_content, delete_clip, copy_image_to_clipboard])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
