import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, buildReport } from '../../scripts/reconcile.ts';

const row = (published: number | null, computed: number) => ({ municipality: 'A', case: 'L2', published, computed });

test('±30% の境界: 1.29 は合格、1.32 は不合格', () => {
  const [a] = reconcile([row(1000, 1290)]);
  const [b] = reconcile([row(1000, 1320)]);
  assert.equal(a!.pass, true);
  assert.equal(b!.pass, false);
  assert.ok(Math.abs(a!.ratio! - 1.29) < 1e-9);
});

test('下側の境界: 0.71 は合格、0.68 は不合格', () => {
  assert.equal(reconcile([row(1000, 710)])[0]!.pass, true);
  assert.equal(reconcile([row(1000, 680)])[0]!.pass, false);
});

test('ちょうど ±30% は合格', () => {
  assert.equal(reconcile([row(1000, 1300)])[0]!.pass, true);
  assert.equal(reconcile([row(1000, 700)])[0]!.pass, true);
});

test('許容幅は引数で変えられる', () => {
  assert.equal(reconcile([row(1000, 1290)], 0.2)[0]!.pass, false);
});

test('公表値が null（「-」）は ratio も pass も null', () => {
  const [r] = reconcile([row(null, 50)]);
  assert.equal(r!.ratio, null);
  assert.equal(r!.pass, null);
});

test('レポートに manifest の notes と合否表が載る', () => {
  const res = reconcile([row(1000, 1100), row(null, 3)]);
  const md = buildReport(res, [{ id: 'housing-land-survey', notes: '非住宅にも住宅の割合を当てた仮定' }]);
  assert.ok(md.includes('非住宅にも住宅の割合を当てた仮定'));
  assert.ok(md.includes('housing-land-survey'));
  assert.ok(md.includes('1/1') || md.includes('1 / 1'));
});

import { resolveHazardCase, prefectureTotal, parseArgs } from '../../scripts/reconcile.ts';

test('CSV の L2 は --hazard-case で指定したハザードに対応づく', () => {
  assert.equal(resolveHazardCase('L2', 'L2_RIKU'), 'L2_RIKU');
  assert.equal(resolveHazardCase('L2', 'L2'), 'L2');
});

test('未知の CSV ケースやハザードケースは例外', () => {
  assert.throws(() => resolveHazardCase('L1', 'L2_RIKU'));
  assert.throws(() => resolveHazardCase('L2', 'BOGUS'));
});

test('県計: 計算値の合計と 国の想定値（--national）・県の公表値との比', () => {
  const t = prefectureTotal([row(1000, 78500), row(null, 78500)], 157000, 152000);
  assert.equal(t.computed, 157000);
  assert.equal(t.national, 157000);
  assert.ok(Math.abs(t.ratioCabinet - 1) < 1e-9);
  assert.ok(Math.abs(t.ratioPref! - 157000 / 152000) < 1e-9);
  const u = prefectureTotal([row(1000, 50000)], 100000, null);
  assert.ok(Math.abs(u.ratioCabinet - 0.5) < 1e-9);
  assert.equal(u.ratioPref, null);
});

test('レポートに県名・県計行とスキップしたメッシュ数が載る', () => {
  const res = reconcile([row(1000, 1100)]);
  const md = buildReport(res, [], { hazardCase: 'L2_RIKU', skipped: 7, prefecture: prefectureTotal([row(1000, 1100)], 157000, 152000) });
  assert.ok(md.startsWith('# 三重県 '));
  assert.ok(md.includes('県計'));
  assert.ok(md.includes('157,000'));
  assert.ok(md.includes('152,000'));
  assert.ok(md.includes('L2_RIKU'));
  assert.ok(/スキップ.*7/.test(md));
});

test('レポート: 県の公表値が無ければ国との比だけ。見出しは県名', () => {
  const res = reconcile([row(1000, 1100)]);
  const md = buildReport(res, [], { prefName: '愛知県', prefecture: prefectureTotal([row(1000, 1100)], 52000, null) });
  assert.ok(md.startsWith('# 愛知県 '));
  assert.ok(md.includes('52,000'));
  assert.ok(!md.includes('152,000'));
  assert.ok(!md.includes('県 約'));
});

test('parseArgs: 既定は三重（24）・国の想定値 157000・陸側', () => {
  const a = parseArgs([]);
  assert.equal(a.pref, '24');
  assert.equal(a.prefName, '三重県');
  assert.equal(a.national, 157000);
  assert.equal(a.prefPublished, 152000);
  assert.equal(a.hazardCase, 'L2_RIKU');
  assert.equal(a.csv, 'data/published/24_municipal.csv');
  assert.equal(a.report, 'reports/reconcile-24-L2_RIKU.md');
});

