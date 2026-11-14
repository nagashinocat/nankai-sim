/**
 * アプリのアイコン（波と家、文字なし）を PNG で作る。外部の画像・道具は使わない。
 * 使い方: npx tsx scripts/make_icons.ts  → public/icons/*.png
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

type RGB = [number, number, number];
const NAVY: RGB = [0x1f, 0x4e, 0x79];
const WHITE: RGB = [0xff, 0xff, 0xff];
const WAVE: RGB = [0x5f, 0xb0, 0xe6];
const CREST: RGB = [0xc8, 0xe8, 0xfa];

/** 単位正方形（0〜1）の点の色。 */
function colorAt(x: number, y: number): RGB {
  // 波（下）
  const crest = 0.74 + 0.025 * Math.sin(2 * Math.PI * (x * 2.5 + 0.1));
  if (y > crest + 0.035) return WAVE;
  if (y > crest) return CREST;
  // 家
  const inRoof = y >= 0.22 && y <= 0.45 && Math.abs(x - 0.5) <= ((y - 0.22) / 0.23) * 0.25;
  const inBody = x >= 0.32 && x <= 0.68 && y >= 0.44 && y <= 0.72;
  const inDoor = x >= 0.455 && x <= 0.545 && y >= 0.57 && y <= 0.72;
  if (inDoor) return NAVY;
  if (inRoof || inBody) return WHITE;
  return NAVY;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** size 画素の PNG。scale < 1 で絵を中央に縮める（maskable の安全域）。4×4 の点の平均でなめらかに。 */
export function iconPng(size: number, scale = 1): Buffer {
  const SS = 4;
  const rows: Buffer[] = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = (px + (sx + 0.5) / SS) / size, v = (py + (sy + 0.5) / SS) / size;
        const [cr, cg, cb] = colorAt(0.5 + (u - 0.5) / scale, 0.5 + (v - 0.5) / scale);
        r += cr; g += cg; b += cb;
      }
      const n = SS * SS;
      row.set([Math.round(r / n), Math.round(g / n), Math.round(b / n)], 1 + px * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = join(process.cwd(), 'public', 'icons');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon-192.png'), iconPng(192));
writeFileSync(join(out, 'icon-512.png'), iconPng(512));
writeFileSync(join(out, 'maskable-512.png'), iconPng(512, 0.8));
writeFileSync(join(out, 'apple-touch-icon.png'), iconPng(180, 0.9));
console.log(`アイコンを書きました: ${out}`);
