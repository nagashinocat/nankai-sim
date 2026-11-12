import type { LatLon } from '../core/types.ts';
import { TSUNAMI_BANDS, bandFromRgba, type TsunamiBand } from '../core/tsunami.ts';

export const TSUNAMI_TILE_URL = 'https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png';
export const TSUNAMI_TILE_ZOOM = 17;

/** Web メルカトル（256px タイル）の通しの画素座標（小数）。 */
function worldPixel(pos: LatLon, z: number): { gx: number; gy: number } {
  const n = 2 ** z;
  const latRad = (pos.lat * Math.PI) / 180;
  return {
    gx: ((pos.lon + 180) / 360) * n * 256,
    gy: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n * 256,
  };
}

/** 通しの画素 → タイル番号とタイル内の画素位置 */
function splitPixel(gx: number, gy: number): { x: number; y: number; px: number; py: number } {
  const ix = Math.floor(gx), iy = Math.floor(gy);
  const x = Math.floor(ix / 256), y = Math.floor(iy / 256);
  return { x, y, px: ix - x * 256, py: iy - y * 256 };
}

/** Web メルカトル（256px タイル）の タイル番号と、タイル内の画素位置 */
export function tileAndPixel(pos: LatLon, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z;
  const fx = ((pos.lon + 180) / 360) * n;
  const latRad = (pos.lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  const clamp = (v: number) => Math.min(255, Math.max(0, v));
  return { x, y, px: clamp(Math.floor((fx - x) * 256)), py: clamp(Math.floor((fy - y) * 256)) };
}

/** タイル URL の画素 (px, py) の RGBA。タイルが無い（404）なら透明。それ以外の失敗は例外。 */
export type PixelReader = (url: string, px: number, py: number) => Promise<[number, number, number, number]>;

type TsunamiRead = TsunamiBand | 'none' | 'unknown';

/** タイル (x, y) の画素 (px, py) の段階。同じ画素は1回だけ読む（失敗・unknown は覚えない）。例外にはしない。 */
function bandAtPixel(read: PixelReader, zoom: number, x: number, y: number, px: number, py: number): Promise<TsunamiRead> {
  const url = TSUNAMI_TILE_URL.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y));
  const key = `${url}#${px},${py}`;
  // reader ごとに別キャッシュにするため、reader をキーの一部として WeakMap で持つ
  let cache = caches.get(read);
  if (!cache) caches.set(read, (cache = new Map()));
  let p = cache.get(key);
  if (!p) {
    p = read(url, px, py).then(([r, g, b, a]) => bandFromRgba(r, g, b, a));
    cache.set(key, p);
    const c = cache;
    p.then((v) => { if (v === 'unknown') c.delete(key); }, () => c.delete(key));
  }
  return p.catch(() => 'unknown' as const);
}

/** 津波浸水深の段階。浸水域外 'none'。読めない・凡例に合わない色は 'unknown'。同じ画素は1回だけ読む（失敗は覚えない）。 */
export function tsunamiAt(pos: LatLon, read: PixelReader, zoom: number = TSUNAMI_TILE_ZOOM): Promise<TsunamiRead> {
  const { x, y, px, py } = tileAndPixel(pos, zoom);
  return bandAtPixel(read, zoom, x, y, px, py);
}

/** 自宅の近くを見る半径（Ruling F3）。 */
export const NEARBY_RADIUS_M = 50;

/** Web メルカトルの1画素の大きさ（m）。156543.03392 × cos(緯度) / 2^z。 */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** 自宅の津波。段階・浸水域外・判定できない、または「すぐ近くまで浸水」（nearby = 周りでいちばん深い段階）。 */
export type HomeTsunami = TsunamiRead | { nearby: TsunamiBand };

/**
 * 自宅の津波（Ruling F3）。中心の画素が段階ならそれ。そうでなければ、約50m の8方向（N・NE・E・SE・S・SW・W・NW）も読み、
 * どれかが段階なら { nearby: いちばん深い段階 }。読めない点は無視するが、周り8点がすべて読めないときは浸水域外と言わず 'unknown'。
 * 中心が読めず、周りにも段階が無いときは 'unknown' のまま。
 */
export async function tsunamiAround(pos: LatLon, read: PixelReader, radiusM: number = NEARBY_RADIUS_M, zoom: number = TSUNAMI_TILE_ZOOM): Promise<HomeTsunami> {
  const centre = await tsunamiAt(pos, read, zoom);
  if (typeof centre === 'object') return centre;
  const { gx, gy } = worldPixel(pos, zoom);
  const d = radiusM / metresPerPixel(pos.lat, zoom);
  const ring = await Promise.all(
    [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
      const rad = (deg * Math.PI) / 180; // 北から時計回り。画素の y は南向き
      const { x, y, px, py } = splitPixel(gx + d * Math.sin(rad), gy - d * Math.cos(rad));
      return bandAtPixel(read, zoom, x, y, px, py);
    }),
  );
  const bands = ring.filter((r): r is TsunamiBand => typeof r === 'object');
  if (bands.length > 0) return { nearby: bands.reduce((a, b) => (TSUNAMI_BANDS.indexOf(b) > TSUNAMI_BANDS.indexOf(a) ? b : a)) };
  if (centre === 'unknown' || ring.every((r) => r === 'unknown')) return 'unknown';
  return 'none';
}
const caches = new WeakMap<PixelReader, Map<string, Promise<TsunamiBand | 'none' | 'unknown'>>>();

/** ブラウザ用。fetch → createImageBitmap → canvas → getImageData。404（浸水なしのタイル）は透明を返す。 */
export function canvasPixelReader(): PixelReader {
  const tiles = new Map<string, Promise<ImageData | null>>();
  const load = (url: string): Promise<ImageData | null> => {
    let p = tiles.get(url);
    if (!p) {
      p = (async () => {
        const res = await fetch(url);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        const bmp = await createImageBitmap(await res.blob());
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (!ctx) throw new Error('canvas unavailable');
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      })();
      tiles.set(url, p);
      p.catch(() => tiles.delete(url));
    }
    return p;
  };
  return async (url, px, py) => {
    const img = await load(url);
    if (!img) return [0, 0, 0, 0];
    const i = (py * img.width + px) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
  };
}