test('parseArgs: 他県は --national が必須。CSV は <県コード>_municipal.csv', () => {
  assert.throws(() => parseArgs(['--pref', '23']), /--national/);
  const a = parseArgs(['--pref', '23', '--national', '52000', '--hazard-case', 'L2']);
  assert.equal(a.prefName, '愛知県');
  assert.equal(a.national, 52000);
  assert.equal(a.prefPublished, null);
  assert.equal(a.csv, 'data/published/23_municipal.csv');
  assert.equal(a.report, 'reports/reconcile-23-L2.md');
});

test('parseArgs: 未知の県コード・数でない --national・値の無い引数は例外', () => {
  assert.throws(() => parseArgs(['--pref', '13', '--national', '1']), /13/);
  assert.throws(() => parseArgs(['--pref', '22', '--national', 'abc']), /--national/);
  assert.throws(() => parseArgs(['--pref', '22', '--national', '0']), /--national/);
  assert.throws(() => parseArgs(['--pref']), /--pref/);
  assert.throws(() => parseArgs(['--hazard-case', 'BOGUS']), /BOGUS/);
});

test('三重の公表値 CSV は 24_municipal.csv にある', () => {
  const csv = readFileSync(fileURLToPath(new URL('../../data/published/24_municipal.csv', import.meta.url)), 'utf8');
  assert.ok(csv.startsWith('municipality,case,shake_collapse'));
  assert.equal(csv.trim().split('\n').length - 1, 29);
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeMunicipality } from '../../scripts/reconcile.ts';
import { useFragilityTable, shakeRates } from '../../src/core/fragility.ts';
import type { FragilityTable } from '../../src/core/fragility.ts';

test('computeMunicipality: Σ total×share×collapse(Ia) と欠落メッシュのスキップ', () => {
  const fx = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/fragility.synthetic.json', import.meta.url)), 'utf8')) as FragilityTable;
  useFragilityTable(fx);
  const files: Record<string, unknown> = {
    // 5236442025 = 想定値の無いメッシュ（Ruling F1 の全項目 null の行）→ スキップ
    'public/data/hazard/L2_RIKU/523644.json': { '5236442023': [6.0, null, null, null, null], '5236442024': [5.0, null, null, null, null], '5236442025': [null, null, null, null, null] },
    'public/data/stock/523644.json': {
      '5236442023': { total: 100, shares: { 'wood:pre1981': 0.6, 'rc:post2000': 0.4 } },
      '5236442024': { total: 50, shares: { 'wood:y1981_2000': 1 } },
      '5236442025': { total: 10, shares: { 'wood:pre1981': 1 } }, // ハザードなし
    },
  };
  const reader = (p: string) => {
    if (!(p in files)) throw new Error(`unexpected ${p}`);
    return files[p];
  };
  const expected =
    100 * 0.6 * shakeRates(6.0, 'wood', 'pre1981', undefined, 'rep').collapse +
    100 * 0.4 * shakeRates(6.0, 'rc', 'post2000', undefined, 'rep').collapse +
    50 * 1 * shakeRates(5.0, 'wood', 'y1981_2000', undefined, 'rep').collapse;
  assert.ok(expected > 0);
  const r = computeMunicipality('L2_RIKU', ['5236442023', '5236442024'], new Map(), new Map(), reader);
  assert.ok(Math.abs(r.sum - expected) < 1e-9);
  assert.equal(r.skipped, 0);
  const r2 = computeMunicipality('L2_RIKU', ['5236442023', '5236442025', '5236442099'], new Map(), new Map(), reader);
  assert.equal(r2.skipped, 2);
});

test('parseArgs: L2_KIHON（内閣府ケース1・基本ケース）を受け付ける', () => {
  const a = parseArgs(['--pref', '21', '--national', '7773', '--hazard-case', 'L2_KIHON']);
  assert.equal(a.hazardCase, 'L2_KIHON');
  assert.equal(a.report, 'reports/reconcile-21-L2_KIHON.md');
  assert.equal(resolveHazardCase('L2', 'L2_KIHON'), 'L2_KIHON');
});

test('parseArgs: 県の公表 県計はケースごと（県が使ったケースのときだけ比べる）', () => {
  assert.equal(parseArgs([]).prefPublished, 152000);
  assert.equal(parseArgs(['--hazard-case', 'L2']).prefPublished, null);
  assert.equal(parseArgs(['--pref', '23', '--national', '1']).prefPublished, 222000);
  assert.equal(parseArgs(['--pref', '21', '--national', '1', '--hazard-case', 'L2_KIHON']).prefPublished, 7773);
  assert.equal(parseArgs(['--pref', '21', '--national', '1']).prefPublished, null);
  assert.equal(parseArgs(['--pref', '22', '--national', '1', '--totals-only']).prefPublished, 179000);
  assert.equal(parseArgs(['--pref', '22', '--national', '1', '--totals-only', '--hazard-case', 'L2_KIHON']).prefPublished, 171000);
});

test('parseArgs: --national を渡したときは内閣府の値と書かない（ラベルは指定値）', () => {
  assert.match(parseArgs([]).nationalLabel, /内閣府/);
  const a = parseArgs(['--pref', '23', '--national', '222000']);
  assert.doesNotMatch(a.nationalLabel, /内閣府/);
  assert.match(a.nationalLabel, /--national/);
  const md = buildReport(reconcile([row(1000, 1100)]), [], { prefName: '愛知県', nationalLabel: a.nationalLabel, prefecture: prefectureTotal([row(1000, 1100)], 222000, 222000) });
  assert.ok(!md.includes('内閣府'));
  assert.ok(md.includes('--national'));
});

test('parseArgs: --totals-only は公表 CSV を読まず、県の建物出力の市町村一覧を使う', () => {
  const a = parseArgs(['--pref', '22', '--national', '179000', '--totals-only']);
  assert.equal(a.csv, null);
  assert.equal(a.munisFrom, 'build/data-build/22/stock/municipality_meshes.json');
  assert.equal(a.report, 'reports/reconcile-22-L2_RIKU.md');
  const b = parseArgs([]);
  assert.equal(b.csv, 'data/published/24_municipal.csv');
  assert.equal(b.munisFrom, null);
});

import { inputsFromNames } from '../../scripts/reconcile.ts';

test('inputsFromNames: 公表値なし（null）の行を渡した順に作る', () => {
  const rows = inputsFromNames(['浜松市', '熱海市'], 'L2_RIKU', (n) => (n === '熱海市' ? 10 : 20));
  assert.deepEqual(rows, [
    { municipality: '浜松市', case: 'L2_RIKU', published: null, computed: 20 },
    { municipality: '熱海市', case: 'L2_RIKU', published: null, computed: 10 },
  ]);
});

test('parseArgs: 照合用ケース（L2_RIKU・L2_KIHON）は build/hazard-reconcile、公開ケースは public/data/hazard から読む。--hazard-dir で変えられる', () => {
  assert.equal(parseArgs([]).hazardDir, 'build/hazard-reconcile');
  assert.equal(parseArgs(['--pref', '21', '--national', '1', '--hazard-case', 'L2_KIHON']).hazardDir, 'build/hazard-reconcile');
  assert.equal(parseArgs(['--hazard-case', 'L2']).hazardDir, 'public/data/hazard');
  assert.equal(parseArgs(['--hazard-case', 'HALF_E']).hazardDir, 'public/data/hazard');
  assert.equal(parseArgs(['--hazard-dir', '/tmp/hz']).hazardDir, '/tmp/hz');
});

test('computeMunicipality: ハザードのディレクトリを指定できる', () => {
  const fx = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/fragility.synthetic.json', import.meta.url)), 'utf8')) as FragilityTable;
  useFragilityTable(fx);
  const seen: string[] = [];
  const reader = (p: string) => {
    seen.push(p);
    return p.includes('hazard') ? { '5236442023': [6.0, null, null, null, null] } : { '5236442023': { total: 10, shares: { 'wood:pre1981': 1 } } };
  };
  computeMunicipality('L2_RIKU', ['5236442023'], new Map(), new Map(), reader, 'build/hazard-reconcile');
  assert.deepEqual(seen, ['build/hazard-reconcile/L2_RIKU/523644.json', 'public/data/stock/523644.json']);
});

test('parseArgs: --totals-only は市町村別の公表表が無い県だけ（ある県は例外）', () => {
  assert.throws(() => parseArgs(['--totals-only']), /--totals-only/);
  assert.throws(() => parseArgs(['--pref', '23', '--national', '1', '--totals-only']), /--totals-only/);
  assert.throws(() => parseArgs(['--pref', '21', '--national', '1', '--totals-only']), /--totals-only/);
  assert.doesNotThrow(() => parseArgs(['--pref', '22', '--national', '1', '--totals-only']));
});

// --- 和歌山県（30）: 公表値は「揺れ等」（液状化・震動・斜面崩壊）なので、揺れ＋液状化で比べる（Ruling W-a） ---
import { municipalityMeshes } from '../../scripts/reconcile.ts';
import { liquefactionRates } from '../../src/core/fragility.ts';
import { combine } from '../../src/core/damage.ts';

test('parseArgs: 和歌山（30）は 30_municipal.csv・県計 約84,700（陸側）・既定で揺れ＋液状化。--shake-only で揺れのみ', () => {
  assert.throws(() => parseArgs(['--pref', '30']), /--national/);
  const a = parseArgs(['--pref', '30', '--national', '84700']);
  assert.equal(a.prefName, '和歌山県');
  assert.equal(a.csv, 'data/published/30_municipal.csv');
  assert.equal(a.hazardCase, 'L2_RIKU');
  assert.equal(a.prefPublished, 84700);
  assert.equal(a.withLiquefaction, true);
  assert.equal(a.report, 'reports/reconcile-30-L2_RIKU-liq.md');
  const b = parseArgs(['--pref', '30', '--national', '84700', '--shake-only']);
  assert.equal(b.withLiquefaction, false);
  assert.equal(b.report, 'reports/reconcile-30-L2_RIKU.md');
  // ほかの県は従来どおり揺れのみ
  assert.equal(parseArgs([]).withLiquefaction, false);
  assert.equal(parseArgs(['--pref', '23', '--national', '1']).withLiquefaction, false);
});

test('和歌山の公表値 CSV は 30 市町村・合計 85,392', () => {
  const csv = readFileSync(fileURLToPath(new URL('../../data/published/30_municipal.csv', import.meta.url)), 'utf8');
  const rows = csv.trim().split('\n');
  assert.equal(rows[0], 'municipality,case,shake_collapse');
  assert.equal(rows.length - 1, 30);
  assert.equal(rows.slice(1).reduce((a, l) => a + Number(l.split(',')[2]), 0), 85392);
});

test('computeMunicipality: withLiquefaction なら揺れと液状化（沈下量 cm）の全壊率を合成。沈下量 null は揺れのみ', () => {
  const fx = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/fragility.synthetic.json', import.meta.url)), 'utf8')) as FragilityTable;
  useFragilityTable(fx);
  const files: Record<string, unknown> = {
    'h/L2_RIKU/523644.json': { '5236442023': [6.0, 20, 30, null, null], '5236442024': [6.0, null, null, null, null] },
    'public/data/stock/523644.json': {
      '5236442023': { total: 100, shares: { 'wood:pre1981': 0.5, 'steel:post2000': 0.5 } },
      '5236442024': { total: 10, shares: { 'wood:pre1981': 1 } },
    },
  };
  const reader = (p: string) => files[p];
  const both = (s: 'wood' | 'steel', e: 'pre1981' | 'post2000') =>
    combine([shakeRates(6.0, s, e, undefined, 'rep'), liquefactionRates(30, s, e, 'rep')]).collapse;
  const expected = 50 * both('wood', 'pre1981') + 50 * both('steel', 'post2000') + 10 * shakeRates(6.0, 'wood', 'pre1981', undefined, 'rep').collapse;
  const r = computeMunicipality('L2_RIKU', ['5236442023', '5236442024'], new Map(), new Map(), reader, 'h', true);
  assert.ok(Math.abs(r.sum - expected) < 1e-9);
  const shakeOnly = computeMunicipality('L2_RIKU', ['5236442023', '5236442024'], new Map(), new Map(), reader, 'h');
  assert.ok(r.sum > shakeOnly.sum);
});

test('municipalityMeshes: 統合で県名付きになった同名の町村（愛知県美浜町・和歌山県美浜町）は県名付きを先に引く', () => {
  const mm = { 愛知県美浜町: ['a'], 和歌山県美浜町: ['w'], 和歌山市: ['x'] };
  assert.deepEqual(municipalityMeshes(mm, '美浜町', '和歌山県'), ['w']);
  assert.deepEqual(municipalityMeshes(mm, '美浜町', '愛知県'), ['a']);
  assert.deepEqual(municipalityMeshes(mm, '和歌山市', '和歌山県'), ['x']);
  assert.throws(() => municipalityMeshes(mm, '美浜町', '三重県'), /美浜町/);
});

test('レポート: 揺れ＋液状化のときは見出しと前提に書き、公表値の定義の違いも載せる', () => {
  const md = buildReport(reconcile([row(1000, 1100)]), [], {
    prefName: '和歌山県', hazardCase: 'L2_RIKU', withLiquefaction: true,
    definitionNote: '公表値は「揺れ等による全壊」（液状化・震動・斜面崩壊）',
  });
  assert.ok(md.startsWith('# 和歌山県 L2 揺れ＋液状化 全壊棟数の照合'));
  assert.ok(md.includes('揺れ＋液状化'));
  assert.ok(md.includes('斜面崩壊'));
  assert.ok(!md.includes('揺れのみ（R12）'));
  const shake = buildReport(reconcile([row(1000, 1100)]), [], { prefName: '三重県' });
  assert.ok(shake.startsWith('# 三重県 L2 揺れ全壊棟数の照合'));
  assert.ok(shake.includes('揺れのみ（R12）'));
});
