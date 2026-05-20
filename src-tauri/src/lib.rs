mod epub;
mod pdf;

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// ---- Data types ----

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Book {
    id: String,
    name: String,
    path: String,
    format: String,
    size: u64,
    content: Option<String>,
    #[serde(rename = "addedAt")]
    added_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Sentence {
    text: String,
    #[serde(rename = "voiceGender", default = "default_gender")]
    voice_gender: String,
    #[serde(default = "default_pitch")]
    pitch: String,
    #[serde(default = "default_rate")]
    rate: String,
}

fn default_gender() -> String { "female".into() }
fn default_pitch() -> String { "+0Hz".into() }
fn default_rate() -> String { "+0%".into() }

#[derive(Debug, Serialize)]
struct TtsResult {
    files: Vec<Option<String>>,
    output_dir: String,
    errors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AudioFile {
    name: String,
    path: String,
    size: u64,
}

// ---- Helpers ----

fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn ensure_dir(p: &PathBuf) {
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
}

// ---- Commands ----

#[tauri::command]
fn read_file(path: String) -> Option<String> {
    fs::read_to_string(&path).ok()
}

#[tauri::command]
fn get_library(app: tauri::AppHandle) -> serde_json::Value {
    let lib_path = app_data_dir(&app).join("library.json");
    fs::read_to_string(&lib_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!([]))
}

#[tauri::command]
fn save_library(app: tauri::AppHandle, library: serde_json::Value) -> bool {
    let lib_path = app_data_dir(&app).join("library.json");
    ensure_dir(&lib_path);
    serde_json::to_string_pretty(&library)
        .ok()
        .and_then(|s| fs::write(&lib_path, s).ok())
        .is_some()
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, data: serde_json::Value) -> bool {
    let p = app_data_dir(&app).join("settings.json");
    ensure_dir(&p);
    serde_json::to_string_pretty(&data)
        .ok()
        .and_then(|s| fs::write(&p, s).ok())
        .is_some()
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Option<serde_json::Value> {
    let p = app_data_dir(&app).join("settings.json");
    fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

#[tauri::command]
fn save_playlists(app: tauri::AppHandle, data: serde_json::Value) -> bool {
    let p = app_data_dir(&app).join("playlists.json");
    ensure_dir(&p);
    serde_json::to_string_pretty(&data)
        .ok()
        .and_then(|s| fs::write(&p, s).ok())
        .is_some()
}

#[tauri::command]
fn load_playlists(app: tauri::AppHandle) -> Option<serde_json::Value> {
    let p = app_data_dir(&app).join("playlists.json");
    fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

#[tauri::command]
fn delete_file(path: String) -> bool {
    fs::remove_file(&path).is_ok()
}

#[tauri::command]
async fn import_book(app: tauri::AppHandle) -> Option<Book> {
    use tauri_plugin_dialog::DialogExt;
    let file = app
        .dialog()
        .file()
        .add_filter("电子书", &["epub", "txt", "pdf", "md"])
        .blocking_pick_file();

    let path = file?.into_path().ok()?;
    let ext = path.extension()?.to_str()?.to_lowercase();
    let name = path.file_stem()?.to_str()?.to_string();
    let meta = fs::metadata(&path).ok()?;

    let content = match ext.as_str() {
        "txt" | "md" => fs::read_to_string(&path).ok(),
        "epub" => epub::parse_epub(path.to_str()?),
        "pdf" => pdf::extract_pdf_text(path.to_str()?),
        _ => None,
    };

    Some(Book {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.replace(&format!(".{}", ext), ""),
        path: path.to_str()?.into(),
        format: ext,
        size: meta.len(),
        content,
        added_at: chrono_now(),
    })
}

#[tauri::command]
async fn import_audio(app: tauri::AppHandle) -> Vec<AudioFile> {
    use tauri_plugin_dialog::DialogExt;
    let files = app
        .dialog()
        .file()
        .add_filter("音频", &["mp3", "wav", "aiff", "m4a"])
        .blocking_pick_files();

    match files {
        Some(paths) => paths
            .into_iter()
            .filter_map(|p| {
                let path = p.into_path().ok()?;
                let name = path.file_name()?.to_str()?.into();
                let meta = fs::metadata(&path).ok()?;
                let size = meta.len();
                Some(AudioFile {
                    name,
                    path: path.to_str()?.into(),
                    size,
                })
            })
            .collect(),
        None => vec![],
    }
}

#[tauri::command]
async fn choose_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok().and_then(|p| p.to_str().map(String::from)))
}

#[tauri::command]
async fn tts_generate(app: tauri::AppHandle, sentences: Vec<Sentence>, output_dir: Option<String>) -> TtsResult {
    let dir = output_dir.unwrap_or_else(|| {
        std::env::temp_dir()
            .join("novel-player-tts")
            .to_str()
            .unwrap_or("/tmp/novel-player-tts")
            .into()
    });
    let _ = tokio::fs::create_dir_all(&dir).await;

    let n = sentences.len();
    let mut files: Vec<Option<String>> = vec![None; n];
    let mut errors: Vec<String> = Vec::new();

    for (i, sent) in sentences.iter().enumerate() {
        let text = sent.text.trim().to_string();
        if text.is_empty() { continue; }

        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        text.hash(&mut hasher);
        sent.voice_gender.hash(&mut hasher);
        sent.pitch.hash(&mut hasher);
        sent.rate.hash(&mut hasher);
        let hash = format!("{:08x}", hasher.finish());

        let output_path = format!("{}/s_{:05}_{}.mp3", dir, i, &hash[..8]);

        // Skip if already generated
        if let Ok(meta) = tokio::fs::metadata(&output_path).await {
            if meta.len() > 100 {
                files[i] = Some(output_path);
                continue;
            }
        }

        let voice = if sent.voice_gender == "male" {
            "zh-CN-YunxiNeural"
        } else {
            "zh-CN-XiaoxiaoNeural"
        };

        // Use bundled edge-tts binary, fallback to system
        let edge_tts_path = app.path().resource_dir()
            .unwrap_or_default()
            .join("binaries").join("edge-tts");
        let edge_tts = if edge_tts_path.exists() {
            edge_tts_path.to_str().unwrap_or("edge-tts").to_string()
        } else {
            "edge-tts".to_string()
        };

        let result = tokio::process::Command::new(&edge_tts)
            .args(["-v", voice, "--pitch", &sent.pitch, "--rate", &sent.rate, "-t", &text, "--write-media", &output_path])
            .output()
            .await;

        match result {
            Ok(o) if o.status.success() && std::path::Path::new(&output_path).exists() => {
                files[i] = Some(output_path);
            }
            Ok(o) => {
                let msg = String::from_utf8_lossy(&o.stderr).trim().to_string();
                let err = if msg.is_empty() { "TTS失败".into() } else { msg };
                errors.push(format!("段{}: {}", i, err));
            }
            Err(e) => {
                errors.push(format!("段{}: {}", i, e));
            }
        }
    }

    TtsResult { files, output_dir: dir, errors }
}

#[tauri::command]
fn tts_read_audio(path: String) -> Option<String> {
    let data = fs::read(&path).ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(&data))
}

#[tauri::command]
async fn export_audio(app: tauri::AppHandle) -> Option<serde_json::Value> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder()?;
    let dest_dir = folder.into_path().ok()?;
    let src_dir = std::env::temp_dir().join("novel-player-tts");

    let mut exported = 0;
    let mut files_list: Vec<String> = Vec::new();

    if src_dir.exists() {
        if let Ok(entries) = fs::read_dir(&src_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |e| e == "mp3" || e == "wav") {
                    let dest = dest_dir.join(path.file_name().unwrap());
                    if fs::copy(&path, &dest).is_ok() {
                        exported += 1;
                        files_list.push(dest.to_str().unwrap_or("").into());
                    }
                }
            }
        }
    }

    Some(serde_json::json!({
        "count": exported,
        "dir": dest_dir.to_str().unwrap_or(""),
        "files": files_list,
    }))
}

