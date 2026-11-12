import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { useFragilityTable, shakeRates, liquefactionRates } from '../src/core/fragility.ts';
import { combine } from '../src/core/damage.ts';
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

export const PREF_NAMES: Record<string, string> = { '21': '岐阜県', '22': '静岡県', '23': '愛知県', '24': '三重県', '30': '和歌山県' };
/** 国（内閣府）の都府県別 揺れ全壊の想定値の既定。三重県 揺れ全壊（陸側）約157,000 (bousai.go.jp/jishin/nankai/taisaku_wg_02/pdf/saidai_02.pdf)。他県は --national で渡す。 */
export const DEFAULT_NATIONAL: Record<string, number> = { '24': 157000 };
/**
 * 県の公表 揺れ全壊の県計（県が使ったケースのみ。ほかのケースでは比べない）。
 * 三重 約152,000（陸側）／愛知 約222,000（理論上最大・陸側ケース）／岐阜 7,773（内閣府 基本ケース）／
 * 静岡 L2 地震動 基本ケース 約171,000・陸側ケース 約179,000（第4次地震被害想定 第一次報告 第Ⅲ編）／
 * 和歌山 揺れ等による全壊 全県 約84,700（平成26年3月 地震被害想定調査 概要版 p.17、内閣府2012年モデルの陸側ケース。市町村の和は 85,392）。
 */
export const PREF_PUBLISHED_TOTALS: Record<string, Record<string, number>> = {
  '24': { L2_RIKU: 152000 },
  '23': { L2_RIKU: 222000 },
  '21': { L2_KIHON: 7773 },
  '22': { L2_RIKU: 179000, L2_KIHON: 171000 },
  '30': { L2_RIKU: 84700 },
};
/**
 * 公表値に液状化を含む県（Ruling W-a）。和歌山県の「揺れ等による全壊」は液状化・震動・斜面崩壊を含むため、
 * 揺れと液状化の全壊率を合成して比べる（--shake-only で揺れのみ）。斜面崩壊は本アプリに無い。
 */
export const PREF_INCLUDES_LIQUEFACTION: Record<string, boolean> = { '30': true };
/** 公表値の定義が本アプリの計算と違う県の注記（レポートの前提に載せる）。 */
export const PUBLISHED_DEFINITION_NOTES: Record<string, string> = {
  '30': '和歌山県の公表値は「揺れ等による全壊棟数」で、液状化・震動・斜面崩壊を含む（平成26年3月 地震被害想定調査 概要版 p.17、冬18時 風速8m）。本計算は揺れ＋液状化で、斜面崩壊は含まない。',
};
const CABINET_URL = 'https://www.bousai.go.jp/jishin/nankai/taisaku_wg_02/pdf/saidai_02.pdf';

const CSV_CASES = ['L2'];
const HAZARD_CASES = ['L2', 'L2_RIKU', 'HALF_E', 'HALF_W', 'L2_KIHON'];
/** 照合だけに使うケース。pipeline.naikaku_hazard が public/ の外（build/hazard-reconcile）に出力する（Ruling T7-f）。 */
export const RECONCILE_CASES = ['L2_RIKU', 'L2_KIHON'];
export const PUBLIC_HAZARD_DIR = 'public/data/hazard';
export const RECONCILE_HAZARD_DIR = 'build/hazard-reconcile';

/** CSV のケース名（L2=県の L2 公表値）を、使うハザードのディレクトリ名に対応づける。未知は例外。 */
export function resolveHazardCase(csvCase: string, hazardCase: string): string {
  if (!CSV_CASES.includes(csvCase)) throw new Error(`未知の CSV ケース: ${csvCase}`);
  if (!HAZARD_CASES.includes(hazardCase)) throw new Error(`未知のハザードケース: ${hazardCase}`);
  return hazardCase;
}

export type PrefTotal = { computed: number; national: number; ratioCabinet: number; prefPublished: number | null; ratioPref: number | null };
/** 県計: 計算値の合計と、国の想定値（national）・県の公表値（prefPublished、無ければ null）との比。 */
export function prefectureTotal(rows: { computed: number }[], national: number, prefPublished: number | null): PrefTotal {
  const computed = rows.reduce((a, r) => a + r.computed, 0);
  return {
    computed,
    national,
    ratioCabinet: computed / national,
    prefPublished,
    ratioPref: prefPublished ? computed / prefPublished : null,
  };
}

