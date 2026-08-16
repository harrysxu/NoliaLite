use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::mpsc,
    time::Duration,
};

use tauri::WebviewWindow;
use tempfile::{Builder as TempfileBuilder, NamedTempFile};

use crate::error::ApiError;

const PDF_SIGNATURE: &[u8; 5] = b"%PDF-";
const PDF_EXPORT_TIMEOUT: Duration = Duration::from_secs(60);

fn validate_pdf_path(path: &Path) -> Result<(), ApiError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("pdf") {
        return Err(ApiError::invalid("The PDF export path must end in .pdf"));
    }
    Ok(())
}

fn validate_pdf_capture_size(width: f64, height: f64) -> Result<(), ApiError> {
    if width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0 {
        Ok(())
    } else {
        Err(ApiError::invalid("The PDF capture size is invalid"))
    }
}

fn create_pdf_target(path: &Path) -> Result<NamedTempFile, ApiError> {
    let parent = path
        .parent()
        .ok_or_else(|| ApiError::invalid("The PDF export path has no parent directory"))?;
    fs::create_dir_all(parent)
        .map_err(|error| ApiError::io("Cannot create the PDF export directory", error))?;
    TempfileBuilder::new()
        .prefix(".nolia-lite-pdf-")
        .suffix(".pdf")
        .tempfile_in(parent)
        .map_err(|error| ApiError::io("Cannot create the temporary PDF file", error))
}

fn validate_pdf_file(file: &mut File) -> Result<(), ApiError> {
    file.sync_all()
        .map_err(|error| ApiError::io("Cannot flush the generated PDF", error))?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| ApiError::io("Cannot inspect the generated PDF", error))?;
    let mut signature = [0_u8; PDF_SIGNATURE.len()];
    file.read_exact(&mut signature)
        .map_err(|error| ApiError::io("The generated PDF is empty or incomplete", error))?;
    if &signature != PDF_SIGNATURE {
        return Err(ApiError {
            code: "pdf_export_failed",
            message: "The generated file is not a valid PDF".to_string(),
        });
    }
    Ok(())
}

fn finish_pdf_export(mut temporary: NamedTempFile, path: &Path) -> Result<String, ApiError> {
    validate_pdf_file(temporary.as_file_mut())?;
    temporary
        .persist(path)
        .map_err(|error| ApiError::io("Cannot replace the PDF export", error.error))?;
    if let Some(parent) = path.parent()
        && let Ok(directory) = File::open(parent)
    {
        let _ = directory.sync_all();
    }
    Ok(path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned())
}

async fn wait_for_native_export(
    receiver: mpsc::Receiver<Result<(), String>>,
) -> Result<(), ApiError> {
    let result =
        tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(PDF_EXPORT_TIMEOUT))
            .await
            .map_err(|error| ApiError::io("Cannot join the PDF export task", error))?
            .map_err(|error| ApiError {
                code: "pdf_export_failed",
                message: format!("PDF generation did not finish: {error}"),
            })?;
    result.map_err(|message| ApiError {
        code: "pdf_export_failed",
        message,
    })
}

#[tauri::command]
pub async fn export_pdf(
    window: WebviewWindow,
    file_path: String,
    capture_width: f64,
    capture_height: f64,
) -> Result<String, ApiError> {
    let path = PathBuf::from(file_path);
    validate_pdf_path(&path)?;
    validate_pdf_capture_size(capture_width, capture_height)?;
    let temporary = create_pdf_target(&path)?;
    let temporary_path = temporary.path().to_path_buf();
    let (sender, receiver) = mpsc::channel();

    window
        .with_webview(move |webview| {
            start_native_pdf_export(
                webview,
                temporary_path,
                capture_width,
                capture_height,
                sender,
            );
        })
        .map_err(|error| ApiError::io("Cannot access the document WebView", error))?;

    wait_for_native_export(receiver).await?;
    finish_pdf_export(temporary, &path)
}

#[cfg(target_os = "macos")]
fn start_native_pdf_export(
    webview: tauri::webview::PlatformWebview,
    path: PathBuf,
    capture_width: f64,
    capture_height: f64,
    sender: mpsc::Sender<Result<(), String>>,
) {
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSData, NSError, NSString};
    use objc2_web_kit::{WKPDFConfiguration, WKWebView};

    unsafe {
        let view: &WKWebView = &*webview.inner().cast();
        let configuration = WKPDFConfiguration::new(MainThreadMarker::from(view));
        configuration.setRect(CGRect::new(
            CGPoint::ZERO,
            CGSize::new(capture_width, capture_height),
        ));
        let output_path = NSString::from_str(path.to_string_lossy().as_ref());
        let completion = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
            let result = if !error.is_null() {
                Err(format!(
                    "WebKit PDF generation failed: {}",
                    (&*error).localizedDescription()
                ))
            } else if data.is_null() {
                Err("WebKit returned no PDF data".to_string())
            } else if (&*data).writeToFile_atomically(&output_path, false) {
                Ok(())
            } else {
                Err("WebKit could not write the generated PDF".to_string())
            };
            let _ = sender.send(result);
        });
        view.createPDFWithConfiguration_completionHandler(Some(&configuration), &completion);
    }
}

