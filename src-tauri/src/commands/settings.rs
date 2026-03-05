use std::fs;
use std::path::{Component, PathBuf};
use tauri::command;

use crate::models::config::AppSettings;

fn get_settings_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("council-of-ai-agents")
        .join("settings.json")
}

fn validate_session_save_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);

    if !candidate.is_absolute() {
        return Err("Session save path must be absolute".to_string());
    }

    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Session save path cannot contain '..'".to_string());
    }

    if candidate.exists() {
        let metadata = fs::metadata(&candidate)
            .map_err(|e| format!("Failed to read session save path metadata: {}", e))?;
        if !metadata.is_dir() {
            return Err("Session save path must be a directory".to_string());
        }

        return fs::canonicalize(&candidate)
            .map_err(|e| format!("Failed to resolve session save path: {}", e));
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| "Session save path must have a valid parent directory".to_string())?;
    if !parent.exists() {
        return Err("Session save path parent directory does not exist".to_string());
    }

    let canonical_parent = fs::canonicalize(parent)
        .map_err(|e| format!("Failed to resolve session save path parent: {}", e))?;
    let leaf = candidate
        .file_name()
        .ok_or_else(|| "Session save path must end with a directory name".to_string())?;

    Ok(canonical_parent.join(leaf))
}

#[command]
pub fn load_settings() -> Result<AppSettings, String> {
    let path = get_settings_path();

    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let json =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {}", e))?;
    serde_json::from_str(&json).map_err(|e| format!("Failed to parse settings: {}", e))
}

#[command]
pub fn save_settings(mut settings: AppSettings) -> Result<(), String> {
    if let Some(path) = settings.session_save_path.as_deref() {
        let validated = validate_session_save_path(path)?;
        settings.session_save_path = Some(validated.to_string_lossy().to_string());
    }

    let path = get_settings_path();

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create settings directory: {}", e))?;
    }

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Serialization error: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write settings: {}", e))
}
