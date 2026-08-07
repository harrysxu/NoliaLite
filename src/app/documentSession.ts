import type {
  DocumentFormat,
  FileFingerprint,
  ReadDocumentResult,
  RecoveryDraft
} from "../bridge/contracts";

export type SaveState = "clean" | "dirty" | "saving" | "conflict" | "error" | "missing";
export type AccessState = "writable" | "readonly-encoding" | "readonly-permission";
export type ExternalState = "changed" | "missing";

export type DocumentSession = {
  sessionId: string;
  kind: "untitled" | "file";
  filePath?: string;
  displayName: string;
  markdown: string;
  savedMarkdown: string;
  format: DocumentFormat;
  baseFingerprint: FileFingerprint | { sha256: "new"; size: 0; mtimeMs: 0 };
  revision: number;
  savedRevision: number;
  saveState: SaveState;
  access: AccessState;
  draftId: string;
  externalState?: ExternalState;
  lastError?: string;
};

const defaultFormat: DocumentFormat = {
  encoding: "utf-8",
  encodingSupported: true,
  bom: false,
  preferredEol: "lf"
};

export function createUntitledSession(draft?: RecoveryDraft): DocumentSession {
  const markdown = draft?.markdown ?? "";
  const revision = draft?.revision ?? 0;
  return {
    sessionId: crypto.randomUUID(),
    kind: "untitled",
    displayName: "未命名",
    markdown,
    savedMarkdown: "",
    format: draft
      ? { ...defaultFormat, bom: draft.bom, preferredEol: draft.preferredEol }
      : defaultFormat,
    baseFingerprint: { sha256: "new", size: 0, mtimeMs: 0 },
    revision,
    savedRevision: 0,
    saveState: markdown ? "dirty" : "clean",
    access: "writable",
    draftId: draft?.draftId ?? crypto.randomUUID()
  };
}

export function createFileSession(
  result: ReadDocumentResult,
  recoveredDraft?: RecoveryDraft
): DocumentSession {
  const recovered = recoveredDraft?.markdown;
  const draftConflicts = recoveredDraft && recoveredDraft.baseSha256 !== result.fingerprint.sha256;
  const access: AccessState = !result.format.encodingSupported
    ? "readonly-encoding"
    : result.writable
      ? "writable"
      : "readonly-permission";
  return {
    sessionId: crypto.randomUUID(),
    kind: "file",
    filePath: result.filePath,
    displayName: result.displayName,
    markdown: recovered ?? result.content,
    savedMarkdown: result.content,
    format: result.format,
    baseFingerprint: result.fingerprint,
    revision: recoveredDraft?.revision ?? 0,
    savedRevision: 0,
    saveState: recovered ? (draftConflicts ? "conflict" : "dirty") : "clean",
    access,
    draftId: result.draftId,
    externalState: draftConflicts ? "changed" : undefined
  };
}

type SessionAction =
  | { type: "replace"; session?: DocumentSession }
  | { type: "edit"; sessionId: string; markdown: string }
  | { type: "saveStarted"; sessionId: string }
  | {
      type: "saveSucceeded";
      sessionId: string;
      requestRevision: number;
      savedMarkdown: string;
      filePath: string;
      fingerprint: FileFingerprint;
    }
  | { type: "saveFailed"; sessionId: string; state: Exclude<SaveState, "clean" | "dirty" | "saving">; message?: string }
  | { type: "external"; sessionId: string; state?: ExternalState }
  | { type: "keepCurrent"; sessionId: string }
  | { type: "setClean"; sessionId: string };

export function documentSessionReducer(
  session: DocumentSession | undefined,
  action: SessionAction
): DocumentSession | undefined {
  if (action.type === "replace") return action.session;
  if (!session || session.sessionId !== action.sessionId) return session;

  switch (action.type) {
    case "edit": {
      if (session.markdown === action.markdown) return session;
      const revision = session.revision + 1;
      const clean = action.markdown === session.savedMarkdown && !session.externalState;
      return {
        ...session,
        markdown: action.markdown,
        revision,
        saveState: clean ? "clean" : session.externalState ? "conflict" : "dirty",
        lastError: undefined
      };
    }
    case "saveStarted":
      return { ...session, saveState: "saving", lastError: undefined };
    case "saveSucceeded": {
      const currentWasSaved = session.revision === action.requestRevision;
      return {
        ...session,
        kind: "file",
        filePath: action.filePath,
        displayName: action.filePath.split(/[\\/]/).pop() || session.displayName,
        baseFingerprint: action.fingerprint,
        savedMarkdown: action.savedMarkdown,
        savedRevision: action.requestRevision,
        saveState: currentWasSaved ? "clean" : "dirty",
        access: "writable",
        externalState: undefined,
        lastError: undefined
      };
    }
    case "saveFailed":
      return { ...session, saveState: action.state, lastError: action.message };
    case "external":
      return {
        ...session,
        externalState: action.state,
        saveState: action.state === "missing"
          ? "missing"
          : action.state && session.saveState !== "clean"
            ? "conflict"
            : session.saveState
      };
    case "keepCurrent":
      return {
        ...session,
        revision: session.revision + 1,
        externalState: "changed",
        saveState: "conflict"
      };
    case "setClean":
      return { ...session, saveState: "clean", externalState: undefined, lastError: undefined };
  }
}
