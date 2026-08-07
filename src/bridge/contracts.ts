export type PreferredEol = "lf" | "crlf";

export type FileFingerprint = {
  sha256: string;
  size: number;
  mtimeMs: number;
};

export type DocumentFormat = {
  encoding: "utf-8";
  encodingSupported: boolean;
  bom: boolean;
  preferredEol: PreferredEol;
};

export type RecoveryDraft = {
  schemaVersion: 1;
  draftId: string;
  filePath?: string;
  displayName: string;
  baseSha256: string;
  revision: number;
  markdown: string;
  bom: boolean;
  preferredEol: PreferredEol;
  updatedAt: number;
};

export type RecentFile = {
  filePath: string;
  displayName: string;
  openedAt: number;
  available: boolean;
};

export type ReadDocumentResult = {
  filePath: string;
  displayName: string;
  content: string;
  fingerprint: FileFingerprint;
  format: DocumentFormat;
  writable: boolean;
  draftId: string;
  draft?: RecoveryDraft;
};

export type SaveMode = "normal" | "saveAs" | "force";

export type ExportFormat = "html" | "pdf";

export type ExportDocumentRequest = {
  filePath: string;
  format: ExportFormat;
  content: string;
};

export type SaveDocumentRequest = {
  filePath: string;
  content: string;
  baseSha256: string;
  revision: number;
  bom: boolean;
  mode: SaveMode;
  draftId?: string;
};

export type SaveDocumentResult =
  | { status: "saved"; revision: number; filePath: string; fingerprint: FileFingerprint }
  | { status: "conflict"; revision: number; disk: FileFingerprint }
  | { status: "missing"; revision: number }
  | { status: "readonly"; revision: number; reason: string }
  | { status: "error"; revision: number; code: string; message: string };

export type InspectDocumentResult =
  | { status: "current"; fingerprint: FileFingerprint }
  | { status: "changed"; fingerprint: FileFingerprint }
  | { status: "missing" }
  | { status: "error"; message: string };
