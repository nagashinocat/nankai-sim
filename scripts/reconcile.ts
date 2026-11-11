import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { useFragilityTable, shakeRates } from '../src/core/fragility.ts';
import type { FragilityTable } from '../src/core/fragility.ts';
import type { Era, Structure } from '../src/core/types.ts';
import fragility from '../src/data/fragility.json' with { type: 'json' };

export type ReconcileInput = { municipality: string; case: string; published: number | null; computed: number };
export type ReconcileResult = { municipality: string; case: string; ratio: number | null; pass: boolean | null };

/** 計算値/公表値の比が 1±tolerance に入れば合格。公表値が null（「-」: わずか）なら照合対象外。 */
export function reconcile(rows: ReconcileInput[], tolerance = 0.3): ReconcileResult[] {
  return rows.map((r) => {
    if (r.published === null || r.published <= 0) return { municipality: r.municipality, case: r.case, ratio: null, pass: null };
    const ratio = r.computed / r.published;
    return { municipality: r.municipality, case: r.case, ratio, pass: Math.abs(ratio - 1) <= tolerance + 1e-9 };
  });
}

type Row = ReconcileInput & ReconcileResult;

/** 照合表（Markdown）。notes は manifest の各データセットの仮定。 */
export const CABINET_PREF_TOTAL = 157000; // 内閣府 都府県別 三重県 揺れ全壊（陸側）約157,000 (bousai.go.jp/jishin/nankai/taisaku_wg_02/pdf/saidai_02.pdf)
export const PREF_PUBLISHED_TOTAL = 152000; // 県の公表 県計 約152,000

const CSV_CASES = ['L2'];
const HAZARD_CASES = ['L2', 'L2_RIKU', 'HALF_E', 'HALF_W'];

/** CSV のケース名（L2=県の L2 公表値）を、使うハザードのディレクトリ名に対応づける。未知は例外。 */
export function resolveHazardCase(csvCase: string, hazardCase: string): string {
  if (!CSV_CASES.includes(csvCase)) throw new Error(`未知の CSV ケース: ${csvCase}`);
  if (!HAZARD_CASES.includes(hazardCase)) throw new Error(`未知のハザードケース: ${hazardCase}`);
  return hazardCase;
}

export type PrefTotal = { computed: number; ratioCabinet: number; ratioPref: number };
export function prefectureTotal(rows: { computed: number }[]): PrefTotal {
  const computed = rows.reduce((a, r) => a + r.computed, 0);
  return { computed, ratioCabinet: computed / CABINET_PREF_TOTAL, ratioPref: computed / PREF_PUBLISHED_TOTAL };
}

export type ReportOptions = { hazardCase?: string; skipped?: number; prefecture?: PrefTotal };

