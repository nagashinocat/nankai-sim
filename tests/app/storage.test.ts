import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAST_KEY, clearLast, loadChecklist, loadLast, saveChecklist, saveLast, savedShelters, type Saved } from '../../src/app/storage.ts';
import type { EvacVM } from '../../src/app/viewmodel.ts';

function memStore(): Storage & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    get length() { return raw.size; },
    clear: () => raw.clear(),
    getItem: (k) => raw.get(k) ?? null,
    key: (i) => [...raw.keys()][i] ?? null,
    removeItem: (k) => void raw.delete(k),
    setItem: (k, v) => void raw.set(k, String(v)),
  };
}

const range = { min: '10.0%', max: '30.0%', central: '20.0%' };
const shelters: Saved['shelters'] = [
  { hazard: 'earthquake', items: [{ name: '菰野小学校', distance: '約300m', walkStandard: '約7分', walkSlow: '約13分', reachText: '' }] },
  { hazard: 'tsunami', items: [] },
];
const saved: Saved = {
  v: 3,
  savedAt: '2026-11-12T01:23:45.000Z',
  municipality: '菰野町',
  input: { structure: 'wood', era: 'pre1981', floors: 2 } as never,
  home: { status: 'ok', intensityLabel: '震度6弱', collapse: range, half: range, liquefaction: '液状化の可能性があります', tsunami: { kind: 'band', depth: '1〜3m', arrival: '海岸への到達 最短約12分（30cm）', urgent: false }, notes: [] } as never,
  area: { status: 'ok', collapse: 12, half: 30, meshes: 9 },
  shelters,
};

test('保存→読み込みの往復', () => {
  const s = memStore();
  saveLast(saved, s);
  assert.deepEqual(loadLast(s), saved);
  assert.ok(s.raw.has('nankai-sim:last'));
});

test('何も無ければ null / 壊れた JSON → null', () => {
  const s = memStore();
  assert.equal(loadLast(s), null);
  s.setItem('nankai-sim:last', '{broken');
  assert.equal(loadLast(s), null);
  s.setItem('nankai-sim:last', '"str"');
  assert.equal(loadLast(s), null);
});

test('clear 後は null', () => {
  const s = memStore();
  saveLast(saved, s);
  clearLast(s);
  assert.equal(loadLast(s), null);
});

test('チェックリスト: 既定は 8 個の false、往復、壊れていれば既定', () => {
  const s = memStore();
  assert.deepEqual(loadChecklist(s), Array(8).fill(false));
  const c = [true, false, true, false, false, false, false, true];
  saveChecklist(c, s);
  assert.deepEqual(loadChecklist(s), c);
  s.setItem('nankai-sim:checklist', '[true]');
  assert.deepEqual(loadChecklist(s), Array(8).fill(false));
  s.setItem('nankai-sim:checklist', 'oops');
  assert.deepEqual(loadChecklist(s), Array(8).fill(false));
});

test('Storage が例外を投げても外に出さない', () => {
  const bad = {
    ...memStore(),
    setItem: () => { throw new Error('quota'); },
    getItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  } as Storage;
  assert.doesNotThrow(() => saveLast(saved, bad));
  assert.doesNotThrow(() => saveChecklist(Array(8).fill(true), bad));
  assert.doesNotThrow(() => clearLast(bad));
  assert.equal(loadLast(bad), null);
  assert.deepEqual(loadChecklist(bad), Array(8).fill(false));
});

test('入れ子の値が壊れている／古いスキーマ → null', () => {
  const s = memStore();
  const put = (o: unknown) => s.setItem('nankai-sim:last', JSON.stringify(o));
  const bad: unknown[] = [
    { ...saved, v: undefined },
    { ...saved, v: 1 }, // 旧スキーマ（避難場所なし）は読まない
    { ...saved, v: 2 },
    { ...saved, v: 4 },
    { ...saved, shelters: undefined },
    { ...saved, shelters: [{ hazard: 'flood', items: [] }] },
    { ...saved, shelters: [{ hazard: 'earthquake', items: [{ name: 'x' }] }] },
    { ...saved, shelters: [{ hazard: 'tsunami', items: [], arrivalCm: '50' }] },
    { ...saved, home: { status: 'outside' }, area: { status: 'nostock' } }, // 結果の出ない場所は保存しない
    { ...saved, home: { status: 'nodata' } },
    { ...saved, home: { status: 'ok' } },
    { ...saved, home: { ...saved.home, collapse: { min: 1 } } },
    { ...saved, home: { ...saved.home, notes: 'x' } },
    { ...saved, home: { status: 'weird' } },
    { ...saved, area: { status: 'ok' } },
    { ...saved, area: { status: 'ok', collapse: '1', half: 2, meshes: 3 } },
    { ...saved, input: null },
    { ...saved, municipality: 5 },
  ];
  for (const b of bad) { put(b); assert.equal(loadLast(s), null, JSON.stringify(b)); }
  put({ ...saved, area: { status: 'nostock' } });
  assert.notEqual(loadLast(s), null);
  put({ ...saved, area: { status: 'unavailable' } });
  assert.notEqual(loadLast(s), null);
});

