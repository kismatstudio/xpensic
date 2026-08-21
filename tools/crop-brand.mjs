// Pure-Node PNG cropper (no sharp / jimp / pngjs dependency).
// Usage:  node tools/crop-brand.mjs <src.png> <dst.png> <x> <y> <w> <h>
//
// Decodes the source PNG (filter-aware scanline reconstruction), crops
// the requested rectangle, and re-encodes with a single IDAT chunk for
// simplicity. Supports truecolor (color type 2) and truecolor+alpha
// (color type 6) — which is what the brand PNGs use.

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync, deflateSync } from "node:zlib";
import { resolve } from "node:path";

// CRC table for PNG — declared at module top so it's initialized before
// any function is called from the top-level code below.
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const [, , srcPath, dstPath, xStr, yStr, wStr, hStr] = process.argv;
const x = Number(xStr);
const y = Number(yStr);
const w = Number(wStr);
const h = Number(hStr);

if (!srcPath || !dstPath || [x, y, w, h].some(Number.isNaN)) {
  console.error("usage: node tools/crop-brand.mjs <src> <dst> <x> <y> <w> <h>");
  process.exit(1);
}

const buf = readFileSync(resolve(srcPath));
if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
  throw new Error("not a PNG");
}

const chunks = [];
let p = 8;
while (p < buf.length) {
  const len = buf.readUInt32BE(p); p += 4;
  const type = buf.slice(p, p + 4).toString("binary"); p += 4;
  const data = buf.slice(p, p + len);
  p += len + 4;
  chunks.push({ type, data });
}

const ihdr = chunks.find((c) => c.type === "IHDR").data;
const srcW = ihdr.readUInt32BE(0);
const srcH = ihdr.readUInt32BE(4);
const bitDepth = ihdr[8];
const colorType = ihdr[9];
const channels = colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : null;
if (channels === null) throw new Error(`unsupported color type ${colorType}`);
if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);

const idatData = inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
const bpp = channels;
const src = unfilterScanlines(idatData, srcW, srcH, bpp);

if (x + w > srcW || y + h > srcH) {
  throw new Error(`crop ${w}x${h}@${x},${y} exceeds source ${srcW}x${srcH}`);
}

const cropped = Buffer.alloc(w * h * bpp);
for (let row = 0; row < h; row++) {
  const srcOff = ((y + row) * srcW + x) * bpp;
  const dstOff = row * w * bpp;
  src.copy(cropped, dstOff, srcOff, srcOff + w * bpp);
}

const filtered = Buffer.alloc((w * bpp + 1) * h);
for (let row = 0; row < h; row++) {
  filtered[row * (w * bpp + 1)] = 0;
  cropped.copy(filtered, row * (w * bpp + 1) + 1, row * w * bpp, (row + 1) * w * bpp);
}
const out = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
out.push(makeChunk("IHDR", encodeIHDR(w, h, bitDepth, colorType)));
out.push(makeChunk("IDAT", deflateSync(filtered)));
out.push(makeChunk("IEND", Buffer.alloc(0)));

writeFileSync(resolve(dstPath), Buffer.concat(out));
console.log(`wrote ${dstPath} (${w}x${h}, ${(Buffer.concat(out).length / 1024).toFixed(1)} KB)`);

function unfilterScanlines(raw, w, h, bpp) {
  const stride = w * bpp;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const srcOff = y * (stride + 1) + 1;
    const dstOff = y * stride;
    for (let xb = 0; xb < stride; xb++) {
      const cur = raw[srcOff + xb];
      const left = xb >= bpp ? out[dstOff + xb - bpp] : 0;
      const up = y > 0 ? out[(y - 1) * stride + xb] : 0;
      const upLeft = y > 0 && xb >= bpp ? out[(y - 1) * stride + xb - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = (cur + left) & 0xff; break;
        case 2: v = (cur + up) & 0xff; break;
        case 3: v = (cur + ((left + up) >> 1)) & 0xff; break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          v = (cur + pr) & 0xff;
          break;
        }
        default: throw new Error(`bad filter ${filter} at row ${y}`);
      }
      out[dstOff + xb] = v;
    }
  }
  return out;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "binary");
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodeIHDR(w, h, bitDepth, colorType) {
  const buf = Buffer.alloc(13);
  buf.writeUInt32BE(w, 0);
  buf.writeUInt32BE(h, 4);
  buf[8] = bitDepth;
  buf[9] = colorType;
  return buf;
}