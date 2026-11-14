/**
 * 「📍 ピンを動かす」（結果の地図で地点を変えて調べ直す）の言葉と状態。DOM なし。
 * 元の地点・動かした地点はメモリだけで持つ（保存・URL・共有文に入れない）。
 */
import { distanceM } from '../core/mesh.ts';
import type { HomeInput, LatLon } from '../core/types.ts';
import { approxDistance, bearingDeg, dir8 } from './minimap.ts';
import type { LocationSource } from './viewmodel.ts';

/** 元の地点（住所・現在地・地図で選んだ所）と、いま計算している地点。メモリだけ。 */
export type MoveState = {
  origin: LatLon;
  originWhere: LocationSource;
  /** 建物の入力（動かしても同じものを使う） */
  home: HomeInput;
  current: LatLon;
};

export const MOVE_TEXT = {
  start: 'ピンを動かす',
  guide: '地図を動かして、十字を調べたい場所に合わせてください',
  crosshair: 'ここを調べる',
  confirm: 'ここで調べ直す',
  cancel: 'やめる',
  busy: 'この場所で計算しています…',
  failed: 'うまく調べられませんでした。通信状況を確認して、もう一度お試しください。',
} as const;

/** この距離（m）未満の移動は「動かしていない」とみなす */
const SAME_M = 1;

/** 元の地点の呼び方（住所の位置／現在地／地図で選んだ位置） */
export function originLabel(where: LocationSource): string {
  return where.kind === 'address' ? '住所の位置' : where.kind === 'gps' ? '現在地' : '地図で選んだ位置';
}

/** 「住所の位置にもどす」 */
export function resetLabel(where: LocationSource): string {
  return `${originLabel(where)}にもどす`;
}

export function isMoved(s: Pick<MoveState, 'origin' | 'current'>): boolean {
  const d = distanceM(s.origin, s.current);
  return Number.isFinite(d) && d >= SAME_M;
}

/** 同じ地点とみなすか（十字を動かさずに「ここで調べ直す」） */
export function samePlace(a: LatLon, b: LatLon): boolean {
  const d = distanceM(a, b);
  return !Number.isFinite(d) || d < SAME_M;
}

/** 「ピンの位置で計算しました（住所の位置から 北東へ約120m）」。距離は 10m 単位（1km 以上は 0.1km 単位）。 */
export function movedNote(origin: LatLon, current: LatLon, where: LocationSource): string {
  const d = distanceM(origin, current);
  const from = originLabel(where);
  if (!Number.isFinite(d) || d < 10) return `ピンの位置で計算しました（${from}のすぐ近く）`;
  return `ピンの位置で計算しました（${from}から ${dir8(bearingDeg(origin, current))}へ${approxDistance(d)}）`;
}
