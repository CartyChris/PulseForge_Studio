/**
 * PulseForge Studio — Electron main process.
 *
 * Boot order matters:
 *   1. resolve the user's login-shell PATH (Finder launches get a minimal PATH, and the
 *      backend spawns user CLIs such as claude / codex / kimi / grok)
 *   2. set PF_DATA_DIR = userData  (server/secrets.ts reads it at import time)
 *   3. require the bundled backend (server.cjs) and start it on 127.0.0.1
 *      (port 7800 preferred, then the last fallback port, then an OS-assigned port)
 *   4. load that URL in a locked-down BrowserWindow
 *
 * PF_SMOKE_TEST=1: boot the backend, GET /api/health and /, print one JSON line to
 * stdout and exit 0 (or 1 on any failure). No window is created.
 */
"use strict";

const { app, BrowserWindow, Menu, shell, session, systemPreferences, dialog, screen } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SMOKE = process.env.PF_SMOKE_TEST === "1";
const PREFERRED_PORT = 7800;
const HOST = "127.0.0.1";
const MIN_W = 1100;
const MIN_H = 700;

let mainWindow = null;
let serverHandle = null; // { app, url, port, close }
let serverOrigin = null; // "http://127.0.0.1:<port>"
let shutdownDone = false;
let shuttingDown = false;
let pathInfo = { source: "unresolved", entries: 0 };

// ---------------------------------------------------------------- helpers

function log(...args) {
  if (!SMOKE) console.log("[pulseforge-desktop]", ...args);
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isOurOrigin(url) {
  return !!serverOrigin && originOf(url) === serverOrigin;
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch {}
}

const stateFile = () => path.join(app.getPath("userData"), "desktop-state.json");

// ---------------------------------------------------------------- PATH resolution

/** Run the user's login+interactive shell once and read its PATH (4 s budget). */
function readLoginShellPath(timeoutMs = 4000) {
  return new Promise((resolve) => {
    let shellBin = process.env.SHELL;
    if (!shellBin) {
      try {
        shellBin = os.userInfo().shell || undefined;
      } catch {}
    }
    if (!shellBin || !fs.existsSync(shellBin)) shellBin = "/bin/zsh";

    const MARK = "__PULSEFORGE_PATH__";
    let out = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child;
    try {
      child = spawn(shellBin, ["-ilc", `printf '${MARK}%s${MARK}' "$PATH"`], {
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, PULSEFORGE_PATH_PROBE: "1" },
        detached: false,
      });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      finish(null);
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      out += d.toString("utf8");
      if (out.length > 1_000_000) out = out.slice(-100_000);
    });
    child.on("error", () => finish(null));
    child.on("close", () => {
      const m = out.match(new RegExp(`${MARK}([\\s\\S]*?)${MARK}`));
      finish(m && m[1].trim() ? m[1].trim() : null);
    });
  });
}

