mod document;
mod error;
mod pdf_export;
mod storage;

use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{
    Emitter, Manager, PhysicalPosition, WebviewWindow, WebviewWindowBuilder,
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
};

struct WindowRegistry {
    pending_paths: Mutex<HashMap<String, Vec<String>>>,
    ready: Mutex<HashSet<String>>,
    documents: Mutex<HashMap<String, String>>,
    next_label: AtomicU64,
}

#[derive(Default)]
struct DocumentWatchState(Mutex<HashMap<String, RecommendedWatcher>>);

struct QuitRequest {
    id: u64,
    remaining: VecDeque<String>,
}

#[derive(Default)]
struct ExitState {
    forced: AtomicBool,
    next_request: AtomicU64,
    request: Mutex<Option<QuitRequest>>,
}

impl WindowRegistry {
    fn new(paths: Vec<String>) -> Self {
        let mut pending_paths = HashMap::new();
        if !paths.is_empty() {
            pending_paths.insert("main".to_string(), paths);
        }
        Self {
            pending_paths: Mutex::new(pending_paths),
            ready: Mutex::new(HashSet::new()),
            documents: Mutex::new(HashMap::new()),
            next_label: AtomicU64::new(1),
        }
    }

    fn queue(&self, label: &str, paths: Vec<String>) {
        self.pending_paths
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .entry(label.to_string())
            .or_default()
            .extend(paths);
    }

    fn mark_ready_and_take(&self, label: &str) -> Vec<String> {
        self.ready
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(label.to_string());
        self.pending_paths
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(label)
            .unwrap_or_default()
    }

    fn is_ready(&self, label: &str) -> bool {
        self.ready
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains(label)
    }

    fn set_document(&self, label: &str, file_path: Option<String>) {
        let mut documents = self
            .documents
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(file_path) = file_path {
            documents.insert(label.to_string(), normalize_path(&file_path));
        } else {
            documents.remove(label);
        }
    }

    fn window_for_path(&self, file_path: &str) -> Option<String> {
        let normalized = normalize_path(file_path);
        self.documents
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .find_map(|(label, path)| (path == &normalized).then(|| label.clone()))
    }

    fn remove(&self, label: &str) {
        self.pending_paths
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(label);
        self.ready
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(label);
        self.documents
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(label);
    }
}

fn normalize_path(file_path: &str) -> String {
    let path = PathBuf::from(file_path);
    path.canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

fn markdown_paths(paths: impl IntoIterator<Item = String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|path| {
            let lower = path.to_ascii_lowercase();
            lower.ends_with(".md") || lower.ends_with(".markdown")
        })
        .collect()
}

fn focused_window(app: &tauri::AppHandle) -> Option<WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| app.get_webview_window("main"))
        .or_else(|| app.webview_windows().into_values().next())
}

fn focus_window(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn dispatch_open_paths(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let Some(window) = focused_window(app) else {
        return;
    };
    let label = window.label().to_string();
    let registry = app.state::<WindowRegistry>();
    registry.queue(&label, paths.clone());
    focus_window(&window);
    if registry.is_ready(&label) {
        let _ = window.emit("open-document-paths", paths);
    }
}

#[tauri::command]
fn take_pending_open_paths(
    window: WebviewWindow,
    state: tauri::State<'_, WindowRegistry>,
) -> Vec<String> {
    state.mark_ready_and_take(window.label())
}

fn create_window(
    app: &tauri::AppHandle,
    registry: &WindowRegistry,
    file_path: Option<String>,
) -> Result<(), String> {
    if let Some(path) = file_path.as_deref()
        && let Some(label) = registry.window_for_path(path)
        && let Some(window) = app.get_webview_window(&label)
    {
        focus_window(&window);
        return Ok(());
    }

    let sequence = registry.next_label.fetch_add(1, Ordering::SeqCst);
    let label = format!("document-{sequence}");
    if let Some(path) = file_path.clone() {
        registry.queue(&label, vec![path.clone()]);
        registry.set_document(&label, Some(path));
    }

    let anchor_position = focused_window(app).and_then(|window| window.outer_position().ok());
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "missing main window configuration".to_string())?;
    config.label = label.clone();
    config.visible = false;
    let window =
        match WebviewWindowBuilder::from_config(app, &config).and_then(|builder| builder.build()) {
            Ok(window) => window,
            Err(error) => {
                registry.remove(&label);
                return Err(error.to_string());
            }
        };
    if let Some(position) = anchor_position {
        let offset = 28 * i32::try_from((sequence - 1) % 8 + 1).unwrap_or(1);
        let _ = window.set_position(PhysicalPosition::new(
            position.x + offset,
            position.y + offset,
        ));
    } else {
        let _ = window.center();
    }
    focus_window(&window);
    Ok(())
}

