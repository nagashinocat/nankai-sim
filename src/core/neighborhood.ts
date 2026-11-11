import { ratesForCell } from './damage.ts';
import type { BuildingStock, Era, HazardCell, Structure, StockKey } from './types.ts';

export type { BuildingStock, StockKey } from './types.ts';

function checkShares(stock: BuildingStock): void {
  let sum = 0;
  for (const v of Object.values(stock.shares)) sum += v ?? 0;
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
    const r = ratesForCell(cell, s, e);
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