function fallbackPathDirs() {
  const home = os.homedir();
  const dirs = [
    path.join(home, ".local/bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    path.join(home, ".bun/bin"),
    path.join(home, ".npm-global/bin"),
  ];
  // ~/.nvm/versions/node/*/bin, newest version first
  const nvmRoot = path.join(home, ".nvm/versions/node");
  try {
    const versions = fs
      .readdirSync(nvmRoot)
      .filter((v) => /^v\d+/.test(v))
      .sort((a, b) => {
        const pa = a.slice(1).split(".").map(Number);
        const pb = b.slice(1).split(".").map(Number);
        for (let i = 0; i < 3; i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
        return 0;
      });
    for (const v of versions) dirs.push(path.join(nvmRoot, v, "bin"));
  } catch {}
  return dirs.filter((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

async function resolveUserPath() {
  const login = await readLoginShellPath(4000);
  const parts = [];
  const add = (p) => {
    for (const seg of String(p || "").split(":")) {
      if (seg && !parts.includes(seg)) parts.push(seg);
    }
  };
  add(login);
  add(fallbackPathDirs().join(":"));
  add(process.env.PATH);
  add("/usr/bin:/bin:/usr/sbin:/sbin");
  process.env.PATH = parts.join(":");
  pathInfo = { source: login ? "login-shell" : "fallback", entries: parts.length };
  log(`PATH resolved via ${pathInfo.source} (${parts.length} entries)`);
}

// ---------------------------------------------------------------- backend

function webDir() {
  if (process.env.PF_DESKTOP_WEB_DIR) return path.resolve(process.env.PF_DESKTOP_WEB_DIR);
  if (app.isPackaged) return path.join(process.resourcesPath, "web");
  // unpackaged (npm run desktop:dev): dist-electron/app/main.cjs -> <repo>/dist
  return path.resolve(__dirname, "..", "..", "dist");
}

async function startBackend() {
  // secrets.ts / jobs.ts read PF_DATA_DIR when the module is first evaluated.
  process.env.PF_DATA_DIR = app.getPath("userData");
  process.env.PF_DESKTOP = "1";
  fs.mkdirSync(process.env.PF_DATA_DIR, { recursive: true });

  const staticDir = webDir();
  if (!fs.existsSync(path.join(staticDir, "index.html"))) {
    throw new Error(`Studio frontend not found at ${staticDir} (index.html missing). Rebuild with npm run build:desktop.`);
  }

  const server = require(path.join(__dirname, "server.cjs"));
  if (typeof server.startServer !== "function") throw new Error("server bundle does not export startServer()");

  const state = readJson(stateFile(), {});
  const candidates = [PREFERRED_PORT];
  if (Number.isInteger(state.lastFallbackPort) && state.lastFallbackPort > 1024 && state.lastFallbackPort !== PREFERRED_PORT) {
    candidates.push(state.lastFallbackPort);
  }
  candidates.push(0);

  let lastErr = null;
  for (const port of candidates) {
    try {
      const handle = await server.startServer({ port, host: HOST, staticDir, logger: !SMOKE });
      if (handle.port !== PREFERRED_PORT && !SMOKE) {
        writeJson(stateFile(), { ...readJson(stateFile(), {}), lastFallbackPort: handle.port });
      }
      return handle;
    } catch (err) {
      lastErr = err;
      const code = err && err.code;
      if (code !== "EADDRINUSE" && code !== "EACCES") throw err;
      log(`port ${port || "(auto)"} unavailable (${code}), trying next`);
    }
  }
  throw lastErr || new Error("could not bind a port");
}

async function shutdownBackend() {
  if (!serverHandle) return;
  const h = serverHandle;
  serverHandle = null;
  const closing = h.close().catch(() => {});
  // SSE streams keep connections busy; don't let them hold the quit hostage.
  const force = setTimeout(() => {
    try {
      h.app.server.closeAllConnections();
    } catch {}
  }, 500);
  await Promise.race([closing, new Promise((r) => setTimeout(r, 3000))]);
  clearTimeout(force);
}

// ---------------------------------------------------------------- smoke test

async function runSmoke() {
  const watchdog = setTimeout(() => {
    process.stdout.write(JSON.stringify({ ok: false, error: "smoke test timed out after 45s" }) + "\n");
    app.exit(1);
  }, 45_000);
  const result = { ok: false, version: app.getVersion(), packaged: app.isPackaged, electron: process.versions.electron };
  try {
    await resolveUserPath();
    result.path = pathInfo;
    serverHandle = await startBackend();
    result.url = serverHandle.url;
    result.dataDir = process.env.PF_DATA_DIR;
    const h = await fetch(`${serverHandle.url}/api/health`, { signal: AbortSignal.timeout(10_000) });
    const healthBody = await h.json().catch(() => null);
    result.health = { status: h.status, name: healthBody && healthBody.name };
    const r = await fetch(`${serverHandle.url}/`, { signal: AbortSignal.timeout(10_000) });
    const html = await r.text();
    result.index = {
      status: r.status,
      contentType: r.headers.get("content-type"),
      bytes: html.length,
      hasPulseForge: html.includes("PulseForge"),
    };
    // SPA fallback: an unknown client route must still get the app shell
    const spa = await fetch(`${serverHandle.url}/some/client/route`, { signal: AbortSignal.timeout(10_000) });
    result.spaFallback = spa.status;
    result.ok =
      h.status === 200 &&
      r.status === 200 &&
      /text\/html/.test(result.index.contentType || "") &&
      result.index.hasPulseForge &&
      spa.status === 200;
    if (!result.ok) result.error = "health or index check failed";
  } catch (err) {
    result.ok = false;
    result.error = String((err && err.message) || err);
  }
  await shutdownBackend().catch(() => {});
  clearTimeout(watchdog);
  process.stdout.write(JSON.stringify(result) + "\n");
  app.exit(result.ok ? 0 : 1);
}

// ---------------------------------------------------------------- window state

function loadBounds() {
  const s = readJson(stateFile(), {});
  const b = s.bounds;
  const fallback = { width: 1440, height: 900 };
  if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return { bounds: fallback, maximized: false };
  const bounds = { width: Math.max(MIN_W, b.width), height: Math.max(MIN_H, b.height) };
  if (Number.isFinite(b.x) && Number.isFinite(b.y)) {
    // only restore the position if it is still visible on some display
    const visible = screen.getAllDisplays().some(({ workArea: w }) =>
      b.x + 100 > w.x && b.x < w.x + w.width - 100 && b.y >= w.y - 10 && b.y < w.y + w.height - 50,
    );
    if (visible) Object.assign(bounds, { x: b.x, y: b.y });
  }
  return { bounds, maximized: !!s.maximized };
}

function saveBounds(win) {
  if (!win || win.isDestroyed()) return;
  const maximized = win.isMaximized() || win.isFullScreen();
  const prev = readJson(stateFile(), {});
  writeJson(stateFile(), { ...prev, bounds: maximized && prev.bounds ? prev.bounds : win.getNormalBounds(), maximized });
}

// ---------------------------------------------------------------- windows

function webPrefs(extra = {}) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
    ...extra,
  };
}

function createMainWindow() {
  const { bounds, maximized } = loadBounds();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_W,
    minHeight: MIN_H,
    title: "PulseForge Studio",
    titleBarStyle: "hiddenInset", // traffic lights overlay the page: frontend pads ~78px on the left
    backgroundColor: "#0f0d0c",
    show: false,
    webPreferences: webPrefs({
      preload: path.join(__dirname, "preload.cjs"),
      additionalArguments: [`--pf-version=${app.getVersion()}`],
    }),
  });
  if (maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  let saveTimer = null;
  const queueSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveBounds(win), 400);
  };
  win.on("resize", queueSave);
  win.on("move", queueSave);
  win.on("close", () => {
    clearTimeout(saveTimer);
    saveBounds(win);
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.on("render-process-gone", (_e, details) => {
    log("renderer gone:", details.reason);
    if (details.reason !== "clean-exit" && !win.isDestroyed()) {
      dialog
        .showMessageBox(win, {
          type: "error",
          message: "The studio view stopped unexpectedly.",
          detail: `Reason: ${details.reason}. Your autosaved project is kept in the app's storage.`,
          buttons: ["Reload", "Quit"],
        })
        .then(({ response }) => (response === 0 ? win.reload() : app.quit()));
    }
  });

  win.loadURL(serverHandle.url);
  return win;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function showErrorWindow(err) {
  const msg = String((err && err.message) || err).replace(/(sk|key|token)[-_a-z0-9]{12,}/gi, "[redacted]");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>PulseForge Studio</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  html,body{margin:0;height:100%;background:#0f0d0c;color:#eae3dc;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif}
  body{display:flex;align-items:center;justify-content:center;-webkit-app-region:drag}
  .card{max-width:560px;padding:32px 36px;border:1px solid #2b2420;border-radius:14px;background:#171310;-webkit-app-region:no-drag}
  h1{margin:0 0 8px;font-size:20px;color:#e8663c}
  pre{white-space:pre-wrap;word-break:break-word;background:#0b0908;border:1px solid #2b2420;border-radius:8px;padding:12px;font-size:12px;color:#f3b49a}
  li{margin:4px 0} code{color:#f3b49a}
</style></head><body><div class="card">
<h1>PulseForge couldn't start its audio engine server</h1>
<p>The built-in backend failed to launch, so the studio can't open yet.</p>
<pre>${escapeHtml(msg)}</pre>
<ul>
  <li>Quit (&#8984;Q) and open PulseForge Studio again.</li>
  <li>If another app is using many local ports, close it and retry.</li>
  <li>Your data folder: <code>${escapeHtml(app.getPath("userData"))}</code></li>
</ul>
<p>Use <b>Help &rarr; Open Data Folder</b> to inspect settings.</p>
</div></body></html>`;
  const win = new BrowserWindow({
    width: 680,
    height: 520,
    resizable: true,
    title: "PulseForge Studio — startup error",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f0d0c",
    webPreferences: webPrefs(),
  });
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  mainWindow = win;
}

// ---------------------------------------------------------------- security

function installSecurityHandlers() {
  const ses = session.defaultSession;
  const ALLOWED = new Set(["clipboard-sanitized-write", "fullscreen"]);

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const requester = (details && details.requestingUrl) || (wc && wc.getURL()) || "";
    if (!isOurOrigin(requester)) return callback(false);
    if (permission === "media") {
      const types = (details && details.mediaTypes) || [];
      if (types.includes("video")) return callback(false); // the studio only ever records audio
      if (process.platform !== "darwin") return callback(true);
      const status = systemPreferences.getMediaAccessStatus("microphone");
      if (status === "granted") return callback(true);
      systemPreferences
        .askForMediaAccess("microphone")
        .then((granted) => {
          callback(granted);
          if (!granted) offerMicSettings();
        })
        .catch(() => callback(false));
      return;
    }
    callback(ALLOWED.has(permission));
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    if (!isOurOrigin(requestingOrigin)) return false;
    if (permission === "media") return !details || details.mediaType !== "video";
    return ALLOWED.has(permission);
  });

  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (ev) => ev.preventDefault());

    const guard = (ev, url) => {
      if (isOurOrigin(url)) return;
      ev.preventDefault();
      if (isHttpUrl(url)) shell.openExternal(url).catch(() => {});
    };
    contents.on("will-navigate", guard);
    contents.on("will-redirect", guard);

    contents.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    });
  });
}

let micDialogShown = false;
function offerMicSettings() {
  if (micDialogShown || !mainWindow || mainWindow.isDestroyed()) return;
  micDialogShown = true;
  dialog
    .showMessageBox(mainWindow, {
      type: "info",
      message: "Microphone access is off for PulseForge Studio",
      detail: "To record, allow PulseForge Studio in System Settings → Privacy & Security → Microphone, then try again.",
      buttons: ["Open System Settings", "Not now"],
      defaultId: 0,
    })
    .then(({ response }) => {
      if (response === 0) shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone").catch(() => {});
    });
}

// ---------------------------------------------------------------- menu

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    ...(isMac ? [] : [{ role: "fileMenu" }]),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Open Data Folder",
          click: () => shell.openPath(app.getPath("userData")),
        },
        {
          label: "Open Studio in Browser",
          enabled: true,
          click: () => serverHandle && shell.openExternal(serverHandle.url),
        },
        { type: "separator" },
        {
          label: `PulseForge Studio ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- lifecycle

function focusMain() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function boot() {
  installSecurityHandlers();
  buildMenu();
  await resolveUserPath();
  try {
    serverHandle = await startBackend();
    serverOrigin = originOf(serverHandle.url);
    log(`backend ready at ${serverHandle.url}`);
    mainWindow = createMainWindow();
  } catch (err) {
    console.error("[pulseforge-desktop] backend failed to start:", err);
    showErrorWindow(err);
  }
}

if (SMOKE) {
  app.whenReady().then(() => {
    if (app.dock) app.dock.hide();
    return runSmoke();
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", focusMain);

  app.whenReady().then(boot);

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) return focusMain();
    if (serverHandle) mainWindow = createMainWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (e) => {
    if (shutdownDone || !serverHandle) return;
    e.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownBackend().finally(() => {
      shutdownDone = true;
      app.quit();
    });
  });
}
