/**
 * 避難場所のデータ（公開データ・5県すべて）の自動保存。電波があるときにアプリを開くと、裏で専用キャッシュに保存する。
 * - 保存のしくみは手動と同じ（saveShelters・専用キャッシュ・保存日）。現在地・住所は保存しない。
 * - 手動の保存・削除と同じロック（このタブ内はキュー、タブどうしは Web Locks）で、同時に走らない。
 * - 失敗しても画面にエラーを出さない（次に開いたときに続きから）。
 * - 「保存したデータを消す」で止める（SHELTERS_AUTO_OFF_KEY）。手動で保存し直したら解除。
 */
import {
  clearSheltersSaved, hasNewerData, loadSheltersSaved, saveShelters, savedIndex, today, writeSheltersSaved,
  type CachesLike, type ShelterIndex,
} from './offline.ts';

/** '1' なら自動で保存しない（利用者が保存したデータを消した） */
export const SHELTERS_AUTO_OFF_KEY = 'nankai-sim:shelters-auto-off';
/** '1' なら自動保存が途中で止まった（次に開いたとき続きから） */
export const SHELTERS_AUTO_PENDING_KEY = 'nankai-sim:shelters-auto-pending';
/** 同時に取りに行くファイルの数（手動の 6 より少なく、表示の邪魔をしない） */
export const AUTO_CONCURRENCY = 2;
const LOCK_NAME = 'nankai-sim:shelters-save';

export type AutoSaveCheck = {
  online: boolean;
  hasCaches: boolean;
  /** navigator.connection.saveData === true */
  saveData: boolean;
  /** 利用者が保存したデータを消した（自動を止めた） */
  autoOff: boolean;
  /** 保存が終わっている（専用キャッシュに index.json がある） */
  saved: boolean;
  /** 公開データの更新日が、保存したデータより新しい */
  newer: boolean;
  /** 前回の自動保存が途中で止まった */
  interrupted: boolean;
};

/** この端末は自動保存の対象か（電波・保存の有無は見ない）。 */
export function autoEligible(c: Pick<AutoSaveCheck, 'hasCaches' | 'saveData' | 'autoOff'>): boolean {
  return c.hasCaches && !c.saveData && !c.autoOff;
}

/** 自動保存を始めるか。 */
export function shouldAutoSave(c: AutoSaveCheck): boolean {
  if (!c.online || !autoEligible(c)) return false;
  return !c.saved || c.newer || c.interrupted;
}

export function saveDataOn(nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  return (nav as { connection?: { saveData?: unknown } } | undefined)?.connection?.saveData === true;
}

const flag = (store: Pick<Storage, 'getItem'> | null, key: string): boolean => {
  try { return store?.getItem(key) === '1'; } catch { return false; }
};
const setFlag = (store: Pick<Storage, 'setItem' | 'removeItem'> | null, key: string, on: boolean): void => {
  try { if (on) store?.setItem(key, '1'); else store?.removeItem(key); } catch { /* 何もしない */ }
};
export const isAutoOff = (store: Pick<Storage, 'getItem'> | null): boolean => flag(store, SHELTERS_AUTO_OFF_KEY);
export const setAutoOff = (store: Pick<Storage, 'setItem' | 'removeItem'> | null, on: boolean): void => setFlag(store, SHELTERS_AUTO_OFF_KEY, on);
export const clearAutoPending = (store: Pick<Storage, 'removeItem' | 'setItem'> | null): void => setFlag(store, SHELTERS_AUTO_PENDING_KEY, false);

// ---- 保存・削除のロック（自動・手動・削除で共通） ----
export const SKIPPED: unique symbol = Symbol('skipped');
let tail: Promise<void> = Promise.resolve();
let pending = 0;
type LocksLike = Pick<LockManager, 'request'>;

/**
 * 保存・削除を1つずつ走らせる。wait=false（自動）は、ほかが走っている・待っているなら走らずに SKIPPED を返す。
 * locks があれば、タブどうしでも1つずつ（wait=false はほかのタブが持っていれば SKIPPED）。
 */
export async function withSaveLock<T>(fn: () => Promise<T>, o: { wait: boolean; locks?: LocksLike | null }): Promise<T | typeof SKIPPED> {
  if (!o.wait && pending > 0) return SKIPPED;
  pending++;
  const prev = tail;
  let release!: () => void;
  tail = new Promise<void>((r) => { release = r; });
  try {
    await prev;
    if (!o.locks) return await fn();
    return await o.locks.request(LOCK_NAME, o.wait ? {} : { ifAvailable: true }, async (lock) => (lock ? fn() : SKIPPED));
  } finally {
    pending--;
    release();
  }
}

/** テスト用 */
export function resetSaveLock(): void { tail = Promise.resolve(); pending = 0; }

