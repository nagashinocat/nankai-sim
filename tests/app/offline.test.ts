import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFLINE_CACHE, SAVE_HEADER, SHELTERS_SAVED_KEY, deleteSavedShelters, hasNewerData, isShelterIndex, loadSheltersSaved, saveShelters,
  savedDateText, savedIndex, sizeText, today, writeSheltersSaved, type CachesLike, type ShelterIndex,
} from '../../src/app/offline.ts';

function memStore(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k),
  };
}

function fakeCaches(): CachesLike & { store: Map<string, Map<string, Response>> } {
  const store = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    let c = store.get(name);
    if (!c) { c = new Map(); store.set(name, c); }
    const cc = c;
    return {
      match: async (u: RequestInfo | URL) => cc.get(String(u))?.clone(),
      put: async (u: RequestInfo | URL, r: Response) => { cc.set(String(u), r); },
      delete: async (u: RequestInfo | URL) => cc.delete(String(u)),
      keys: async () => [...cc.keys()].map((k) => new Request(k)),
    } as unknown as Cache;
  };
  return { store, open, has: async (n) => store.has(n), delete: async (n) => store.delete(n) };
}

const BASE = 'https://x.test/app/data';
const INDEX: ShelterIndex = { files: ['503515.json', '503516.json', '523644.json'], updated: '2026-11-12', count: 9, bytes: 3_300_000 };

test('saveShelters: 全ファイルと最後に index.json。保存用の見出しを付ける。進み具合', async () => {
  const caches = fakeCaches();
  const seen: { url: string; header: string | null }[] = [];
  const progress: [number, number][] = [];
  await saveShelters({
    base: BASE, index: INDEX, caches,
    fetch: async (url, init) => {
      seen.push({ url, header: new Headers(init?.headers).get(SAVE_HEADER) });
      return new Response('[]', { headers: { 'content-type': 'application/json' } });
    },
    onProgress: (d, t) => progress.push([d, t]),
  });
  const c = caches.store.get(OFFLINE_CACHE)!;
  assert.deepEqual([...c.keys()].sort(), [...INDEX.files.map((f) => `${BASE}/shelters/${f}`), `${BASE}/shelters/index.json`].sort());
  assert.ok(seen.every((s) => s.header === '1'));
  assert.deepEqual(progress[0], [0, 3]);
  assert.deepEqual(progress.at(-1), [3, 3]);
  assert.deepEqual(await savedIndex(caches, BASE), INDEX);
});

test('saveShelters: 途中で失敗したら index.json を入れず、次は続きから', async () => {
  const caches = fakeCaches();
  let fail = true;
  const fetched: string[] = [];
  const fetch = async (url: string) => {
    fetched.push(url);
    if (fail && url.endsWith('523644.json')) throw new Error('offline');
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  };
  await assert.rejects(saveShelters({ base: BASE, index: INDEX, caches, fetch, concurrency: 1 }));
  assert.equal(await savedIndex(caches, BASE), null);
  fail = false;
  fetched.length = 0;
  const progress: [number, number][] = [];
  await saveShelters({ base: BASE, index: INDEX, caches, fetch, onProgress: (d, t) => progress.push([d, t]) });
  assert.deepEqual(fetched, [`${BASE}/shelters/523644.json`]);
  assert.deepEqual(progress[0], [2, 3]);
  assert.ok(await savedIndex(caches, BASE));
});

test('saveShelters: HTML や ok でない応答は保存しない（失敗）', async () => {
  const caches = fakeCaches();
  await assert.rejects(saveShelters({ base: BASE, index: INDEX, caches, fetch: async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) }));
  await assert.rejects(saveShelters({ base: BASE, index: INDEX, caches, fetch: async () => new Response('x', { status: 500 }) }));
  assert.equal(await savedIndex(caches, BASE), null);
});

test('deleteSavedShelters: キャッシュと保存日を消す', async () => {
  const caches = fakeCaches();
  const st = memStore();
  await saveShelters({ base: BASE, index: INDEX, caches, fetch: async () => new Response('[]') });
  writeSheltersSaved(st, { savedAt: '2026-11-14', updated: '2026-11-12', count: 9 });
  await deleteSavedShelters(caches, st);
  assert.equal(await caches.has(OFFLINE_CACHE), false);
  assert.equal(st.getItem(SHELTERS_SAVED_KEY), null);
  assert.equal(await savedIndex(caches, BASE), null);
});