export type ReportOptions = { hazardCase?: string; skipped?: number; prefecture?: PrefTotal; prefName?: string; nationalLabel?: string; withLiquefaction?: boolean; definitionNote?: string };

export type Args = {
  pref: string; prefName: string; national: number; nationalLabel: string; prefPublished: number | null; hazardCase: string;
  /** 公表値 CSV（--totals-only のときは null） */
  csv: string | null;
  /** --totals-only のとき市町村一覧を読む県ごとの建物出力（それ以外は null） */
  munisFrom: string | null;
  /** ハザードのディレクトリ（リポジトリのルートから。その下に <ケース>/<2次メッシュ>.json） */
  hazardDir: string;
  /** 揺れと液状化の全壊率を合成して比べる（公表値が液状化を含む県。Ruling W-a） */
  withLiquefaction: boolean;
  report: string;
};

const CABINET_LABEL = `内閣府 （陸側, ${CABINET_URL}）`;

/**
 * コマンドライン引数: --pref <県コード>（既定 24）、--national <棟数>（24 以外は必須）、--hazard-case（既定 L2_RIKU）、
 * --totals-only（市町村別の公表値が無い県。build/data-build/<県>/stock/municipality_meshes.json の全市町村で県計だけ比べる）、
 * --shake-only（公表値が液状化を含む県（和歌山）でも揺れのみで計算。参考用）。
 */
