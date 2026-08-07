import type { DocumentSession } from "../app/documentSession";

type Props = {
  session?: DocumentSession;
};

function statusFor(session: DocumentSession): { label: string; tone: string; exceptional?: boolean } {
  if (session.access !== "writable") return { label: "只读", tone: "readonly", exceptional: true };
  if (session.kind === "untitled" && session.saveState === "clean") return { label: "尚未保存", tone: "quiet" };
  const statuses = {
    clean: { label: "已保存", tone: "clean" },
    dirty: { label: "未保存", tone: "dirty" },
    saving: { label: "正在保存", tone: "saving" },
    conflict: { label: "保存冲突", tone: "warning", exceptional: true },
    error: { label: "保存失败", tone: "danger", exceptional: true },
    missing: { label: "原文件不存在", tone: "warning", exceptional: true }
  } as const;
  return statuses[session.saveState];
}

function currentPlatform(): "macos" | "windows" | "linux" {
  const platform = `${navigator.platform ?? ""} ${navigator.userAgent}`;
  if (/Mac|iPhone|iPad|iPod/i.test(platform)) return "macos";
  if (/Win/i.test(platform)) return "windows";
  return "linux";
}

export function TitleBar({ session }: Props) {
  const status = session ? statusFor(session) : undefined;
  return (
    <header className={`title-bar is-${currentPlatform()}`} data-tauri-drag-region>
      <div className="traffic-light-space" data-tauri-drag-region />
      <div className="document-title" data-tauri-drag-region title={session?.filePath ?? session?.displayName}>
        <strong>{session?.displayName ?? "Nolia Lite"}</strong>
        {status ? (
          <span className={`save-status is-${status.tone}${status.exceptional ? " is-exceptional" : ""}`} role="status">
            <i aria-hidden="true" />
            <span className="save-status-label">{status.label}</span>
          </span>
        ) : null}
      </div>
      <div className="title-bar-balance" data-tauri-drag-region />
    </header>
  );
}
