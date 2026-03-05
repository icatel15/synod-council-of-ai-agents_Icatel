use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::command;
use uuid::Uuid;

use crate::models::session::{Session, SessionSummary};

const MAX_SESSION_FILE_BYTES: u64 = 5 * 1024 * 1024;

fn default_sessions_dir() -> PathBuf {
    dirs::data_dir()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
        .join("council-of-ai-agents")
        .join("sessions")
}

fn validate_custom_sessions_dir(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);

    if !candidate.is_absolute() {
        return Err("Custom sessions path must be absolute".to_string());
    }

    if candidate
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err("Custom sessions path cannot contain '..'".to_string());
    }

    Ok(candidate)
}

fn resolve_sessions_dir(custom_path: Option<String>, create_if_missing: bool) -> Result<PathBuf, String> {
    let dir = match custom_path {
        Some(path) => validate_custom_sessions_dir(&path)?,
        None => default_sessions_dir(),
    };

    if create_if_missing {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create sessions directory: {}", e))?;
    }

    if dir.exists() {
        fs::canonicalize(&dir).map_err(|e| format!("Failed to resolve sessions directory: {}", e))
    } else {
        Ok(dir)
    }
}

fn validate_session_id(session_id: &str) -> Result<String, String> {
    Uuid::parse_str(session_id)
        .map(|id| id.to_string())
        .map_err(|_| "Invalid session id format".to_string())
}

fn ensure_readable_session_file(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path)
        .map_err(|e| format!("Failed to read session metadata: {}", e))?;

    if !metadata.is_file() {
        return Err("Session path is not a regular file".to_string());
    }

    if metadata.len() > MAX_SESSION_FILE_BYTES {
        return Err(format!(
            "Session file exceeds max size ({} bytes)",
            MAX_SESSION_FILE_BYTES
        ));
    }

    Ok(())
}

#[command]
pub fn save_session(session: Session, custom_path: Option<String>) -> Result<(), String> {
    let dir = resolve_sessions_dir(custom_path, true)?;
    let session_id = validate_session_id(&session.id)?;
    let file_path = dir.join(format!("{}.json", session_id));
    let json =
        serde_json::to_string_pretty(&session).map_err(|e| format!("Serialization error: {}", e))?;

    if json.len() as u64 > MAX_SESSION_FILE_BYTES {
        return Err(format!(
            "Session exceeds max size ({} bytes)",
            MAX_SESSION_FILE_BYTES
        ));
    }

    fs::write(file_path, json).map_err(|e| format!("Failed to write session file: {}", e))
}

#[command]
pub fn load_session(session_id: String, custom_path: Option<String>) -> Result<Session, String> {
    let dir = resolve_sessions_dir(custom_path, false)?;
    let session_id = validate_session_id(&session_id)?;
    let file_path = dir.join(format!("{}.json", session_id));
    ensure_readable_session_file(&file_path)?;

    let json =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read session file: {}", e))?;
    serde_json::from_str(&json).map_err(|e| format!("Failed to parse session: {}", e))
}

#[command]
pub fn list_sessions(custom_path: Option<String>) -> Result<Vec<SessionSummary>, String> {
    let dir = resolve_sessions_dir(custom_path, false)?;

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut sessions: Vec<SessionSummary> = Vec::new();

    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Failed to read sessions directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to inspect directory entry type: {}", e))?;
        if !file_type.is_file() {
            continue;
        }

        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }

        let Some(stem) = path.file_stem().and_then(|name| name.to_str()) else {
            continue;
        };
        if Uuid::parse_str(stem).is_err() {
            continue;
        }

        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > MAX_SESSION_FILE_BYTES {
            continue;
        }

        if let Ok(json) = fs::read_to_string(&path) {
            if let Ok(session) = serde_json::from_str::<Session>(&json) {
                sessions.push(SessionSummary {
                    id: session.id,
                    title: session.title,
                    created_at: session.created_at,
                    updated_at: session.updated_at,
                });
            }
        }
    }

    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(sessions)
}

#[command]
pub fn delete_session(session_id: String, custom_path: Option<String>) -> Result<(), String> {
    let dir = resolve_sessions_dir(custom_path, false)?;
    let session_id = validate_session_id(&session_id)?;
    let file_path = dir.join(format!("{}.json", session_id));

    if file_path.exists() {
        let metadata = fs::symlink_metadata(&file_path)
            .map_err(|e| format!("Failed to inspect session file: {}", e))?;
        if metadata.file_type().is_symlink() {
            return Err("Refusing to delete symlinked session file".to_string());
        }

        fs::remove_file(file_path).map_err(|e| format!("Failed to delete session: {}", e))
    } else {
        Ok(())
    }
}

#[command]
pub fn get_default_sessions_path() -> Result<String, String> {
    let path = default_sessions_dir();

    let resolved = if path.exists() {
        fs::canonicalize(&path).unwrap_or(path)
    } else {
        path
    };
    resolved
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to convert path to string".to_string())
}
