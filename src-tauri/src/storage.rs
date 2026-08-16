use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tempfile::NamedTempFile;

use crate::error::ApiError;

const RECENT_LIMIT: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub file_path: String,
    pub display_name: String,
    pub opened_at: u64,
    pub available: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RecentFileStore {
    version: u8,
    files: Vec<RecentFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraft {
    pub schema_version: u8,
    pub draft_id: String,
    pub file_path: Option<String>,
    pub display_name: String,
    pub base_sha256: String,
    pub revision: u64,
    pub markdown: String,
    pub bom: bool,
    pub preferred_eol: String,
    pub updated_at: u64,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, ApiError> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| ApiError::io("Cannot resolve the application data directory", error))?;
    fs::create_dir_all(&path)
        .map_err(|error| ApiError::io("Cannot create the application data directory", error))?;
    Ok(path)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), ApiError> {
    let parent = path
        .parent()
        .ok_or_else(|| ApiError::invalid("The storage path has no parent directory"))?;
    fs::create_dir_all(parent)
        .map_err(|error| ApiError::io("Cannot create the storage directory", error))?;
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| ApiError::io("Cannot create a temporary storage file", error))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| ApiError::io("Cannot write the storage file", error))?;
    temporary
        .persist(path)
        .map_err(|error| ApiError::io("Cannot replace the storage file", error.error))?;
    Ok(())
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn draft_id_for_path(path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hex::encode(hasher.finalize())
}

fn validate_draft_id(value: &str) -> Result<(), ApiError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(ApiError::invalid("The draft id is invalid"));
    }
    Ok(())
}

fn recovery_dir(app: &AppHandle) -> Result<PathBuf, ApiError> {
    let path = app_data_dir(app)?.join("Recovery");
    fs::create_dir_all(&path)
        .map_err(|error| ApiError::io("Cannot create the recovery directory", error))?;
    Ok(path)
}

fn recovery_path(app: &AppHandle, draft_id: &str) -> Result<PathBuf, ApiError> {
    validate_draft_id(draft_id)?;
    Ok(recovery_dir(app)?.join(format!("{draft_id}.json")))
}

#[tauri::command]
pub fn write_draft(app: AppHandle, mut draft: RecoveryDraft) -> Result<(), ApiError> {
    validate_draft_id(&draft.draft_id)?;
    draft.schema_version = 1;
    draft.updated_at = now_millis();
    let path = recovery_path(&app, &draft.draft_id)?;
    let bytes = serde_json::to_vec(&draft)
        .map_err(|error| ApiError::io("Cannot encode the recovery draft", error))?;
    atomic_write(&path, &bytes)
}

#[tauri::command]
pub fn delete_draft(app: AppHandle, draft_id: String) -> Result<(), ApiError> {
    let path = recovery_path(&app, &draft_id)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ApiError::io("Cannot remove the recovery draft", error)),
    }
}

pub fn read_draft(app: &AppHandle, draft_id: &str) -> Option<RecoveryDraft> {
    let path = recovery_path(app, draft_id).ok()?;
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[tauri::command]
pub fn list_drafts(app: AppHandle) -> Result<Vec<RecoveryDraft>, ApiError> {
    let directory = recovery_dir(&app)?;
    let mut drafts = fs::read_dir(directory)
        .map_err(|error| ApiError::io("Cannot read recovery drafts", error))?
        .filter_map(Result::ok)
        .filter_map(|entry| fs::read(entry.path()).ok())
        .filter_map(|bytes| serde_json::from_slice::<RecoveryDraft>(&bytes).ok())
        .collect::<Vec<_>>();
    drafts.sort_by_key(|draft| std::cmp::Reverse(draft.updated_at));
    drafts.truncate(5);
    Ok(drafts)
}

fn recent_path(app: &AppHandle) -> Result<PathBuf, ApiError> {
    Ok(app_data_dir(app)?.join("recent-files.json"))
}

fn load_recent_store(app: &AppHandle) -> RecentFileStore {
    let Ok(path) = recent_path(app) else {
        return RecentFileStore::default();
    };
    let Ok(bytes) = fs::read(path) else {
        return RecentFileStore {
            version: 1,
            files: Vec::new(),
        };
    };
    serde_json::from_slice(&bytes).unwrap_or(RecentFileStore {
        version: 1,
        files: Vec::new(),
    })
}

fn save_recent_store(app: &AppHandle, store: &RecentFileStore) -> Result<(), ApiError> {
    let bytes = serde_json::to_vec(store)
        .map_err(|error| ApiError::io("Cannot encode recent files", error))?;
    atomic_write(&recent_path(app)?, &bytes)
}

pub fn touch_recent(app: &AppHandle, file_path: &Path) -> Result<(), ApiError> {
    let canonical = file_path
        .canonicalize()
        .unwrap_or_else(|_| file_path.to_path_buf());
    let canonical_string = canonical.to_string_lossy().into_owned();
    let mut store = load_recent_store(app);
    store.version = 1;
    store
        .files
        .retain(|item| item.file_path != canonical_string);
    store.files.insert(
        0,
        RecentFile {
            file_path: canonical_string,
            display_name: canonical
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Markdown")
                .to_string(),
            opened_at: now_millis(),
            available: true,
        },
    );
    store.files.truncate(RECENT_LIMIT);
    save_recent_store(app, &store)
}

#[tauri::command]
pub fn list_recent_files(app: AppHandle) -> Result<Vec<RecentFile>, ApiError> {
    let mut store = load_recent_store(&app);
    for item in &mut store.files {
        item.available = Path::new(&item.file_path).is_file();
    }
    Ok(store.files)
}

#[tauri::command]
pub fn remove_recent_file(app: AppHandle, file_path: String) -> Result<Vec<RecentFile>, ApiError> {
    let mut store = load_recent_store(&app);
    store.files.retain(|item| item.file_path != file_path);
    save_recent_store(&app, &store)?;
    Ok(store.files)
}

#[tauri::command]
pub fn clear_recent_files(app: AppHandle) -> Result<Vec<RecentFile>, ApiError> {
    let store = RecentFileStore {
        version: 1,
        files: Vec::new(),
    };
    save_recent_store(&app, &store)?;
    Ok(store.files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draft_ids_are_stable_and_do_not_expose_paths() {
        let path = Path::new("/Users/example/secret/note.md");
        let first = draft_id_for_path(path);
        assert_eq!(first, draft_id_for_path(path));
        assert_eq!(first.len(), 64);
        assert!(!first.contains("secret"));
    }

    #[test]
    fn rejects_unsafe_draft_ids() {
        assert!(validate_draft_id("safe-id_123").is_ok());
        assert!(validate_draft_id(&"a".repeat(128)).is_ok());
        assert!(validate_draft_id(&"a".repeat(129)).is_err());
        assert!(validate_draft_id("草稿").is_err());
        assert!(validate_draft_id("../escape").is_err());
        assert!(validate_draft_id("nested/path").is_err());
        assert!(validate_draft_id("").is_err());
    }
}
