import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../fixtures/fragility.synthetic.json' with { type: 'json' };
import { useFragilityTable, type FragilityTable } from '../../src/core/fragility.ts';
import { estimateArea } from '../../src/core/neighborhood.ts';
import type { BuildingStock, HazardCell, HomeInput, Shelter } from '../../src/core/types.ts';
import { areaViewModel, evacuationViewModel, formatPct, homeViewModel, intensityLabel, locationNote } from '../../src/app/viewmodel.ts';

before(() => useFragilityTable(fixture as unknown as FragilityTable));

const cell = (o: Partial<HazardCell> = {}): HazardCell => ({
  intensity: 6.2, pl: null, settlementCm: null, tsunamiDepth: null, tsunamiArrivalMin: null, ...o,
});
const home = (o: Partial<HomeInput> = {}): HomeInput => ({ structure: 'wood', era: 'pre1981', retrofitted: false, ...o });
const pct = (s: string) => parseFloat(s.replace('%未満', '').replace('%', ''));

const UNKNOWN_NOTE = 'わからない項目があるため幅が広くなっています';
const FLOORS_NOTE = '階数を入れると幅が狭くなります';
const RETRO_NOTE = '耐震補強をした場合として、ひとつ新しい年代の基準で計算しています';
const NOTICES = [
  'データは最新でない場合や未掲載の場合があります。最新の指定状況は市町にご確認ください',
  '指定緊急避難場所（命を守るために緊急に逃げる場所）と指定避難所（一定期間滞在する施設）は別のものです',
  '指定緊急避難場所は災害の種類ごとに指定されています。地震・津波に対応しているかを確認してください',
];

test('intensityLabel の境界', () => {
  assert.equal(intensityLabel(6.5), '震度7');
  assert.equal(intensityLabel(6.49), '震度6強');
  assert.equal(intensityLabel(6.0), '震度6強');
  assert.equal(intensityLabel(5.99), '震度6弱');
  assert.equal(intensityLabel(5.5), '震度6弱');
  assert.equal(intensityLabel(5.0), '震度5強');
  assert.equal(intensityLabel(4.5), '震度5弱');
  assert.equal(intensityLabel(4.49), '震度4');
  assert.equal(intensityLabel(3.5), '震度4');
  assert.equal(intensityLabel(3.49), '震度3以下');
});

test('formatPct', () => {
  assert.equal(formatPct(0.1234), '12.3%');
  assert.equal(formatPct(0.0004), '0.1%未満');
  assert.equal(formatPct(0), '0.1%未満');
  assert.equal(formatPct(0.001), '0.1%');
  assert.equal(formatPct(1), '100.0%');
});

test("'outside' / null の伝搬", () => {
  assert.deepEqual(homeViewModel('outside', home()), { status: 'outside' });
  assert.deepEqual(homeViewModel(null, home()), { status: 'nodata' });
  assert.deepEqual(homeViewModel(cell({ intensity: null }), home()), { status: 'nodata' });
  assert.deepEqual(homeViewModel(cell({ intensity: NaN }), home()), { status: 'nodata' });
});

test('homeViewModel: 通常ケース', () => {
  const vm = homeViewModel(cell(), home());
  assert.equal(vm.status, 'ok');
  if (vm.status !== 'ok') return;
  assert.equal(vm.intensityLabel, '震度6強');
  assert.equal(vm.liquefaction, null);
  assert.deepEqual(vm.notes, []);
  assert.ok(pct(vm.collapse.min) <= pct(vm.collapse.central) && pct(vm.collapse.central) <= pct(vm.collapse.max));
});

test('液状化: 沈下量があれば整数cmで文言、null なら null', () => {
  const vm = homeViewModel(cell({ settlementCm: 12.6 }), home());
  assert.equal(vm.status === 'ok' && vm.liquefaction, '液状化で地盤が約13cm沈下するおそれ');
});

test('わからない: 注記が付き 最小 ≤ 代表 ≤ 最大、幅が広がる', () => {
  const known = homeViewModel(cell(), home());
  const vm = homeViewModel(cell(), home({ structure: 'unknown', era: 'unknown' }));
  assert.equal(vm.status, 'ok');
  if (vm.status !== 'ok' || known.status !== 'ok') return;
  assert.ok(vm.notes.includes(UNKNOWN_NOTE));
  assert.ok(!known.notes.includes(UNKNOWN_NOTE));
  for (const k of ['collapse', 'half'] as const) {
    assert.ok(pct(vm[k].min) <= pct(vm[k].central) && pct(vm[k].central) <= pct(vm[k].max), k);
  }
  assert.ok(pct(vm.collapse.max) - pct(vm.collapse.min) > pct(known.collapse.max) - pct(known.collapse.min));
  // 片方だけ unknown でも付く
  const one = homeViewModel(cell(), home({ era: 'unknown' }));
  assert.ok(one.status === 'ok' && one.notes.includes(UNKNOWN_NOTE));
});

