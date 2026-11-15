import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_CONCURRENCY, SHELTERS_AUTO_OFF_KEY, SHELTERS_AUTO_PENDING_KEY, SKIPPED, autoEligible, autoStatus, resetSaveLock, runAutoSave,
  saveDataOn, shouldAutoSave, stopAutoSave, withSaveLock, type AutoSaveDeps,
} from '../../src/app/autosave.ts';
import { OFFLINE_CACHE, SHELTERS_SAVED_KEY, loadSheltersSaved, savedIndex, writeSheltersSaved, type CachesLike, type ShelterIndex } from '../../src/app/offline.ts';

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
const INDEX: ShelterIndex = { files: ['503515.json', '503516.json', '523644.json', '523645.json', '523646.json'], updated: '2026-11-12', count: 9, bytes: 3_300_000 };
const ok = () => new Response('[]', { headers: { 'content-type': 'application/json' } });

function deps(over: Partial<AutoSaveDeps> = {}): AutoSaveDeps & { caches: ReturnType<typeof fakeCaches>; store: Storage } {
  return {
    base: BASE, store: memStore(), caches: fakeCaches(), fetch: async () => ok(), online: () => true, saveData: () => false,
    fetchIndex: async () => INDEX, ...over,
  } as AutoSaveDeps & { caches: ReturnType<typeof fakeCaches>; store: Storage };
}

const BASE_CHECK = { online: true, hasCaches: true, saveData: false, autoOff: false, saved: false, newer: false, interrupted: false };

test('shouldAutoSave: 電波・キャッシュあり・データセーバーでない・止めていない、かつ 未保存／新しいデータ／途中で止まった', () => {
  assert.equal(shouldAutoSave(BASE_CHECK), true);
  assert.equal(shouldAutoSave({ ...BASE_CHECK, saved: true }), false);
  assert.equal(shouldAutoSave({ ...BASE_CHECK, saved: true, newer: true }), true);
  assert.equal(shouldAutoSave({ ...BASE_CHECK, saved: true, interrupted: true }), true);
  assert.equal(shouldAutoSave({ ...BASE_CHECK, online: false }), false);
  assert.equal(shouldAutoSave({ ...BASE_CHECK, hasCaches: false }), false);
  assert.equal(shouldAutoSave({ ...BASE_CHECK, saveData: true }), false);
  assert.equal(shouldAutoSave({ ...BASE_CHECK, autoOff: true }), false);
  assert.equal(shouldAutoSave({ ...BASE_CHECK, autoOff: true, newer: true, interrupted: true }), false);
  assert.equal(autoEligible({ hasCaches: true, saveData: false, autoOff: false }), true);
  assert.equal(autoEligible({ hasCaches: true, saveData: true, autoOff: false }), false);
});

test('saveDataOn: navigator.connection.saveData が true のときだけ', () => {
  assert.equal(saveDataOn({ connection: { saveData: true } }), true);
  assert.equal(saveDataOn({ connection: { saveData: false } }), false);
  assert.equal(saveDataOn({}), false);
  assert.equal(saveDataOn(undefined), false);
});

test('runAutoSave: 未保存なら保存（同時取得は 2 まで・自動の印・住所や座標は入れない）。保存済みなら2回目は走らない', async () => {
  resetSaveLock();
  let inflight = 0, max = 0;
  const d = deps({
    fetch: async () => { inflight++; max = Math.max(max, inflight); await new Promise((r) => setTimeout(r, 5)); inflight--; return ok(); },
  });
  assert.equal(await runAutoSave(d), 'saved');
  assert.equal(max, AUTO_CONCURRENCY);
  assert.deepEqual(await savedIndex(d.caches, BASE), INDEX);
  assert.deepEqual(Object.keys(JSON.parse(d.store.getItem(SHELTERS_SAVED_KEY)!)).sort(), ['auto', 'count', 'savedAt', 'updated']);
  assert.equal(loadSheltersSaved(d.store)?.auto, true);
  assert.equal(d.store.getItem(SHELTERS_AUTO_PENDING_KEY), null);
  assert.equal(autoStatus().phase, 'idle');
  let fetched = 0;
  d.fetch = async () => { fetched++; return ok(); };
  assert.equal(await runAutoSave(d), 'skipped');
  assert.equal(fetched, 0);
});

test('runAutoSave: 新しいデータがあれば保存し直す', async () => {
  resetSaveLock();
  const d = deps();
  assert.equal(await runAutoSave(d), 'saved');
  d.fetchIndex = async () => ({ ...INDEX, updated: '2026-12-01' });
  assert.equal(await runAutoSave(d), 'saved');
  assert.equal(loadSheltersSaved(d.store)?.updated, '2026-12-01');
});