#[tauri::command]
async fn open_document_windows(
    app: tauri::AppHandle,
    state: tauri::State<'_, WindowRegistry>,
    paths: Vec<String>,
) -> Result<(), String> {
    let markdown = markdown_paths(paths.clone());
    if markdown.len() != paths.len() {
        return Err("Only .md and .markdown files can be opened".to_string());
    }
    for path in markdown {
        create_window(&app, &state, Some(path))?;
    }
    Ok(())
}

#[tauri::command]
async fn create_document_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, WindowRegistry>,
) -> Result<(), String> {
    create_window(&app, &state, None)
}

#[tauri::command]
fn set_window_document(
    window: WebviewWindow,
    state: tauri::State<'_, WindowRegistry>,
    file_path: Option<String>,
) {
    state.set_document(window.label(), file_path);
}

#[tauri::command]
fn watch_document(
    window: WebviewWindow,
    state: tauri::State<'_, DocumentWatchState>,
    file_path: String,
) -> Result<(), String> {
    let target = std::path::PathBuf::from(file_path)
        .canonicalize()
        .map_err(|error| format!("Cannot watch the Markdown file: {error}"))?;
    let parent = target
        .parent()
        .ok_or_else(|| "The Markdown path has no parent directory".to_string())?
        .to_path_buf();
    let emitted_path = target.to_string_lossy().into_owned();
    let event_window = window.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        if matches!(event.kind, EventKind::Access(_))
            || !event.paths.iter().any(|path| path == &target)
        {
            return;
        }
        let _ = event_window.emit("document-file-event", &emitted_path);
    })
    .map_err(|error| format!("Cannot create the Markdown file watcher: {error}"))?;
    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|error| format!("Cannot watch the Markdown directory: {error}"))?;
    state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(window.label().to_string(), watcher);
    Ok(())
}

#[tauri::command]
fn stop_document_watch(window: WebviewWindow, state: tauri::State<'_, DocumentWatchState>) {
    state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(window.label());
}

fn begin_quit(app: &tauri::AppHandle) {
    let state = app.state::<ExitState>();
    if state.forced.load(Ordering::SeqCst) {
        return;
    }
    let mut request = state
        .request
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if request.is_some() {
        return;
    }

    let focused = focused_window(app).map(|window| window.label().to_string());
    let registry = app.state::<WindowRegistry>();
    let mut labels = app
        .webview_windows()
        .into_keys()
        .filter(|label| registry.is_ready(label))
        .collect::<Vec<_>>();
    labels.sort();
    if let Some(focused) = focused
        && let Some(index) = labels.iter().position(|label| label == &focused)
    {
        labels.swap(0, index);
    }
    if labels.is_empty() {
        state.forced.store(true, Ordering::SeqCst);
        app.exit(0);
        return;
    }

    let id = state.next_request.fetch_add(1, Ordering::SeqCst) + 1;
    let next = labels.first().cloned();
    *request = Some(QuitRequest {
        id,
        remaining: labels.into(),
    });
    drop(request);
    if let Some(label) = next
        && let Some(window) = app.get_webview_window(&label)
    {
        focus_window(&window);
        let _ = window.emit("quit-requested", id);
    }
}

