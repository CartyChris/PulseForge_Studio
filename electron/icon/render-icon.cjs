/**
 * Rasterize electron/icon/icon.svg -> electron/resources/icon.png (1024x1024, transparent)
 * using a hidden Electron window + <canvas>, then build electron/resources/icon.icns with
 * the macOS built-ins sips + iconutil. Run: node_modules/.bin/electron electron/icon/render-icon.cjs
 */
"use strict";
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const here = __dirname;
const outDir = path.join(here, "..", "resources");

app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(path.join(here, "icon.svg"), "utf8");
    const win = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadURL("data:text/html,<!doctype html><title>icon</title>");
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = 1024; c.height = 1024;
        const g = c.getContext("2d");
        g.clearRect(0, 0, 1024, 1024);
        g.drawImage(img, 0, 0, 1024, 1024);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("svg failed to load"));
      img.src = "data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}";
    })`);
    fs.mkdirSync(outDir, { recursive: true });
    const png = path.join(outDir, "icon.png");
    fs.writeFileSync(png, Buffer.from(dataUrl.split(",")[1], "base64"));

    const iconset = fs.mkdtempSync(path.join(os.tmpdir(), "pf-icon-")) + "/icon.iconset";
    fs.mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      execFileSync("sips", ["-z", String(size), String(size), png, "--out", path.join(iconset, `icon_${size}x${size}.png`)], { stdio: "ignore" });
      const s2 = size * 2;
      execFileSync("sips", ["-z", String(s2), String(s2), png, "--out", path.join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: "ignore" });
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(outDir, "icon.icns")]);
    fs.rmSync(path.dirname(iconset), { recursive: true, force: true });
    console.log("[icon] wrote", png, "and icon.icns");
    app.exit(0);
  } catch (err) {
    console.error("[icon] failed:", err);
    app.exit(1);
  }
});
