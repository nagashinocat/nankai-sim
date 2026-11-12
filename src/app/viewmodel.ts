import { estimateHome } from '../core/damage.ts';
import { estimateArea } from '../core/neighborhood.ts';
import { EVAC_START_MIN, WALK_SPEED, nearestShelters, reachBeforeTsunami } from '../core/evacuation.ts';
import type { TsunamiBand } from '../core/tsunami.ts';
import type { HomeTsunami } from './tsunami-tile.ts';
import { TSUNAMI_ARRIVAL_NOTE, TSUNAMI_INUNDATED_STRONG, TSUNAMI_OUTSIDE, tsunamiNearbyText } from './text.ts';
import type { Arrival } from './data.ts';
import type { BuildingStock, HazardCell, HomeInput, LatLon, Shelter } from '../core/types.ts';

export type RangeVM = { min: string; max: string; central: string };
/**
 * 津波。band = 浸水深の段階（想定）、nearby = 自宅の点は浸水域外だが約50m以内に浸水（depth はその最大。Ruling F3）、
 * none = 想定の浸水域外、unknown = 判定できない（津波は含めない）。保存してよい文字列だけ。
 */
export type TsunamiVM =
  | { kind: 'band' | 'nearby'; depth: string; arrival: string | null; urgent: boolean }
  | { kind: 'none' }
  | { kind: 'unknown' };
export type HomeVM =
  | { status: 'ok'; intensityLabel: string; collapse: RangeVM; half: RangeVM; liquefaction: string | null; tsunami: TsunamiVM; notes: string[] }
  | { status: 'nodata' }
  | { status: 'outside' };
export type OkHomeVM = Extract<HomeVM, { status: 'ok' }>;
/** unavailable = 建物データが不正で推計できない（通信エラーとは別） */
export type AreaVM = { status: 'ok'; collapse: number; half: number; meshes: number } | { status: 'nostock' } | { status: 'unavailable' };
export type EvacVM = {
  /** reachText = 画面・保存に出す判定の文言（地震の避難場所は空） */
  items: { name: string; distance: string; walkStandard: string; walkSlow: string; reach: 'ok' | 'tight' | 'no' | 'n/a'; reachText: string }[];
  hazard: 'earthquake' | 'tsunami';
  notices: string[];
  /** 判定に使った到達時間の高さ（cm）。津波リストで到達時間があるときだけ数値、ほかは null */
  arrivalCm: number | null;
};

/** 津波の避難場所リストの下の説明。高さ（cm）は到達時間のデータから。不明なら高さを書かない。 */
export function reachHintText(cm: number | null | undefined): string {
  const height = typeof cm === 'number' && Number.isFinite(cm) ? `（${cm}cm）` : '';
  return `間に合うかどうかは、ゆっくり歩く速さに避難を始めるまでの${EVAC_START_MIN}分を足した時間を、海岸への津波の到達時間${height}と比べた目安です。`;
}

export const SHELTER_NOTICES = [
  'データは最新でない場合や未掲載の場合があります。最新の指定状況は市町にご確認ください',
  '指定緊急避難場所（命を守るために緊急に逃げる場所）と指定避難所（一定期間滞在する施設）は別のものです',
  '指定緊急避難場所は災害の種類ごとに指定されています。地震・津波に対応しているかを確認してください',
];

export const REACH_TEXT = {
  ok: 'すぐ避難を始めれば間に合う可能性',
  tight: 'ぎりぎり。より近い高い場所も考えて',
  no: '間に合わないおそれ。近くの高い建物や高台へ',
  'n/a': '揺れが収まったらすぐ高い所へ',
} as const;

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

/**
 * tsunami: 自宅の段階（tsunamiAround）。band は幅（lo〜hi）と代表値（mid）で、nearby は近くのいちばん深い段階で（Ruling F3）、
 * none は浸水深0で、unknown は津波なし（null）で計算する。
 */