export function buildReport(results: (ReconcileResult & Partial<ReconcileInput>)[], datasets: { id: string; notes?: string }[], opts: ReportOptions = {}): string {
  const judged = results.filter((r) => r.pass !== null);
  const passed = judged.filter((r) => r.pass).length;
  const fmt = (n: number | null | undefined) => (n == null ? '-' : Math.round(n).toLocaleString('en-US'));
  const lines = [
    `# 三重県 L2 揺れ全壊棟数の照合（ハザード: ${opts.hazardCase ?? '-'}）`,
    '',
    `合格（±30%）: ${passed}/${judged.length}`,
    '',
    '| 市町 | 公表値 | 計算値 | 比 | 合否 |',
    '|---|---:|---:|---:|---|',
    ...results.map((r) => `| ${r.municipality} | ${fmt(r.published)} | ${fmt(r.computed)} | ${r.ratio === null ? '-' : r.ratio.toFixed(2)} | ${r.pass === null ? '-' : r.pass ? 'pass' : 'FAIL'} |`),
    ...(opts.prefecture
      ? [
          '',
          `県計: 計算 ${opts.prefecture.computed.toLocaleString('en-US').split('.')[0]} / 内閣府 約${CABINET_PREF_TOTAL.toLocaleString('en-US')}（陸側, https://www.bousai.go.jp/jishin/nankai/taisaku_wg_02/pdf/saidai_02.pdf）= ${opts.prefecture.ratioCabinet.toFixed(2)} / 県 約${PREF_PUBLISHED_TOTAL.toLocaleString('en-US')} = ${opts.prefecture.ratioPref.toFixed(2)}`,
        ]
      : []),
    ...(opts.skipped !== undefined ? ['', `ハザードまたは建物が無くスキップしたメッシュ数: ${opts.skipped}`] : []),
    '',
    '## 前提（manifest の notes）',
    '',
    '- 揺れのみ（R12）。液状化・津波は含めない。非木造は階数未入力（全階数の包絡）。',
    '- 公表値は丸め値。非住宅にも住宅の割合を当てる仮定を含む（下記 notes 参照）。',
    ...datasets.map((d) => `- ${d.id}: ${d.notes ?? ''}`),
  ];
  return lines.join('\n') + '\n';
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function readJson(p: string): any { return JSON.parse(readFileSync(resolve(root, p), 'utf8')); }

export type JsonReader = (relPath: string) => unknown;

/** 市町のメッシュ群の揺れ全壊棟数 Σ total×share×collapse(Ia)。reader は public/ 配下の相対パスから JSON を読む（テストで差し替え可）。 */
export function computeMunicipality(hazardCase: string, meshes: string[], hazardCache: Map<string, Record<string, number[]>>, stockCache: Map<string, Record<string, { total: number; shares: Record<string, number> }>>, reader: JsonReader = readJson): { sum: number; skipped: number } {
  let sum = 0;
  let skipped = 0;
  for (const mesh of meshes) {
    const m2 = mesh.slice(0, 6);
    if (!hazardCache.has(m2)) hazardCache.set(m2, reader(`public/data/hazard/${hazardCase}/${m2}.json`) as Record<string, number[]>);
    if (!stockCache.has(m2)) stockCache.set(m2, reader(`public/data/stock/${m2}.json`) as Record<string, { total: number; shares: Record<string, number> }>);
    const hz = hazardCache.get(m2)![mesh];
    const st = stockCache.get(m2)![mesh];
    if (!hz || !st) { skipped++; continue; }
    const ia = hz[0]!;
    for (const [key, share] of Object.entries(st.shares)) {
      const [s, e] = key.split(':') as [Structure, Era];
      sum += st.total * share * shakeRates(ia, s, e, undefined, 'rep').collapse;
    }
  }
  return { sum, skipped };
}

function main(): void {
  const i = process.argv.indexOf('--hazard-case');
  const hazardCase = i >= 0 ? process.argv[i + 1] : 'L2_RIKU';
  if (!hazardCase) throw new Error('--hazard-case に値がありません');
  useFragilityTable(fragility as unknown as FragilityTable);
  const csv = readFileSync(resolve(root, 'data/published/mie_municipal.csv'), 'utf8').trim().split('\n').slice(1);
  const meshes: Record<string, string[]> = readJson('public/data/stock/municipality_meshes.json');
  const hz = new Map<string, Record<string, number[]>>();
  const st = new Map<string, Record<string, { total: number; shares: Record<string, number> }>>();
  let skipped = 0;
  const inputs: ReconcileInput[] = csv.map((line: string) => {
    const [municipality, c, v] = line.split(',') as [string, string, string];
    resolveHazardCase(c, hazardCase);
    const ms = meshes[municipality];
    if (!ms) throw new Error(`municipality_meshes.json に ${municipality} がありません`);
    const published = v.trim() === '-' || v.trim() === '' ? null : Number(v);
    const r = computeMunicipality(hazardCase, ms, hz, st);
    skipped += r.skipped;
    return { municipality, case: c, published, computed: r.sum };
  });
  const results = reconcile(inputs);
  const rows = results.map((r, i) => ({ ...inputs[i]!, ...r }) as Row);
  const manifest = readJson('public/data/manifest.json') as { datasets: { id: string; notes?: string }[] };
  const md = buildReport(rows, manifest.datasets, { hazardCase, skipped, prefecture: prefectureTotal(rows) });
  mkdirSync(resolve(root, 'reports'), { recursive: true });
  const out = resolve(root, `reports/reconcile-mie-${hazardCase}.md`);
  writeFileSync(out, md);
  console.log(md.split('## 前提')[0]);
  if (!existsSync(out)) throw new Error('レポートを書けませんでした');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
