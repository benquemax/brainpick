#!/usr/bin/env node
/**
 * Generate the PWA icon set — a glowing knowledge-constellation on deep
 * space. One shared geometry drives both the SVG favicon and the rasterized
 * PNGs (an SVG-derived set with zero image dependencies: pixels are drawn
 * procedurally and encoded as PNG via node:zlib).
 *
 * Outputs (public/icons/): favicon.svg, icon-192.png, icon-512.png,
 * icon-maskable-512.png, apple-touch-icon.png
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// ---- shared geometry (normalized 0..1 coordinates) ------------------------

const CYAN = [107, 229, 255];
const VIOLET = [173, 148, 255];
const NODES = [
  { x: 0.5, y: 0.47, r: 0.085, color: CYAN }, // the sun
  { x: 0.28, y: 0.3, r: 0.045, color: VIOLET },
  { x: 0.72, y: 0.27, r: 0.05, color: CYAN },
  { x: 0.79, y: 0.58, r: 0.042, color: VIOLET },
  { x: 0.63, y: 0.78, r: 0.038, color: CYAN },
  { x: 0.33, y: 0.72, r: 0.045, color: CYAN },
  { x: 0.19, y: 0.52, r: 0.032, color: VIOLET },
];
const EDGES = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 5],
  [1, 6],
  [2, 3],
  [4, 5],
  [0, 4],
];
const BG_TOP = [13, 19, 38];
const BG_BOTTOM = [4, 6, 14];

// ---- SVG ------------------------------------------------------------------

function buildSvg() {
  const S = 512;
  const nodeSvg = NODES.map((n, i) => {
    const [r, g, b] = n.color;
    return (
      `<circle cx="${(n.x * S).toFixed(1)}" cy="${(n.y * S).toFixed(1)}" r="${(n.r * S * 2.4).toFixed(1)}" fill="url(#glow${i})"/>` +
      `<circle cx="${(n.x * S).toFixed(1)}" cy="${(n.y * S).toFixed(1)}" r="${(n.r * S * 0.66).toFixed(1)}" fill="rgb(${r},${g},${b})"/>`
    );
  }).join('\n    ');
  const gradients = NODES.map((n, i) => {
    const [r, g, b] = n.color;
    return (
      `<radialGradient id="glow${i}"><stop offset="0%" stop-color="rgb(${r},${g},${b})" stop-opacity="0.9"/>` +
      `<stop offset="100%" stop-color="rgb(${r},${g},${b})" stop-opacity="0"/></radialGradient>`
    );
  }).join('\n      ');
  const edgeSvg = EDGES.map(([a, b]) => {
    const na = NODES[a];
    const nb = NODES[b];
    return `<line x1="${(na.x * S).toFixed(1)}" y1="${(na.y * S).toFixed(1)}" x2="${(nb.x * S).toFixed(1)}" y2="${(nb.y * S).toFixed(1)}"/>`;
  }).join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgb(${BG_TOP.join(',')})"/>
      <stop offset="100%" stop-color="rgb(${BG_BOTTOM.join(',')})"/>
    </linearGradient>
      ${gradients}
  </defs>
  <rect width="${S}" height="${S}" rx="${S * 0.22}" fill="url(#bg)"/>
  <g stroke="rgb(107,229,255)" stroke-opacity="0.38" stroke-width="3">
    ${edgeSvg}
  </g>
  <g>
    ${nodeSvg}
  </g>
</svg>
`;
}

// ---- PNG encoding -----------------------------------------------------------

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- procedural rasterizer ---------------------------------------------------

function render(size, { maskable = false } = {}) {
  const px = new Float64Array(size * size * 4);
  const cornerR = maskable ? 0 : size * 0.22;
  // content shrinks into the maskable safe zone (~80% circle)
  const zoom = maskable ? 0.72 : 1;
  const off = (1 - zoom) / 2;
  const nx = (v) => (v * zoom + off) * size;
  const nr = (v) => v * zoom * size;

  // background: vertical gradient inside a rounded rect
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const r = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t;
    const g = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t;
    const b = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t;
    for (let x = 0; x < size; x++) {
      let inside = 1;
      if (cornerR > 0) {
        const cx = Math.max(cornerR - x, x - (size - 1 - cornerR), 0);
        const cy = Math.max(cornerR - y, y - (size - 1 - cornerR), 0);
        inside = Math.hypot(cx, cy) <= cornerR ? 1 : 0;
      }
      if (inside === 0) continue;
      const i = (y * size + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }

  const additive = (x, y, [r, g, b], a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    if (px[i + 3] === 0) return; // outside the rounded rect
    px[i] = Math.min(255, px[i] + r * a);
    px[i + 1] = Math.min(255, px[i + 1] + g * a);
    px[i + 2] = Math.min(255, px[i + 2] + b * a);
  };

  // edges: soft glowing lines
  for (const [ai, bi] of EDGES) {
    const A = NODES[ai];
    const B = NODES[bi];
    const x1 = nx(A.x);
    const y1 = nx(A.y);
    const x2 = nx(B.x);
    const y2 = nx(B.y);
    const sigma = size * 0.004 + 0.8;
    const pad = Math.ceil(sigma * 3);
    const minX = Math.max(0, Math.floor(Math.min(x1, x2)) - pad);
    const maxX = Math.min(size - 1, Math.ceil(Math.max(x1, x2)) + pad);
    const minY = Math.max(0, Math.floor(Math.min(y1, y2)) - pad);
    const maxY = Math.min(size - 1, Math.ceil(Math.max(y1, y2)) + pad);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
        const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
        const a = Math.exp((-d * d) / (2 * sigma * sigma)) * 0.4;
        if (a > 0.003) additive(x, y, CYAN, a);
      }
    }
  }

  // nodes: bright core + wide halo
  for (const node of NODES) {
    const cx = nx(node.x);
    const cy = nx(node.y);
    const core = nr(node.r) * 0.62;
    const halo = nr(node.r) * 2.6;
    const pad = Math.ceil(halo);
    for (let y = Math.max(0, Math.floor(cy - pad)); y <= Math.min(size - 1, Math.ceil(cy + pad)); y++) {
      for (let x = Math.max(0, Math.floor(cx - pad)); x <= Math.min(size - 1, Math.ceil(cx + pad)); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > halo) continue;
        const coreA = Math.max(0, Math.min(1, (core - d) / Math.max(1, core * 0.35) + 0.4));
        const haloA = Math.exp((-d * d) / (2 * (halo * 0.42) ** 2)) * 0.75;
        const a = Math.min(1.4, coreA + haloA);
        additive(x, y, node.color, a);
        if (d < core * 0.5) additive(x, y, [255, 255, 255], 0.35 * (1 - d / (core * 0.5)));
      }
    }
  }

  const rgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < px.length; i++) rgba[i] = Math.round(px[i]);
  return rgba;
}

// ---- write the set -----------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'favicon.svg'), buildSvg());
for (const [name, size, opts] of [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
]) {
  writeFileSync(join(OUT_DIR, name), encodePng(size, size, render(size, opts)));
  console.log(`[icons] wrote ${name}`);
}
console.log(`[icons] wrote favicon.svg -> ${OUT_DIR}`);