export function homeViewModel(
  baseCell: HazardCell | null | 'outside',
  input: HomeInput,
  tsunami: HomeTsunami,
  arrival: Arrival | null,
): HomeVM {
  const arrivalMin = arrival?.min ?? null;
  if (baseCell === 'outside') return { status: 'outside' };
  if (baseCell === null) return { status: 'nodata' };
  const band: TsunamiBand | null = typeof tsunami !== 'object' ? null : 'nearby' in tsunami ? tsunami.nearby : tsunami;
  const cell: HazardCell = { ...baseCell, tsunamiDepth: band ? band.mid : tsunami === 'none' ? 0 : null };
  const est = estimateHome(cell, input, band ? [band.lo, band.hi] : undefined);
  if (!est || cell.intensity === null) return { status: 'nodata' };
  const tsunamiVM: TsunamiVM = band
    ? { kind: typeof tsunami === 'object' && 'nearby' in tsunami ? 'nearby' : 'band', depth: band.label,
        arrival: arrivalMin !== null && Number.isFinite(arrivalMin) ? `海岸への到達 最短約${Math.round(arrivalMin)}分（${arrival!.cm}cm）` : null,
        // 到達時間が不明または5分以内: 判定せず「すぐ高い所へ」（避難場所リストと同じ扱い）
        urgent: reachBeforeTsunami(0, arrivalMin) === 'n/a' }
    : { kind: tsunami as 'none' | 'unknown' };
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
    tsunami: tsunamiVM,
    notes,
  };
}

/** 自宅の津波の行（結果・前回の結果で共通）。unknown は上の注意で伝えるので行を出さない。cls は画面の class。 */
export function homeTsunamiLines(t: TsunamiVM): { text: string; cls: string }[] {
  if (t.kind === 'none') return [{ text: TSUNAMI_OUTSIDE, cls: 'tsunami-line' }];
  if (t.kind === 'unknown') return [];
  return [
    // 浸水域内（・約50m以内）は、到達時間にかかわらず必ず先頭に（Ruling F2）
    { text: TSUNAMI_INUNDATED_STRONG, cls: 'strong tsunami-strong' },
    t.kind === 'band'
      ? { text: `津波 浸水深 ${t.depth}（想定）${t.arrival ? `・${t.arrival}` : ''}`, cls: 'tsunami-line' }
      : { text: tsunamiNearbyText(t.depth), cls: 'tsunami-line' },
    ...(t.kind === 'nearby' && t.arrival ? [{ text: t.arrival, cls: 'tsunami-line' }] : []),
    ...(t.arrival ? [{ text: TSUNAMI_ARRIVAL_NOTE, cls: 'note' }] : []),
    ...(t.urgent ? [{ text: REACH_TEXT['n/a'], cls: 'strong tsunami-urgent' }] : []),
  ];
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

/** 地震用と津波用の2つ（常に）。各5件。津波の判定は「ゆっくり歩く＋避難開始5分」と、海岸への到達時間（その県で公表されている最も低い高さ。arrival.min）との比較。 */
export function evacuationViewModel(origin: LatLon, shelters: Shelter[], arrival: Arrival | null): EvacVM[] {
  const arrivalMin = arrival?.min ?? null;
  const build = (hazard: 'earthquake' | 'tsunami'): EvacVM => {
    const std = nearestShelters(origin, shelters, { hazard, speedMps: WALK_SPEED.standard, limit: 5 });
    return {
      hazard,
      notices: [...SHELTER_NOTICES],
      arrivalCm: hazard === 'tsunami' && arrival ? arrival.cm : null,
      items: std.map((h) => {
        const slowMin = (h.walkMin * WALK_SPEED.standard) / WALK_SPEED.slow;
        const reach = hazard === 'tsunami' ? reachBeforeTsunami(slowMin, arrivalMin) : 'n/a';
        return {
          name: h.shelter.name,
          distance: formatDistance(h.distanceM),
          walkStandard: formatWalk(h.walkMin),
          walkSlow: formatWalk(slowMin),
          reach,
          reachText: hazard === 'tsunami' ? REACH_TEXT[reach] : '',
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
