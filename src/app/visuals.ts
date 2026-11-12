/**
 * 結果を「ひと目でわかる」ようにする絵・バッジのための値（DOM なし・計算は変えない）。
 * 保存した前回の結果（文字列だけの RangeVM・TsunamiVM）からも同じ絵を作れるように、表示用の文字列から読み取る。
 */
import { TSUNAMI_BANDS } from '../core/tsunami.ts';
import type { HomeVM, RangeVM, TsunamiVM } from './viewmodel.ts';

/** 震度バッジの色の段階。le4 = 震度4以下。 */
export type IntensityLevel = 'le4' | '5-' | '5+' | '6-' | '6+' | '7';

const INTENSITY_RE = /震度(?:7|6強|6弱|5強|5弱|4|3以下)/g;

export function intensityLevel(label: string): IntensityLevel {
  if (label === '震度7') return '7';
  if (label === '震度6強') return '6+';
  if (label === '震度6弱') return '6-';
  if (label === '震度5強') return '5+';
  if (label === '震度5弱') return '5-';
  return 'le4';
}

/** バッジの色（塗り / 文字）。 */
export const INTENSITY_COLORS: Record<IntensityLevel, { fill: string; text: string }> = {
  le4: { fill: '#e8eef5', text: '#1a1a1a' },
  '5-': { fill: '#fff3a0', text: '#1a1a1a' },
  '5+': { fill: '#ffd84d', text: '#1a1a1a' },
  '6-': { fill: '#f39c3d', text: '#1a1a1a' },
  '6+': { fill: '#d9381e', text: '#fff' },
  '7': { fill: '#8e2a8c', text: '#fff' },
};

const LEVEL_ORDER: IntensityLevel[] = ['le4', '5-', '5+', '6-', '6+', '7'];

/**
 * 震度の行の文字列を、地の文と震度に分ける（例「先に東側で震度6弱、後に西側で震度6強」）。
 * つなげると元の文字列に戻る。
 */
export function splitIntensity(text: string): { text: string; intensity: boolean }[] {
  const out: { text: string; intensity: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(INTENSITY_RE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index), intensity: false });
    out.push({ text: m[0], intensity: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), intensity: false });
  return out;
}

/** 震度の行のうち、いちばん強い震度（時間差は先発・後発の強いほう）。無ければ null。 */
export function maxIntensity(text: string): string | null {
  let best: string | null = null;
  for (const m of text.matchAll(INTENSITY_RE)) {
    if (best === null || LEVEL_ORDER.indexOf(intensityLevel(m[0])) > LEVEL_ORDER.indexOf(intensityLevel(best))) best = m[0];
  }
  return best;
}

/** formatPct の文字列 → 割合。「0.1%未満」は 0 より大きいごく小さい値（0.0005）。読めなければ null。 */
export function parsePct(s: string): number | null {
  if (s === '0.1%未満') return 0.0005;
  const m = /^(\d+(?:\.\d+)?)%$/.exec(s);
  return m ? Number(m[1]) / 100 : null;
}

export type RangeNum = { min: number; max: number; central: number };
export function rangeNumbers(r: RangeVM): RangeNum | null {
  const min = parsePct(r.min), max = parsePct(r.max), central = parsePct(r.central);
  return min === null || max === null || central === null ? null : { min, max, central };
}

/**
 * 「10軒あったら」。代表値で、全壊 = round(全壊率×10)、半壊 = round(半壊率×10)、全壊+半壊 ≤ 10 に切る。
 * 割合が 0 より大きいのに 0 軒に丸まるときは「1軒未満」。
 */
export function tenHouses(collapse: number, half: number): { full: number; half: number; caption: string } {
  // 1e-9: 「25.0%」→ 0.25 が浮動小数で 2.4999… になって切り下がらないように
  const r10 = (x: number) => Math.max(0, Math.round(x * 10 + 1e-9));
  const full = Math.min(10, r10(collapse));
  const h = Math.min(10 - full, r10(half));
  // 「1軒未満」は丸めで 0 になったときだけ（合計10軒に切って 0 になったときは「約0軒」）
  const count = (n: number, rate: number) => (r10(rate) === 0 && rate > 0 ? '1軒未満' : `約${n}軒`);
  return { full, half: h, caption: `10軒あったら：全壊 ${count(full, collapse)}・半壊 ${count(h, half)}` };
}

/** 範囲バーの読み上げ。例「全壊 代表値12.3% 幅5.0%〜20.1%」。 */
export const rangeAriaLabel = (label: string, r: RangeVM): string => `${label} 代表値${r.central} 幅${r.min}〜${r.max}`;

/** 津波の段階の代表値（m）。homeTsunamiVM の mid、無ければ（前回の結果）段階の表記から。 */
export function tsunamiMid(t: TsunamiVM): number | null {
  if (t.kind !== 'band' && t.kind !== 'nearby') return null;
  if (typeof t.mid === 'number' && Number.isFinite(t.mid)) return t.mid;
  return TSUNAMI_BANDS.find((b) => b.label === t.depth)?.mid ?? null;
}

