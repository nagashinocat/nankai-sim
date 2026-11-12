/**
 * 「家族の決まり」メモ。端末内（localStorage）だけに保存する。結果の保存（storage.ts）とは別のキー。
 * 座標・住所は持たない（避難場所は名前の文字列だけ）。
 */
export const FAMILY_KEY = 'nankai-sim:family:v1';
export const FAMILY_BACKUP_KEY = 'nankai-sim:family:v1:backup';
export const MAX_LINE = 200;
export const MAX_AREA = 600;
export const MAX_ROWS = 8;

export type FamilyRow = { who: string; memo: string };
export type FamilyMemo = {
  tsunami: string; quake: string; meet1: string; meet2: string;
  contact: string; relay: string; rows: FamilyRow[]; items: string;
  /** 見直した日 YYYY-MM-DD */
  reviewed: string | null;
};

export const emptyFamily = (): FamilyMemo => ({
  tsunami: '', quake: '', meet1: '', meet2: '', contact: '', relay: '', rows: [], items: '', reviewed: null,
});

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const clamp = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max) : '');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 厳密に読む。壊れている・版が違うときは null（呼び出し側が退避する）。 */
export function parseFamilyStrict(raw: string | null | undefined): FamilyMemo | null {
  if (raw === null || raw === undefined) return null;
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!isObj(o) || o.v !== 1) return null;
  const rows = Array.isArray(o.rows)
    ? o.rows.filter(isObj).slice(0, MAX_ROWS).map((r) => ({ who: clamp(r.who, MAX_LINE), memo: clamp(r.memo, MAX_LINE) }))
    : [];
  return {
    tsunami: clamp(o.tsunami, MAX_LINE), quake: clamp(o.quake, MAX_LINE),
    meet1: clamp(o.meet1, MAX_LINE), meet2: clamp(o.meet2, MAX_LINE),
    contact: clamp(o.contact, MAX_AREA), relay: clamp(o.relay, MAX_LINE),
    rows, items: clamp(o.items, MAX_AREA),
    reviewed: typeof o.reviewed === 'string' && DATE_RE.test(o.reviewed) ? o.reviewed : null,
  };
}

/** 読めなければ空のメモ。例外は出さない。 */
export function parseFamily(raw: string | null | undefined): FamilyMemo {
  return parseFamilyStrict(raw) ?? emptyFamily();
}

export function serializeFamily(m: FamilyMemo): string {
  return JSON.stringify({
    v: 1,
    tsunami: m.tsunami.slice(0, MAX_LINE), quake: m.quake.slice(0, MAX_LINE),
    meet1: m.meet1.slice(0, MAX_LINE), meet2: m.meet2.slice(0, MAX_LINE),
    contact: m.contact.slice(0, MAX_AREA), relay: m.relay.slice(0, MAX_LINE),
    rows: m.rows.slice(0, MAX_ROWS).map((r) => ({ who: r.who.slice(0, MAX_LINE), memo: r.memo.slice(0, MAX_LINE) })),
    items: m.items.slice(0, MAX_AREA),
    reviewed: m.reviewed && DATE_RE.test(m.reviewed) ? m.reviewed : null,
  });
}

/** 読み込み。壊れた値は消さず、バックアップのキーに一度だけ写す。 */
export function loadFamily(store: Pick<Storage, 'getItem' | 'setItem'>): FamilyMemo {
  let raw: string | null = null;
  try { raw = store.getItem(FAMILY_KEY); } catch { return emptyFamily(); }
  if (raw === null) return emptyFamily();
  const m = parseFamilyStrict(raw);
  if (m) return m;
  try { if (store.getItem(FAMILY_BACKUP_KEY) === null) store.setItem(FAMILY_BACKUP_KEY, raw); } catch { /* 退避できなくても続ける */ }
  return emptyFamily();
}

/** 保存。できたら true。 */
export function saveFamily(m: FamilyMemo, store: Pick<Storage, 'setItem'>): boolean {
  try { store.setItem(FAMILY_KEY, serializeFamily(m)); return true; } catch { return false; }
}

export function formatReviewed(d: string): string {
  const [y, mo, da] = d.split('-').map(Number);
  return `${y}年${mo}月${da}日`;
}

const filled = (s: string): string => s.trim();

export function isEmptyFamily(m: FamilyMemo): boolean {
  return !(filled(m.tsunami) || filled(m.quake) || filled(m.meet1) || filled(m.meet2) || filled(m.contact) || filled(m.relay) ||
    filled(m.items) || m.rows.some((r) => filled(r.who) || filled(r.memo)));
}

/** コピー用の文面。書いた項目だけを出す。 */
export function familyText(m: FamilyMemo): string {
  const out: string[] = ['【わが家の災害時の決まり】'];
  const sec = (title: string, lines: string[]): void => { if (lines.length) out.push('', `■${title}`, ...lines); };
  sec('津波のときの避難先', filled(m.tsunami) ? [filled(m.tsunami)] : []);
  sec('地震（火事など）のときの避難先', filled(m.quake) ? [filled(m.quake)] : []);
  sec('はぐれたときの集合場所', [
    filled(m.meet1) ? `第1：${filled(m.meet1)}` : '', filled(m.meet2) ? `第2：${filled(m.meet2)}` : '',
  ].filter(Boolean));
  sec('連絡のしかた', [
    filled(m.contact), filled(m.relay) ? `連絡を中継する人：${filled(m.relay)}` : '',
  ].filter(Boolean));
  sec('家族それぞれの予定', m.rows
    .filter((r) => filled(r.who) || filled(r.memo))
    .map((r) => `・${[filled(r.who), filled(r.memo)].filter(Boolean).join('：')}`));
  sec('持ち出す物・置き場所', filled(m.items) ? [filled(m.items)] : []);
  if (m.reviewed) out.push('', `見直した日：${formatReviewed(m.reviewed)}`);
  return out.join('\n');
}