#[tauri::command]
fn answer_quit_request(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, ExitState>,
    request_id: u64,
    allowed: bool,
) {
    let mut request = state
        .request
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(current) = request.as_mut() else {
        return;
    };
    if current.id != request_id
        || current.remaining.front().map(String::as_str) != Some(window.label())
    {
        return;
    }
    if !allowed {
        *request = None;
        return;
    }

    current.remaining.pop_front();
    drop(request);
    if app.webview_windows().len() > 1 {
        let _ = window.destroy();
    }
    continue_quit(&app, request_id);
}

fn continue_quit(app: &tauri::AppHandle, request_id: u64) {
    loop {
        let state = app.state::<ExitState>();
        let next = {
            let mut request = state
                .request
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(current) = request.as_mut() else {
                return;
            };
            if current.id != request_id {
                return;
            }
            match current.remaining.front().cloned() {
                Some(label) => Some(label),
                None => {
                    *request = None;
                    None
                }
            }
        };
        let Some(label) = next else {
            state.forced.store(true, Ordering::SeqCst);
            app.exit(0);
            return;
        };
        if let Some(next_window) = app.get_webview_window(&label) {
            focus_window(&next_window);
            let _ = next_window.emit("quit-requested", request_id);
            return;
        }
        let mut request = state
            .request
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(current) = request.as_mut()
            && current.id == request_id
            && current.remaining.front() == Some(&label)
        {
            current.remaining.pop_front();
        }
    }
}

#[tauri::command]
fn close_current_window(
    app: tauri::AppHandle,
    window: WebviewWindow,
    registry: tauri::State<'_, WindowRegistry>,
    watchers: tauri::State<'_, DocumentWatchState>,
    exit: tauri::State<'_, ExitState>,
) -> Result<(), String> {
    let label = window.label().to_string();
    registry.remove(&label);
    watchers
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&label);
    if app.webview_windows().len() <= 1 {
        exit.forced.store(true, Ordering::SeqCst);
        app.exit(0);
        return Ok(());
    }
    window.destroy().map_err(|error| error.to_string())
}