test('v2（津波なし）は読み捨て、端末からも消す。津波の形が不正な v3 も読み込まない', () => {
  const s = memStore();
  s.setItem(LAST_KEY, JSON.stringify({ ...saved, v: 2 }));
  assert.equal(loadLast(s), null);
  assert.equal(s.raw.has(LAST_KEY), false);
  const home = saved.home;
  for (const t of [undefined, { kind: 'x' }, { kind: 'band', depth: 3, arrival: null }, { kind: 'band', depth: '1〜3m' }, { kind: 'band', depth: '1〜3m', arrival: null }]) {
    s.setItem(LAST_KEY, JSON.stringify({ ...saved, home: { ...home, tsunami: t } }));
    assert.equal(loadLast(s), null, JSON.stringify(t));
  }
  for (const t of [{ kind: 'none' }, { kind: 'unknown' }, { kind: 'band', depth: '20m以上', arrival: null, urgent: true }]) {
    s.setItem(LAST_KEY, JSON.stringify({ ...saved, home: { ...home, tsunami: t } }));
    assert.notEqual(loadLast(s), null, JSON.stringify(t));
  }
});

test('旧スキーマ（v1）は読み捨て、端末からも消す', () => {
  const s = memStore();
  const { shelters: _omit, ...v1 } = { ...saved, v: 1 };
  s.setItem(LAST_KEY, JSON.stringify(v1));
  assert.equal(loadLast(s), null);
  assert.equal(s.raw.has(LAST_KEY), false);
});

test('savedShelters: 名前・距離・徒歩の文字列だけを残す（座標は保存しない。判定は文言だけ）', () => {
  const evac = [
    {
      hazard: 'earthquake', notices: ['n'],
      items: [{ name: 'A', distance: '約110m', walkStandard: '約3分', walkSlow: '約5分', reach: 'n/a', reachText: '', pos: { lat: 35.02, lon: 136.5 } }],
    },
    { hazard: 'tsunami', notices: ['n'], items: [], arrivalCm: 50 },
  ] as unknown as EvacVM[];
  const out = savedShelters(evac);
  assert.deepEqual(out, [
    { hazard: 'earthquake', items: [{ name: 'A', distance: '約110m', walkStandard: '約3分', walkSlow: '約5分', reachText: '' }], arrivalCm: null },
    { hazard: 'tsunami', items: [], arrivalCm: 50 },
  ]);
  assert.doesNotMatch(JSON.stringify(out), /35\.02|136\.5|lat|lon|pos/);
});

test('loadLast: 避難場所リストの arrivalCm は無くても（以前の保存）数値でも読める', () => {
  const store = new Map<string, string>();
  const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as unknown as Storage;
  for (const lists of [[{ hazard: 'tsunami', items: [] }], [{ hazard: 'tsunami', items: [], arrivalCm: 50 }], [{ hazard: 'tsunami', items: [], arrivalCm: null }]]) {
    s.setItem(LAST_KEY, JSON.stringify({ ...saved, shelters: lists }));
    assert.ok(loadLast(s), JSON.stringify(lists));
  }
});

test('v3: 津波 nearby（Ruling F3）は band と同じ形なら読み込み、形が違えば読まない', () => {
  const s = memStore();
  const home = saved.home;
  s.setItem(LAST_KEY, JSON.stringify({ ...saved, home: { ...home, tsunami: { kind: 'nearby', depth: '1〜3m', arrival: '海岸への到達 最短約20分（30cm）', urgent: false } } }));
  assert.notEqual(loadLast(s), null);
  for (const t of [{ kind: 'nearby', depth: '1〜3m' }, { kind: 'nearby', depth: 1, arrival: null, urgent: true }]) {
    s.setItem(LAST_KEY, JSON.stringify({ ...saved, home: { ...home, tsunami: t } }));
    assert.equal(loadLast(s), null, JSON.stringify(t));
  }
});
