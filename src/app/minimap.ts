/**
 * 簡易地図（方向と距離だけの図）の計算。DOM なし・外部通信なし。
 * 中心（いまいる場所／自宅）から避難場所への直線の向きと距離を、正方形の枠の中の位置に直す。
 * 座標はメモリで使うだけで、保存しない。
 */
import { DETOUR_FACTOR, WALK_SPEED } from '../core/evacuation.ts';
import { distanceM } from '../core/mesh.ts';
import type { LatLon, Shelter } from '../core/types.ts';

const EARTH_R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** from から to への方位（度）。0 = 北、時計回り、0 以上 360 未満。同じ地点は 0。 */
export function bearingDeg(from: LatLon, to: LatLon): number {
  const φ1 = rad(from.lat), φ2 = rad(to.lat), Δλ = rad(to.lon - from.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  if (Math.abs(x) < 1e-15 && Math.abs(y) < 1e-15) return 0;
  const b = (deg(Math.atan2(y, x)) + 360) % 360;
  return Number.isFinite(b) ? b : 0;
}

const DIR8 = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'] as const;
const DIR8_KIDS = ['きた', 'きたひがし', 'ひがし', 'みなみひがし', 'みなみ', 'みなみにし', 'にし', 'きたにし'] as const;
/** 8方位の番号（0 = 北）。各方位は中心 ±22.5°（22.5° ちょうどは北東）。 */
function dirIndex(d: number): number {
  const v = ((d % 360) + 360) % 360;
  return Math.floor((v + 22.5) / 45) % 8;
}
/** 北・北東・東・南東・南・南西・西・北西 */
export const dir8 = (d: number): string => DIR8[dirIndex(d)];
/** きた・きたひがし・ひがし…（こどもモード） */
export const dir8Kids = (d: number): string => DIR8_KIDS[dirIndex(d)];

/** origin を原点とした平面の位置（m）。東が +x、北が +y（正距円筒近似。数km なら十分）。 */
export function localXY(origin: LatLon, p: LatLon): { x: number; y: number } {
  const x = rad(p.lon - origin.lon) * Math.cos(rad(origin.lat)) * EARTH_R;
  const y = rad(p.lat - origin.lat) * EARTH_R;
  return { x, y };
}

const SCALES = [50, 100, 200, 250, 500, 1000, 2000] as const;
/** 目盛りの長さ（m）。maxM（枠の幅）の 1/4〜1/2 に入る、いちばん長いもの。入らなければ近い端（50 か 2000）。 */
export function niceScale(maxM: number): number {
  if (!(maxM > 0)) return SCALES[0];
  let pick: number = SCALES[0];
  for (const s of SCALES) if (s <= maxM / 2) pick = s;
  return pick;
}

/** 「約350m」「約1.2km」（結果画面の距離と同じ書き方）。 */
export function approxDistance(m: number): string {
  const v = Number.isFinite(m) && m > 0 ? m : 0;
  const r = Math.round(v / 10) * 10;
  return r < 1000 ? `約${r}m` : `約${(v / 1000).toFixed(1)}km`;
}

/** 直線距離からの徒歩の目安（分）。結果画面と同じ（直線×DETOUR_FACTOR、速さ m/s、切り上げ）。 */
export function walkMinutes(m: number, speedMps: number): number {
  const v = Number.isFinite(m) && m > 0 ? m : 0;
  return Math.ceil((v * DETOUR_FACTOR) / speedMps / 60);
}

/** この距離（m）より近いときは向きを言わない（「すぐ近く」）。 */
export const NEAR_M = 10;

export type MinimapPoint = { x: number; y: number; name: string };
export type MinimapModel = {
  /** 枠の一辺（px）。中心は (size/2, size/2)。画面の座標（下が +y） */
  size: number;
  /** 枠の半分が何 m か */
  halfM: number;
  target: MinimapPoint & { distanceM: number; bearing: number; dir: string; dirKids: string };
  /** 枠の中にある、ほかの避難場所（target は除く） */
  others: MinimapPoint[];
  scale: { m: number; px: number; label: string };
  /** 「北東へ 約350m」。10m 未満は「すぐ近く（約10m以内）」 */
  dirText: string;
  /** 「約350m」 */
  distanceText: string;
  /** ゆっくり歩いた目安（分） */
  walkSlowMin: number;
  /** 10m 未満（向きを言わない） */
  here: boolean;
};

/** target が枠の 80% 以内に入る縮尺で、中心 origin の図を作る。枠の半分は少なくとも 100m。 */
export function minimapModel(origin: LatLon, target: Shelter, others: Shelter[], sizePx: number): MinimapModel {
  const size = sizePx > 0 ? sizePx : 240;
  const half = size / 2;
  const d0 = distanceM(origin, target.pos);
  const d = Number.isFinite(d0) ? d0 : 0;
  // 縮尺は図の平面の距離で決める（球面距離とはわずかに違うので、図の上で 80% を超えないように）
  const tq = localXY(origin, target.pos);
  const planar = Number.isFinite(tq.x) && Number.isFinite(tq.y) ? Math.hypot(tq.x, tq.y) : 0;
  const halfM = Math.max(planar / 0.8, 100);
  const pxPerM = half / halfM;
  const toScreen = (p: LatLon): { x: number; y: number } => {
    const q = localXY(origin, p);
    const x = half + q.x * pxPerM, y = half - q.y * pxPerM;
    return { x: Number.isFinite(x) ? x : half, y: Number.isFinite(y) ? y : half };
  };
  const b = d < NEAR_M ? 0 : bearingDeg(origin, target.pos);
  const t = toScreen(target.pos);
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.x <= size && p.y >= 0 && p.y <= size;
  const otherPts = others
    .filter((s) => s.id !== target.id)
    .map((s) => ({ ...toScreen(s.pos), name: s.name }))
    .filter(inside);
  const scaleM = niceScale(halfM * 2);
  const here = d < NEAR_M;
  const distanceText = approxDistance(d);
  return {
    size,
    halfM,
    target: { ...t, name: target.name, distanceM: d, bearing: b, dir: dir8(b), dirKids: dir8Kids(b) },
    others: otherPts,
    scale: { m: scaleM, px: scaleM * pxPerM, label: scaleM >= 1000 ? `${scaleM / 1000}km` : `${scaleM}m` },
    dirText: here ? 'すぐ近く（約10m以内）' : `${dir8(b)}へ ${distanceText}`,
    distanceText,
    walkSlowMin: walkMinutes(d, WALK_SPEED.slow),
    here,
  };
}
