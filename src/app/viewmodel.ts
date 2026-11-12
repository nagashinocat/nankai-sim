import { estimateHome, estimateHomeLag } from '../core/damage.ts';
import { estimateArea, estimateAreaLag } from '../core/neighborhood.ts';
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
  | { kind: 'band' | 'nearby'; depth: string; arrival: string | null; urgent: boolean;
      /** 到達時間の高さが 30cm より高いときの注意（Ruling W-d）。無ければ省く（以前の保存にも無い） */
      arrivalCaveat?: string }
  | { kind: 'none' }
  | { kind: 'unknown' };
/** 時間差の1段階（先発、後発まで含めた合計）。 */
export type StageVM = { label: string; collapse: RangeVM; half: RangeVM };
export type HomeVM =
  | { status: 'ok'; intensityLabel: string; collapse: RangeVM; half: RangeVM; liquefaction: string | null; tsunami: TsunamiVM; notes: string[];
      /** 時間差のときだけ: [先発, 後発まで含めた合計]。collapse・half は合計と同じ（以前の保存・最大クラス・半割れには無い） */
      stages?: StageVM[] }
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

/** 到達時間の高さの表記。100cm 未満は「30cm」、100cm 以上は「1m」（和歌山県は +1m。Ruling W-b）。 */
export function arrivalHeightText(cm: number): string {
  return cm >= 100 ? `${cm / 100}m` : `${cm}cm`;
}

/** 到達時間の高さが 30cm より高い（静岡 50cm・和歌山 1m）ときに到達の行の下に添える注意（Ruling W-d）。30cm 以下は null。 */
export function arrivalCaveatText(cm: number): string | null {
  return cm > 30 ? `この時間は${arrivalHeightText(cm)}の津波が着く時間です。それより低い津波はもっと早く着くことがあります` : null;
}

/** 津波の避難場所リストの下の説明。高さ（cm）は到達時間のデータから。不明なら高さを書かない。 */
export function reachHintText(cm: number | null | undefined): string {
  const height = typeof cm === 'number' && Number.isFinite(cm) ? `（${arrivalHeightText(cm)}）` : '';
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
  const tsunamiVM = tsunamiVMOf(tsunami, band, arrival);
  return {
    status: 'ok',
    intensityLabel: intensityLabel(cell.intensity),
    collapse: rangeVM(est.collapse, est.central.collapse),
    half: rangeVM(est.half, est.central.half),
    liquefaction: liquefactionText(cell.settlementCm),
    tsunami: tsunamiVM,
    notes: notesOf(input),
  };
}

const rangeVM = (r: [number, number], c: number): RangeVM => ({ min: formatPct(r[0]), max: formatPct(r[1]), central: formatPct(c) });

function notesOf(input: HomeInput): string[] {
  const notes: string[] = [];
  if (input.structure === 'unknown' || input.era === 'unknown') notes.push(NOTE_UNKNOWN);
  if ((input.structure === 'steel' || input.structure === 'rc') && (input.floors === undefined || input.floors === null)) notes.push(NOTE_FLOORS);
  if (input.retrofitted) notes.push(NOTE_RETROFIT);
  return notes;
}

function tsunamiVMOf(tsunami: HomeTsunami, band: TsunamiBand | null, arrival: Arrival | null): TsunamiVM {
  const arrivalMin = arrival?.min ?? null;
  const hasArrival = arrivalMin !== null && Number.isFinite(arrivalMin);
  const caveat = hasArrival ? arrivalCaveatText(arrival!.cm) : null;
  return band
    ? { kind: typeof tsunami === 'object' && 'nearby' in tsunami ? 'nearby' : 'band', depth: band.label,
        arrival: hasArrival ? `海岸への到達 最短約${Math.round(arrivalMin!)}分（${arrivalHeightText(arrival!.cm)}）` : null,
        // 到達時間が不明または5分以内: 判定せず「すぐ高い所へ」（避難場所リストと同じ扱い）
        urgent: reachBeforeTsunami(0, arrivalMin) === 'n/a',
        ...(caveat ? { arrivalCaveat: caveat } : {}) }
    : { kind: tsunami as 'none' | 'unknown' };
}

