import type { BuildingStock, HazardCell, HomeInput } from '../core/types.ts';
import { meshCollapseRate, meshLagCollapseRate } from '../core/neighborhood.ts';
import type { Arrival, DataSource, HazardCase, Scenario } from './data.ts';
import type { HomeTsunami } from './tsunami-tile.ts';
import { HALF_EXPLAIN, LAG_EXPLAIN } from './text.ts';
import type { MeshRate } from './ui/map.ts';
import { LAG_TOTAL_LABEL, areaLagViewModel, areaViewModel, homeLagViewModel, homeViewModel, type AreaVM, type HomeVM } from './viewmodel.ts';

export type { Scenario } from './data.ts';

/** タブの順（初期表示は先頭の L2 = 最大クラス）。 */
export const SCENARIOS: readonly Scenario[] = ['L2', 'HALF_E', 'HALF_W', 'LAG_EW', 'LAG_WE'];

/** タブの名前（保存する結果にも使う）。 */
export const SCENARIO_LABELS: Record<Scenario, string> = {
  L2: '最大クラス',
  HALF_E: '東側の半割れ',
  HALF_W: '西側の半割れ',
  LAG_EW: '時間差（東→西）',
  LAG_WE: '時間差（西→東）',
};

/** タブごとの説明文（最大クラスは無し）。結果と前回の結果で共通。 */
export const SCENARIO_EXPLAIN: Partial<Record<Scenario, string>> = { HALF_E: HALF_EXPLAIN, HALF_W: HALF_EXPLAIN, LAG_EW: LAG_EXPLAIN, LAG_WE: LAG_EXPLAIN };

/** どのケースのハザードを使うか。時間差は先発・後発の2つ。 */
export const SCENARIO_CASES: Record<Scenario, { single: HazardCase } | { first: HazardCase; second: HazardCase; firstLabel: string; sides: readonly [string, string] }> = {
  L2: { single: 'L2' },
  HALF_E: { single: 'HALF_E' },
  HALF_W: { single: 'HALF_W' },
  LAG_EW: { first: 'HALF_E', second: 'HALF_W', firstLabel: '先発（東側）', sides: ['東側', '西側'] },
  LAG_WE: { first: 'HALF_W', second: 'HALF_E', firstLabel: '先発（西側）', sides: ['西側', '東側'] },
};

/** シナリオを切り替えても変わらない、場所ごとの材料。 */
export type ScenarioContext = {
  mesh: string;
  /** 周辺1km のメッシュ */
  meshes: string[];
  input: HomeInput;
  /** 自宅の津波（最大クラスの帯。どのシナリオでも同じ） */
  homeTsunami: HomeTsunami;
  arrival: Arrival | null;
  stock: Record<string, BuildingStock>;
  /** 周辺の各メッシュ中心の浸水深（浸水域外は 0、判定できないときは null）。ハザードのあるメッシュにだけ呼ぶ。 */
  areaTsunamiDepth(mesh: string): Promise<number | null>;
};

/** 'error' = 半割れ・時間差のデータを通信エラーなどで読めなかった（データが無い nodata とは別。そのタブだけ再試行できる）。L2 は例外にするので出ない。 */
export type ScenarioHome = HomeVM | { status: 'error' };
export type ScenarioResult = { scenario: Scenario; home: ScenarioHome; area: AreaVM; meshRates: MeshRate[] };

/** 津波の深さを入れる（キャッシュは呼び出し側。同じメッシュは同じ値）。 */
async function withTsunami(cells: Record<string, HazardCell>, ctx: ScenarioContext): Promise<Record<string, HazardCell>> {
  const out: Record<string, HazardCell> = { ...cells };
  await Promise.all(ctx.meshes.map(async (m) => {
    const c = cells[m];
    if (!c) return;
    out[m] = { ...c, tsunamiDepth: await ctx.areaTsunamiDepth(m) };
  }));
  return out;
}

/** 不正な建物データは「データなし」（null）。 */
function rateOf(f: () => number | null): number | null {
  try { return f(); } catch { return null; }
}