test('runAutoSave: データセーバー・電波なし・止めた・一覧が読めない ときは何もしない', async () => {
  resetSaveLock();
  let fetched = 0;
  const f = async () => { fetched++; return ok(); };
  assert.equal(await runAutoSave(deps({ fetch: f, saveData: () => true })), 'skipped');
  assert.equal(await runAutoSave(deps({ fetch: f, online: () => false })), 'skipped');
  assert.equal(await runAutoSave(deps({ fetch: f, caches: null })), 'skipped');
  const off = deps({ fetch: f });
  off.store.setItem(SHELTERS_AUTO_OFF_KEY, '1');
  assert.equal(await runAutoSave(off), 'skipped');
  assert.equal(await runAutoSave(deps({ fetch: f, fetchIndex: async () => null })), 'skipped');
  assert.equal(fetched, 0);
});

test('runAutoSave: 失敗しても例外を投げず、途中の印を残す（次は続きから）', async () => {
  resetSaveLock();
  let n = 0;
  const d = deps({ fetch: async () => (++n === 3 ? Promise.reject(new Error('net')) : ok()) });
  assert.equal(await runAutoSave(d), 'failed');
  assert.equal(d.store.getItem(SHELTERS_AUTO_PENDING_KEY), '1');
  assert.equal(await savedIndex(d.caches, BASE), null);
  assert.equal(autoStatus().phase, 'idle');
  const fetched: string[] = [];
  d.fetch = async (u) => { fetched.push(u); return ok(); };
  assert.equal(await runAutoSave(d), 'saved');
  assert.ok(fetched.length < INDEX.files.length, '保存済みのファイルは取り直さない');
  assert.equal(d.store.getItem(SHELTERS_AUTO_PENDING_KEY), null);
});

test('stopAutoSave: 途中の自動保存を止め、次からも自動で保存しない', async () => {
  resetSaveLock();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const d = deps({
    fetch: async (_u, init) => {
      await new Promise<void>((resolve, reject) => {
        void gate.then(resolve);
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
      return ok();
    },
  });
  const p = runAutoSave(d);
  while (autoStatus().phase !== 'running') await new Promise((r) => setTimeout(r, 1));
  stopAutoSave(d.store);
  assert.equal(await p, 'failed');
  release();
  assert.equal(d.store.getItem(SHELTERS_AUTO_OFF_KEY), '1');
  assert.equal(await savedIndex(d.caches, BASE), null);
  assert.equal(await runAutoSave(d), 'skipped');
});

test('withSaveLock: 手動・削除は順番待ち、自動はほかが走っていれば走らない', async () => {
  resetSaveLock();
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const manual = withSaveLock(async () => { order.push('manual:start'); await gate; order.push('manual:end'); }, { wait: true });
  const del = withSaveLock(async () => { order.push('delete'); }, { wait: true });
  assert.equal(await withSaveLock(async () => { order.push('auto'); }, { wait: false }), SKIPPED);
  await new Promise((r) => setTimeout(r, 5));
  release();
  await manual; await del;
  assert.deepEqual(order, ['manual:start', 'manual:end', 'delete']);
  // 例外のあともロックは外れる
  await assert.rejects(withSaveLock(async () => { throw new Error('x'); }, { wait: true }));
  assert.equal(await withSaveLock(async () => 'ran', { wait: false }), 'ran');
});

test('runAutoSave: ほかのタブがロックを持っていれば走らない（Web Locks の ifAvailable）', async () => {
  resetSaveLock();
  let fetched = 0;
  const locks = { request: async (_n: string, o: LockOptions, cb: (l: Lock | null) => unknown) => { assert.equal(o.ifAvailable, true); return cb(null); } };
  const d = deps({ fetch: async () => { fetched++; return ok(); }, locks: locks as never });
  assert.equal(await runAutoSave(d), 'skipped');
  assert.equal(fetched, 0);
  assert.equal(d.caches.store.has(OFFLINE_CACHE), false);
});

test('runAutoSave: ロックを取ったあとにもう一度確かめる（待っている間にほかで保存が終わった）', async () => {
  resetSaveLock();
  const d = deps();
  // 一覧を読む前に、ほかで保存が終わっていたことにする
  writeSheltersSaved(d.store, { savedAt: '2026-11-15', updated: INDEX.updated, count: INDEX.count });
  const c = await d.caches.open(OFFLINE_CACHE);
  await c.put(`${BASE}/shelters/index.json`, new Response(JSON.stringify(INDEX)));
  let fetched = 0;
  d.fetch = async () => { fetched++; return ok(); };
  assert.equal(await runAutoSave(d), 'skipped');
  assert.equal(fetched, 0);
});
