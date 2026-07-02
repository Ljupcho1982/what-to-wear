/*
 * Dependency-free PNG icon generator for What to Wear.
 * Draws a white t-shirt on the brand gradient. Run: node scripts/gen-icons.mjs
 */
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "icons");

// Brand gradient endpoints (top-left → bottom-right).
const C1 = [0x3d, 0xa9, 0xfc];
const C2 = [0x7c, 0x5c, 0xff];

// T-shirt outline in normalized [0,1] space (y grows downward).
const SHIRT = [
  [0.10, 0.30], [0.30, 0.19], [0.40, 0.19], [0.50, 0.28], [0.60, 0.19],
  [0.70, 0.19], [0.90, 0.30], [0.78, 0.44], [0.70, 0.37], [0.70, 0.82],
  [0.30, 0.82], [0.30, 0.37], [0.22, 0.44]
];

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function render(size, { rounded, shirtScale }) {
  const data = Buffer.alloc(size * size * 4);
  const r = size * 0.22;                 // corner radius for "any" icons
  const s = shirtScale;                  // shirt scale within the square
  const off = (1 - s) / 2;               // centering offset

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Rounded-corner transparency (skip for maskable/full-bleed).
      if (rounded && outsideRounded(x, y, size, r)) { data[i + 3] = 0; continue; }

      // Gradient background.
      const t = (x + y) / (2 * size);
      data[i]     = Math.round(C1[0] + (C2[0] - C1[0]) * t);
      data[i + 1] = Math.round(C1[1] + (C2[1] - C1[1]) * t);
      data[i + 2] = Math.round(C1[2] + (C2[2] - C1[2]) * t);
      data[i + 3] = 255;

      // White shirt on top.
      const nx = (x / size - off) / s;
      const ny = (y / size - off) / s;
      if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 && pointInPoly(nx, ny, SHIRT)) {
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
      }
    }
  }
  return data;
}

function outsideRounded(x, y, size, r) {
  const cx = Math.min(x, size - 1 - x);
  const cy = Math.min(y, size - 1 - y);
  if (cx >= r || cy >= r) return false;
  const dx = r - cx, dy = r - cy;
  return dx * dx + dy * dy > r * r;
}

// --- Minimal PNG encoder (RGBA, no filtering) -----------------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

fs.mkdirSync(OUT, { recursive: true });
const jobs = [
  ["icon-192.png", 192, { rounded: true, shirtScale: 0.78 }],
  ["icon-512.png", 512, { rounded: true, shirtScale: 0.78 }],
  ["icon-maskable-512.png", 512, { rounded: false, shirtScale: 0.62 }] // shirt inside safe zone
];
for (const [name, size, opts] of jobs) {
  fs.writeFileSync(path.join(OUT, name), encodePng(size, render(size, opts)));
  console.log("wrote", name);
}
