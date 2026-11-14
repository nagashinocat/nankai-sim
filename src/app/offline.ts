/**
 * 避難場所のデータ（国土地理院 指定緊急避難場所。公開データ）を端末に保存して、電波なしでも #near で使えるようにする。
 * - 保存先は専用のキャッシュ（OFFLINE_CACHE）。Service Worker の版つきキャッシュ（nankai-sim-…）とは名前の接頭辞が違うので、更新で消えない。
 * - localStorage には保存した日・データの更新日・件数だけ（現在地・住所は入れない）。
 * - 途中で失敗しても、もう一度押すとキャッシュに無いファイルだけ取りに行く（続きから）。
 */

export const OFFLINE_CACHE = 'nankai-offline-shelters-v1';
export const SHELTERS_SAVED_KEY = 'nankai-sim:shelters-saved';
/** 保存のときに付ける見出し。Service Worker はこの要求を版つきキャッシュに入れない（同じデータを2つ持たない）。 */
export const SAVE_HEADER = 'x-nankai-offline-save';

export type ShelterIndex = { files: string[]; updated: string | null; count: number; bytes: number };
export type SheltersSaved = { savedAt: string; updated: string | null; count: number };

export function isShelterIndex(v: unknown): v is ShelterIndex {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.files) && o.files.every((f) => typeof f === 'string' && /^\d{6}\.json$/.test(f))
    && (o.updated === null || typeof o.updated === 'string')
    && typeof o.count === 'number' && typeof o.bytes === 'number';
}

export function loadSheltersSaved(store: Pick<Storage, 'getItem'> | null): SheltersSaved | null {
  try {
    const raw = store?.getItem(SHELTERS_SAVED_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.savedAt !== 'string' || typeof v.count !== 'number' || !(v.updated === null || typeof v.updated === 'string')) return null;
    return { savedAt: v.savedAt, updated: v.updated, count: v.count };
  } catch {
    return null;
  }
}

export function writeSheltersSaved(store: Pick<Storage, 'setItem'> | null, v: SheltersSaved): void {
  // 日付と件数だけ（ほかの項目を混ぜない）
  try { store?.setItem(SHELTERS_SAVED_KEY, JSON.stringify({ savedAt: v.savedAt, updated: v.updated, count: v.count })); } catch { /* 保存できなくてもデータ自体はキャッシュにある */ }
}

export function clearSheltersSaved(store: Pick<Storage, 'removeItem'> | null): void {
  try { store?.removeItem(SHELTERS_SAVED_KEY); } catch { /* 何もしない */ }
}

/** 公開されているデータの更新日が、保存したデータの更新日より新しい。 */
export function hasNewerData(saved: SheltersSaved | null, index: ShelterIndex | null): boolean {
  if (!saved || !index || !index.updated) return false;
  return !saved.updated || index.updated > saved.updated;
}

/** 「約3.3MB」。 */
export function sizeText(bytes: number): string {
  if (!(bytes > 0)) return '約0MB';
  const mb = bytes / 1_000_000;
  return mb < 1 ? `約${Math.max(0.1, Math.round(mb * 10) / 10)}MB` : `約${Math.round(mb * 10) / 10}MB`;
}

/** YYYY-MM-DD（端末の日付） */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function savedDateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日` : iso;
}

type CacheLike = Pick<Cache, 'match' | 'put' | 'keys' | 'delete'>;
export type CachesLike = { open(name: string): Promise<CacheLike>; has(name: string): Promise<boolean>; delete(name: string): Promise<boolean> };
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** 保存したファイルに付ける見出し（どの更新日のデータか）。続きから保存するとき、違う更新日のファイルは取り直す。 */
export const DATA_VERSION_HEADER = 'x-nankai-data-updated';

/**
 * 全ファイルを専用キャッシュに入れる。同じ更新日のファイルがすでに入っていれば取り直さない（続きから）。
 * 取りに行くファイルがあるときは、先に index.json を消す（保存し直しの途中を「保存済み」に見せない）。
 * index.json は全部そろってから最後に入れる（index があれば保存は完了している）。
 * 1つでも失敗したら、ほかの取得も止め（AbortController）、取得中のものが終わるのを待ってから例外。失敗のあとは onProgress を呼ばない。
 */
export async function saveShelters(o: {
  base: string; // 例: https://example.com/app/data
  index: ShelterIndex;
  caches: CachesLike;
  fetch: FetchLike;
  onProgress?(done: number, total: number): void;
  concurrency?: number;
}): Promise<void> {
  const cache = await o.caches.open(OFFLINE_CACHE);
  const indexUrl = `${o.base}/shelters/index.json`;
  const version = o.index.updated ?? '';
  const urls = o.index.files.map((f) => `${o.base}/shelters/${f}`);
  const total = urls.length;
  let done = 0;
  const todo: string[] = [];
  for (const u of urls) {
    const hit = await cache.match(u);
    if (hit && (hit.headers.get(DATA_VERSION_HEADER) ?? '') === version) done++;
    else todo.push(u);
  }
  if (todo.length > 0) await cache.delete(indexUrl);
  o.onProgress?.(done, total);
  const ctrl = new AbortController();
  let failure: unknown = null;
  const get = async (url: string): Promise<Response> => {
    const res = await o.fetch(url, { cache: 'no-cache', headers: { [SAVE_HEADER]: '1' }, signal: ctrl.signal });
    if (!res.ok || /text\/html/i.test(res.headers.get('content-type') ?? '')) throw new Error(`${url}: HTTP ${res.status}`);
    const body = await res.arrayBuffer();
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json', [DATA_VERSION_HEADER]: version } });
  };
  let next = 0;
  const worker = async (): Promise<void> => {
    while (failure === null && next < todo.length) {
      const url = todo[next++];
      try {
        const res = await get(url);
        if (failure !== null) return;
        await cache.put(url, res);
        done++;
        if (failure === null) o.onProgress?.(done, total);
      } catch (e) {
        if (failure === null) { failure = e; ctrl.abort(); }
        return;
      }
    }
  };
  await Promise.allSettled(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 6, todo.length)) }, worker));
  if (failure !== null) throw failure;
  // 一覧（ファイルが無い2次メッシュを「無い」と判断するのに使う）
  await cache.put(indexUrl, new Response(JSON.stringify(o.index), { headers: { 'content-type': 'application/json' } }));
}

/** 保存が終わっているか（専用キャッシュに index.json がある）。 */
export async function savedIndex(caches: CachesLike, base: string): Promise<ShelterIndex | null> {
  try {
    if (!(await caches.has(OFFLINE_CACHE))) return null;
    const hit = await (await caches.open(OFFLINE_CACHE)).match(`${base}/shelters/index.json`);
    if (!hit) return null;
    const v: unknown = await hit.json();
    return isShelterIndex(v) ? v : null;
  } catch {
    return null;
  }
}

export async function deleteSavedShelters(caches: CachesLike, store: Pick<Storage, 'removeItem'> | null): Promise<void> {
  clearSheltersSaved(store);
  await caches.delete(OFFLINE_CACHE);
}
