import type { RangeVM, TsunamiVM } from '../viewmodel.ts';
import {
  INTENSITY_COLORS, PICTURE_MAX_M, intensityLevel, rangeAriaLabel, rangeNumbers, splitIntensity, summaryTiles, tenHouses,
  tsunamiPictureVM, type SummaryTile,
} from '../visuals.ts';
import type { ScenarioHome } from '../scenario.ts';
import { el } from './dom.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElement {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  for (const c of children) n.append(c);
  return n;
}

/** 震度のバッジ（色つきの丸い札）。文字は「震度6強」のまま（色だけに頼らない）。 */
export function intensityBadge(label: string): HTMLElement {
  const c = INTENSITY_COLORS[intensityLevel(label)];
  return el('span', { class: `shindo shindo-${intensityLevel(label).replace('+', 'p').replace('-', 'm')}`, style: `background:${c.fill};color:${c.text}` }, label);
}

/** 震度の行の文字列（「震度6弱」「先に東側で震度6弱、後に西側で震度6強」）を、震度だけバッジにした節点。 */
export function intensityNodes(text: string): Node[] {
  return splitIntensity(text).map((s) => (s.intensity ? intensityBadge(s.text) : document.createTextNode(s.text)));
}

/** 家の形（約22px）。 */
function houseIcon(color: string): SVGElement {
  return svg('svg', { viewBox: '0 0 22 22', width: 22, height: 22, 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: 'M11 2 L21 10 L18 10 L18 20 L4 20 L4 10 L1 10 Z', fill: color }));
}

export const HOUSE_COLORS = { full: '#b3261e', half: '#f0a040', other: '#d0d4da' } as const;

/** 「10軒あったら」の家の列と一文。数値が読めないときは出さない。 */
export function houseRow(collapse: RangeVM, half: RangeVM): HTMLElement | null {
  const c = rangeNumbers(collapse), h = rangeNumbers(half);
  if (!c || !h) return null;
  const t = tenHouses(c.central, h.central);
  const icons = Array.from({ length: 10 }, (_, i) => houseIcon(i < t.full ? HOUSE_COLORS.full : i < t.full + t.half ? HOUSE_COLORS.half : HOUSE_COLORS.other));
  return el('div', { class: 'houses' },
    el('div', { class: 'house-icons', 'aria-hidden': 'true' }, ...icons),
    el('p', { class: 'house-caption' }, t.caption),
    el('p', { class: 'house-key', 'aria-hidden': 'true' },
      el('span', { class: 'key-swatch', style: `background:${HOUSE_COLORS.full}` }), '全壊　',
      el('span', { class: 'key-swatch', style: `background:${HOUSE_COLORS.half}` }), '半壊　',
      el('span', { class: 'key-swatch', style: `background:${HOUSE_COLORS.other}` }), 'それ以外（被害なしとは限りません）'));
}

/** 0〜100% の横棒。幅（最小〜最大）を薄い帯、代表値を印で。 */
export function rangeBar(label: string, r: RangeVM): HTMLElement | null {
  const n = rangeNumbers(r);
  if (!n) return null;
  const pc = (x: number) => `${Math.max(0, Math.min(100, x * 100)).toFixed(2)}%`;
  // 印は 0% でも 100% でも見えるように、枠の内側（1〜99%）に収める
  const mark = (x: number) => `${Math.max(1, Math.min(99, x * 100)).toFixed(2)}%`;
  return el('div', { class: `range-bar range-${label === '全壊' ? 'full' : 'half'}`, role: 'img', 'aria-label': rangeAriaLabel(label, r) },
    el('span', { class: 'range-band', style: `left:${pc(n.min)};width:${pc(Math.max(n.max - n.min, 0))}` }),
    el('span', { class: 'range-mark', style: `left:${mark(n.central)}` }));
}

/**
 * 津波の深さの絵（人1.7m・2階建ての家約6mと水の高さ）。band / nearby のときだけ。
 * 水は代表値の高さまで濃く、段階の幅（lo〜hi）を薄い帯で。nearby は家と人を左の乾いた地面に置き、水は右側だけ。
 */