test('保存日: 日付・更新日・件数だけ。壊れた値は null', () => {
  const st = memStore();
  writeSheltersSaved(st, { savedAt: '2026-11-14', updated: '2026-11-12', count: 9, ...({ pos: { lat: 1 } } as object) } as never);
  assert.deepEqual(JSON.parse(st.getItem(SHELTERS_SAVED_KEY)!), { savedAt: '2026-11-14', updated: '2026-11-12', count: 9 });
  assert.deepEqual(loadSheltersSaved(st), { savedAt: '2026-11-14', updated: '2026-11-12', count: 9 });
  st.setItem(SHELTERS_SAVED_KEY, '{bad');
  assert.equal(loadSheltersSaved(st), null);
  assert.equal(loadSheltersSaved(null), null);
  const throwing = { getItem() { throw new Error('denied'); } };
  assert.equal(loadSheltersSaved(throwing), null);
});

test('hasNewerData: 公開データの更新日が新しいときだけ', () => {
  const saved = { savedAt: '2026-11-14', updated: '2026-11-12', count: 9 };
  assert.equal(hasNewerData(saved, INDEX), false);
  assert.equal(hasNewerData(saved, { ...INDEX, updated: '2026-12-01' }), true);
  assert.equal(hasNewerData(saved, { ...INDEX, updated: null }), false);
  assert.equal(hasNewerData(null, INDEX), false);
  assert.equal(hasNewerData({ ...saved, updated: null }, INDEX), true);
});

test('isShelterIndex / sizeText / today / savedDateText', () => {
  assert.equal(isShelterIndex(INDEX), true);
  assert.equal(isShelterIndex({ ...INDEX, files: ['../x.json'] }), false);
  assert.equal(isShelterIndex(null), false);
  assert.equal(sizeText(3_300_000), '約3.3MB');
  assert.equal(sizeText(20_000), '約0.1MB');
  assert.equal(today(new Date(2026, 10, 4)), '2026-11-04');
  assert.equal(savedDateText('2026-11-04'), '2026年11月4日');
});

test('saveShelters: 失敗したらほかの取得を止め（abort）、取得中が終わるまで待つ。失敗のあとは進み具合を呼ばない', async () => {
  const caches = fakeCaches();
  const index: ShelterIndex = { ...INDEX, files: Array.from({ length: 20 }, (_, i) => `5${String(i).padStart(5, '0')}.json`) };
  let started = 0, inFlight = 0, aborted = 0;
  const progress: [number, number][] = [];
  let failedAt = -1;
  const fetch = async (url: string, init?: RequestInit) => {
    started++;
    inFlight++;
    try {
      if (url.endsWith('500002.json')) { await new Promise((r) => setTimeout(r, 5)); failedAt = progress.length; throw new Error('offline'); }
      await new Promise((r) => setTimeout(r, 20));
      if (init?.signal?.aborted) { aborted++; throw new Error('aborted'); }
      return new Response('[]', { headers: { 'content-type': 'application/json' } });
    } finally {
      inFlight--;
    }
  };
  await assert.rejects(saveShelters({ base: BASE, index, caches, fetch, concurrency: 4, onProgress: (d, t) => progress.push([d, t]) }), /offline/);
  assert.equal(inFlight, 0, '取得中のものが終わってから例外');
  assert.ok(started < 20, `止まらずに ${started} 件取りに行った`);
  assert.ok(aborted > 0);
  assert.equal(progress.length, failedAt, '失敗のあとに進み具合を呼んだ');
  assert.equal(await savedIndex(caches, BASE), null);
});

test('saveShelters: 保存し直し（更新日が違う）は、先に index.json を消し、違う更新日のファイルを取り直す', async () => {
  const caches = fakeCaches();
  const ok = async () => new Response('[]', { headers: { 'content-type': 'application/json' } });
  await saveShelters({ base: BASE, index: INDEX, caches, fetch: ok });
  assert.ok(await savedIndex(caches, BASE));
  const newer = { ...INDEX, updated: '2026-12-01' };
  const fetched: string[] = [];
  await assert.rejects(saveShelters({
    base: BASE, index: newer, caches, concurrency: 1,
    fetch: async (url) => { fetched.push(url); if (url.endsWith('503516.json')) throw new Error('offline'); return ok(); },
  }));
  assert.equal(await savedIndex(caches, BASE), null, '途中の保存し直しを「保存済み」に見せない');
  fetched.length = 0;
  await saveShelters({ base: BASE, index: newer, caches, fetch: async (url) => { fetched.push(url); return ok(); } });
  assert.deepEqual(fetched.sort(), [`${BASE}/shelters/503516.json`, `${BASE}/shelters/523644.json`]);
  assert.deepEqual(await savedIndex(caches, BASE), newer);
  // 全部そろっていれば何も取りに行かない
  fetched.length = 0;
  await saveShelters({ base: BASE, index: newer, caches, fetch: async (url) => { fetched.push(url); return ok(); } });
  assert.deepEqual(fetched, []);
});
