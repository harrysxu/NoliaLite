import { describe, expect, it } from "vitest";

import { createFileSession, createUntitledSession, documentSessionReducer } from "./documentSession";

describe("document session state machine", () => {
  it("keeps a document dirty when typing continues during save", () => {
    const initial = createUntitledSession();
    const edited = documentSessionReducer(initial, {
      type: "edit",
      sessionId: initial.sessionId,
      markdown: "first"
    })!;
    const saving = documentSessionReducer(edited, {
      type: "saveStarted",
      sessionId: initial.sessionId
    })!;
    const editedAgain = documentSessionReducer(saving, {
      type: "edit",
      sessionId: initial.sessionId,
      markdown: "second"
    })!;
    const completed = documentSessionReducer(editedAgain, {
      type: "saveSucceeded",
      sessionId: initial.sessionId,
      requestRevision: edited.revision,
      savedMarkdown: edited.markdown,
      filePath: "/tmp/note.md",
      fingerprint: { sha256: "hash", size: 5, mtimeMs: 1 }
    })!;
    expect(completed.markdown).toBe("second");
    expect(completed.savedMarkdown).toBe("first");
    expect(completed.saveState).toBe("dirty");
  });

  it("returns to clean when undo restores saved markdown", () => {
    const initial = { ...createUntitledSession(), savedMarkdown: "saved", markdown: "saved", kind: "file" as const };
    const edited = documentSessionReducer(initial, {
      type: "edit",
      sessionId: initial.sessionId,
      markdown: "changed"
    })!;
    const undone = documentSessionReducer(edited, {
      type: "edit",
      sessionId: initial.sessionId,
      markdown: "saved"
    })!;
    expect(undone.saveState).toBe("clean");
  });

  it("ignores stale actions from a replaced session", () => {
    const initial = createUntitledSession();
    const unchanged = documentSessionReducer(initial, {
      type: "edit",
      sessionId: "stale-session",
      markdown: "should not apply"
    });
    expect(unchanged).toBe(initial);
  });

  it("restores a conflicting draft without treating it as saved", () => {
    const result = fileResult("disk");
    const restored = createFileSession(result, {
      schemaVersion: 1,
      draftId: "draft",
      filePath: result.filePath,
      displayName: result.displayName,
      baseSha256: "older",
      revision: 7,
      markdown: "draft content",
      bom: false,
      preferredEol: "lf",
      updatedAt: 1
    });
    expect(restored.markdown).toBe("draft content");
    expect(restored.savedMarkdown).toBe("disk");
    expect(restored.saveState).toBe("conflict");
    expect(restored.externalState).toBe("changed");
  });

  it("marks a clean document as missing without discarding editor content", () => {
    const initial = createFileSession(fileResult("content"));
    const missing = documentSessionReducer(initial, { type: "external", sessionId: initial.sessionId, state: "missing" })!;
    expect(missing.markdown).toBe("content");
    expect(missing.saveState).toBe("missing");
    expect(missing.externalState).toBe("missing");
  });

  it("turns an external change during editing into a conflict", () => {
    const initial = createFileSession(fileResult("saved"));
    const edited = documentSessionReducer(initial, { type: "edit", sessionId: initial.sessionId, markdown: "local" })!;
    const conflicted = documentSessionReducer(edited, { type: "external", sessionId: initial.sessionId, state: "changed" })!;
    expect(conflicted.saveState).toBe("conflict");
    expect(conflicted.markdown).toBe("local");
  });

  it("keeps readonly encoding and readonly permissions distinct", () => {
    const encoding = createFileSession({
      ...fileResult("text"),
      format: { encoding: "utf-8", encodingSupported: false, bom: false, preferredEol: "lf" }
    });
    const permission = createFileSession({ ...fileResult("text"), writable: false });
    expect(encoding.access).toBe("readonly-encoding");
    expect(permission.access).toBe("readonly-permission");
  });
});

function fileResult(content: string) {
  return {
    filePath: "/tmp/note.md",
    displayName: "note.md",
    content,
    fingerprint: { sha256: `hash-${content}`, size: content.length, mtimeMs: 1 },
    format: { encoding: "utf-8" as const, encodingSupported: true, bom: false, preferredEol: "lf" as const },
    writable: true,
    draftId: "draft"
  };
}
