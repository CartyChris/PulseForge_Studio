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
  // codesign refuses bundles whose files carry extended attributes ("resource fork, Finder information,
  // or similar detritus not allowed") — files copied out of a Finder/iCloud-managed folder such as
  // ~/Desktop pick them up. Strip them from the packaged copy only.
  execFileSync("xattr", ["-cr", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log(`  • ad-hoc signed ${path.basename(appPath)}`);
};
