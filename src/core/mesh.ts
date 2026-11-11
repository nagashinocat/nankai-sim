import type { LatLon } from './types.ts';

// 5次メッシュ(250m)。1単位 = 緯度 1/480度(7.5秒) × 経度 1/320度(11.25秒)。
const LAT_UNITS_PER_DEG = 480;
const LON_UNITS_PER_DEG = 320;
const LON_BASE = 100;
const EARTH_R = 6_371_000;
const EPS = 1e-7; // 浮動小数誤差で境界がずれないよう、インデックス空間で補正

const rad = (d: number) => (d * Math.PI) / 180;

/** 2点間の球面距離(m) */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function indexToCode(latIdx: number, lonIdx: number): string {
  // 1次: 緯度320単位(40分) / 経度320単位(1度)。2次: 8分割(40単位)。3次: 10分割(4単位)。
  const p = Math.floor(latIdx / 320);
  const u = Math.floor(lonIdx / 320);
  const latR = latIdx % 320;
  const lonR = lonIdx % 320;
  const q = Math.floor(latR / 40);
  const v = Math.floor(lonR / 40);
  const r = Math.floor((latR % 40) / 4);
  const w = Math.floor((lonR % 40) / 4);
  const latR4 = latR % 4;
  const lonR4 = lonR % 4;
  const d4 = Math.floor(latR4 / 2) * 2 + Math.floor(lonR4 / 2) + 1; // 南西1・南東2・北西3・北東4
  const d5 = Math.floor((latR4 % 2) * 2 + (lonR4 % 2)) + 1;
  return `${p}${u}${q}${v}${r}${w}${d4}${d5}`;
}

function codeToIndex(code: string): { latIdx: number; lonIdx: number } {
  if (!/^\d{10}$/.test(code)) throw new Error(`invalid mesh code: ${code}`);
  const n = (i: number, len = 1) => Number(code.slice(i, i + len));
  const p = n(0, 2), u = n(2, 2), q = n(4), v = n(5), r = n(6), w = n(7);
  const d4 = n(8) - 1, d5 = n(9) - 1;
  const latIdx = p * 320 + q * 40 + r * 4 + (d4 >> 1) * 2 + (d5 >> 1);
  const lonIdx = u * 320 + v * 40 + w * 4 + (d4 & 1) * 2 + (d5 & 1);
  return { latIdx, lonIdx };
}

const toIdx = (p: LatLon) => ({
  latIdx: Math.floor(p.lat * LAT_UNITS_PER_DEG + EPS),
  lonIdx: Math.floor((p.lon - LON_BASE) * LON_UNITS_PER_DEG + EPS),
});

const idxCenter = (latIdx: number, lonIdx: number): LatLon => ({
  lat: (latIdx + 0.5) / LAT_UNITS_PER_DEG,
  lon: LON_BASE + (lonIdx + 0.5) / LON_UNITS_PER_DEG,
});

/** 緯度経度 → 10桁の5次メッシュコード。境界上の点は南西側(= 大きい方のインデックス側)に入る。 */
export function latLonToMesh250(p: LatLon): string {
  const { latIdx, lonIdx } = toIdx(p);
  return indexToCode(latIdx, lonIdx);
}

/** 5次メッシュコード → 中心座標 */
export function meshCenter(code: string): LatLon {
  const { latIdx, lonIdx } = codeToIndex(code);
  return idxCenter(latIdx, lonIdx);
}

/** 先頭6桁(2次メッシュ) */
export function mesh2Of(code: string): string {
  return code.slice(0, 6);
}

/** 中心点が半径内にある 250m メッシュ(球面近似) */
export function meshesWithin(center: LatLon, radiusM: number): string[] {
  const dLat = (radiusM / EARTH_R) * (180 / Math.PI);
  const dLon = dLat / Math.max(Math.cos(rad(center.lat)), 1e-6);
  const lo = toIdx({ lat: center.lat - dLat, lon: center.lon - dLon });
  const hi = toIdx({ lat: center.lat + dLat, lon: center.lon + dLon });
  const out: string[] = [];
  for (let la = lo.latIdx; la <= hi.latIdx; la++) {
    for (let lo2 = lo.lonIdx; lo2 <= hi.lonIdx; lo2++) {
      if (distanceM(center, idxCenter(la, lo2)) <= radiusM + 1e-6) out.push(indexToCode(la, lo2));
    }
  }
  return out;
}
