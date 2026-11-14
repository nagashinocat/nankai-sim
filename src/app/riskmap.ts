/**
 * 周辺1km の「やることマップ」の計算（DOM なし・外部通信なし）。
 * 250m マスを、倒壊（全壊率の推計の中央値）と津波（マス中心の浸水深）の組み合わせで「やること」の色に分ける。
 * 色だけに頼らない: 津波は波の模様、判定できないマスは斜線。座標はメモリで使うだけで、保存しない。
 */
import { distanceM } from '../core/mesh.ts';
import type { LatLon, Shelter } from '../core/types.ts';
import type { TsunamiVM } from './viewmodel.ts';
import { NEAR_M, approxDistance, bearingDeg, dir8, dir8Kids } from './minimap.ts';

export type RiskMode = 'shake' | 'tsunami' | 'both';
export const RISK_MODES: readonly RiskMode[] = ['shake', 'tsunami', 'both'];
export const RISK_MODE_LABELS: Record<RiskMode, string> = { shake: '揺れ', tsunami: '津波', both: '両方' };

export type Collapse = 'high' | 'mid' | 'low' | 'none';
export type TsunamiClass = 'yes' | 'no' | 'unknown';
export type CellClass = { collapse: Collapse; tsunami: TsunamiClass };

/** 倒壊「大きい」の分け目（全壊率の推計 10%以上）と「中」（1%以上）。 */
export const COLLAPSE_HIGH = 0.1;
export const COLLAPSE_MID = 0.01;

export const RISK_COLORS = {
  both: '#8E7CC3',
  tsunami: '#8FBCE8',
  high: '#E8A33D',
  mid: '#F6D58E',
  lowBoth: '#E3E1DA',
  low: '#EEEBE3',
  unknown: '#D6D6D6',
} as const;

const finite = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/** マスの分類。rate = 全壊率の推計（null はデータなし）、tsunamiDepth = マス中心の浸水深（m。0 は浸水域外、null は判定できない）。 */
export function cellClass(rate: number | null, tsunamiDepth: number | null): CellClass {
  const collapse: Collapse = !finite(rate) ? 'none' : rate >= COLLAPSE_HIGH ? 'high' : rate >= COLLAPSE_MID ? 'mid' : 'low';
  const tsunami: TsunamiClass = !finite(tsunamiDepth) ? 'unknown' : tsunamiDepth > 0 ? 'yes' : 'no';
  return { collapse, tsunami };
}

/** fill = 塗りの色、hatch = 波の模様（津波）、unknownHatch = 斜線（判定できない）。 */
export type CellFill = { fill: string; hatch: boolean; unknownHatch: boolean };

export function cellFill(cls: CellClass, mode: RiskMode): CellFill {
  const f = (fill: string, hatch = false, unknownHatch = false): CellFill => ({ fill, hatch, unknownHatch });
  const { collapse: c, tsunami: t } = cls;
  if (mode === 'shake') {
    if (c === 'none') return f(RISK_COLORS.unknown, false, true);
    return f(c === 'high' ? RISK_COLORS.high : c === 'mid' ? RISK_COLORS.mid : RISK_COLORS.low);
  }
  if (mode === 'tsunami') {
    if (t === 'unknown') return f(RISK_COLORS.unknown, false, true);
    return t === 'yes' ? f(RISK_COLORS.tsunami, true) : f(RISK_COLORS.low);
  }
  // 両方
  if (t === 'yes') return c === 'high' ? f(RISK_COLORS.both, true) : f(RISK_COLORS.tsunami, true);
  // 津波が判定できないマスは「津波なし」扱いにしない（斜線）。倒壊が大きいことは色で残す
  if (t === 'unknown') return c === 'high' ? f(RISK_COLORS.high, false, true) : f(RISK_COLORS.unknown, false, true);
  if (c === 'high') return f(RISK_COLORS.high);
  if (c === 'none') return f(RISK_COLORS.unknown, false, true);
  return f(RISK_COLORS.lowBoth);
}

export type LegendItem = { key: string; fill: string; hatch: boolean; unknownHatch: boolean; title: string; desc: string };

const item = (key: string, fill: string, title: string, desc: string, hatch = false, unknownHatch = false): LegendItem =>
  ({ key, fill, hatch, unknownHatch, title, desc });