/** 浸水深（代表値 m）の言いかえ。 */
export function depthPhrase(mid: number): string {
  if (mid < 0.3) return '足首くらい';
  if (mid < 0.5) return 'ひざくらい';
  if (mid < 1) return '腰くらい';
  if (mid < 3) return '1階の天井近くまで';
  if (mid < 5) return '2階の床より上';
  if (mid < 10) return '2階の屋根近くまで';
  return '家が完全に沈む高さ';
}

/** 絵の縦の範囲（m）。これより深いときは全部を水にして「家より高い」。 */
export const PICTURE_MAX_M = 8;

export type TsunamiPictureVM = {
  /** 絵に描く水の高さ（m。段階の代表値）。10m以上は PICTURE_MAX_M */
  waterM: number;
  /** 段階の幅（m。薄い帯）。絵の上限で切る。10m以上は代表値と同じく上限 */
  loM: number;
  hiM: number;
  overHouse: boolean;
  /** 自宅の地点は浸水域外で、近く（約50m以内）が浸水: 家と人は乾いた地面、水は絵の右側だけ */
  nearby: boolean;
  /** 見える言いかえ（nearby は「近くで」から） */
  phrase: string;
  depth: string;
  aria: string;
};

/** band / nearby のときだけ。none・unknown・段階が読めないときは null（絵を出さない）。 */
export function tsunamiPictureVM(t: TsunamiVM): TsunamiPictureVM | null {
  if (t.kind !== 'band' && t.kind !== 'nearby') return null;
  const mid = tsunamiMid(t);
  if (mid === null) return null;
  const overHouse = mid >= 10;
  const nearby = t.kind === 'nearby';
  const b = TSUNAMI_BANDS.find((x) => x.label === t.depth);
  const cap = (m: number) => Math.min(PICTURE_MAX_M, m);
  const phrase = `${nearby ? '近くで' : ''}${depthPhrase(mid)}`;
  const aria = nearby
    ? `津波の深さの絵：自宅の地点は浸水域外ですが、すぐ近く（約50m以内）の浸水深 ${t.depth}（想定）。近くの水の高さは${depthPhrase(mid)}${overHouse ? '（家より高い）' : ''}。家と人は乾いた地面、右側に近くの水を描いた図。身長1.7mの人と、高さ約6mの2階建ての家と比べています`
    : `津波の深さの絵：浸水深 ${t.depth}（想定）。${phrase}${overHouse ? '（家より高い）' : ''}。身長1.7mの人と、高さ約6mの2階建ての家と比べた図`;
  return {
    waterM: overHouse ? PICTURE_MAX_M : mid,
    loM: overHouse ? PICTURE_MAX_M : cap(b?.lo ?? mid),
    hiM: overHouse ? PICTURE_MAX_M : cap(b?.hi ?? mid),
    overHouse,
    nearby,
    phrase,
    depth: t.depth,
    aria,
  };
}

export type SummaryTile =
  | { key: 'shake'; label: string; value: string; intensity: string | null }
  | { key: 'collapse' | 'tsunami' | 'arrival'; label: string; value: string; /** 2行目（行動の一言） */ note?: string };

/**
 * 「ひと目でわかる」の4枚（揺れ・自宅の全壊・津波・津波の到達）。到達は浸水域内・近くのときだけ。
 * home: そのタブの自宅の結果（'loading' = 読み込み中）。t: 自宅の場所の津波（どのタブでも同じ）。
 */
export function summaryTiles(home: HomeVM | { status: 'error' } | 'loading', t: TsunamiVM): SummaryTile[] {
  const ok = home !== 'loading' && home.status === 'ok' ? home : null;
  const pending = home === 'loading' ? '読み込み中' : home.status === 'error' ? '読み込めませんでした' : 'データなし';
  const shake = ok ? maxIntensity(ok.intensityLabel) : null;
  const tiles: SummaryTile[] = [
    { key: 'shake', label: ok?.stages ? '揺れ（強いほう）' : '揺れ', value: shake ?? pending, intensity: shake },
    { key: 'collapse', label: ok?.stages ? '自宅の全壊（合計）' : '自宅の全壊', value: ok ? (ok.collapse.central.endsWith('未満') ? ok.collapse.central : `約${ok.collapse.central}`) : pending },
    {
      key: 'tsunami', label: '津波',
      value: t.kind === 'band' ? `浸水深 ${t.depth}` : t.kind === 'nearby' ? `近くで 最大${t.depth}` : t.kind === 'none' ? '想定の浸水域外' : '判定できません',
      ...(t.kind === 'band' || t.kind === 'nearby' ? { note: '揺れたらすぐ高い所へ' } : {}),
    },
  ];
  if (t.kind === 'band' || t.kind === 'nearby') {
    const min = typeof t.arrivalMin === 'number' && Number.isFinite(t.arrivalMin) ? t.arrivalMin : null;
    // 不明 → 「すぐ（到達時間は不明）」、5分以内（urgent）→「すぐ」、それ以外 →「最短約N分（目安）」
    const value = min === null ? 'すぐ（到達時間は不明）' : t.urgent ? 'すぐ' : `最短約${Math.round(min)}分（目安）`;
    tiles.push({ key: 'arrival', label: '津波の到達（海岸・最短）', value });
  }
  return tiles;
}
