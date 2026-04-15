const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

exports.default = async function setWindowsIcon(context) {
  if (context.electronPlatformName !== "win32") return;

  const projectDir = context.packager.projectDir;
  const productFilename = context.packager.appInfo.productFilename;
  const exePath = path.join(context.appOutDir, `${productFilename}.exe`);
  const iconPath = path.join(projectDir, "build", "icon.ico");
  const rceditPath = path.join(projectDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "qb-icon-"));
  const tempExePath = path.join(tempDir, "app.exe");
  const tempIconPath = path.join(tempDir, "icon.ico");

  try {
    fs.copyFileSync(exePath, tempExePath);
    fs.copyFileSync(iconPath, tempIconPath);
    execFileSync(rceditPath, [tempExePath, "--set-icon", tempIconPath], { stdio: "inherit" });
    fs.copyFileSync(tempExePath, exePath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
