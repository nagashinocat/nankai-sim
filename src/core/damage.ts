import { liquefactionRates, shakeRates, tsunamiRates } from './fragility.ts';
import type { Era, HazardCell, HomeInput, Range, Rates, Structure } from './types.ts';

export type { HazardCell, HomeInput, Range } from './types.ts';

const STRUCTURES: Structure[] = ['wood', 'steel', 'rc'];
const ERAS: Era[] = ['pre1981', 'y1981_2000', 'post2000'];

/** 独立な要因の合成。全壊率・(全壊+半壊)率それぞれを 1 − Π(1 − p) で合成し、half = 差。 */
export function combine(list: Rates[]): Rates {
  let keepC = 1;
  let keepT = 1;
  for (const r of list) {
    keepC *= 1 - r.collapse;
    keepT *= 1 - (r.collapse + r.half);
  }
  const collapse = 1 - keepC;
  const total = Math.max(collapse, 1 - keepT);
  return { collapse, half: total - collapse };
}

/** 揺れ → 液状化 → 津波の順に合成。沈下量・浸水深が null／非有限の要因は飛ばす。intensity が無効なら null。 */
export function ratesForCell(cell: HazardCell, s: Structure, e: Era): Rates | null {
  if (cell.intensity === null || !Number.isFinite(cell.intensity)) return null;
  const parts: Rates[] = [shakeRates(cell.intensity, s, e)];
  if (cell.settlementCm !== null && Number.isFinite(cell.settlementCm)) {
    parts.push(liquefactionRates(cell.settlementCm, s, e));
  }
  if (cell.tsunamiDepth !== null && Number.isFinite(cell.tsunamiDepth)) {
    parts.push(tsunamiRates(cell.tsunamiDepth, s));
  }
  return combine(parts);
}

/** 補強済みは 1 つ新しい年代の曲線を使う。 */
function newer(e: Era): Era {
  return e === 'pre1981' ? 'y1981_2000' : 'post2000';
}

/** 1 つ古い年代（pre1981 は呼び出し側で特別扱い）。 */
function older(e: Era): Era {
  return e === 'post2000' ? 'y1981_2000' : 'pre1981';
}

/** 揺れの幅 ±0.5 は震度だけを動かす。unknown は該当する全構造・全年代の最小〜最大。 */
export function estimateHome(
  cell: HazardCell,
  input: HomeInput,
): { collapse: Range; half: Range } | null {
  if (cell.intensity === null || !Number.isFinite(cell.intensity)) return null;
  const structures = input.structure === 'unknown' ? STRUCTURES : [input.structure];
  const eras = input.era === 'unknown' ? ERAS : [input.era];
  let cMin = Infinity, cMax = -Infinity, hMin = Infinity, hMax = -Infinity;
  for (const di of [-0.5, 0, 0.5]) {
    const shifted: HazardCell = { ...cell, intensity: cell.intensity + di };
    for (const s of structures) {
      for (const e0 of eras) {
        const r = ratesForCell(shifted, s, input.retrofitted ? newer(e0) : e0);
        if (!r) return null;
        cMin = Math.min(cMin, r.collapse); cMax = Math.max(cMax, r.collapse);
        hMin = Math.min(hMin, r.half); hMax = Math.max(hMax, r.half);
      }
    }
  }
  return { collapse: [cMin, cMax], half: [hMin, hMax] };
}

/** 時間差（先発→後発）。先発で無傷だった分は通常、半壊した分は 1 つ古い年代の曲線で後発を受ける。 */
export function estimateLag(first: HazardCell, second: HazardCell, s: Structure, e: Era): Rates | null {
  const f = ratesForCell(first, s, e);
  const ri = ratesForCell(second, s, e);
  if (!f || !ri) return null;
  const u = Math.max(0, 1 - f.collapse - f.half);
  let rdCollapse: number;
  if (e === 'pre1981') {
    rdCollapse = ri.collapse + ri.half;
  } else {
    const rd = ratesForCell(second, s, older(e));
    if (!rd) return null;
    rdCollapse = rd.collapse;
  }
  return {
    collapse: f.collapse + u * ri.collapse + f.half * rdCollapse,
    half: u * ri.half + f.half * (1 - rdCollapse),
  };
}
