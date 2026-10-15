/**
 * electron-builder afterPack hook. We ship unsigned (mac.identity = null), but after
 * electron-builder rewrites Info.plist the bundle's code seal no longer matches, which
 * on Apple Silicon makes Finder/Gatekeeper report the app as "damaged". An ad-hoc
 * signature (codesign -s -) restores a consistent seal; it is not a Developer ID.
 */
"use strict";
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log(`  • ad-hoc signed ${path.basename(appPath)}`);
};
