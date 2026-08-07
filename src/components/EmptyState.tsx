import { FilePlus2, FileText, FileWarning, FolderOpen, RotateCcw } from "lucide-react";

import type { RecentFile, RecoveryDraft } from "../bridge/contracts";

type Props = {
  recentFiles: RecentFile[];
  drafts: RecoveryDraft[];
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (file: RecentFile) => void;
  onRemoveRecent: (path: string) => void;
  onRecoverDraft: (draft: RecoveryDraft) => void;
};

function relativeDate(value: number): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "今天";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

export function EmptyState({
  recentFiles,
  drafts,
  onNew,
  onOpen,
  onOpenRecent,
  onRemoveRecent,
  onRecoverDraft
}: Props) {
  return (
    <main className="empty-state">
      <h1>Nolia Lite</h1>
      <div className="empty-actions">
        <button type="button" onClick={onNew}>
          <FilePlus2 size={18} />
          新建文档
        </button>
        <button type="button" onClick={onOpen}>
          <FolderOpen size={18} />
          打开文件
        </button>
      </div>
      {drafts.length || recentFiles.length ? (
        <section className="recent-section" aria-label="最近文件">
          <h2>{drafts.length ? "恢复与最近文件" : "最近文件"}</h2>
          <div className="recent-list">
            {drafts.map((draft) => (
              <button type="button" key={draft.draftId} onClick={() => onRecoverDraft(draft)}>
                <RotateCcw size={16} aria-hidden="true" />
                <span>{draft.displayName || "未保存的草稿"}</span>
                <time>{relativeDate(draft.updatedAt)}</time>
              </button>
            ))}
            {recentFiles.map((file) => (
              <button
                type="button"
                key={file.filePath}
                className={file.available ? undefined : "is-missing"}
                onClick={() => onOpenRecent(file)}
                onKeyDown={(event) => {
                  if (event.key !== "Delete" && event.key !== "Backspace") return;
                  event.preventDefault();
                  onRemoveRecent(file.filePath);
                }}
                title={file.filePath}
              >
                {file.available ? <FileText size={16} aria-hidden="true" /> : <FileWarning size={16} aria-hidden="true" />}
                <span>{file.displayName}</span>
                <time>{relativeDate(file.openedAt)}</time>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