#[tauri::command]
fn list_generated_audio() -> Vec<AudioFile> {
    let src_dir = std::env::temp_dir().join("novel-player-tts");
    if !src_dir.exists() { return vec![]; }

    let mut files: Vec<AudioFile> = Vec::new();
    if let Ok(entries) = fs::read_dir(&src_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "mp3") {
                if let (Some(name), Ok(meta)) = (
                    path.file_name().and_then(|n| n.to_str()).map(String::from),
                    fs::metadata(&path),
                ) {
                    files.push(AudioFile {
                        name,
                        path: path.to_str().unwrap_or("").into(),
                        size: meta.len(),
                    });
                }
            }
        }
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    files
}

fn chrono_now() -> String {
    // Simple ISO timestamp without chrono dependency
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let secs = d % 86400;
    let days = d / 86400;
    // Approximate date from Unix epoch (good enough for IDs)
    let y = 1970 + days / 365;
    let rem = days % 365;
    let m = rem / 30 + 1;
    let day = rem % 30 + 1;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z",
        y, m, day, secs / 3600, (secs % 3600) / 60, secs % 60
    )
}

// ---- App entry ----

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            import_book,
            read_file,
            get_library,
            save_library,
            save_settings,
            load_settings,
            save_playlists,
            load_playlists,
            delete_file,
            import_audio,
            choose_folder,
            tts_generate,
            tts_read_audio,
            export_audio,
            list_generated_audio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
