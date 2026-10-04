// Generates assets/image/farsidecheck-icon.png: an original placeholder icon (a dial arc with a band
// tick on a dark background). No dependencies: it writes a PNG with Node's zlib.
// Run: node scripts/generate-icon.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 512;
const SUPERSAMPLE = 3;

const BG = [11, 18, 32];
const ARC_TRACK = [58, 74, 104];
const ARC_FILL = [255, 214, 10];
const TICK = [245, 247, 250];

// Dial geometry in pixels: half circle opening upwards, centre slightly below the middle.
const CX = SIZE / 2;
const CY = SIZE * 0.62;
const R = SIZE * 0.34;
const HALF_STROKE = SIZE * 0.055;
const FILL_FRACTION = 0.68;
const TICK_FRACTION = 0.5;

function angleOf(fraction) {
  return Math.PI * (1 - fraction); // fraction 0 -> pi (left), 1 -> 0 (right)
}

function colourAt(x, y) {
  const dx = x - CX;
  const dy = CY - y; // y-up
  const r = Math.hypot(dx, dy);
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += 2 * Math.PI;
  // Dial arc (upper half only).
  if (dy >= 0 && Math.abs(r - R) <= HALF_STROKE) {
    const fraction = 1 - angle / Math.PI;
    return fraction <= FILL_FRACTION ? ARC_FILL : ARC_TRACK;
  }
  // Band tick: a short radial bar across the arc at TICK_FRACTION.
  const ta = angleOf(TICK_FRACTION);
  const along = dx * Math.cos(ta) + dy * Math.sin(ta);
  const across = -dx * Math.sin(ta) + dy * Math.cos(ta);
  if (Math.abs(across) <= SIZE * 0.012 && along >= R - HALF_STROKE * 1.7 && along <= R + HALF_STROKE * 1.7) {
    return TICK;
  }
  return BG;
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let sy = 0; sy < SUPERSAMPLE; sy++) {
      for (let sx = 0; sx < SUPERSAMPLE; sx++) {
        const c = colourAt(x + (sx + 0.5) / SUPERSAMPLE, y + (sy + 0.5) / SUPERSAMPLE);
        r += c[0];
        g += c[1];
        b += c[2];
      }
    }
    const n = SUPERSAMPLE * SUPERSAMPLE;
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    raw[o] = Math.round(r / n);
    raw[o + 1] = Math.round(g / n);
    raw[o + 2] = Math.round(b / n);
    raw[o + 3] = 255;
  }
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/image/farsidecheck-icon.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log('wrote ' + out + ' (' + png.length + ' bytes)');