fn application_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = AboutMetadata {
        name: Some("Nolia Lite".to_string()),
        version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        "Nolia Lite",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("关于 Nolia Lite"), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("服务"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("隐藏 Nolia Lite"))?,
            &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "app.quit",
                "退出 Nolia Lite",
                true,
                Some("CmdOrCtrl+Q"),
            )?,
        ],
    )?;
    let file_menu = Submenu::with_items(
        app,
        "文件",
        true,
        &[
            &MenuItem::with_id(app, "file.new", "新建", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "file.open", "打开…", true, Some("CmdOrCtrl+O"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "file.save", "保存", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(
                app,
                "file.save_as",
                "另存为…",
                true,
                Some("CmdOrCtrl+Shift+S"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &Submenu::with_items(
                app,
                "导出",
                true,
                &[
                    &MenuItem::with_id(
                        app,
                        "file.export_html",
                        "HTML…",
                        true,
                        Some("CmdOrCtrl+Shift+E"),
                    )?,
                    &MenuItem::with_id(app, "file.export_pdf", "PDF…", true, None::<&str>)?,
                ],
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("拷贝"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "edit.find", "查找…", true, Some("CmdOrCtrl+F"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "format.bold", "粗体", true, Some("CmdOrCtrl+B"))?,
            &MenuItem::with_id(app, "format.italic", "斜体", true, Some("CmdOrCtrl+I"))?,
            &MenuItem::with_id(app, "format.link", "链接…", true, Some("CmdOrCtrl+K"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "format.table", "插入表格…", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "format.mermaid",
                "插入 Mermaid 图表",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, "format.math", "插入公式", true, None::<&str>)?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        app,
        "显示",
        true,
        &[&PredefinedMenuItem::fullscreen(app, Some("进入全屏幕"))?],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("最小化"))?,
            &PredefinedMenuItem::maximize(app, Some("缩放"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::bring_all_to_front(app, Some("前置全部窗口"))?,
        ],
    )?;
    Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
    )
}

pub fn run() {
    let initial_paths = markdown_paths(std::env::args().skip(1));
    let app = tauri::Builder::default()
        .manage(WindowRegistry::new(initial_paths))
        .manage(DocumentWatchState::default())
        .manage(ExitState::default())
        .menu(application_menu)
        .on_window_event(|window, event| {
            let label = window.label().to_string();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let exit = window.state::<ExitState>();
                    if exit.forced.load(Ordering::SeqCst) {
                        return;
                    }
                    let registry = window.state::<WindowRegistry>();
                    if registry.is_ready(&label) {
                        api.prevent_close();
                        let _ = window.emit("close-requested", ());
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    window.state::<WindowRegistry>().remove(&label);
                    window
                        .state::<DocumentWatchState>()
                        .0
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .remove(&label);
                }
                _ => {}
            }
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "app.quit" {
                begin_quit(app);
            } else if id.starts_with("file.")
                || id.starts_with("edit.")
                || id.starts_with("format.")
            {
                if let Some(window) = focused_window(app) {
                    let _ = window.emit("menu-command", id);
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(
            |app, arguments, _cwd| {
                dispatch_open_paths(app, markdown_paths(arguments));
            },
        ))
        .invoke_handler(tauri::generate_handler![
            document::read_document,
            document::read_local_image,
            document::resolve_markdown_link,
            document::inspect_document,
            document::save_document,
            document::write_export_document,
            pdf_export::export_pdf,
            storage::write_draft,
            storage::delete_draft,
            storage::list_drafts,
            storage::list_recent_files,
            storage::remove_recent_file,
            take_pending_open_paths,
            open_document_windows,
            create_document_window,
            set_window_document,
            watch_document,
            stop_document_watch,
            close_current_window,
            answer_quit_request,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Nolia Lite");

    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested { api, .. } => {
            let exit = app.state::<ExitState>();
            if exit.forced.load(Ordering::SeqCst) || app.webview_windows().is_empty() {
                return;
            }
            api.prevent_exit();
            begin_quit(app);
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|path| path.to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            dispatch_open_paths(app, markdown_paths(paths));
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_markdown_paths_from_system_open_events() {
        let paths = markdown_paths([
            "/tmp/note.md".to_string(),
            "/tmp/README.MARKDOWN".to_string(),
            "/tmp/image.png".to_string(),
            "--flag".to_string(),
        ]);
        assert_eq!(paths, ["/tmp/note.md", "/tmp/README.MARKDOWN"]);
    }

    #[test]
    fn pending_open_paths_preserve_startup_and_later_finder_events() {
        let pending = WindowRegistry::new(vec!["/tmp/startup.md".to_string()]);
        pending.queue("main", vec!["/tmp/later.markdown".to_string()]);
        assert_eq!(
            pending.mark_ready_and_take("main"),
            ["/tmp/startup.md", "/tmp/later.markdown"]
        );
        assert!(pending.mark_ready_and_take("main").is_empty());
        assert!(pending.is_ready("main"));
    }

    #[test]
    fn window_registry_tracks_documents_independently() {
        let registry = WindowRegistry::new(Vec::new());
        registry.set_document("main", Some("/tmp/one.md".to_string()));
        registry.set_document("document-1", Some("/tmp/two.md".to_string()));
        assert_eq!(
            registry.window_for_path("/tmp/one.md").as_deref(),
            Some("main")
        );
        assert_eq!(
            registry.window_for_path("/tmp/two.md").as_deref(),
            Some("document-1")
        );
        registry.remove("main");
        assert!(registry.window_for_path("/tmp/one.md").is_none());
    }
}
