import { estimateLag, ratesForCell } from './damage.ts';
import type { BuildingStock, Era, HazardCell, Structure, StockKey } from './types.ts';

export type { BuildingStock, StockKey } from './types.ts';

const STRUCTURE_KEYS = ['wood', 'steel', 'rc'];
const ERA_KEYS = ['pre1981', 'y1981_2000', 'post2000'];
const VALID_KEYS = new Set(STRUCTURE_KEYS.flatMap((s) => ERA_KEYS.map((e) => `${s}:${e}`)));

function checkShares(stock: BuildingStock): void {
  if (!Number.isFinite(stock.total) || stock.total < 0) throw new Error(`total が不正です: ${stock.total}`);
  let sum = 0;
  for (const [key, v] of Object.entries(stock.shares)) {
    if (!VALID_KEYS.has(key)) throw new Error(`未知の構造×年代キーです: ${key}`);
    if (v === undefined) continue;
    if (!Number.isFinite(v) || v < 0) throw new Error(`shares[${key}] は 0 以上の有限値が必要です: ${v}`);
    sum += v;
  }
  if (!(Math.abs(sum - 1) < 0.01)) throw new Error(`shares の合計が 1 ではありません: ${sum}`);
}

/** 構成比で按分した (全壊率, 半壊率)。ハザードが無効なら null。 */
function blendedRates(cell: HazardCell, stock: BuildingStock): { collapse: number; half: number } | null {
  checkShares(stock);
  let collapse = 0;
  let half = 0;
  for (const [key, share] of Object.entries(stock.shares)) {
    if (!share) continue;
    const [s, e] = key.split(':') as [Structure, Era];
    const r = ratesForCell(cell, s, e, undefined, 'rep');
    if (!r) return null;
    collapse += share * r.collapse;
    half += share * r.half;
  }
  return { collapse, half };
}

/** 地図の色分け用。メッシュ内の全壊率（構成比で加重平均）。 */
export function meshCollapseRate(cell: HazardCell, stock: BuildingStock): number | null {
  return blendedRates(cell, stock)?.collapse ?? null;
}

/** 周辺の全壊・半壊棟数。cells・stock の両方にあり、ハザードが有効なメッシュだけ数える。 */
export function estimateArea(
  cells: Record<string, HazardCell>,
  stock: Record<string, BuildingStock>,
  meshes: string[],
): { collapse: number; half: number; countedMeshes: number } {
  let collapse = 0;
  let half = 0;
  let countedMeshes = 0;
  for (const m of meshes) {
    const c = cells[m];
    const s = stock[m];
    if (!c || !s) continue;
    const r = blendedRates(c, s);
    if (!r) continue;
    collapse += s.total * r.collapse;
    half += s.total * r.half;
    countedMeshes++;
  }
  return { collapse, half, countedMeshes };
}

/** 時間差（先発→後発）の構成比按分。曲線は 'rep'。先発の津波は含めない（estimateHomeLag と同じ。津波は後発のセルから一度だけ）。
 *  どちらかのハザードが無効なら null。 */
function blendedLagRates(first: HazardCell, second: HazardCell, stock: BuildingStock): { collapse: number; half: number } | null {
  checkShares(stock);
  const f: HazardCell = { ...first, tsunamiDepth: null };
  let collapse = 0;
  let half = 0;
  for (const [key, share] of Object.entries(stock.shares)) {
    if (!share) continue;
    const [s, e] = key.split(':') as [Structure, Era];
    const r = estimateLag(f, second, s, e, undefined, 'rep');
    if (!r) return null;
    collapse += share * r.collapse;
    half += share * r.half;
  }
  return { collapse, half };
}

/** 地図の色分け用（時間差）。後発まで含めた合計の全壊率。 */
export function meshLagCollapseRate(first: HazardCell, second: HazardCell, stock: BuildingStock): number | null {
  return blendedLagRates(first, second, stock)?.collapse ?? null;
}

/** 周辺の全壊・半壊棟数（時間差の合計）。先発・後発・建物のすべてにあり、ハザードが有効なメッシュだけ数える。 */
export function estimateAreaLag(
  firstCells: Record<string, HazardCell>,
  secondCells: Record<string, HazardCell>,
  stock: Record<string, BuildingStock>,
  meshes: string[],
): { collapse: number; half: number; countedMeshes: number } {
  let collapse = 0;
  let half = 0;
  let countedMeshes = 0;
  for (const m of meshes) {
    const f = firstCells[m], c = secondCells[m], s = stock[m];
    if (!f || !c || !s) continue;
    const r = blendedLagRates(f, c, s);
    if (!r) continue;
    collapse += s.total * r.collapse;
    half += s.total * r.half;
    countedMeshes++;
  }
  return { collapse, half, countedMeshes };
}
