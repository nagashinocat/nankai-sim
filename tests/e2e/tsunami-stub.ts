import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';

const TSUNAMI_HOST = '**/disaportaldata.gsi.go.jp/**';
const CORS = { 'access-control-allow-origin': '*' };

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 256×256 を1色で塗った PNG（RGBA）。hole(px, py) が true の画素は透明。 */
export function solidPng(r: number, g: number, b: number, a = 255, hole?: (px: number, py: number) => boolean): Buffer {
  const w = 256;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit, RGBA
  const raw = Buffer.concat(Array.from({ length: w }, (_, y) => {
    const row = Buffer.alloc(1 + w * 4);
    for (let x = 0; x < w; x++) row.set(hole?.(x, y) ? [0, 0, 0, 0] : [r, g, b, a], 1 + x * 4);
    return row;
  }));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** hole: z17 で、その地点から radiusPx 画素以内を透明（浸水域外）にする（自宅の点だけ浸水域外・周りは浸水、の確認用）。 */
export type TsunamiStub = 'none' | 'error' | { rgb: [number, number, number]; alpha?: number; hole?: { lat: number; lon: number; radiusPx: number } };

function worldPixel(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z * 256;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}

/** 津波タイルの配信元を差し替える。既定は 404（浸水域外）で、外部へは出ない。後から呼んだものが優先される。 */
export async function stubTsunami(page: Page, mode: TsunamiStub = 'none'): Promise<void> {
  await page.route(TSUNAMI_HOST, (route) => {
    if (mode === 'none') return route.fulfill({ status: 404, headers: CORS, body: 'not found' });
    if (mode === 'error') return route.fulfill({ status: 500, headers: CORS, body: 'error' });
    const m = /\/(\d+)\/(\d+)\/(\d+)\.png/.exec(route.request().url());
    const h = mode.hole;
    let hole: ((px: number, py: number) => boolean) | undefined;
    if (h && m && Number(m[1]) === 17) {
      const [cx, cy] = worldPixel(h.lat, h.lon, 17);
      const ox = Number(m[2]) * 256, oy = Number(m[3]) * 256;
      hole = (px, py) => Math.hypot(ox + px + 0.5 - cx, oy + py + 0.5 - cy) <= h.radiusPx;
    }
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: solidPng(...mode.rgb, mode.alpha ?? 255, hole) });
  });
}
