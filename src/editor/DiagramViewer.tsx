import { Download, Pencil, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type DiagramViewerContent = {
  svg: string;
  markdown: string;
  name?: string;
  initialScale?: number;
  onEdit?: () => void;
};

type Props = {
  content: DiagramViewerContent;
  onClose: () => void;
};

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

export function DiagramViewer({ content, onClose }: Props) {
  const [scale, setScale] = useState(() => clampScale(content.initialScale ?? 1));
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const aspectRatio = useMemo(() => svgAspectRatio(content.svg), [content.svg]);

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setScale((value) => clampScale(value + SCALE_STEP));
      } else if (event.key === "-") {
        event.preventDefault();
        setScale((value) => clampScale(value - SCALE_STEP));
      } else if (content.onEdit && isEditShortcut(event)) {
        event.preventDefault();
        onClose();
        content.onEdit();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [content, onClose]);

  const downloadPng = async () => {
    setDownloading(true);
    setDownloadError(false);
    try {
      await downloadDiagramPng(content.svg, pngFileName(content.name));
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  };

  return createPortal(
    <div
      className="diagram-viewer-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagram-viewer-title"
      aria-keyshortcuts="Escape F2 E Control+Enter Meta+Enter"
    >
      <button type="button" className="diagram-viewer-backdrop" aria-label="关闭图表查看器" onClick={onClose} />
      <section className="diagram-viewer-surface">
        <header className="diagram-viewer-header">
          <strong id="diagram-viewer-title">图表预览</strong>
          <div className="diagram-viewer-toolbar" role="toolbar" aria-label="图表操作">
            <ViewerButton label="缩小图表" disabled={scale <= MIN_SCALE} onClick={() => setScale((value) => clampScale(value - SCALE_STEP))}>
              <ZoomOut size={17} />
            </ViewerButton>
            <span className="diagram-viewer-scale" aria-live="polite">{Math.round(scale * 100)}%</span>
            <ViewerButton label="恢复图表比例" disabled={scale === 1} onClick={() => setScale(1)}>
              <RotateCcw size={17} />
            </ViewerButton>
            <ViewerButton label="放大图表" disabled={scale >= MAX_SCALE} onClick={() => setScale((value) => clampScale(value + SCALE_STEP))}>
              <ZoomIn size={17} />
            </ViewerButton>
            <span className="diagram-viewer-divider" aria-hidden="true" />
            <ViewerButton label="下载 PNG 图片" disabled={downloading} onClick={() => void downloadPng()}>
              <Download size={17} />
            </ViewerButton>
            <ViewerButton label="编辑图表源码" onClick={() => {
              onClose();
              content.onEdit?.();
            }}>
              <Pencil size={17} />
            </ViewerButton>
            <button
              ref={closeButtonRef}
              type="button"
              className="diagram-viewer-button"
              title="关闭图表查看器"
              aria-label="关闭图表查看器"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>
        {downloadError ? <div className="diagram-viewer-error" role="status">图表下载失败，请重试。</div> : null}
        <div className="diagram-viewer-viewport">
          <div className="diagram-viewer-canvas" style={{ width: `${scale * 100}%` }}>
            <div
              className="diagram-viewer-diagram"
              style={{ aspectRatio }}
              dangerouslySetInnerHTML={{ __html: content.svg }}
            />
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function ViewerButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="diagram-viewer-button" title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function isEditShortcut(event: KeyboardEvent): boolean {
  return event.key === "F2"
    || (event.key.toLowerCase() === "e" && !event.metaKey && !event.ctrlKey && !event.altKey)
    || ((event.metaKey || event.ctrlKey) && event.key === "Enter");
}

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function pngFileName(name: string | undefined): string {
  const normalized = (name ?? "nolia-lite-diagram")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim();
  return `${normalized || "nolia-lite-diagram"}.png`;
}

export async function downloadDiagramPng(svgMarkup: string, fileName: string): Promise<void> {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(svgMarkup, "image/svg+xml");
  const svg = documentNode.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg" || documentNode.querySelector("parsererror")) throw new Error("Invalid SVG");
  if (!svg.getAttribute("xmlns")) svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const dimensions = svgDimensions(svg);
  const outputScale = Math.min(2, 4096 / Math.max(dimensions.width, dimensions.height));
  const width = Math.max(1, Math.round(dimensions.width * outputScale));
  const height = Math.max(1, Math.round(dimensions.height * outputScale));
  const serialized = new XMLSerializer().serializeToString(svg);
  const sourceUrl = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await loadImage(sourceUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasBlob(canvas);
    triggerDownload(blob, fileName);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function svgDimensions(svg: Element): { width: number; height: number } {
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const viewBoxWidth = viewBox?.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2] : undefined;
  const viewBoxHeight = viewBox?.length === 4 && Number.isFinite(viewBox[3]) ? viewBox[3] : undefined;
  return {
    width: Math.max(1, Math.min(8192, numericSvgLength(svg.getAttribute("width")) ?? viewBoxWidth ?? 1600)),
    height: Math.max(1, Math.min(8192, numericSvgLength(svg.getAttribute("height")) ?? viewBoxHeight ?? 900))
  };
}

function numericSvgLength(value: string | null): number | undefined {
  if (!value || value.trim().endsWith("%")) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function svgAspectRatio(svgMarkup: string): number {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(svgMarkup, "image/svg+xml");
  const svg = documentNode.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg" || documentNode.querySelector("parsererror")) return 16 / 9;
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const viewBoxWidth = viewBox?.length === 4 && Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? viewBox[2] : undefined;
  const viewBoxHeight = viewBox?.length === 4 && Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? viewBox[3] : undefined;
  const dimensions = svgDimensions(svg);
  const ratio = viewBoxWidth && viewBoxHeight
    ? viewBoxWidth / viewBoxHeight
    : dimensions.width / dimensions.height;
  return Math.max(0.05, Math.min(20, ratio));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Diagram image load failed"));
    image.src = url;
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Diagram image export failed")), "image/png");
  });
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const _testing = { clampScale, pngFileName, svgAspectRatio, svgDimensions };