/** 凡例（マスの色）。言葉は「やること」。hasUnknown = 判定できないマスがあるときだけ斜線の行を足す。 */
export function legendFor(mode: RiskMode, kids: boolean, hasUnknown = false): LegendItem[] {
  if (kids) {
    // こどもモードは両方の地図だけ。あかは使わない（あかは「にげる」だけ）
    return [
      item('both', RISK_COLORS.both, 'いえが こわれやすく、つなみも くる ところ', '', true),
      item('tsunami', RISK_COLORS.tsunami, 'つなみが くる ところ', '', true),
      item('collapse', RISK_COLORS.high, 'いえが こわれやすい ところ', ''),
      item('low', RISK_COLORS.lowBoth, 'はいいろ：わりと ひくい（でも ゆだんしない）', ''),
      ...(hasUnknown ? [item('unknown', RISK_COLORS.unknown, 'わからない ところ（ななめの せん）', '', false, true)] : []),
    ];
  }
  const unknown = (desc: string) => (hasUnknown ? [item('unknown', RISK_COLORS.unknown, '判定できません', desc, false, true)] : []);
  if (mode === 'shake') {
    return [
      item('high', RISK_COLORS.high, '倒壊の危険 大', '耐震化・家具の固定を'),
      item('mid', RISK_COLORS.mid, '倒壊の危険 中', '古い家は特に注意'),
      item('low', RISK_COLORS.low, '比較的低い', '備えは同じく必要'),
      ...unknown('全壊率を推計できないマス（斜線）'),
    ];
  }
  if (mode === 'tsunami') {
    return [
      item('tsunami', RISK_COLORS.tsunami, '津波の浸水想定', '揺れたらすぐ高い所へ', true),
      item('none', RISK_COLORS.low, '想定なし', '想定を超える津波もあり得ます'),
      ...unknown('津波を判定できないマス（斜線）'),
    ];
  }
  return [
    item('both', RISK_COLORS.both, '両方に注意', '耐震化＋すぐ避難', true),
    item('tsunami', RISK_COLORS.tsunami, 'すぐ高い所へ', '津波に注意', true),
    item('collapse', RISK_COLORS.high, '家の倒壊に注意', '耐震化・家具の固定'),
    item('low', RISK_COLORS.lowBoth, '比較的低い', '備えは同じく必要'),
    ...unknown('データが足りないマス（斜線。倒壊が大きいマスはだいだい色に斜線）'),
  ];
}

export type HomeKind = TsunamiVM['kind'];
export type HomeQuadrant = {
  /** 図で点を置くマスの種類（legendFor の key と同じ。outside は図なし） */
  key: string;
  title: string;
  action: string;
  /** 読み上げ用「自宅は 〜 マスに入っています」 */
  aria: string;
};

const homeTsunamiClass = (k: HomeKind): TsunamiClass => (k === 'band' || k === 'nearby' ? 'yes' : k === 'none' ? 'no' : 'unknown');

/**
 * 「自宅はここ」。homeRate = 自宅のマスの全壊率の推計、homeTsunamiKind = 自宅の津波（Ruling F3 の nearby は「あり」）。
 * 表示モードごとに言葉を変える。outside = 対応範囲外（判定しない）。
 */
export function homeQuadrant(homeRate: number | null, homeTsunamiKind: HomeKind, mode: RiskMode = 'both', outside = false): HomeQuadrant {
  if (outside) {
    return { key: 'outside', title: '対応範囲外', action: '自宅の場所は対応範囲外のため、判定していません。市町村のハザードマップで確認してください。', aria: '自宅の場所は対応範囲外のため、判定していません' };
  }
  const c = cellClass(homeRate, 0).collapse;
  const t = homeTsunamiClass(homeTsunamiKind);
  const q = (key: string, title: string, action: string, cellText: string): HomeQuadrant => ({ key, title, action, aria: `自宅は ${cellText}マスに入っています` });
  const nearby = homeTsunamiKind === 'nearby';
  if (mode === 'shake') {
    if (c === 'high') return q('high', '倒壊の危険 大', '家の耐震化と家具の固定を。', '倒壊の危険が大きい');
    if (c === 'mid') return q('mid', '倒壊の危険 中', '古い家は特に注意。耐震診断と家具の固定を。', '倒壊の危険が中くらいの');
    if (c === 'low') return q('low', '比較的低い', '備えは同じく必要です。家具の固定を。想定を超える揺れもあり得ます。', '倒壊の危険が比較的低い');
    return q('unknown', '判定できません', '全壊率を推計できないマスです。家具の固定と避難場所の確認を。', '全壊率を推計できない');
  }
  if (mode === 'tsunami') {
    if (t === 'yes') return q('tsunami', 'すぐ高い所へ', nearby ? 'すぐ近くまで浸水の想定。揺れが収まったら、すぐ高い所へ。' : '揺れが収まったら、到達時間を待たずにすぐ高い所へ。', nearby ? 'すぐ近くまで津波の浸水想定がある' : '津波の浸水想定がある');
    if (t === 'no') return q('none', '想定なし', '浸水の想定はありません。ただし想定を超える津波もあり得ます。海の近くで強く揺れたら高い所へ。', '津波の浸水想定がない');
    return q('unknown', '判定できません', '津波を判定できません。海の近くで強く揺れたら、すぐ高い所へ。', '津波を判定できない');
  }
  if (t === 'yes' && c === 'high') return q('both', '両方に注意', '家の耐震化と家具の固定。揺れが収まったら、すぐ高い所へ。', '倒壊が大きく 津波もある');
  if (t === 'yes') return q('tsunami', 'すぐ高い所へ', '揺れが収まったら、到達時間を待たずにすぐ高い所へ。家具の固定も。', '津波がある');
  if (c === 'high') {
    return t === 'unknown'
      ? q('collapse', '家の倒壊に注意', '家の耐震化と家具の固定を。津波は判定できないため、海の近くで強く揺れたら高い所へ。', '倒壊が大きい（津波は判定できない）')
      : q('collapse', '家の倒壊に注意', '家の耐震化と家具の固定を。', '倒壊が大きい');
  }
  if (t === 'unknown') return q('unknown', '判定できません', '津波を判定できないマスです。海の近くで強く揺れたら、すぐ高い所へ。', '津波を判定できない');
  if (c === 'none') return q('unknown', '判定できません', '全壊率を推計できないマスです。家具の固定と避難場所の確認を。', '全壊率を推計できない');
  return q('low', '比較的低い', '備えは同じく必要です。家具の固定と避難場所の確認を。想定を超える揺れや津波もあり得ます。', '倒壊も津波も比較的低い');
}

