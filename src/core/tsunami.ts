/** 津波浸水深の段階。20m以上は hi=20, mid=20。rgb は地理院の凡例色。 */
export type TsunamiBand = { label: string; lo: number; hi: number; mid: number; rgb: [number, number, number] };

export const TSUNAMI_BANDS: TsunamiBand[] = [
  { label: '0.3m未満', lo: 0, hi: 0.3, mid: 0.15, rgb: [255, 255, 179] },
  { label: '0.3〜0.5m', lo: 0.3, hi: 0.5, mid: 0.4, rgb: [247, 245, 169] },
  { label: '0.5〜1m', lo: 0.5, hi: 1, mid: 0.75, rgb: [248, 225, 166] },
  { label: '1〜3m', lo: 1, hi: 3, mid: 2, rgb: [255, 216, 192] },
  { label: '3〜5m', lo: 3, hi: 5, mid: 4, rgb: [255, 183, 183] },
  { label: '5〜10m', lo: 5, hi: 10, mid: 7.5, rgb: [255, 145, 145] },
  { label: '10〜20m', lo: 10, hi: 20, mid: 15, rgb: [242, 133, 201] },
  { label: '20m以上', lo: 20, hi: 20, mid: 20, rgb: [220, 122, 220] },
];

const MAX_DISTANCE = 24;

/** タイル画素 → 段階。a<128 は浸水域外('none')。最も近い凡例色との距離が24以内ならその段階、それ以外 'unknown'。 */
export function bandFromRgba(r: number, g: number, b: number, a: number): TsunamiBand | 'none' | 'unknown' {
  if (a < 128) return 'none';
  let best: TsunamiBand | null = null;
  let bestD = Infinity;
  for (const band of TSUNAMI_BANDS) {
    const d = Math.hypot(r - band.rgb[0], g - band.rgb[1], b - band.rgb[2]);
    if (d < bestD) { bestD = d; best = band; }
  }
  return best && bestD <= MAX_DISTANCE ? best : 'unknown';
}