export function parseArgs(argv: string[]): Args {
  const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} に値がありません`);
    return v;
  };
  const pref = opt('--pref') ?? '24';
  const prefName = PREF_NAMES[pref];
  if (!prefName) throw new Error(`未対応の県コード: ${pref}（${Object.keys(PREF_NAMES).join(', ')}）`);
  const hazardCase = opt('--hazard-case') ?? 'L2_RIKU';
  if (!HAZARD_CASES.includes(hazardCase)) throw new Error(`未知のハザードケース: ${hazardCase}`);
  const nat = opt('--national');
  const national = nat === undefined ? DEFAULT_NATIONAL[pref] : Number(nat);
  const totalsOnly = argv.includes('--totals-only');
  const withLiquefaction = !argv.includes('--shake-only') && (PREF_INCLUDES_LIQUEFACTION[pref] ?? false);
  const csvPath = `data/published/${pref}_municipal.csv`;
  if (totalsOnly && existsSync(resolve(root, csvPath))) throw new Error(`--totals-only は市町村別の公表表が無い県だけ（${csvPath} があります）`);
  if (national === undefined) throw new Error(`--national <棟数>（国の想定する ${prefName} の揺れ全壊棟数）を指定してください`);
  if (!Number.isFinite(national) || national <= 0) throw new Error(`--national は正の数: ${nat}`);
  return {
    pref,
    prefName,
    national,
    nationalLabel: nat === undefined ? CABINET_LABEL : '比較値（--national で指定）',
    prefPublished: PREF_PUBLISHED_TOTALS[pref]?.[hazardCase] ?? null,
    hazardCase,
    csv: totalsOnly ? null : csvPath,
    munisFrom: totalsOnly ? `build/data-build/${pref}/stock/municipality_meshes.json` : null,
    hazardDir: opt('--hazard-dir') ?? (RECONCILE_CASES.includes(hazardCase) ? RECONCILE_HAZARD_DIR : PUBLIC_HAZARD_DIR),
    withLiquefaction,
    report: `reports/reconcile-${pref}-${hazardCase}${withLiquefaction ? '-liq' : ''}.md`,
  };
}

/** 「内閣府 約157,000（陸側, URL）」の形。ラベルの「（」の前に値を入れる。 */
function nationalText(label: string, n: number): string {
  const v = `約${n.toLocaleString('en-US')}`;
  const i = label.indexOf('（');
  return i < 0 ? `${label} ${v}` : `${label.slice(0, i).trimEnd()} ${v}${label.slice(i)}`;
}

/** 公表値の無い市町村の照合行（--totals-only）。computed は市町村名 → 計算値。 */
export function inputsFromNames(names: string[], hazardCase: string, computed: (name: string) => number): ReconcileInput[] {
  return names.map((municipality) => ({ municipality, case: hazardCase, published: null, computed: computed(municipality) }));
}

/** 照合表（Markdown）。notes は manifest の各データセットの仮定。 */
export function buildReport(results: (ReconcileResult & Partial<ReconcileInput>)[], datasets: { id: string; notes?: string }[], opts: ReportOptions = {}): string {
  const judged = results.filter((r) => r.pass !== null);
  const passed = judged.filter((r) => r.pass).length;
  const fmt = (n: number | null | undefined) => (n == null ? '-' : Math.round(n).toLocaleString('en-US'));
  const what = opts.withLiquefaction ? '揺れ＋液状化 全壊棟数' : '揺れ全壊棟数';
  const lines = [
    `# ${opts.prefName ?? '三重県'} L2 ${what}の照合（ハザード: ${opts.hazardCase ?? '-'}）`,
    '',
    `合格（±30%）: ${passed}/${judged.length}`,
    '',
    '| 市町 | 公表値 | 計算値 | 比 | 合否 |',
    '|---|---:|---:|---:|---|',
    ...results.map((r) => `| ${r.municipality} | ${fmt(r.published)} | ${fmt(r.computed)} | ${r.ratio === null ? '-' : r.ratio.toFixed(2)} | ${r.pass === null ? '-' : r.pass ? 'pass' : 'FAIL'} |`),
    ...(opts.prefecture
      ? [
          '',
          `県計: 計算 ${opts.prefecture.computed.toLocaleString('en-US').split('.')[0]} / ${nationalText(opts.nationalLabel ?? CABINET_LABEL, opts.prefecture.national)} = ${opts.prefecture.ratioCabinet.toFixed(2)}` +
            (opts.prefecture.prefPublished !== null && opts.prefecture.ratioPref !== null
              ? ` / 県 約${opts.prefecture.prefPublished.toLocaleString('en-US')} = ${opts.prefecture.ratioPref.toFixed(2)}`
              : ''),
        ]
      : []),
    ...(opts.skipped !== undefined ? ['', `ハザードまたは建物が無くスキップしたメッシュ数: ${opts.skipped}`] : []),
    '',
    '## 前提（manifest の notes）',
    '',
    opts.withLiquefaction
      ? '- 揺れ＋液状化（メッシュの沈下量があれば 1−(1−揺れの全壊率)(1−液状化の全壊率) で合成）。津波は含めない。非木造は階数未入力（全階数の包絡）。'
      : '- 揺れのみ（R12）。液状化・津波は含めない。非木造は階数未入力（全階数の包絡）。',
    ...(opts.definitionNote ? [`- 公表値の定義: ${opts.definitionNote}`] : []),
    '- 公表値は丸め値。非住宅にも住宅の割合を当てる仮定を含む（下記 notes 参照）。',
    ...datasets.map((d) => `- ${d.id}: ${d.notes ?? ''}`),
  ];
  return lines.join('\n') + '\n';
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function readJson(p: string): any { return JSON.parse(readFileSync(resolve(root, p), 'utf8')); }

export type JsonReader = (relPath: string) => unknown;

/**
 * 市町村名 → 統合後の municipality_meshes.json のメッシュ。別の県に同名の町村があると統合で県名付き（例: 和歌山県美浜町）に
 * なるので、県名付きを先に引き、無ければそのままの名前。どちらも無ければ例外。
 */
export function municipalityMeshes(meshes: Record<string, string[]>, name: string, prefName: string): string[] {
  const ms = meshes[`${prefName}${name}`] ?? meshes[name];
  if (!ms) throw new Error(`municipality_meshes.json に ${name}（${prefName}${name}）がありません`);
  return ms;
}

