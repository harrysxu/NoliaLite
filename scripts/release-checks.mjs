import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const limitBytes = 25 * 1024 * 1024;
const releaseRoot = process.env.TAURI_TARGET
  ? path.join(root, "src-tauri", "target", process.env.TAURI_TARGET, "release")
  : path.join(root, "src-tauri", "target", "release");
const results = [];

function check(condition, message) {
  if (!condition) throw new Error(message);
  results.push(message);
}

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function directorySize(target) {
  const entry = await stat(target);
  if (!entry.isDirectory()) return entry.size;
  const children = await readdir(target);
  const sizes = await Promise.all(children.map((child) => directorySize(path.join(target, child))));
  return sizes.reduce((total, size) => total + size, 0);
}

async function digest(target) {
  return createHash("sha256").update(await readFile(target)).digest("hex");
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    if (/\.test\.[jt]sx?$/.test(entry.name) || !/\.[jt]sx?$/.test(entry.name)) return [];
    return [target];
  }));
  return files.flat();
}

const base = await json("src-tauri/tauri.conf.json");
const mac = await json("src-tauri/tauri.macos.conf.json");
const windows = await json("src-tauri/tauri.windows.conf.json");
const linux = await json("src-tauri/tauri.linux.conf.json");
const capability = await json("src-tauri/capabilities/default.json");

for (const [name, config] of [["macOS", mac], ["Windows", windows], ["Linux", linux]]) {
  const window = config.app?.windows?.[0];
  check(config.app.windows.length === 1, `${name}: one native document-window template`);
  check(window.width === 940 && window.height === 720, `${name}: default window is 940x720`);
  check(window.minWidth === 560 && window.minHeight === 480, `${name}: minimum window is 560x480`);
  check(window.decorations === true, `${name}: native window decorations enabled`);
}

const macWindow = mac.app.windows[0];
check(macWindow.titleBarStyle === "Overlay" && macWindow.hiddenTitle === true, "macOS: native overlay title bar enabled");
check(macWindow.trafficLightPosition?.x === 14 && macWindow.trafficLightPosition?.y === 15, "macOS: traffic lights use the documented left position");
for (const [name, config] of [["Windows", windows], ["Linux", linux]]) {
  const window = config.app.windows[0];
  check(!("titleBarStyle" in window) && !("hiddenTitle" in window) && !("trafficLightPosition" in window), `${name}: no macOS title-bar overrides`);
}

const icons = base.bundle?.icon ?? [];
check(icons.includes("icons/icon.icns") && icons.includes("icons/icon.ico") && icons.some((icon) => icon.endsWith(".png")), "bundle: macOS, Windows, and PNG icons configured");
const associations = base.bundle?.fileAssociations?.flatMap((item) => item.ext ?? []) ?? [];
check(associations.includes("md") && associations.includes("markdown"), "bundle: .md and .markdown file associations configured");

const csp = base.app?.security?.csp ?? "";
check(/connect-src ipc: http:\/\/ipc\.localhost(?:;|$)/.test(csp), "security: CSP connect-src is restricted to Tauri IPC");
check(!/connect-src[^;]*https?:\/\/(?!ipc\.localhost)/.test(csp), "security: CSP has no external network endpoint");
check(csp.includes("object-src 'none'") && csp.includes("frame-src 'none'"), "security: objects and frames are blocked");

check(
  capability.windows?.length === 2
    && capability.windows.includes("main")
    && capability.windows.includes("document-*")
    && !capability.windows.includes("*"),
  "security: capability is scoped to main and controlled document windows"
);
check(!capability.permissions.some((permission) => /(?:shell|http|fs:)/.test(permission)), "security: no shell, HTTP, or direct filesystem capability");

const sources = await sourceFiles(path.join(root, "src"));
const productionSource = (await Promise.all(sources.map((file) => readFile(file, "utf8")))).join("\n");
check(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/.test(productionSource), "privacy: production frontend contains no network client API");
check(!/aria-label=["'](?:关闭窗口|最小化|最大化|缩放窗口)["']/.test(productionSource), "window UI: WebView does not duplicate native window controls");

const appCss = await readFile(path.join(root, "src/styles/app.css"), "utf8");
const editorCss = await readFile(path.join(root, "src/styles/editor.css"), "utf8");
const tokensCss = await readFile(path.join(root, "src/styles/tokens.css"), "utf8");
check(appCss.includes("min-width: 560px") && appCss.includes("min-height: 480px"), "display: minimum viewport constraints present");
check(editorCss.includes("width: min(880px, calc(100% - 80px))"), "display: document column is capped at 880px");
check(!productionSource.includes("title-actions") && !productionSource.includes("save-title-button"), "window UI: document mode has no persistent file toolbar");
check(tokensCss.includes("prefers-color-scheme: dark") && tokensCss.includes("prefers-reduced-motion: reduce"), "display: dark mode and reduced motion rules present");

const distPath = path.join(root, "dist");
check(existsSync(path.join(distPath, "index.html")), "build: frontend index exists");
const indexHtml = await readFile(path.join(distPath, "index.html"), "utf8");
check(!/(?:src|href)=["']https?:\/\//i.test(indexHtml), "build: entry page references only bundled assets");
const distBytes = await directorySize(distPath);

let bundleSummary = "not checked on this platform";
if (process.platform === "darwin") {
  const appPath = path.join(releaseRoot, "bundle", "macos", "Nolia Lite.app");
  const dmgDirectory = path.join(releaseRoot, "bundle", "dmg");
  check(existsSync(appPath), "macOS bundle: .app exists");
  const appBytes = await directorySize(appPath);
  check(appBytes <= limitBytes, "macOS bundle: .app is within 25 MB");
  const dmgName = (await readdir(dmgDirectory)).find((name) => name.endsWith(".dmg"));
  check(Boolean(dmgName), "macOS bundle: DMG exists");
  const dmgBytes = await directorySize(path.join(dmgDirectory, dmgName));
  check(dmgBytes <= limitBytes, "macOS bundle: DMG is within 25 MB");
  const sourceIcon = path.join(root, "src-tauri/icons/icon.icns");
  const bundledIcon = path.join(appPath, "Contents/Resources/icon.icns");
  check(await digest(sourceIcon) === await digest(bundledIcon), "macOS bundle: packaged icon matches source icon");
  const info = await readFile(path.join(appPath, "Contents/Info.plist"), "utf8");
  check(info.includes("CFBundleDocumentTypes") && info.includes("markdown"), "macOS bundle: document association is present in Info.plist");
  bundleSummary = `.app ${(appBytes / 1024 / 1024).toFixed(2)} MB, DMG ${(dmgBytes / 1024 / 1024).toFixed(2)} MB`;
}

console.log(`Release checks passed: ${results.length}`);
console.log(`Frontend dist: ${(distBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`Bundle: ${bundleSummary}`);