export type EscapeTarget = {
  shelter: Shelter;
  /** 津波の避難場所リストでの番号（0 から。画面は +1） */
  index: number;
  distanceM: number;
  bearing: number;
  dir: string;
  dirKids: string;
  here: boolean;
  /** 「近い津波の避難場所「1」：北西に約450m（直線）。海から離れる方向とは限りません。道と方向は実際に確かめてください」 */
  text: string;
  /** text の頭（「近い津波の避難場所「1」」）と残り（「：北西に…」） */
  head: string;
  rest: string;
  /** こどもモード（ひらがな） */
  kidsText: string;
};

export const ESCAPE_NOTE = '海から離れる方向とは限りません。道と方向は実際に確かめてください';
/** 地図の矢印のラベル */
export const ESCAPE_LABEL = '近い津波の避難場所';
export const ESCAPE_LABEL_KIDS = 'にげる ばしょ';

/**
 * 逃げる方向。自宅が浸水域内（band）・すぐ近くまで浸水（nearby）のときだけ、いちばん近い津波の避難場所。
 * 浸水域外（none）・判定できない（unknown）・避難場所が無いときは null（矢印を出さない）。
 */
export function escapeTarget(home: LatLon, tsunamiShelters: Shelter[], tsunamiKind: HomeKind): EscapeTarget | null {
  if (tsunamiKind !== 'band' && tsunamiKind !== 'nearby') return null;
  let best = -1, bestD = Infinity;
  tsunamiShelters.forEach((s, i) => {
    const d = distanceM(home, s.pos);
    if (Number.isFinite(d) && d < bestD) { best = i; bestD = d; }
  });
  if (best < 0) return null;
  const shelter = tsunamiShelters[best];
  const here = bestD < NEAR_M;
  const b = here ? 0 : bearingDeg(home, shelter.pos);
  const no = best + 1;
  const dist = approxDistance(bestD);
  const head = `${ESCAPE_LABEL}「${no}」`;
  const rest = `：${here ? 'すぐ近く（約10m以内）' : `${dir8(b)}に${dist}（直線）`}。${ESCAPE_NOTE}`;
  return {
    shelter, index: best, distanceM: bestD, bearing: b, dir: dir8(b), dirKids: dir8Kids(b), here,
    text: head + rest, head, rest,
    kidsText: here ? 'にげる ばしょは すぐ ちかく' : `にげる ばしょは ${dir8Kids(b)}の ほう`,
  };
}

/** 浸水域外・判定できないときに、矢印の代わりに地図の下に出す文（null は出さない）。 */
export function noArrowText(tsunamiKind: HomeKind, hasShelters: boolean): string | null {
  if (tsunamiKind === 'band' || tsunamiKind === 'nearby') return hasShelters ? null : '近くに津波の避難場所のデータがありません。市町村のハザードマップで高い所を確かめてください。';
  if (tsunamiKind === 'none') return '自宅は津波の浸水想定の外なので、矢印は出していません。想定を超える津波もあり得るので、念のため緑の印（津波の避難場所）も確かめておきましょう。';
  return '津波を判定できないため、矢印は出していません。海の近くで強く揺れたら、緑の印（津波の避難場所）などの高い所へ。';
}

/** 地図の読み上げの文。モード・自宅・矢印に合わせて変わる。 */
export function mapAlt(mode: RiskMode, home: HomeQuadrant, escape: EscapeTarget | null, kids = false): string {
  if (kids) {
    return `おうちの まわりの きけん マップ。${escape ? `みどりの やじるしの ほうへ にげる。${escape.kidsText}。` : ''}みどりの まるは にげる ばしょ（たかい ところ）`;
  }
  const name = { shake: '揺れの地図', tsunami: '津波の地図', both: '揺れと津波の両方の地図' }[mode];
  const homeText = home.key === 'outside' ? home.aria : `${home.aria}（${home.title}）`;
  const arrow = mode !== 'shake' && escape ? `矢印: ${escape.text}。` : '';
  return `${name}。${homeText}。${arrow}緑の大きな印は津波の避難場所（高い所）、青緑の小さな印は地震の避難場所`;
}