/** 自宅の場所の津波（どのタブでも同じ）。自宅の計算結果が無いタブ（データなし・読み込み失敗・読み込み中）でも津波の行を出すために使う。 */
export function homeTsunamiVM(tsunami: HomeTsunami, arrival: Arrival | null): TsunamiVM {
  const band: TsunamiBand | null = typeof tsunami !== 'object' ? null : 'nearby' in tsunami ? tsunami.nearby : tsunami;
  return tsunamiVMOf(tsunami, band, arrival);
}

export const LAG_TOTAL_LABEL = '後発まで含めた合計';

/**
 * 時間差（先発→後発）の自宅。津波は合計にだけ加わる（後発のセル＋浸水深の幅。estimateHomeLag）。
 * どちらかが範囲外なら outside、どちらかがデータなし（null・震度 null）なら nodata（先発が無いのに後発だけで計算しない）。
 * collapse・half・tsunami・notes は合計のもの。stages = [先発, 合計]（labels の順）。
 */
export function homeLagViewModel(
  firstCell: HazardCell | null | 'outside',
  secondCell: HazardCell | null | 'outside',
  input: HomeInput,
  tsunami: HomeTsunami,
  arrival: Arrival | null,
  labels: readonly [string, string] = ['先発', LAG_TOTAL_LABEL],
  /** 先発・後発の側の呼び名（例 ['東側','西側']）。渡すと震度の行が「先に東側で震度X、後に西側で震度Y」になる */
  sides?: readonly [string, string],
): HomeVM {
  if (firstCell === 'outside' || secondCell === 'outside') return { status: 'outside' };
  if (firstCell === null || secondCell === null) return { status: 'nodata' };
  const band: TsunamiBand | null = typeof tsunami !== 'object' ? null : 'nearby' in tsunami ? tsunami.nearby : tsunami;
  const second: HazardCell = { ...secondCell, tsunamiDepth: band ? band.mid : tsunami === 'none' ? 0 : null };
  const est = estimateHomeLag(firstCell, second, input, band ? [band.lo, band.hi] : undefined);
  if (!est || firstCell.intensity === null || second.intensity === null) return { status: 'nodata' };
  const f = est.first, t = est.total;
  // 液状化の沈下量は先発・後発のうち大きいほう（どちらも無ければ null）
  const settlement = firstCell.settlementCm === null && second.settlementCm === null ? null : Math.max(firstCell.settlementCm ?? 0, second.settlementCm ?? 0);
  return {
    status: 'ok',
    intensityLabel: sides
      ? `先に${sides[0]}で${intensityLabel(firstCell.intensity)}、後に${sides[1]}で${intensityLabel(second.intensity)}`
      : `先発 ${intensityLabel(firstCell.intensity)}・後発 ${intensityLabel(second.intensity)}`,
    collapse: rangeVM(t.collapse, t.central.collapse),
    half: rangeVM(t.half, t.central.half),
    liquefaction: liquefactionText(settlement),
    tsunami: tsunamiVMOf(tsunami, band, arrival),
    notes: notesOf(input),
    stages: [
      { label: labels[0], collapse: rangeVM(f.collapse, f.central.collapse), half: rangeVM(f.half, f.central.half) },
      { label: labels[1], collapse: rangeVM(t.collapse, t.central.collapse), half: rangeVM(t.half, t.central.half) },
    ],
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
    // 到達の行のすぐ下（Ruling W-d）
    ...(t.arrival && t.arrivalCaveat ? [{ text: t.arrivalCaveat, cls: 'note tsunami-caveat' }] : []),
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

/** 時間差（後発まで含めた合計）の周辺の棟数。先発・後発・建物のすべてがあるメッシュだけ数える。 */
export function areaLagViewModel(
  firstCells: Record<string, HazardCell>,
  secondCells: Record<string, HazardCell>,
  stock: Record<string, BuildingStock>,
  meshes: string[],
): AreaVM {
  let a: ReturnType<typeof estimateAreaLag>;
  try {
    a = estimateAreaLag(firstCells, secondCells, stock, meshes);
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