/** 市町のメッシュ群の揺れ全壊棟数 Σ total×share×collapse(Ia)。withLiquefaction なら沈下量のあるメッシュで液状化の全壊率と合成。reader はリポジトリのルートからの相対パスで JSON を読む（ハザードは hazardDir の下）（テストで差し替え可）。 */
export function computeMunicipality(hazardCase: string, meshes: string[], hazardCache: Map<string, Record<string, (number | null)[]>>, stockCache: Map<string, Record<string, { total: number; shares: Record<string, number> }>>, reader: JsonReader = readJson, hazardDir: string = PUBLIC_HAZARD_DIR, withLiquefaction = false): { sum: number; skipped: number } {
  let sum = 0;
  let skipped = 0;
  for (const mesh of meshes) {
    const m2 = mesh.slice(0, 6);
    if (!hazardCache.has(m2)) hazardCache.set(m2, reader(`${hazardDir}/${hazardCase}/${m2}.json`) as Record<string, (number | null)[]>);
    if (!stockCache.has(m2)) stockCache.set(m2, reader(`public/data/stock/${m2}.json`) as Record<string, { total: number; shares: Record<string, number> }>);
    const hz = hazardCache.get(m2)![mesh];
    const st = stockCache.get(m2)![mesh];
    // 想定値の無いメッシュ（全項目 null の行。Ruling F1）もスキップ
    if (!hz || typeof hz[0] !== 'number' || !st) { skipped++; continue; }
    const ia = hz[0];
    const settlementCm = withLiquefaction && typeof hz[2] === 'number' ? hz[2] : null;
    for (const [key, share] of Object.entries(st.shares)) {
      const [s, e] = key.split(':') as [Structure, Era];
      const shake = shakeRates(ia, s, e, undefined, 'rep');
      const rate = settlementCm === null ? shake.collapse : combine([shake, liquefactionRates(settlementCm, s, e, 'rep')]).collapse;
      sum += st.total * share * rate;
    }
  }
  return { sum, skipped };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const { hazardCase } = args;
  useFragilityTable(fragility as unknown as FragilityTable);
  const meshes: Record<string, string[]> = readJson('public/data/stock/municipality_meshes.json');
  const hz = new Map<string, Record<string, (number | null)[]>>();
  const st = new Map<string, Record<string, { total: number; shares: Record<string, number> }>>();
  let skipped = 0;
  const compute = (municipality: string): number => {
    const ms = municipalityMeshes(meshes, municipality, args.prefName);
    const r = computeMunicipality(hazardCase, ms, hz, st, readJson, args.hazardDir, args.withLiquefaction);
    skipped += r.skipped;
    return r.sum;
  };
  let inputs: ReconcileInput[];
  if (args.csv === null) {
    // 市町村別の公表値が無い県: 県の建物出力にある全市町村で県計だけ比べる
    const names = Object.keys(readJson(args.munisFrom!) as Record<string, string[]>);
    inputs = inputsFromNames(names, hazardCase, compute);
  } else {
    const csv = readFileSync(resolve(root, args.csv), 'utf8').trim().split('\n').slice(1);
    inputs = csv.map((line: string) => {
      const [municipality, c, v] = line.split(',') as [string, string, string];
      resolveHazardCase(c, hazardCase);
      const published = v.trim() === '-' || v.trim() === '' ? null : Number(v);
      return { municipality, case: c, published, computed: compute(municipality) };
    });
  }
  const results = reconcile(inputs);
  const rows = results.map((r, i) => ({ ...inputs[i]!, ...r }) as Row);
  const manifest = readJson('public/data/manifest.json') as { datasets: { id: string; notes?: string }[] };
  const md = buildReport(rows, manifest.datasets, {
    hazardCase,
    skipped,
    prefName: args.prefName,
    nationalLabel: args.nationalLabel,
    withLiquefaction: args.withLiquefaction,
    definitionNote: PUBLISHED_DEFINITION_NOTES[args.pref],
    prefecture: prefectureTotal(rows, args.national, args.prefPublished),
  });
  mkdirSync(resolve(root, 'reports'), { recursive: true });
  const out = resolve(root, args.report);
  writeFileSync(out, md);
  console.log(md.split('## 前提')[0]);
  if (!existsSync(out)) throw new Error('レポートを書けませんでした');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
