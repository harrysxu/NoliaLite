import { FilePlus2, FileText, FileWarning, FolderOpen, RotateCcw, Trash2, X } from "lucide-react";

import type { RecentFile, RecoveryDraft } from "../bridge/contracts";

type Props = {
  recentFiles: RecentFile[];
  drafts: RecoveryDraft[];
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (file: RecentFile) => void;
  onRemoveRecent: (path: string) => void;
  onClearRecent: () => void;
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

export function HistorySidebar({
  recentFiles,
  drafts,
  onNew,
  onOpen,
  onOpenRecent,
  onRemoveRecent,
  onClearRecent,
  onRecoverDraft
}: Props) {
  return (
    <main className="history-view">
      <aside className="history-sidebar" aria-label="文件历史">
        <header className="history-header">
          <h1>历史</h1>
          <div className="history-actions">
            <button type="button" aria-label="新建文档" title="新建文档" onClick={onNew}>
              <FilePlus2 size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-label="打开文件" title="打开文件" onClick={onOpen}>
              <FolderOpen size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="清空历史"
              title="清空历史"
              disabled={!recentFiles.length}
              onClick={onClearRecent}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="history-content">
          {drafts.length ? (
            <section className="history-section" aria-labelledby="recovery-heading">
              <h2 id="recovery-heading">恢复</h2>
              <ul>
                {drafts.map((draft) => (
                  <li key={draft.draftId}>
                    <button className="history-entry" type="button" onClick={() => onRecoverDraft(draft)}>
                      <RotateCcw size={16} aria-hidden="true" />
                      <span>{draft.displayName || "未保存的草稿"}</span>
                      <time>{relativeDate(draft.updatedAt)}</time>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="history-section" aria-labelledby="recent-heading">
            <h2 id="recent-heading">最近文件</h2>
            <ul>
              {recentFiles.map((file) => (
                <li key={file.filePath}>
                  <button
                    type="button"
                    className={`history-entry${file.available ? "" : " is-missing"}`}
                    onClick={() => onOpenRecent(file)}
                    title={file.filePath}
                  >
                    {file.available
                      ? <FileText size={16} aria-hidden="true" />
                      : <FileWarning size={16} aria-hidden="true" />}
                    <span>{file.displayName}</span>
                    <time>{relativeDate(file.openedAt)}</time>
                  </button>
                  <button
                    type="button"
                    className="history-remove"
                    aria-label={`从历史中删除 ${file.displayName}`}
                    title="从历史中删除"
                    onClick={() => onRemoveRecent(file.filePath)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </main>
  );
}
