use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tempfile::NamedTempFile;

use crate::{
    error::ApiError,
    storage::{RecoveryDraft, draft_id_for_path, read_draft, touch_recent},
};

const MARKDOWN_EXTENSIONS: [&str; 2] = ["md", "markdown"];
const MAX_LOCAL_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const ASSET_DIRECTORY: &str = "assets";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFingerprint {
    pub sha256: String,
    pub size: u64,
    pub mtime_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFormat {
    pub encoding: &'static str,
    pub encoding_supported: bool,
    pub bom: bool,
    pub preferred_eol: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDocumentResult {
    pub file_path: String,
    pub display_name: String,
    pub content: String,
    pub fingerprint: FileFingerprint,
    pub format: DocumentFormat,
    pub writable: bool,
    pub draft_id: String,
    pub draft: Option<RecoveryDraft>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentRequest {
    pub file_path: String,
    pub content: String,
    pub base_sha256: String,
    pub revision: u64,
    pub bom: bool,
    pub mode: SaveMode,
    pub draft_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocumentRequest {
    pub file_path: String,
    pub format: ExportFormat,
    pub content: String,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    Html,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SaveMode {
    Normal,
    SaveAs,
    Force,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SaveDocumentResult {
    Saved {
        revision: u64,
        file_path: String,
        fingerprint: FileFingerprint,
    },
    Conflict {
        revision: u64,
        disk: FileFingerprint,
    },
    Missing {
        revision: u64,
    },
    Readonly {
        revision: u64,
        reason: String,
    },
    Error {
        revision: u64,
        code: String,
        message: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum InspectDocumentResult {
    Current { fingerprint: FileFingerprint },
    Changed { fingerprint: FileFingerprint },
    Missing,
    Error { message: String },
}

fn validate_markdown_path(path: &Path) -> Result<(), ApiError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !MARKDOWN_EXTENSIONS.contains(&extension.as_str()) {
        return Err(ApiError::invalid(
            "Only .md and .markdown files are supported",
        ));
    }
    Ok(())
}

fn validate_export_path(path: &Path, format: &ExportFormat) -> Result<(), ApiError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let valid = match format {
        ExportFormat::Html => matches!(extension.as_str(), "html" | "htm"),
    };
    if !valid {
        return Err(ApiError::invalid(
            "The export file extension does not match the selected format",
        ));
    }
    Ok(())
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn fingerprint(path: &Path, bytes: &[u8]) -> Result<FileFingerprint, ApiError> {
    let metadata = fs::metadata(path)
        .map_err(|error| ApiError::io("Cannot read Markdown file metadata", error))?;
    let mtime_ms = metadata
        .modified()
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    Ok(FileFingerprint {
        sha256: hash_bytes(bytes),
        size: metadata.len(),
        mtime_ms,
    })
}

fn preferred_eol(content: &str) -> &'static str {
    let crlf = content.match_indices("\r\n").count();
    let lf = content.match_indices('\n').count().saturating_sub(crlf);
    if crlf > lf { "crlf" } else { "lf" }
}

fn is_writable(path: &Path) -> bool {
    OpenOptions::new().write(true).open(path).is_ok()
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, ApiError> {
    fs::read(path).map_err(|error| ApiError::io("Cannot read the Markdown file", error))
}

#[tauri::command]
pub fn read_document(app: AppHandle, file_path: String) -> Result<ReadDocumentResult, ApiError> {
    let path = PathBuf::from(file_path);
    validate_markdown_path(&path)?;
    let bytes = read_bytes(&path)?;
    let fingerprint = fingerprint(&path, &bytes)?;
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let body = if bom { &bytes[3..] } else { &bytes };
    let (content, encoding_supported) = match std::str::from_utf8(body) {
        Ok(value) => (value.to_string(), true),
        Err(_) => (String::from_utf8_lossy(body).into_owned(), false),
    };
    let canonical = path.canonicalize().unwrap_or(path);
    let draft_id = draft_id_for_path(&canonical);
    let writable = encoding_supported && is_writable(&canonical);
    let result = ReadDocumentResult {
        file_path: canonical.to_string_lossy().into_owned(),
        display_name: canonical
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Markdown")
            .to_string(),
        format: DocumentFormat {
            encoding: "utf-8",
            encoding_supported,
            bom,
            preferred_eol: preferred_eol(&content),
        },
        content,
        fingerprint,
        writable,
        draft: read_draft(&app, &draft_id),
        draft_id,
    };
    touch_recent(&app, &canonical)?;
    Ok(result)
}

fn current_fingerprint(path: &Path) -> Result<FileFingerprint, ApiError> {
    let bytes = read_bytes(path)?;
    fingerprint(path, &bytes)
}

fn encode_document_bytes(content: &str, bom: bool) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(content.len() + usize::from(bom) * 3);
    if bom {
        bytes.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    }
    bytes.extend_from_slice(content.as_bytes());
    bytes
}

#[tauri::command]
pub fn inspect_document(file_path: String, base_sha256: String) -> InspectDocumentResult {
    let path = PathBuf::from(file_path);
    if !path.exists() {
        return InspectDocumentResult::Missing;
    }
    match current_fingerprint(&path) {
        Ok(fingerprint) if fingerprint.sha256 == base_sha256 => {
            InspectDocumentResult::Current { fingerprint }
        }
        Ok(fingerprint) => InspectDocumentResult::Changed { fingerprint },
        Err(error) => InspectDocumentResult::Error {
            message: error.message,
        },
    }
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn document_asset_directory(document: &Path) -> Result<PathBuf, ApiError> {
    validate_markdown_path(document)?;
    let parent = document
        .parent()
        .ok_or_else(|| ApiError::invalid("The Markdown path has no parent directory"))?;
    let root = parent
        .canonicalize()
        .map_err(|error| ApiError::io("Cannot resolve the document directory", error))?;
    let directory = root.join(ASSET_DIRECTORY);
    fs::create_dir_all(&directory)
        .map_err(|error| ApiError::io("Cannot create the document asset directory", error))?;
    let canonical = directory
        .canonicalize()
        .map_err(|error| ApiError::io("Cannot resolve the document asset directory", error))?;
    if !canonical.starts_with(&root) {
        return Err(ApiError::invalid(
            "The document asset directory is outside the document directory",
        ));
    }
    Ok(canonical)
}

fn available_asset_path(
    directory: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<PathBuf, ApiError> {
    let requested = Path::new(file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::invalid("The image file name is invalid"))?;
    let requested_path = Path::new(requested);
    image_mime_type(requested_path)
        .ok_or_else(|| ApiError::invalid("The local image format is not supported"))?;
    let stem = requested_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let extension = requested_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");

    for index in 1..=10_000 {
        let candidate_name = if index == 1 {
            requested.to_string()
        } else {
            format!("{stem}-{index}.{extension}")
        };
        let candidate = directory.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
        if fs::read(&candidate).is_ok_and(|existing| existing == bytes) {
            return Ok(candidate);
        }
    }
    Err(ApiError::invalid("Cannot allocate an image asset name"))
}

fn write_document_image(
    document: &Path,
    file_name: &str,
    bytes: &[u8],
) -> Result<String, ApiError> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_LOCAL_IMAGE_BYTES {
        return Err(ApiError::invalid(
            "The local image is empty or larger than 25 MB",
        ));
    }
    let directory = document_asset_directory(document)?;
    let destination = available_asset_path(&directory, file_name, bytes)?;
    if !destination.exists() {
        let mut temporary = NamedTempFile::new_in(&directory)
            .map_err(|error| ApiError::io("Cannot create a temporary image asset", error))?;
        temporary
            .write_all(bytes)
            .map_err(|error| ApiError::io("Cannot write the image asset", error))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| ApiError::io("Cannot sync the image asset", error))?;
        temporary
            .persist(&destination)
            .map_err(|error| ApiError::io("Cannot install the image asset", error.error))?;
    }
    let name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| ApiError::invalid("The image asset name is invalid"))?;
    Ok(format!("{ASSET_DIRECTORY}/{name}"))
}

#[tauri::command]
pub fn import_document_image(
    document_path: String,
    image_path: String,
) -> Result<String, ApiError> {
    let source = PathBuf::from(image_path);
    let metadata = fs::metadata(&source)
        .map_err(|error| ApiError::io("Cannot read local image metadata", error))?;
    if !metadata.is_file() || metadata.len() > MAX_LOCAL_IMAGE_BYTES {
        return Err(ApiError::invalid(
            "The local image is unavailable or larger than 25 MB",
        ));
    }
    image_mime_type(&source)
        .ok_or_else(|| ApiError::invalid("The local image format is not supported"))?;
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| ApiError::invalid("The image file name is invalid"))?;
    let bytes =
        fs::read(&source).map_err(|error| ApiError::io("Cannot read the local image", error))?;
    write_document_image(Path::new(&document_path), file_name, &bytes)
}

#[tauri::command]
pub fn store_document_image(
    document_path: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, ApiError> {
    write_document_image(Path::new(&document_path), &file_name, &bytes)
}

#[tauri::command]
pub fn read_local_image(document_path: String, image_source: String) -> Result<String, ApiError> {
    let document = PathBuf::from(document_path);
    let relative = PathBuf::from(&image_source);
    let first_segment = image_source.split(['/', '\\']).next().unwrap_or_default();
    if image_source.is_empty()
        || image_source.contains('\0')
        || relative.is_absolute()
        || first_segment.contains(':')
    {
        return Err(ApiError::invalid(
            "Only local relative image paths are supported",
        ));
    }

    let parent = document
        .parent()
        .ok_or_else(|| ApiError::invalid("The Markdown path has no parent directory"))?;
    let root = parent
        .canonicalize()
        .map_err(|error| ApiError::io("Cannot resolve the Markdown directory", error))?;
    let image_path = root
        .join(relative)
        .canonicalize()
        .map_err(|error| ApiError::io("Cannot resolve the local image", error))?;
    if !image_path.starts_with(&root) {
        return Err(ApiError::invalid(
            "The local image must remain inside the Markdown directory",
        ));
    }
    let metadata = fs::metadata(&image_path)
        .map_err(|error| ApiError::io("Cannot read local image metadata", error))?;
    if !metadata.is_file() || metadata.len() > MAX_LOCAL_IMAGE_BYTES {
        return Err(ApiError::invalid(
            "The local image is unavailable or larger than 25 MB",
        ));
    }
    let mime = image_mime_type(&image_path)
        .ok_or_else(|| ApiError::invalid("The local image format is not supported"))?;
    let bytes = fs::read(&image_path)
        .map_err(|error| ApiError::io("Cannot read the local image", error))?;
    Ok(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
}

#[tauri::command]
pub fn resolve_markdown_link(
    document_path: String,
    target_path: String,
) -> Result<String, ApiError> {
    let document = PathBuf::from(document_path);
    validate_markdown_path(&document)?;
    let relative = PathBuf::from(&target_path);
    let first_segment = target_path.split(['/', '\\']).next().unwrap_or_default();
    if target_path.is_empty()
        || target_path.contains('\0')
        || relative.is_absolute()
        || first_segment.contains(':')
    {
        return Err(ApiError::invalid(
            "Only relative Markdown links are supported",
        ));
    }
    validate_markdown_path(&relative)?;

    let root = document
        .parent()
        .ok_or_else(|| ApiError::invalid("The Markdown path has no parent directory"))?
        .canonicalize()
        .map_err(|error| ApiError::io("Cannot resolve the document directory", error))?;
    let candidate = root
        .join(relative)
        .canonicalize()
        .map_err(|error| ApiError::io("Cannot resolve the Markdown link", error))?;
    if !candidate.starts_with(&root) {
        return Err(ApiError::invalid(
            "The Markdown link is outside the document directory",
        ));
    }
    let metadata = fs::metadata(&candidate)
        .map_err(|error| ApiError::io("Cannot read the Markdown link", error))?;
    if !metadata.is_file() {
        return Err(ApiError::invalid("The Markdown link is not a file"));
    }
    Ok(candidate.to_string_lossy().into_owned())
}

fn write_atomically(
    path: &Path,
    bytes: &[u8],
    expected_hash: Option<&str>,
) -> Result<FileFingerprint, ApiError> {
    let parent = path
        .parent()
        .ok_or_else(|| ApiError::invalid("The Markdown path has no parent directory"))?;
    fs::create_dir_all(parent)
        .map_err(|error| ApiError::io("Cannot create the target directory", error))?;

    let original_permissions = fs::metadata(path)
        .ok()
        .map(|metadata| metadata.permissions());
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| ApiError::io("Cannot create a temporary Markdown file", error))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|error| ApiError::io("Cannot write the temporary Markdown file", error))?;

    if let Some(permissions) = original_permissions {
        temporary
            .as_file()
            .set_permissions(permissions)
            .map_err(|error| ApiError::io("Cannot preserve Markdown file permissions", error))?;
    }

    if let Some(expected_hash) = expected_hash {
        let current = read_bytes(path)?;
        if hash_bytes(&current) != expected_hash {
            return Err(ApiError {
                code: "file_conflict",
                message: "The Markdown file changed before replacement".to_string(),
            });
        }
    }

    temporary
        .persist(path)
        .map_err(|error| ApiError::io("Cannot replace the Markdown file", error.error))?;

    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
    current_fingerprint(path)
}

#[tauri::command]
pub fn write_export_document(request: ExportDocumentRequest) -> Result<String, ApiError> {
    let path = PathBuf::from(request.file_path);
    validate_export_path(&path, &request.format)?;
    write_atomically(&path, request.content.as_bytes(), None)?;
    Ok(path
        .canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub fn save_document(app: AppHandle, request: SaveDocumentRequest) -> SaveDocumentResult {
    let path = PathBuf::from(&request.file_path);
    if let Err(error) = validate_markdown_path(&path) {
        return SaveDocumentResult::Error {
            revision: request.revision,
            code: error.code.to_string(),
            message: error.message,
        };
    }

    let current = if path.exists() {
        match current_fingerprint(&path) {
            Ok(value) => Some(value),
            Err(error) => {
                return SaveDocumentResult::Error {
                    revision: request.revision,
                    code: error.code.to_string(),
                    message: error.message,
                };
            }
        }
    } else {
        None
    };

    if current.is_none() && request.mode == SaveMode::Normal && request.base_sha256 != "new" {
        return SaveDocumentResult::Missing {
            revision: request.revision,
        };
    }

    if let Some(current) = &current {
        if request.mode == SaveMode::Normal && current.sha256 != request.base_sha256 {
            return SaveDocumentResult::Conflict {
                revision: request.revision,
                disk: current.clone(),
            };
        }
        if !is_writable(&path) {
            return SaveDocumentResult::Readonly {
                revision: request.revision,
                reason: "The Markdown file is not writable".to_string(),
            };
        }
    }

    let bytes = encode_document_bytes(&request.content, request.bom);

    let expected_hash = current.as_ref().map(|value| value.sha256.as_str());
    match write_atomically(&path, &bytes, expected_hash) {
        Ok(fingerprint) => {
            let _ = touch_recent(&app, &path);
            if let Some(draft_id) = request.draft_id {
                let _ = crate::storage::delete_draft(app, draft_id);
            }
            SaveDocumentResult::Saved {
                revision: request.revision,
                file_path: path
                    .canonicalize()
                    .unwrap_or(path)
                    .to_string_lossy()
                    .into_owned(),
                fingerprint,
            }
        }
        Err(error) if error.code == "file_conflict" => {
            let disk = current_fingerprint(&path).unwrap_or_else(|_| FileFingerprint {
                sha256: String::new(),
                size: 0,
                mtime_ms: 0,
            });
            SaveDocumentResult::Conflict {
                revision: request.revision,
                disk,
            }
        }
        Err(error) => SaveDocumentResult::Error {
            revision: request.revision,
            code: error.code.to_string(),
            message: error.message,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_bom_and_line_endings_without_normalizing_text() {
        assert_eq!(preferred_eol("a\r\nb\r\n"), "crlf");
        assert_eq!(preferred_eol("a\nb\n"), "lf");
        assert_eq!(preferred_eol("a\r\nb\n"), "lf");
        assert_eq!(
            encode_document_bytes("正文\r\n", false),
            "正文\r\n".as_bytes()
        );
        assert_eq!(
            encode_document_bytes("正文\r\n", true),
            [vec![0xef, 0xbb, 0xbf], "正文\r\n".as_bytes().to_vec()].concat()
        );
    }

    #[test]
    fn accepts_only_mvp_markdown_extensions() {
        assert!(validate_markdown_path(Path::new("note.md")).is_ok());
        assert!(validate_markdown_path(Path::new("note.MARKDOWN")).is_ok());
        assert!(validate_markdown_path(Path::new("note.txt")).is_err());
    }

    #[test]
    fn validates_export_extensions_by_format() {
        assert!(validate_export_path(Path::new("note.html"), &ExportFormat::Html).is_ok());
        assert!(validate_export_path(Path::new("note.HTM"), &ExportFormat::Html).is_ok());
        assert!(validate_export_path(Path::new("note.md"), &ExportFormat::Html).is_err());
    }

    #[test]
    fn writes_html_exports_atomically() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("note.html");
        let result = write_export_document(ExportDocumentRequest {
            file_path: path.to_string_lossy().into_owned(),
            format: ExportFormat::Html,
            content: "<!doctype html><title>Note</title>".to_string(),
        })
        .expect("write export");
        assert_eq!(
            fs::read_to_string(&path).expect("read export"),
            "<!doctype html><title>Note</title>"
        );
        assert_eq!(
            PathBuf::from(result),
            path.canonicalize().expect("canonical export")
        );
    }

    #[test]
    fn recognizes_only_supported_image_formats() {
        assert_eq!(image_mime_type(Path::new("cover.PNG")), Some("image/png"));
        assert_eq!(
            image_mime_type(Path::new("diagram.svg")),
            Some("image/svg+xml")
        );
        assert_eq!(image_mime_type(Path::new("payload.html")), None);
    }

    #[test]
    fn imports_images_into_a_relative_assets_directory_without_overwriting() {
        let directory = tempfile::tempdir().expect("tempdir");
        let document = directory.path().join("note.md");
        let first = directory.path().join("cover.png");
        let second_directory = directory.path().join("other");
        fs::create_dir(&second_directory).expect("create second directory");
        let second = second_directory.join("cover.png");
        fs::write(&document, b"# Note").expect("write document");
        fs::write(&first, [0x89, b'P', b'N', b'G']).expect("write first image");
        fs::write(&second, [0x89, b'P', b'N', b'2']).expect("write second image");

        let first_relative = import_document_image(
            document.to_string_lossy().into_owned(),
            first.to_string_lossy().into_owned(),
        )
        .expect("import first image");
        let duplicate_relative = import_document_image(
            document.to_string_lossy().into_owned(),
            first.to_string_lossy().into_owned(),
        )
        .expect("reuse duplicate image");
        let second_relative = import_document_image(
            document.to_string_lossy().into_owned(),
            second.to_string_lossy().into_owned(),
        )
        .expect("import second image");

        assert_eq!(first_relative, "assets/cover.png");
        assert_eq!(duplicate_relative, first_relative);
        assert_eq!(second_relative, "assets/cover-2.png");
        assert_eq!(
            fs::read(directory.path().join(&first_relative)).unwrap(),
            [0x89, b'P', b'N', b'G']
        );
        assert_eq!(
            fs::read(directory.path().join(&second_relative)).unwrap(),
            [0x89, b'P', b'N', b'2']
        );
    }

    #[test]
    fn loads_only_relative_local_images() {
        let directory = tempfile::tempdir().expect("tempdir");
        let document_directory = directory.path().join("document");
        fs::create_dir(&document_directory).expect("create document directory");
        let document = document_directory.join("note.md");
        let image = document_directory.join("cover.png");
        let outside_image = directory.path().join("outside.png");
        fs::write(&document, b"![cover](cover.png)").expect("write document");
        fs::write(&image, [0x89, b'P', b'N', b'G']).expect("write image");
        fs::write(&outside_image, [0x89, b'P', b'N', b'G']).expect("write outside image");

        let loaded = read_local_image(
            document.to_string_lossy().into_owned(),
            "cover.png".to_string(),
        )
        .expect("load image");
        assert_eq!(loaded, "data:image/png;base64,iVBORw==");
        assert!(
            read_local_image(
                document.to_string_lossy().into_owned(),
                "https://example.com/cover.png".to_string(),
            )
            .is_err()
        );
        assert!(
            read_local_image(
                document.to_string_lossy().into_owned(),
                image.to_string_lossy().into_owned(),
            )
            .is_err()
        );
        assert!(
            read_local_image(
                document.to_string_lossy().into_owned(),
                "../outside.png".to_string(),
            )
            .is_err()
        );
        #[cfg(unix)]
        {
            let linked_image = document_directory.join("linked.png");
            std::os::unix::fs::symlink(&outside_image, &linked_image)
                .expect("create image symlink");
            assert!(
                read_local_image(
                    document.to_string_lossy().into_owned(),
                    "linked.png".to_string(),
                )
                .is_err()
            );
        }
        assert!(
            read_local_image(
                document.to_string_lossy().into_owned(),
                "missing.png".to_string(),
            )
            .is_err()
        );
        let unsupported = document_directory.join("payload.html");
        fs::write(&unsupported, b"not an image").expect("write unsupported image");
        assert!(
            read_local_image(
                document.to_string_lossy().into_owned(),
                "payload.html".to_string(),
            )
            .is_err()
        );
        assert!(
            read_local_image(
                document.to_string_lossy().into_owned(),
                "bad\0name.png".to_string(),
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_local_images_larger_than_the_limit_without_reading_them() {
        let directory = tempfile::tempdir().expect("tempdir");
        let document = directory.path().join("note.md");
        let image = directory.path().join("large.png");
        fs::write(&document, b"").expect("write document");
        File::create(&image)
            .and_then(|file| file.set_len(MAX_LOCAL_IMAGE_BYTES + 1))
            .expect("create sparse image");
        assert!(
            read_local_image(
                document.to_string_lossy().into_owned(),
                "large.png".to_string(),
            )
            .is_err()
        );
    }

    #[test]
    fn resolves_only_markdown_links_inside_the_document_directory() {
        let parent = tempfile::tempdir().expect("parent tempdir");
        let root = parent.path().join("notes");
        fs::create_dir_all(root.join("nested")).expect("create notes");
        let document = root.join("current.md");
        let target = root.join("nested").join("target.markdown");
        let outside = parent.path().join("outside.md");
        fs::write(&document, b"[target](nested/target.markdown)").expect("write document");
        fs::write(&target, b"# Target").expect("write target");
        fs::write(&outside, b"# Outside").expect("write outside");

        let resolved = resolve_markdown_link(
            document.to_string_lossy().into_owned(),
            "nested/target.markdown".to_string(),
        )
        .expect("resolve target");
        assert_eq!(
            PathBuf::from(resolved),
            target.canonicalize().expect("canonical target")
        );
        assert!(
            resolve_markdown_link(
                document.to_string_lossy().into_owned(),
                "../outside.md".to_string(),
            )
            .is_err()
        );
        assert!(
            resolve_markdown_link(
                document.to_string_lossy().into_owned(),
                "nested/target.txt".to_string(),
            )
            .is_err()
        );
    }

    #[test]
    fn inspect_reports_current_changed_and_missing_files() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("note.md");
        fs::write(&path, b"before").expect("seed");
        let path_string = path.to_string_lossy().into_owned();
        let base = hash_bytes(b"before");

        assert!(matches!(
            inspect_document(path_string.clone(), base.clone()),
            InspectDocumentResult::Current { .. }
        ));
        fs::write(&path, b"after").expect("external edit");
        assert!(matches!(
            inspect_document(path_string.clone(), base),
            InspectDocumentResult::Changed { .. }
        ));
        fs::remove_file(&path).expect("remove");
        assert!(matches!(
            inspect_document(path_string, String::new()),
            InspectDocumentResult::Missing
        ));
    }

    #[test]
    fn serializes_save_results_with_the_frontend_contract() {
        let result = SaveDocumentResult::Saved {
            revision: 3,
            file_path: "/tmp/note.md".to_string(),
            fingerprint: FileFingerprint {
                sha256: "hash".to_string(),
                size: 4,
                mtime_ms: 5,
            },
        };
        let json = serde_json::to_value(result).expect("serialize save result");
        assert_eq!(json["status"], "saved");
        assert_eq!(json["filePath"], "/tmp/note.md");
        assert_eq!(json["fingerprint"]["mtimeMs"], 5);
        assert!(json.get("file_path").is_none());
    }

    #[test]
    fn atomic_write_detects_a_stale_baseline() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("note.md");
        fs::write(&path, b"before").expect("seed");
        let result = write_atomically(&path, b"after", Some("stale"));
        assert!(result.is_err());
        assert_eq!(fs::read(&path).expect("read"), b"before");
    }

    #[test]
    fn atomic_write_replaces_content() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("note.md");
        fs::write(&path, b"before").expect("seed");
        let base = hash_bytes(b"before");
        let saved = write_atomically(&path, b"after", Some(&base)).expect("save");
        assert_eq!(saved.sha256, hash_bytes(b"after"));
        assert_eq!(fs::read(&path).expect("read"), b"after");
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_preserves_existing_file_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("note.md");
        fs::write(&path, b"before").expect("seed");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).expect("set permissions");
        let base = hash_bytes(b"before");

        write_atomically(&path, b"after", Some(&base)).expect("save");
        let mode = fs::metadata(&path).expect("metadata").permissions().mode() & 0o777;
        assert_eq!(mode, 0o640);
    }
}