// ---- 自動保存の進み具合（保存の欄が表示に使う） ----
export type AutoStatus = { phase: 'idle' } | { phase: 'running'; done: number; total: number };
let status: AutoStatus = { phase: 'idle' };
const listeners = new Set<() => void>();
export function autoStatus(): AutoStatus { return status; }
/** 変わったら呼ぶ（running の進み具合・終わったとき）。戻り値で解除。 */
export function onAutoStatus(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
function setStatus(s: AutoStatus): void {
  status = s;
  for (const f of [...listeners]) { try { f(); } catch { /* 表示の失敗で保存を止めない */ } }
}

let current: AbortController | null = null;
/** 自動保存を止め、次からも自動で保存しない（「保存したデータを消す」）。 */
export function stopAutoSave(store: Pick<Storage, 'setItem' | 'removeItem'> | null): void {
  setAutoOff(store, true);
  current?.abort();
}

export type AutoSaveDeps = {
  base: string;
  store: Storage | null;
  caches: CachesLike | null;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  online(): boolean;
  saveData(): boolean;
  fetchIndex(): Promise<ShelterIndex | null>;
  locks?: LocksLike | null;
  persist?(): Promise<unknown>;
  /** ほかのタブで自動を止めたら止める（storage イベント）。無ければ聞かない */
  events?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
};

export type AutoSaveResult = 'saved' | 'skipped' | 'failed';

/** 外からの中止（stopAutoSave）も、saveShelters の中止（1つ失敗したら残りを止める）も効く fetch。 */
function abortableFetch(f: AutoSaveDeps['fetch'], outer: AbortSignal): AutoSaveDeps['fetch'] {
  return (url, init) => {
    if (outer.aborted) return Promise.reject(new Error('stopped'));
    const c = new AbortController();
    const stop = (): void => c.abort();
    outer.addEventListener('abort', stop, { once: true });
    init?.signal?.addEventListener('abort', stop, { once: true });
    return f(url, { ...init, signal: c.signal }).finally(() => outer.removeEventListener('abort', stop));
  };
}

/**
 * 条件がそろっていれば保存する。例外は投げない（失敗は 'failed'。画面にエラーは出さない）。
 * ロックを取ってから、もう一度条件を見る（ほかのタブがちょうど保存し終えた・利用者が消した、などで二重に走らない）。
 */
export async function runAutoSave(d: AutoSaveDeps): Promise<AutoSaveResult> {
  const caches = d.caches;
  if (!caches || !d.online() || d.saveData() || isAutoOff(d.store)) return 'skipped';
  let started = false;
  try {
    const r = await withSaveLock(async (): Promise<AutoSaveResult> => {
      if (!d.online() || isAutoOff(d.store)) return 'skipped';
      const have = await savedIndex(caches, d.base);
      const saved = have ? loadSheltersSaved(d.store) ?? { savedAt: '', updated: have.updated, count: have.count } : null;
      const index = await d.fetchIndex();
      if (!index || index.files.length === 0) return 'skipped';
      const go = shouldAutoSave({
        online: d.online(), hasCaches: true, saveData: d.saveData(), autoOff: isAutoOff(d.store),
        saved: !!have, newer: hasNewerData(saved, index), interrupted: flag(d.store, SHELTERS_AUTO_PENDING_KEY),
      });
      if (!go) return 'skipped';
      const ctrl = new AbortController();
      current = ctrl;
      const onStorage = (e: Event): void => {
        const k = (e as StorageEvent).key;
        if ((k === SHELTERS_AUTO_OFF_KEY || k === null) && isAutoOff(d.store)) ctrl.abort();
      };
      d.events?.addEventListener('storage', onStorage);
      try {
        started = true;
        setFlag(d.store, SHELTERS_AUTO_PENDING_KEY, true);
        setStatus({ phase: 'running', done: 0, total: index.files.length });
        try { await d.persist?.(); } catch { /* 頼めなくても保存は続ける */ }
        clearSheltersSaved(d.store);
        await saveShelters({
          base: d.base, index, caches, fetch: abortableFetch(d.fetch, ctrl.signal), concurrency: AUTO_CONCURRENCY,
          onProgress: (done, total) => { if (!ctrl.signal.aborted) setStatus({ phase: 'running', done, total }); },
        });
        if (ctrl.signal.aborted) return 'failed';
        writeSheltersSaved(d.store, { savedAt: today(), updated: index.updated, count: index.count, auto: true });
        clearAutoPending(d.store);
        return 'saved';
      } finally {
        d.events?.removeEventListener('storage', onStorage);
        if (current === ctrl) current = null;
      }
    }, { wait: false, locks: d.locks });
    return r === SKIPPED ? 'skipped' : r;
  } catch {
    return 'failed';
  } finally {
    if (started) setStatus({ phase: 'idle' });
  }
}

/** 表示が落ち着いてから1回だけ自動保存を始める（requestIdleCallback、無ければ load 後 3 秒）。 */
export function scheduleAutoSave(d: AutoSaveDeps, win: Window = window): void {
  let fired = false;
  const go = (): void => { if (!fired) { fired = true; void runAutoSave(d); } };
  const later = (): void => {
    const ric = (win as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof ric === 'function') ric.call(win, go, { timeout: 10_000 });
    else win.setTimeout(go, 3000);
  };
  if (win.document.readyState === 'complete') later();
  else win.addEventListener('load', later, { once: true });
}