test('鉄骨・RC で階数なし → 注記、階数あり → なし、木造は出さない', () => {
  for (const structure of ['steel', 'rc'] as const) {
    const a = homeViewModel(cell(), home({ structure, era: 'post2000' }));
    assert.ok(a.status === 'ok' && a.notes.includes(FLOORS_NOTE), structure);
    const b = homeViewModel(cell(), home({ structure, era: 'post2000', floors: 5 }));
    assert.ok(b.status === 'ok' && !b.notes.includes(FLOORS_NOTE), structure);
  }
  const w = homeViewModel(cell(), home());
  assert.ok(w.status === 'ok' && !w.notes.includes(FLOORS_NOTE));
});

test('補強済みの注記と注記の順序', () => {
  const vm = homeViewModel(cell(), home({ structure: 'unknown', era: 'unknown', retrofitted: true }));
  assert.ok(vm.status === 'ok');
  const vm2 = homeViewModel(cell(), home({ structure: 'steel', retrofitted: true }));
  assert.deepEqual(vm2.status === 'ok' && vm2.notes, [FLOORS_NOTE, RETRO_NOTE]);
  const vm3 = homeViewModel(cell(), home({ structure: 'unknown', retrofitted: true }));
  assert.deepEqual(vm3.status === 'ok' && vm3.notes, [UNKNOWN_NOTE, RETRO_NOTE]);
});

const wood100: BuildingStock = { total: 100, shares: { 'wood:pre1981': 1 } };

test('areaViewModel: ストックの無いメッシュだけ → nostock', () => {
  assert.deepEqual(areaViewModel({ a: cell() }, {}, ['a']), { status: 'nostock' });
  assert.deepEqual(areaViewModel({}, { a: wood100 }, ['a']), { status: 'nostock' });
});

test('areaViewModel: 建物データが不正なら unavailable（例外を外に出さない）', () => {
  const broken = { total: 100, shares: { 'wood:pre1981': 0.3 } } as BuildingStock; // 合計が1でない
  assert.deepEqual(areaViewModel({ a: cell() }, { a: broken }, ['a']), { status: 'unavailable' });
});

test('locationNote: どの場所で計算したかの一文', () => {
  assert.equal(locationNote({ kind: 'address', label: '三重県津市広明町' }), '三重県津市広明町 付近で計算しました');
  assert.equal(locationNote({ kind: 'pin' }), '地図で選んだ場所で計算しました');
  assert.equal(locationNote({ kind: 'gps' }), '現在地で計算しました');
});

test('areaViewModel: estimateArea と一致（10棟単位に丸め）', () => {
  const cells = { a: cell(), b: cell({ intensity: 5.5 }) };
  const stock = { a: wood100, b: { total: 237, shares: { 'wood:post2000': 0.5, 'rc:pre1981': 0.5 } } as BuildingStock };
  const raw = estimateArea(cells, stock, ['a', 'b', 'c']);
  const vm = areaViewModel(cells, stock, ['a', 'b', 'c']);
  assert.deepEqual(vm, {
    status: 'ok',
    collapse: Math.round(raw.collapse / 10) * 10,
    half: Math.round(raw.half / 10) * 10,
    meshes: raw.countedMeshes,
  });
  assert.equal(vm.status === 'ok' && vm.collapse % 10, 0);
});

const sh = (id: string, dLat: number, o: Partial<Shelter> = {}): Shelter => ({
  id, name: id, pos: { lat: 35 + dLat, lon: 135 }, earthquake: true, tsunami: false, ...o,
});
const origin = { lat: 35, lon: 135 };