export function tsunamiPicture(t: TsunamiVM): HTMLElement | null {
  const vm = tsunamiPictureVM(t);
  if (!vm) return null;
  const W = 260, H = 140, ground = 126, top = 10;
  const s = (ground - top) / PICTURE_MAX_M; // 1m あたりの px
  const y = (m: number) => ground - m * s;
  // 置き方: 浸水域内は水が全体、nearby は左に家と人・右に水
  const L = vm.nearby ? { px: 20, hx: 46, hw: 84, wx: 176 } : { px: 44, hx: 120, hw: 100, wx: 0 };
  const { px, hx, hw, wx } = L;
  // 人（1.7m）
  const ph = 1.7 * s, head = ph * 0.13;
  const person = svg('g', { fill: '#3a3a3a' },
    svg('circle', { cx: px, cy: ground - ph + head, r: head }),
    svg('rect', { x: px - head * 0.9, y: ground - ph + head * 2.1, width: head * 1.8, height: ph * 0.42, rx: 2 }),
    svg('rect', { x: px - head * 0.8, y: ground - ph * 0.47, width: head * 0.7, height: ph * 0.47 }),
    svg('rect', { x: px + head * 0.1, y: ground - ph * 0.47, width: head * 0.7, height: ph * 0.47 }));
  // 2階建ての家（壁 0〜6m、1階 0〜3m・2階 3〜6m、屋根 6〜7.4m）
  const house = svg('g', {},
    svg('rect', { x: hx, y: y(6), width: hw, height: 6 * s, fill: '#fff', stroke: '#555', 'stroke-width': 1.5 }),
    svg('line', { x1: hx, y1: y(3), x2: hx + hw, y2: y(3), stroke: '#555', 'stroke-width': 1.5 }),
    svg('path', { d: `M${hx - 8} ${y(6)} L${hx + hw / 2} ${y(7.4)} L${hx + hw + 8} ${y(6)} Z`, fill: '#8a6f5a', stroke: '#555', 'stroke-width': 1.5 }),
    svg('text', { x: hx + hw / 2, y: y(1.5) + 5, 'text-anchor': 'middle', 'font-size': 13, fill: '#333' }, '1F'),
    svg('text', { x: hx + hw / 2, y: y(4.5) + 5, 'text-anchor': 'middle', 'font-size': 13, fill: '#333' }, '2F'));
  const ww = W - wx;
  // 段階の幅（薄い帯）と代表値（濃い水）。どちらも最低 4px は描く
  const MIN_PX = 4;
  const midH = Math.max(MIN_PX, vm.waterM * s);
  const bandH = Math.max(MIN_PX, y(vm.loM) - y(vm.hiM));
  const band = vm.hiM > vm.loM
    ? [svg('rect', { class: 'water-band', x: wx, y: y(vm.hiM), width: ww, height: bandH, fill: 'rgba(30,110,210,0.16)', stroke: 'rgba(30,91,176,0.6)', 'stroke-width': 1, 'stroke-dasharray': '4 3' })]
    : [];
  const water = svg('rect', { class: 'water-mid', x: wx, y: ground - midH, width: ww, height: midH, fill: 'rgba(30,110,210,0.42)' });
  const surface = svg('line', { x1: wx, y1: ground - midH, x2: W, y2: ground - midH, stroke: '#1e5bb0', 'stroke-width': 2 });
  const labels = [
    svg('text', { x: px + 10, y: y(1.7) + 4, 'font-size': 11, fill: '#333' }, '1.7m'),
    svg('text', { x: hx + hw + 4, y: y(6) + 4, 'font-size': 11, fill: '#333' }, '約6m'),
    ...(vm.nearby ? [svg('text', { x: W - 4, y: top + 4, 'text-anchor': 'end', 'font-size': 10, 'font-weight': 700, fill: '#0b2e66' }, '近く（自宅の地点は浸水域外）')] : []),
    ...(vm.overHouse ? [svg('text', { x: vm.nearby ? W - 4 : 8, y: top + 18, 'text-anchor': vm.nearby ? 'end' : 'start', 'font-size': 13, 'font-weight': 700, fill: '#0b2e66' }, '家より高い')] : []),
  ];
  const pic = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': vm.aria, class: 'tsunami-svg' },
    svg('rect', { x: 0, y: 0, width: W, height: H, fill: '#f4f8fc' }),
    person, house, ...band, water, surface,
    svg('line', { x1: 0, y1: ground, x2: W, y2: ground, stroke: '#5b4a3a', 'stroke-width': 3 }),
    ...labels);
  return el('figure', { class: 'tsunami-picture' }, pic,
    el('figcaption', { 'aria-hidden': 'true' }, el('strong', {}, vm.phrase), `（想定 ${vm.depth}${vm.overHouse ? '・家より高い' : ''}）`));
}

/** 見出しの前の小さな絵文字（読み上げない。見出しの名前は変えない）。 */
export const headingIcon = (emoji: string): HTMLElement => el('span', { class: 'h-icon', 'aria-hidden': 'true' }, `${emoji} `);

function tileNode(t: SummaryTile): HTMLElement {
  // 「最短約15分（目安）」のような括弧書きは小さく（狭い幅で途中改行しないように）
  const paren = /^(.+?)(（.+）)$/.exec(t.value);
  const value = t.key === 'shake' && t.intensity ? intensityBadge(t.intensity)
    : el('span', { class: 'tile-value' }, paren ? [paren[1], el('span', { class: 'tile-paren' }, paren[2])] : t.value);
  const note = 'note' in t && t.note ? el('span', { class: 'tile-note' }, t.note) : null;
  return el('div', { class: `tile tile-${t.key}` }, el('span', { class: 'tile-label' }, t.label), value, note);
}

/** 「ひと目でわかる」まとめ（タブを替えるたびに作り直す）。 */
export function summaryCard(home: ScenarioHome | 'loading', t: TsunamiVM): HTMLElement {
  return el('section', { class: 'card summary', id: 'summary', 'aria-labelledby': 'summary-heading' },
    el('h2', { id: 'summary-heading' }, 'ひと目でわかる'),
    el('div', { class: 'tiles' }, ...summaryTiles(home, t).map(tileNode)));
}
