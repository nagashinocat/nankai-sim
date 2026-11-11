import { estimateHome } from '../core/damage.ts';
import { estimateArea } from '../core/neighborhood.ts';
import { WALK_SPEED, nearestShelters, reachBeforeTsunami } from '../core/evacuation.ts';
import type { BuildingStock, HazardCell, HomeInput, LatLon, Shelter } from '../core/types.ts';

export type RangeVM = { min: string; max: string; central: string };
export type HomeVM =
  | { status: 'ok'; intensityLabel: string; collapse: RangeVM; half: RangeVM; liquefaction: string | null; notes: string[] }
  | { status: 'nodata' }
  | { status: 'outside' };
export type OkHomeVM = Extract<HomeVM, { status: 'ok' }>;
/** unavailable = 建物データが不正で推計できない（通信エラーとは別） */
export type AreaVM = { status: 'ok'; collapse: number; half: number; meshes: number } | { status: 'nostock' } | { status: 'unavailable' };
export type EvacVM = {
  items: { name: string; distance: string; walkStandard: string; walkSlow: string; reach: 'ok' | 'tight' | 'no' | 'n/a' }[];
  hazard: 'earthquake' | 'tsunami';
  notices: string[];
};

export const SHELTER_NOTICES = [
  'データは最新でない場合や未掲載の場合があります。最新の指定状況は市町にご確認ください',
  '指定緊急避難場所（命を守るために緊急に逃げる場所）と指定避難所（一定期間滞在する施設）は別のものです',
  '指定緊急避難場所は災害の種類ごとに指定されています。地震・津波に対応しているかを確認してください',
];

const NOTE_UNKNOWN = 'わからない項目があるため幅が広くなっています';
const NOTE_FLOORS = '階数を入れると幅が狭くなります';
const NOTE_RETROFIT = '耐震補強をした場合として、ひとつ新しい年代の基準で計算しています';

/** 計測震度 → 震度階級。 */
export function intensityLabel(i: number): string {
  if (i >= 6.5) return '震度7';
  if (i >= 6.0) return '震度6強';
  if (i >= 5.5) return '震度6弱';
  if (i >= 5.0) return '震度5強';
  if (i >= 4.5) return '震度5弱';
  if (i >= 3.5) return '震度4';
  return '震度3以下';
}

/** 0.1234 → "12.3%"。0.1% 未満は "0.1%未満"。 */
export function formatPct(x: number): string {
  if (x < 0.001) return '0.1%未満';
  return `${(x * 100).toFixed(1)}%`;
}

function liquefactionText(cm: number | null): string | null {
  if (cm === null || !Number.isFinite(cm)) return null;
  const n = Math.round(cm);
  return n >= 1 ? `液状化で地盤が約${n}cm沈下するおそれ` : null;
}

export function homeViewModel(cell: HazardCell | null | 'outside', input: HomeInput): HomeVM {
  if (cell === 'outside') return { status: 'outside' };
  if (cell === null) return { status: 'nodata' };
  const est = estimateHome(cell, input);
  if (!est || cell.intensity === null) return { status: 'nodata' };
  const range = (r: [number, number], c: number): RangeVM => ({ min: formatPct(r[0]), max: formatPct(r[1]), central: formatPct(c) });
  const notes: string[] = [];
  if (input.structure === 'unknown' || input.era === 'unknown') notes.push(NOTE_UNKNOWN);
  if ((input.structure === 'steel' || input.structure === 'rc') && (input.floors === undefined || input.floors === null)) notes.push(NOTE_FLOORS);
  if (input.retrofitted) notes.push(NOTE_RETROFIT);
  return {
    status: 'ok',
    intensityLabel: intensityLabel(cell.intensity),
    collapse: range(est.collapse, est.central.collapse),
    half: range(est.half, est.central.half),
    liquefaction: liquefactionText(cell.settlementCm),
    notes,
  };
}

export function areaViewModel(
  cells: Record<string, HazardCell>,
  stock: Record<string, BuildingStock>,
  meshes: string[],
): AreaVM {
  let a: ReturnType<typeof estimateArea>;
  try {
    a = estimateArea(cells, stock, meshes);
  } catch {
    return { status: 'unavailable' };
  }
  if (a.countedMeshes === 0) return { status: 'nostock' };
  const r10 = (n: number) => Math.round(n / 10) * 10;
  return { status: 'ok', collapse: r10(a.collapse), half: r10(a.half), meshes: a.countedMeshes };
}

function formatDistance(m: number): string {
  const r = Math.round(m / 10) * 10;
  return r < 1000 ? `約${r}m` : `約${(m / 1000).toFixed(1)}km`;
}
const formatWalk = (min: number) => `約${Math.ceil(min)}分`;

/** 地震用と津波用の2つ（常に）。各5件。津波の到達判定は津波データ（深さ・到達時間）があるときだけ。 */
export function evacuationViewModel(origin: LatLon, shelters: Shelter[], cell: HazardCell | null): EvacVM[] {
  const hasTsunami = cell !== null && Number.isFinite(cell.tsunamiDepth);
  const build = (hazard: 'earthquake' | 'tsunami'): EvacVM => {
    const std = nearestShelters(origin, shelters, { hazard, speedMps: WALK_SPEED.standard, limit: 5 });
    return {
      hazard,
      notices: [...SHELTER_NOTICES],
      items: std.map((h) => {
      const slowMin = (h.walkMin * WALK_SPEED.standard) / WALK_SPEED.slow;
      return {
        name: h.shelter.name,
        distance: formatDistance(h.distanceM),
        walkStandard: formatWalk(h.walkMin),
        walkSlow: formatWalk(slowMin),
        // 津波のみ判定。ゆっくり歩く場合で見積もる（安全側）。
        reach: hazard === 'tsunami' && hasTsunami ? reachBeforeTsunami(slowMin, cell.tsunamiArrivalMin) : 'n/a',
      };
      }),
    };
  };
  return [build('earthquake'), build('tsunami')];
}

/** どこで計算したか。住所は画面に出すだけ（保存・共有しない）。 */
export type LocationSource = { kind: 'address'; label: string } | { kind: 'pin' } | { kind: 'gps' };
export function locationNote(src: LocationSource): string {
  if (src.kind === 'address') return `${src.label} 付近で計算しました`;
  return src.kind === 'pin' ? '地図で選んだ場所で計算しました' : '現在地で計算しました';
}