#[cfg(windows)]
fn start_native_pdf_export(
    webview: tauri::webview::PlatformWebview,
    path: PathBuf,
    _capture_width: f64,
    _capture_height: f64,
    sender: mpsc::Sender<Result<(), String>>,
) {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{ICoreWebView2_7, ICoreWebView2Environment6},
        PrintToPdfCompletedHandler,
    };
    use windows::core::{HSTRING, Interface};

    let result = (|| -> windows::core::Result<()> {
        let controller = webview.controller();
        let core = unsafe { controller.CoreWebView2()? };
        let core = core.cast::<ICoreWebView2_7>()?;
        let environment = webview.environment().cast::<ICoreWebView2Environment6>()?;
        let settings = unsafe { environment.CreatePrintSettings()? };
        unsafe {
            settings.SetShouldPrintBackgrounds(true)?;
            settings.SetShouldPrintHeaderAndFooter(false)?;
            settings.SetMarginTop(0.0)?;
            settings.SetMarginRight(0.0)?;
            settings.SetMarginBottom(0.0)?;
            settings.SetMarginLeft(0.0)?;
            settings.SetPageWidth(8.27)?;
            settings.SetPageHeight(11.69)?;
        }
        let output = HSTRING::from(path.to_string_lossy().as_ref());
        let callback_sender = sender.clone();
        let handler = PrintToPdfCompletedHandler::create(Box::new(move |error, success| {
            let result = if error.is_err() {
                Err(format!("WebView2 PDF generation failed: {error:?}"))
            } else if success {
                Ok(())
            } else {
                Err("WebView2 did not create the PDF".to_string())
            };
            let _ = callback_sender.send(result);
            Ok(())
        }));
        unsafe { core.PrintToPdf(&output, &settings, &handler)? };
        Ok(())
    })();
    if let Err(error) = result {
        let _ = sender.send(Err(format!(
            "Cannot start WebView2 PDF generation: {error}"
        )));
    }
}

#[cfg(target_os = "linux")]
fn start_native_pdf_export(
    webview: tauri::webview::PlatformWebview,
    path: PathBuf,
    _capture_width: f64,
    _capture_height: f64,
    sender: mpsc::Sender<Result<(), String>>,
) {
    use std::{cell::RefCell, rc::Rc};

    use gio::prelude::FileExt;
    use webkit2gtk::PrintOperationExt;

    let settings = gtk::PrintSettings::new();
    let output_uri = gio::File::for_path(path).uri();
    settings.set_printer("Print to File");
    settings.set(
        gtk::PRINT_SETTINGS_OUTPUT_URI.as_str(),
        Some(output_uri.as_str()),
    );
    settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT.as_str(), Some("pdf"));

    let operation = webkit2gtk::PrintOperation::new(&webview.inner());
    operation.set_print_settings(&settings);
    let sender = Rc::new(RefCell::new(Some(sender)));
    let failed_sender = Rc::clone(&sender);
    operation.connect_failed(move |_, error| {
        if let Some(sender) = failed_sender.borrow_mut().take() {
            let _ = sender.send(Err(format!("WebKitGTK PDF generation failed: {error}")));
        }
    });
    operation.connect_finished(move |_| {
        if let Some(sender) = sender.borrow_mut().take() {
            let _ = sender.send(Ok(()));
        }
    });
    operation.print();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_pdf_export_paths() {
        assert!(validate_pdf_path(Path::new("note.pdf")).is_ok());
        assert!(validate_pdf_path(Path::new("note.PDF")).is_ok());
        assert!(validate_pdf_path(Path::new("note.html")).is_err());
    }

    #[test]
    fn accepts_only_positive_finite_capture_sizes() {
        assert!(validate_pdf_capture_size(940.0, 2_400.0).is_ok());
        assert!(validate_pdf_capture_size(0.0, 2_400.0).is_err());
        assert!(validate_pdf_capture_size(940.0, f64::NAN).is_err());
    }

    #[test]
    fn rejects_empty_or_non_pdf_native_output() {
        let mut empty = tempfile::tempfile().expect("empty temp file");
        assert!(validate_pdf_file(&mut empty).is_err());

        let mut invalid = tempfile::tempfile().expect("invalid temp file");
        std::io::Write::write_all(&mut invalid, b"not a pdf").expect("write invalid data");
        assert!(validate_pdf_file(&mut invalid).is_err());
    }

    #[test]
    fn accepts_a_pdf_signature() {
        let mut output = tempfile::tempfile().expect("pdf temp file");
        std::io::Write::write_all(&mut output, b"%PDF-1.7\n%%EOF\n").expect("write PDF data");
        assert!(validate_pdf_file(&mut output).is_ok());
    }
}
