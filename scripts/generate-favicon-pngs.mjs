#!/usr/bin/env node
/**
 * Rasterizes the Strata layered-bars wordmark (apps/web/public/favicon.svg)
 * into PNG fallbacks, with zero new dependencies: a minimal in-repo PNG
 * encoder (RGBA -> zlib-deflated scanlines -> PNG chunks) plus a hand-rolled
 * rounded-rect/gradient rasterizer, 4x supersampled and box-downsampled for
 * anti-aliasing. Re-run after any change to the mark's geometry/colors.
 *
 * Output:
 *   apps/web/public/favicon.png        (32x32 legacy <link rel="icon"> fallback)
 *   apps/web/public/apple-touch-icon.png (180x180, Apple's documented size)
 */
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, '../apps/web/public');

// Brand colors — must stay in sync with apps/web/public/favicon.svg and the
// Strata dark-palette tokens in apps/web/src/styles.css (--ground, --text-1,
// --sol-1, --sol-2).
const GROUND = [0x0c, 0x14, 0x2e];
const ICE = [0xec, 0xf0, 0xfb];
const SOL_1 = [0xff, 0xb2, 0x7a];
const SOL_2 = [0xff, 0x88, 0x96];

const SUPERSAMPLE = 4;

/** @param {number} x @param {number} y @param {number} w @param {number} h @param {number} r */
function insideRoundedRect(x, y, w, h, r) {
  return (px, py) => {
    if (px < x || px >= x + w || py < y || py >= y + h) return false;
    const dx = px < x + r ? x + r - px : px > x + w - r ? px - (x + w - r) : 0;
    const dy = py < y + r ? y + r - py : py > y + h - r ? py - (y + h - r) : 0;
    if (dx === 0 || dy === 0) return true;
    return dx * dx + dy * dy <= r * r;
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixRgb(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** Renders the 32x32-viewBox mark at `big` px (already includes supersampling). */
function renderCanvas(big) {
  const scale = big / 32;
  const buf = new Float64Array(big * big * 3);
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const i = (y * big + x) * 3;
      buf[i] = GROUND[0];
      buf[i + 1] = GROUND[1];
      buf[i + 2] = GROUND[2];
    }
  }
  // Background rounded square is implicit (whole canvas already GROUND);
  // outer corner rounding is applied at alpha-composite time via the mask
  // built below (bgMask marks pixels inside the r=7 rounded square — pixels
  // outside it are left fully transparent so the icon reads correctly on
  // any browser-chrome background).
  const bgMask = insideRoundedRect(0, 0, 32 * scale, 32 * scale, 7 * scale);
  const alpha = new Float64Array(big * big).fill(0);
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      if (bgMask(x, y)) alpha[y * big + x] = 1;
    }
  }

  function paintRect(mask, color, opacity) {
    for (let y = 0; y < big; y++) {
      for (let x = 0; x < big; x++) {
        if (!mask(x, y)) continue;
        const i = (y * big + x) * 3;
        buf[i] = lerp(buf[i], color[0], opacity);
        buf[i + 1] = lerp(buf[i + 1], color[1], opacity);
        buf[i + 2] = lerp(buf[i + 2], color[2], opacity);
      }
    }
  }

  paintRect(
    insideRoundedRect(8 * scale, 6 * scale, 16 * scale, 5.4 * scale, 2.7 * scale),
    ICE,
    0.28,
  );
  paintRect(
    insideRoundedRect(5 * scale, 13 * scale, 22 * scale, 5.4 * scale, 2.7 * scale),
    ICE,
    0.55,
  );

  const barX = 2 * scale;
  const barW = 28 * scale;
  const barMask = insideRoundedRect(barX, 20 * scale, barW, 6.4 * scale, 3.2 * scale);
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      if (!barMask(x, y)) continue;
      const t = Math.min(1, Math.max(0, (x - barX) / barW));
      const color = mixRgb(SOL_1, SOL_2, t);
      const i = (y * big + x) * 3;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
    }
  }

  return { buf, alpha, big };
}

/** Box-downsamples an RGB+alpha supersampled canvas to `size`x`size` RGBA bytes. */
function downsample(canvas, size) {
  const { buf, alpha, big } = canvas;
  const factor = big / size;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const px = Math.floor(x * factor + sx);
          const py = Math.floor(y * factor + sy);
          const i = (py * big + px) * 3;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
          a += alpha[py * big + px];
          n++;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

// --- Minimal PNG encoder (RGBA8, no external dependency) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(rgba, size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type: none
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function generate(size, outPath) {
  const canvas = renderCanvas(size * SUPERSAMPLE);
  const rgba = downsample(canvas, size);
  const png = encodePng(rgba, size);
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}

generate(32, resolve(PUBLIC_DIR, 'favicon.png'));
generate(180, resolve(PUBLIC_DIR, 'apple-touch-icon.png'));
