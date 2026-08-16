// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DocumentSession } from "../app/documentSession";
import type { RecentFile, RecoveryDraft } from "../bridge/contracts";
import { DecisionDialog } from "./DecisionDialog";
import { DocumentOutline } from "./DocumentOutline";
import { EditorErrorBoundary } from "./EditorErrorBoundary";
import { FindBar } from "./FindBar";
import { HistorySidebar } from "./HistorySidebar";
import { StatusBanner } from "./StatusBanner";
import { TitleBar } from "./TitleBar";

afterEach(cleanup);

const session = (overrides: Partial<DocumentSession> = {}): DocumentSession => ({
  sessionId: "session-1",
  kind: "file",
  filePath: "/tmp/note.md",
  displayName: "note.md",
  markdown: "# Note",
  savedMarkdown: "# Note",
  format: { encoding: "utf-8", encodingSupported: true, bom: false, preferredEol: "lf" },
  baseFingerprint: { sha256: "base", size: 6, mtimeMs: 1 },
  revision: 0,
  saveState: "clean",
  access: "writable",
  draftId: "draft-1",
  ...overrides
});

describe("application page components", () => {
  it("renders a compact heading outline and navigates by slug", () => {
    const onSelect = vi.fn();
    render(<DocumentOutline markdown={"# First\n\n## Second"} onSelect={onSelect} />);
    expect(screen.getByRole("navigation", { name: "文档大纲" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Second" }));
    expect(onSelect).toHaveBeenCalledWith("second");
  });

  it("replaces an editor render crash with an actionable error instead of a blank window", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    function BrokenEditor(): never {
      throw new Error("editor view unavailable");
    }
    render(<EditorErrorBoundary><BrokenEditor /></EditorErrorBoundary>);
    expect(screen.getByRole("alert").textContent).toContain("editor view unavailable");
    expect(screen.getByRole("button", { name: "重新载入" })).toBeTruthy();
    consoleError.mockRestore();
  });

  it("shows a left history surface without the former landing page", () => {
    const onNew = vi.fn();
    const onOpen = vi.fn();
    render(
      <HistorySidebar
        recentFiles={[]}
        drafts={[]}
        onNew={onNew}
        onOpen={onOpen}
        onOpenRecent={() => undefined}
        onRemoveRecent={() => undefined}
        onClearRecent={() => undefined}
        onRecoverDraft={() => undefined}
      />
    );
    expect(screen.getByRole("complementary", { name: "文件历史" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "历史" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Nolia Lite" })).toBeNull();
    expect((screen.getByRole("button", { name: "清空历史" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "新建文档" }));
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    expect(onNew).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("opens recovery and recent entries and supports deleting or clearing history", () => {
    const draft: RecoveryDraft = {
      schemaVersion: 1,
      draftId: "draft-1",
      displayName: "恢复稿",
      baseSha256: "new",
      revision: 2,
      markdown: "draft",
      bom: false,
      preferredEol: "lf",
      updatedAt: Date.now()
    };
    const recent: RecentFile = {
      filePath: "/tmp/missing.md",
      displayName: "missing.md",
      openedAt: Date.now(),
      available: false
    };
    const onRecoverDraft = vi.fn();
    const onOpenRecent = vi.fn();
    const onRemoveRecent = vi.fn();
    const onClearRecent = vi.fn();
    render(
      <HistorySidebar
        recentFiles={[recent]}
        drafts={[draft]}
        onNew={() => undefined}
        onOpen={() => undefined}
        onOpenRecent={onOpenRecent}
        onRemoveRecent={onRemoveRecent}
        onClearRecent={onClearRecent}
        onRecoverDraft={onRecoverDraft}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /恢复稿/ }));
    const recentButton = screen.getByRole("button", { name: /^missing\.md/ });
    fireEvent.click(recentButton);
    fireEvent.click(screen.getByRole("button", { name: "从历史中删除 missing.md" }));
    fireEvent.click(screen.getByRole("button", { name: "清空历史" }));
    expect(onRecoverDraft).toHaveBeenCalledWith(draft);
    expect(onOpenRecent).toHaveBeenCalledWith(recent);
    expect(onRemoveRecent).toHaveBeenCalledWith(recent.filePath);
    expect(onClearRecent).toHaveBeenCalledOnce();
  });

  it("shows every save-state label and prevents a lossy encoding save", () => {
    const { container, rerender } = render(<TitleBar session={session()} />);
    expect(screen.getByRole("status").textContent).toContain("已保存");
    expect(container.querySelector(".title-actions")).toBeNull();
    for (const [saveState, label] of [
      ["dirty", "未保存"],
      ["saving", "正在保存"],
      ["conflict", "保存冲突"],
      ["error", "保存失败"],
      ["missing", "原文件不存在"]
    ] as const) {
      rerender(<TitleBar session={session({ saveState })} />);
      expect(screen.getByRole("status").textContent).toContain(label);
    }
    rerender(<TitleBar session={session({ access: "readonly-encoding" })} />);
    expect(screen.getByRole("status").textContent).toContain("只读");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("supports keyboard find navigation and exposes a polite result count", () => {
    const onQueryChange = vi.fn();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onClose = vi.fn();
    render(
      <FindBar
        query="note"
        result={{ current: 2, total: 4 }}
        onQueryChange={onQueryChange}
        onPrevious={onPrevious}
        onNext={onNext}
        onClose={onClose}
      />
    );
    const input = screen.getByRole("textbox", { name: "在文档中查找" });
    expect(document.activeElement).toBe(input);
    expect(screen.getByText("2/4").getAttribute("aria-live")).toBe("polite");
    fireEvent.change(input, { target: { value: "draft" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onQueryChange).toHaveBeenCalledWith("draft");
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("focuses the primary modal action, traps Tab, and maps Escape to cancel", () => {
    const onChoose = vi.fn();
    render(
      <DecisionDialog
        spec={{
          title: "处理更改",
          message: "请选择如何处理当前内容。",
          actions: [
            { id: "cancel", label: "取消" },
            { id: "discard", label: "丢弃", tone: "danger" },
            { id: "save", label: "保存", tone: "primary" }
          ]
        }}
        onChoose={onChoose}
      />
    );
    const dialog = screen.getByRole("dialog", { name: "处理更改" });
    const cancel = screen.getByRole("button", { name: "取消" });
    const save = screen.getByRole("button", { name: "保存" });
    expect(dialog.getAttribute("aria-describedby")).toBe("dialog-message");
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(save, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(save, { key: "Escape" });
    expect(onChoose).toHaveBeenCalledWith("cancel");
  });

  it("announces blocking status as an alert and runs its recovery action", () => {
    const retry = vi.fn();
    render(<StatusBanner tone="danger" alert message="无法保存更改" actions={[{ label: "重试", onClick: retry }]} />);
    expect(screen.getByRole("alert").textContent).toContain("无法保存更改");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
