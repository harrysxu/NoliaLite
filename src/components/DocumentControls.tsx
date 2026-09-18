import { Eye, Pencil, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

type Props = {
  preview: boolean;
  zoom: number;
  onTogglePreview: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetZoom: () => void;
};

export function DocumentControls({
  preview,
  zoom,
  onTogglePreview,
  onZoomOut,
  onZoomIn,
  onResetZoom
}: Props) {
  return (
    <div className="document-controls" role="toolbar" aria-label="文档显示设置">
      <button
        type="button"
        className={preview ? "is-active" : undefined}
        aria-pressed={preview}
        aria-label={preview ? "退出预览" : "预览文档"}
        title={preview ? "退出预览" : "预览文档"}
        onClick={onTogglePreview}
      >
        {preview ? <Pencil size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
      <span className="document-controls-divider" aria-hidden="true" />
      <button
        type="button"
        aria-label="缩小文档"
        title="缩小文档"
        disabled={zoom <= 0.5}
        onClick={onZoomOut}
      >
        <ZoomOut size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="document-zoom-value"
        aria-label="重置文档缩放"
        title="重置文档缩放"
        disabled={zoom === 1}
        onClick={onResetZoom}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label="放大文档"
        title="放大文档"
        disabled={zoom >= 3}
        onClick={onZoomIn}
      >
        <ZoomIn size={16} aria-hidden="true" />
      </button>
      {zoom !== 1 ? (
        <button
          type="button"
          aria-label="恢复文档缩放"
          title="恢复文档缩放"
          onClick={onResetZoom}
        >
          <RotateCcw size={15} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