test('evacuation: 地震用は earthquake:true だけ・最大5件・注意文3つ', () => {
  const shelters = [
    ...Array.from({ length: 7 }, (_, i) => sh(`e${i}`, 0.001 * (i + 1))),
    sh('t-only', 0.0001, { earthquake: false, tsunami: true }),
  ];
  const lists = evacuationViewModel(origin, shelters, cell());
  assert.equal(lists.length, 2);
  assert.equal(lists[0].hazard, 'earthquake');
  assert.equal(lists[0].items.length, 5);
  assert.ok(!lists[0].items.some((i) => i.name === 't-only'));
  assert.equal(lists[0].items[0].name, 'e0');
  assert.deepEqual(lists[0].notices, NOTICES);
  for (const i of lists[0].items) assert.equal(i.reach, 'n/a');
});

test('evacuation: 津波深さがあれば津波リストも（ゆっくり徒歩で到達判定）', () => {
  const shelters = [
    sh('near', 0.001, { tsunami: true }), // 約111m
    sh('far', 0.02, { tsunami: true }),   // 約2.2km
  ];
  const lists = evacuationViewModel(origin, shelters, cell({ tsunamiDepth: 2, tsunamiArrivalMin: 30 }));
  assert.deepEqual(lists.map((l) => l.hazard), ['earthquake', 'tsunami']);
  const t = lists[1];
  assert.deepEqual(t.items.map((i) => i.name), ['near', 'far']);
  assert.equal(t.items[0].reach, 'ok');   // ゆっくり: 111*1.3/0.5/60 ≈ 4.8分 < 24
  assert.equal(t.items[1].reach, 'no');   // ≈ 96分 > 30
  assert.deepEqual(t.notices, NOTICES);
});

test('evacuation: 津波データが無くても津波の避難場所リストは常に出す（到達判定は n/a）', () => {
  const s = [sh('x', 0.001, { tsunami: true }), sh('e', 0.0005)];
  for (const c of [cell(), null, cell({ tsunamiDepth: NaN }), cell({ tsunamiDepth: 1, tsunamiArrivalMin: null })]) {
    const l = evacuationViewModel(origin, s, c);
    assert.deepEqual(l.map((x) => x.hazard), ['earthquake', 'tsunami'], JSON.stringify(c));
    assert.deepEqual(l[1].items.map((i) => i.name), ['x']);
    assert.equal(l[1].items[0].reach, 'n/a');
  }
});

test('evacuation: 距離・徒歩の書式', () => {
  const l = evacuationViewModel(origin, [sh('a', 0.001), sh('b', 0.02)], cell());
  const [a, b] = l[0].items;
  assert.match(a.distance, /^約\d+0m$/);
  assert.equal(a.distance, '約110m');
  assert.match(b.distance, /^約\d+\.\dkm$/);
  assert.equal(b.distance, '約2.2km');
  assert.match(a.walkStandard, /^約\d+分$/);
  assert.equal(a.walkStandard, '約3分'); // 111*1.3/60 = 2.4 → 3
  assert.equal(a.walkSlow, '約5分');     // 4.8 → 5
});

test('液状化: 非有限・0cm に丸まる値は null', () => {
  for (const v of [NaN, Infinity]) {
    // 非有限はデータ不正として estimateHome が null → 'nodata'（「約NaNcm」は出ない）
    assert.deepEqual(homeViewModel(cell({ settlementCm: v }), home()), { status: 'nodata' }, String(v));
  }
  for (const v of [0, 0.4]) {
    const vm = homeViewModel(cell({ settlementCm: v }), home());
    assert.ok(vm.status === 'ok' && vm.liquefaction === null, String(v));
  }
  const vm = homeViewModel(cell({ settlementCm: 0.5 }), home());
  assert.ok(vm.status === 'ok' && vm.liquefaction === '液状化で地盤が約1cm沈下するおそれ');
});



test('距離の境界: 994m → 約990m, 996m → 約1.0km', async () => {
  const { distanceM } = await import('../../src/core/mesh.ts');
  const perDeg = distanceM(origin, { lat: 36, lon: 135 });
  const at = (m: number) => sh('d', m / perDeg);
  assert.equal(evacuationViewModel(origin, [at(994)], cell())[0].items[0].distance, '約990m');
  assert.equal(evacuationViewModel(origin, [at(996)], cell())[0].items[0].distance, '約1.0km');
  assert.equal(evacuationViewModel(origin, [at(999)], cell())[0].items[0].distance, '約1.0km');
});

test("reach は 'tight' になりうる（ゆっくり徒歩 ≈4.8分 / 到達5.5分）", () => {
  const l = evacuationViewModel(origin, [sh('n', 0.001, { tsunami: true })], cell({ tsunamiDepth: 2, tsunamiArrivalMin: 5.5 }));
  assert.equal(l[1].items[0].reach, 'tight');
});
