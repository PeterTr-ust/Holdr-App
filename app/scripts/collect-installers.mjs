/**
 * Copies the installers built on this machine into app/release/ under stable
 * file names, ready to be attached to a GitHub release. Stable names keep the
 * download links ("releases/latest/download/<name>") valid across versions:
 *
 *   Windows: Holdr-Windows-Setup.exe, Holdr-Windows.msi
 *   macOS:   Holdr-macOS.dmg (universal: Apple Silicon and Intel)
 *
 * Run after `npm run desktop:build:windows` or `npm run desktop:build:mac`.
 * The release folder is git-ignored.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
const target = join(appDir, "src-tauri", "target");
const downloads = join(appDir, "release");

const ARTIFACTS = [
  {
    dir: join(target, "release", "bundle", "nsis"),
    suffix: "_x64-setup.exe",
    name: "Holdr-Windows-Setup.exe",
  },
  {
    dir: join(target, "release", "bundle", "msi"),
    suffix: "_x64_en-US.msi",
    name: "Holdr-Windows.msi",
  },
  {
    dir: join(target, "universal-apple-darwin", "release", "bundle", "dmg"),
    suffix: "_universal.dmg",
    name: "Holdr-macOS.dmg",
  },
];

mkdirSync(downloads, { recursive: true });
let copied = 0;

for (const { dir, suffix, name } of ARTIFACTS) {
  // Only take the installer of the current version, never a stale one.
  const file = `Holdr_${version}${suffix}`;
  if (!existsSync(dir) || !readdirSync(dir).includes(file)) continue;
  copyFileSync(join(dir, file), join(downloads, name));
  console.log(`✓ ${file} → app/release/${name}`);
  copied += 1;
}

if (copied === 0) {
  console.error(`No installers for version ${version} found. Build them first (see README).`);
  process.exit(1);
}
