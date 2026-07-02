/*
 * Assembles the deployable web bundle into ./www for Capacitor.
 * Copies only the PWA runtime files (no tests, scripts, or node_modules).
 * Run: node scripts/build-www.mjs   (or: npm run build)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WWW = path.join(ROOT, "www");

const FILES = ["index.html", "app.js", "recommend.js", "weather.js", "manifest.webmanifest", "sw.js"];
const DIRS = ["icons"];

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(WWW, f));
for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(WWW, d), { recursive: true });

console.log("Built www/ →", FILES.length + DIRS.length, "entries copied.");