/**
 * 1つのシナリオの自宅・周辺・地図を計算する。対応範囲（outside）は常に L2 で決める。
 * L2 の読み込み失敗は例外（再試行できる）。ほかのシナリオは、データが無い（404・行なし）なら nodata、
 * 通信エラーなどは status 'error'（そのシナリオだけ。L2 や他のタブには影響しない）。
 */
export async function computeScenario(ds: DataSource, ctx: ScenarioContext, scenario: Scenario): Promise<ScenarioResult> {
  const l2Cell = await ds.hazardCell('L2', ctx.mesh);
  // 自宅が範囲外でも、周辺（範囲内のマス）の推計と地図は従来どおり出す。自宅だけ outside にする。
  const homeCellOf = async (c: HazardCase): Promise<HazardCell | null | 'outside'> =>
    l2Cell === 'outside' ? 'outside' : c === 'L2' ? l2Cell : ds.hazardCell(c, ctx.mesh);
  const spec = SCENARIO_CASES[scenario];
  try {
    if ('single' in spec) {
      const cell = await homeCellOf(spec.single);
      const raw = await ds.hazardFor(spec.single, ctx.meshes);
      const cells = await withTsunami(raw, ctx);
      return {
        scenario,
        home: homeViewModel(cell, ctx.input, ctx.homeTsunami, ctx.arrival),
        area: areaViewModel(cells, ctx.stock, ctx.meshes),
        meshRates: ctx.meshes.map((m) => ({ mesh: m, rate: cells[m] && ctx.stock[m] ? rateOf(() => meshCollapseRate(cells[m], ctx.stock[m])) : null })),
      };
    }
    const [firstCell, secondCell, firstRaw, secondRaw] = await Promise.all([
      homeCellOf(spec.first), homeCellOf(spec.second),
      ds.hazardFor(spec.first, ctx.meshes), ds.hazardFor(spec.second, ctx.meshes),
    ]);
    // 津波は後発のセルから合計にだけ加える（先発は津波なし）
    const second = await withTsunami(secondRaw, ctx);
    return {
      scenario,
      home: homeLagViewModel(firstCell, secondCell, ctx.input, ctx.homeTsunami, ctx.arrival, [spec.firstLabel, LAG_TOTAL_LABEL], spec.sides),
      area: areaLagViewModel(firstRaw, second, ctx.stock, ctx.meshes),
      meshRates: ctx.meshes.map((m) => ({
        mesh: m,
        rate: firstRaw[m] && second[m] && ctx.stock[m] ? rateOf(() => meshLagCollapseRate(firstRaw[m], second[m], ctx.stock[m])) : null,
      })),
    };
  } catch (e) {
    if (scenario === 'L2') throw e;
    // データが無い（404）は data 層が null にするので nodata。ここに来るのは通信エラーなど（再試行できる）。
    return { scenario, home: { status: 'error' }, area: { status: 'unavailable' }, meshRates: ctx.meshes.map((m) => ({ mesh: m, rate: null })) };
  }
}

/**
 * 「最後に頼んだものだけ採用」する印（request token）。run() は新しい要求が来る（または invalidate された）と、
 * それまでの要求の結果を捨てて null を返す（失敗も黙って捨てる）。最新の要求の失敗だけが例外になる。
 */
export function createLatestOnly(): { run<T>(task: () => Promise<T>): Promise<T | null>; invalidate(): void } {
  let token = 0;
  return {
    async run<T>(task: () => Promise<T>): Promise<T | null> {
      const mine = ++token;
      try {
        const v = await task();
        return mine === token ? v : null;
      } catch (e) {
        if (mine === token) throw e;
        return null;
      }
    },
    invalidate(): void { token++; },
  };
}

/**
 * タブ切り替え用。request は ScenarioResult、または古くなった要求なら null を返す。
 * 場所が変わった・結果を消したときは invalidate() で進行中の計算を無効にする。
 */
export function createScenarioRunner(ds: DataSource): {
  request(ctx: ScenarioContext, scenario: Scenario): Promise<ScenarioResult | null>;
  invalidate(): void;
} {
  const latest = createLatestOnly();
  return {
    request: (ctx, scenario) => latest.run(() => computeScenario(ds, ctx, scenario)),
    invalidate: () => latest.invalidate(),
  };
}

