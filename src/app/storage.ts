import type { HomeInput } from '../core/types.ts';
import type { Scenario } from './data.ts';
import type { AreaVM, EvacVM, OkHomeVM } from './viewmodel.ts';

/** 保存する避難場所。名前と距離・徒歩の文字列だけ（座標は持たせない）。 */
export type SavedShelterList = {
  hazard: 'earthquake' | 'tsunami';
  items: { name: string; distance: string; walkStandard: string; walkSlow: string; reachText: string }[];
  /** 判定に使った到達時間の高さ（cm）。以前の保存には無い */
  arrivalCm?: number | null;
};

/**
 * 端末内（localStorage）に保存する前回の結果。結果が出たとき（home が ok）だけ保存する。
 * プライバシー: 住所の文字列・座標は含めない（型にも持たせない）。
 */
export type Saved = {
  v: 4; // スキーマ版。変えたら上げる（古い値は読み捨てる）。v2 で避難場所、v3 で津波（段階の文言・判定の文言）、v4 で scenario（選んだタブ）を追加。v3 は L2 として読む
  /** 選んだタブ（ケース）。ID の文字列だけ */
  scenario: Scenario;
  savedAt: string; // ISO 8601
  municipality: string | null;
  input: HomeInput;
  home: OkHomeVM;
  area: AreaVM;
  shelters: SavedShelterList[];
};

/** 画面の避難場所リスト → 保存用。決めたフィールドだけを写す（座標などが紛れ込まない）。 */
export function savedShelters(evac: EvacVM[]): SavedShelterList[] {
  return evac.map((e) => ({
    hazard: e.hazard,
    items: e.items.map((i) => ({ name: i.name, distance: i.distance, walkStandard: i.walkStandard, walkSlow: i.walkSlow, reachText: i.reachText })),
    arrivalCm: e.arrivalCm ?? null,
  }));
}

export const LAST_KEY = 'nankai-sim:last';
export const CHECKLIST_KEY = 'nankai-sim:checklist';
export const CHECKLIST_SIZE = 8;

export function saveLast(s: Saved, store: Storage): void {
  try { store.setItem(LAST_KEY, JSON.stringify(s)); } catch { /* 保存できなくても表示は続ける */ }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isRange = (x: unknown): boolean =>
  isObj(x) && typeof x.min === 'string' && typeof x.max === 'string' && typeof x.central === 'string';

const isStr = (x: unknown): x is string => typeof x === 'string';

function validShelters(x: unknown): boolean {
  return Array.isArray(x) && x.every((l) =>
    isObj(l) && (l.hazard === 'earthquake' || l.hazard === 'tsunami') && Array.isArray(l.items) &&
    (l.arrivalCm === undefined || l.arrivalCm === null || typeof l.arrivalCm === 'number') &&
    l.items.every((i) => isObj(i) && isStr(i.name) && isStr(i.distance) && isStr(i.walkStandard) && isStr(i.walkSlow) && isStr(i.reachText)));
}

const SCENARIO_IDS: readonly unknown[] = ['L2', 'HALF_E', 'HALF_W', 'LAG_EW', 'LAG_WE'];

function validSaved(o: Record<string, unknown>): boolean {
  if (o.v !== 4 || !SCENARIO_IDS.includes(o.scenario) || typeof o.savedAt !== 'string') return false;
  if (o.municipality !== null && typeof o.municipality !== 'string') return false;
  if (!isObj(o.input) || !isObj(o.home) || !isObj(o.area) || !validShelters(o.shelters)) return false;
  const h = o.home;
  if (h.status !== 'ok') return false;
  if (typeof h.intensityLabel !== 'string' || !isRange(h.collapse) || !isRange(h.half)) return false;
  if (h.liquefaction !== null && typeof h.liquefaction !== 'string') return false;
  const t = h.tsunami;
  if (!isObj(t)) return false;
  if (t.kind === 'band' || t.kind === 'nearby') { if (!isStr(t.depth) || (t.arrival !== null && !isStr(t.arrival)) || typeof t.urgent !== 'boolean' || (t.arrivalCaveat !== undefined && !isStr(t.arrivalCaveat))) return false; }
  else if (t.kind !== 'none' && t.kind !== 'unknown') return false;
  if (h.stages !== undefined && !(Array.isArray(h.stages) && h.stages.every((g) => isObj(g) && isStr(g.label) && isRange(g.collapse) && isRange(g.half)))) return false;
  // 時間差（LAG_*）は stages 必須、それ以外は stages なし
  if ((typeof o.scenario === 'string' && o.scenario.startsWith('LAG_')) !== (h.stages !== undefined)) return false;
  if (!Array.isArray(h.notes) || !h.notes.every((n) => typeof n === 'string')) return false;
  const a = o.area;
  if (a.status === 'ok') return Number.isFinite(a.collapse) && Number.isFinite(a.half) && Number.isFinite(a.meshes);
  return a.status === 'nostock' || a.status === 'unavailable';
}

/** 読めない値（壊れている・古いスキーマ）は null を返し、端末からも消す。 */
export function loadLast(store: Storage): Saved | null {
  try {
    const raw = store.getItem(LAST_KEY);
    if (raw === null) return null;
    let v: unknown = null;
    try { v = JSON.parse(raw); } catch { /* 下で消す */ }
    // v3 は scenario を持たない（L2 だけだった）。v4 に読み替える。
    if (isObj(v) && v.v === 3) v = { ...v, v: 4, scenario: 'L2' };
    if (isObj(v) && validSaved(v)) return v as unknown as Saved;
    clearLast(store);
    return null;
  } catch {
    return null;
  }
}

export function clearLast(store: Storage): void {
  try { store.removeItem(LAST_KEY); } catch { /* 無視 */ }
}

const emptyChecklist = () => Array<boolean>(CHECKLIST_SIZE).fill(false);

export function saveChecklist(checked: boolean[], store: Storage): void {
  try { store.setItem(CHECKLIST_KEY, JSON.stringify(checked)); } catch { /* 無視 */ }
}

export function loadChecklist(store: Storage): boolean[] {
  try {
    const raw = store.getItem(CHECKLIST_KEY);
    if (raw === null) return emptyChecklist();
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v) || v.length !== CHECKLIST_SIZE || !v.every((x) => typeof x === 'boolean')) return emptyChecklist();
    return v as boolean[];
  } catch {
    return emptyChecklist();
  }
}
