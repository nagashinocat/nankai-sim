import type { HomeInput } from '../core/types.ts';
import type { AreaVM, EvacVM, OkHomeVM } from './viewmodel.ts';

/** 保存する避難場所。名前と距離・徒歩の文字列だけ（座標は持たせない）。 */
export type SavedShelterList = {
  hazard: 'earthquake' | 'tsunami';
  items: { name: string; distance: string; walkStandard: string; walkSlow: string }[];
};

/**
 * 端末内（localStorage）に保存する前回の結果。結果が出たとき（home が ok）だけ保存する。
 * プライバシー: 住所の文字列・座標は含めない（型にも持たせない）。
 */
export type Saved = {
  v: 2; // スキーマ版。変えたら上げる（古い値は読み捨てる）。v2 で避難場所を追加
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
    items: e.items.map((i) => ({ name: i.name, distance: i.distance, walkStandard: i.walkStandard, walkSlow: i.walkSlow })),
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
    l.items.every((i) => isObj(i) && isStr(i.name) && isStr(i.distance) && isStr(i.walkStandard) && isStr(i.walkSlow)));
}

function validSaved(o: Record<string, unknown>): boolean {
  if (o.v !== 2 || typeof o.savedAt !== 'string') return false;
  if (o.municipality !== null && typeof o.municipality !== 'string') return false;
  if (!isObj(o.input) || !isObj(o.home) || !isObj(o.area) || !validShelters(o.shelters)) return false;
  const h = o.home;
  if (h.status !== 'ok') return false;
  if (typeof h.intensityLabel !== 'string' || !isRange(h.collapse) || !isRange(h.half)) return false;
  if (h.liquefaction !== null && typeof h.liquefaction !== 'string') return false;
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
