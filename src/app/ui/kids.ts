/**
 * こどもモードの画面（結果・かぞくの きまり）。計算はせず、画面に出している値（ScenarioHome・TsunamiVM・家族のメモ）から描く。
 * 絵文字は使わず、インライン SVG。絵には読み上げの名前か、見える文字を付ける。
 */
import {
  KIDS_EMPTY, KIDS_TEXT, arrivalLine, fun, depthReading, houseLegend, intensityReading, intensityRuby, kidActions, kidReviewed, kidShake,
  tsunamiKidText, type Face, type KidCard, type RubyPart,
} from '../kids.ts';
import { PICTURE_MAX_M, rangeNumbers, tsunamiPictureVM } from '../visuals.ts';
import type { TsunamiVM } from '../viewmodel.ts';
import type { Scenario, ScenarioHome } from '../scenario.ts';
import { emptyFamily, loadFamily, type FamilyMemo } from '../family.ts';
import { el } from './dom.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElement {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  for (const c of children) n.append(c);
  return n;
}

/** 読みつきの文字。 */
export function rubyNodes(parts: RubyPart[]): Node[] {
  return parts.map((p) => (p.rt ? el('ruby', {}, p.text, el('rt', {}, p.rt)) : document.createTextNode(p.text)));
}

/** こども / おとな の切り替え（aria-pressed）。 */
export function modeToggle(kids: boolean, onChange: (kids: boolean) => void): { node: HTMLElement; set(kids: boolean): void } {
  const kb = el('button', { type: 'button', class: 'mode-btn', id: 'mode-kids' }, 'こども');
  const ab = el('button', { type: 'button', class: 'mode-btn', id: 'mode-adult' }, 'おとな');
  const set = (on: boolean): void => {
    kb.setAttribute('aria-pressed', String(on));
    ab.setAttribute('aria-pressed', String(!on));
  };
  kb.addEventListener('click', () => onChange(true));
  ab.addEventListener('click', () => onChange(false));
  set(kids);
  return { node: el('div', { class: 'mode-toggle', role: 'group', 'aria-label': 'ひょうじの きりかえ（こども / おとな）' }, kb, ab), set };
}

/** かおの いろ（あかは にげる ことばだけに つかう）。1〜2: みどり、3（5弱）: きいろ、4（5強）: こん、5〜（6弱いじょう）: こい だいだい */
const faceColor = (step: number): string => (step <= 2 ? '#3A9D5D' : step === 3 ? '#F0A040' : step === 4 ? '#1F2A44' : '#C2410C');
const FACE_NAME: Record<Face, string> = { calm: 'おちついた かおの マーク', worried: 'しんぱいな かおの マーク', distressed: 'こまった かおの マーク' };

function faceIcon(face: Face, step: number): SVGElement {
  const mouth = face === 'calm' ? 'M30 58 Q48 72 66 58' : face === 'worried' ? 'M32 64 L64 64' : 'M30 66 Q48 52 66 66';
  return svg('svg', { width: 88, height: 88, viewBox: '0 0 96 96', role: 'img', 'aria-label': FACE_NAME[face], class: 'kid-face' },
    svg('circle', { cx: 48, cy: 48, r: 44, fill: faceColor(step) }),
    svg('circle', { cx: 34, cy: 40, r: 5, fill: '#FFFFFF' }),
    svg('circle', { cx: 62, cy: 40, r: 5, fill: '#FFFFFF' }),
    svg('path', { d: mouth, stroke: '#FFFFFF', 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round' }),
    ...(face === 'distressed' ? [svg('path', { d: 'M24 26 L36 32 M72 26 L60 32', stroke: '#FFFFFF', 'stroke-width': 4, 'stroke-linecap': 'round' })] : []));
}

const METER = ['#DCE6F2', '#DCE6F2', '#FFE680', '#FFD84D', '#F39C3D', '#D9381E', '#E6D3E6'];

function section(id: string, title: string, ...children: (Node | null)[]): HTMLElement {
  return el('section', { class: 'kid-card', id }, el('h2', {}, title), ...children);
}

const noData = (): HTMLElement => el('p', { class: 'kid-nodata' }, KIDS_TEXT.noData);

function shakeSection(home: ScenarioHome | 'loading', sc: Scenario): HTMLElement {
  if (home === 'loading') return section('kid-shake', KIDS_TEXT.shakeTitle, el('p', { class: 'kid-loading', role: 'status' }, KIDS_TEXT.loading));
  const s = home.status === 'ok' ? kidShake(home.intensityLabel, sc === 'LAG_EW' || sc === 'LAG_WE') : null;
  if (!s) return section('kid-shake', KIDS_TEXT.shakeTitle, noData());
  const phraseLines = s.phrase.split('。').filter(Boolean);
  const meter = el('div', { class: 'kid-meter', role: 'img', 'aria-label': `ゆれメーター：7だんかいの ${s.step}ばんめ` },
    ...METER.map((c, i) => el('span', { class: `kid-meter-step${i + 1 === s.step ? ' kid-meter-on' : ''}`, style: `background:${c}` })));
  return section('kid-shake', KIDS_TEXT.shakeTitle,
    el('div', { class: 'kid-shake-row' }, faceIcon(s.face, s.step),
      el('div', { class: 'kid-shake-text' },
        ...(s.prefix ? [el('p', { class: 'kid-prefix' }, s.prefix)] : []),
        el('p', { class: `kid-shindo kid-step-${s.step}` },
          el('span', { 'aria-hidden': 'true' }, ...rubyNodes(intensityRuby(s.label))), el('span', { class: 'sr-only' }, intensityReading(s.label))),
        el('p', { class: 'kid-phrase' }, ...phraseLines.flatMap((l, i) => (i === 0 ? [l + (phraseLines.length > 1 ? '。' : '')] : [el('br', {}), l]))))),
    meter,
    el('div', { class: 'kid-meter-ends', 'aria-hidden': 'true' }, el('span', {}, KIDS_TEXT.weak), el('span', {}, KIDS_TEXT.strong)));
}

const HOUSE = { collapse: ['#8C1D18', '#B3261E'], half: ['#C77A1E', '#F0A040'], ok: ['#9AA3B0', '#C9CFD8'] } as const;

function bigHouse(kind: keyof typeof HOUSE): SVGElement {
  const [roof, wall] = HOUSE[kind];
  return svg('svg', { viewBox: '0 0 56 52', 'aria-hidden': 'true', class: `kid-house kid-house-${kind}` },
    svg('path', { d: 'M4 24 L28 4 L52 24 Z', fill: roof }),
    svg('rect', { x: 10, y: 24, width: 36, height: 26, rx: 3, fill: wall }),
    svg('rect', { x: 23, y: 34, width: 10, height: 16, rx: 2, fill: '#FFFFFF' }));
}

function houseSection(home: ScenarioHome | 'loading'): HTMLElement {
  if (home === 'loading') return section('kid-house', KIDS_TEXT.houseTitle, el('p', { class: 'kid-loading' }, KIDS_TEXT.loading));
  const c = home.status === 'ok' ? rangeNumbers(home.collapse) : null;
  const h = home.status === 'ok' ? rangeNumbers(home.half) : null;
  if (!c || !h) return section('kid-house', KIDS_TEXT.houseTitle, noData());
  const lg = houseLegend(c.central, h.central);
  const houses = Array.from({ length: 10 }, (_, i) => bigHouse(i < lg.full ? 'collapse' : i < lg.full + lg.half ? 'half' : 'ok'));
  const key = (color: string, text: string, cls: string) => el('p', { class: `kid-key ${cls}` }, el('span', { class: 'kid-swatch', style: `background:${color}`, 'aria-hidden': 'true' }), text);
  return section('kid-house', KIDS_TEXT.houseTitle,
    el('p', { class: 'kid-lead' }, KIDS_TEXT.houseLead),
    el('div', { class: 'kid-houses', role: 'img', 'aria-label': lg.aria }, ...houses),
    el('div', { class: 'kid-keys' },
      key(HOUSE.collapse[1], lg.fullText, 'kid-key-collapse'),
      key(HOUSE.half[1], lg.halfText, 'kid-key-half'),
      key(HOUSE.ok[1], lg.restText, 'kid-key-ok')),
    el('p', { class: 'kid-tip' }, KIDS_TEXT.houseTip));
}

/** つなみの え（きみ 1.3m・おとな 1.7m・2かいだての いえ）。たての めもりは おとなの え と おなじ（PICTURE_MAX_M まで）。 */
export function kidsTsunamiPicture(t: TsunamiVM): SVGElement | null {
  const vm = tsunamiPictureVM(t);
  if (!vm) return null;
  const W = 358, H = 260, ground = 240, top = 14;
  const s = (ground - top) / PICTURE_MAX_M;
  const y = (m: number) => ground - m * s;
  const L = vm.nearby ? { kid: 30, adult: 112, hx: 150, wx: 240 } : { kid: 40, adult: 140, hx: 258, wx: 0 };
  const hw = 76;
  const person = (x: number, m: number, color: string): SVGElement => {
    const ph = m * s, r = Math.max(4, ph * 0.14);
    return svg('g', { fill: color },
      svg('circle', { cx: x, cy: ground - ph + r, r }),
      svg('rect', { x: x - r * 0.95, y: ground - ph + r * 2.2, width: r * 1.9, height: ph - r * 2.2, rx: r * 0.8 }));
  };
  const font = { 'font-size': 13, 'font-weight': 700, fill: '#1F2A44', stroke: '#FFFFFF', 'stroke-width': 3, 'paint-order': 'stroke', 'stroke-linejoin': 'round' };
  const ww = W - L.wx;
  const midH = Math.max(4, vm.waterM * s);
  const bandOn = vm.hiM > vm.loM;
  const label = vm.nearby ? 'ちかくの みず' : null;
  const aria = `つなみの え。${vm.nearby ? 'いえの ちかくの' : ''}みずの ふかさは ${depthReading(vm.depth)}（よそう）。${tsunamiKidText(t).lines.join('')}きみ（1.3メートル）、おとな（1.7メートル）、2かいだての いえと くらべた え`;
  return svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria, class: 'kid-tsunami-svg' },
    svg('rect', { x: 0, y: 0, width: W, height: H, rx: 14, fill: '#F3F8FF' }),
    // いえ（かべ 0〜6m、1かい・2かい、やね 6〜7.4m）
    svg('path', { d: `M${L.hx - 8} ${y(6)} L${L.hx + hw / 2} ${y(7.4)} L${L.hx + hw + 8} ${y(6)} Z`, fill: '#8B6F5A' }),
    svg('rect', { x: L.hx, y: y(6), width: hw, height: 6 * s, fill: '#FFFFFF', stroke: '#8B6F5A', 'stroke-width': 3 }),
    svg('line', { x1: L.hx, y1: y(3), x2: L.hx + hw, y2: y(3), stroke: '#8B6F5A', 'stroke-width': 2 }),
    svg('text', { x: L.hx + hw / 2, y: y(4.5) + 5, 'text-anchor': 'middle', ...font }, '2かい'),
    svg('text', { x: L.hx + hw / 2, y: y(1.5) + 5, 'text-anchor': 'middle', ...font }, '1かい'),
    ...(bandOn ? [svg('rect', { class: 'kid-water-band', x: L.wx, y: y(vm.hiM), width: ww, height: Math.max(4, y(vm.loM) - y(vm.hiM)), fill: '#7FB8EA', opacity: 0.35 })] : []),
    svg('rect', { class: 'kid-water', x: L.wx, y: ground - midH, width: ww, height: midH, fill: '#4BA3E3', opacity: 0.75 }),
    svg('line', { x1: L.wx, y1: ground - midH, x2: W, y2: ground - midH, stroke: '#2C7FC4', 'stroke-width': 3 }),
    svg('line', { x1: 0, y1: ground, x2: W, y2: ground, stroke: '#6B5B4B', 'stroke-width': 4 }),
    // ひとは みずの まえに（みえるように）
    person(L.kid, 1.3, '#F28C28'),
    person(L.adult, 1.7, '#1F2A44'),
    svg('text', { x: L.kid - 12, y: y(1.3) - 6, ...font }, 'きみ（1.3m）'),
    svg('text', { x: L.adult - 14, y: y(1.7) - 6, ...font }, 'おとな（1.7m）'),
    ...(bandOn ? [svg('text', { x: 12, y: 26, 'font-size': 13, 'font-weight': 700, fill: '#1F4FA8' }, KIDS_TEXT.bandHint)] : []),
    ...(label ? [svg('text', { x: W - 8, y: 44, 'text-anchor': 'end', 'font-size': 13, 'font-weight': 700, fill: '#1F4FA8' }, label)] : []),
    ...(vm.overHouse ? [svg('text', { x: W - 8, y: 62, 'text-anchor': 'end', 'font-size': 14, 'font-weight': 900, fill: '#1F2A44' }, 'いえより たかい')] : []));
}

function clockIcon(): SVGElement {
  return svg('svg', { width: 44, height: 44, viewBox: '0 0 44 44', 'aria-hidden': 'true', class: 'kid-clock-icon' },
    svg('circle', { cx: 22, cy: 22, r: 19, fill: 'none', stroke: '#1F2A44', 'stroke-width': 3 }),
    svg('path', { d: 'M22 11 L22 22 L30 27', stroke: '#1F2A44', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }));
}

function tsunamiSection(t: TsunamiVM): HTMLElement {
  const txt = tsunamiKidText(t);
  if (t.kind !== 'band' && t.kind !== 'nearby') {
    return section('kid-tsunami', KIDS_TEXT.tsunamiTitle, el('p', { class: 'kid-tsunami-short' }, txt.lines[0]));
  }
  const pic = kidsTsunamiPicture(t);
  const arr = arrivalLine(t)!;
  const wait = el('strong', { class: 'kid-red-text' }, 'まって いたら まにあわない！');
  const arrNode = arr.min !== null
    ? el('p', { class: 'kid-arrival-text' }, 'はやいと ', el('span', { class: 'kid-big-num' }, fun(arr.min)), 'で うみに つく。', `${KIDS_TEXT.earlier}。`, el('br', {}), wait)
    : el('p', { class: 'kid-arrival-text' }, 'すぐ くるかも。', el('br', {}), wait);
  return section('kid-tsunami', KIDS_TEXT.tsunamiTitle,
    ...(pic ? [pic] : []),
    el('p', { class: 'kid-tsunami-phrase' }, ...txt.lines.flatMap((l, i) => (i === 0 ? [l] : [el('br', {}), l]))),
    el('div', { class: 'kid-arrival' }, clockIcon(), arrNode));
}

function actionIcon(key: KidCard['key'], color: string): SVGElement {
  const paths: Record<KidCard['key'], SVGElement[]> = {
    protect: [
      svg('path', { d: 'M6 18 L22 8 L38 18', stroke: color, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      svg('circle', { cx: 22, cy: 24, r: 6, fill: color }),
      svg('path', { d: 'M12 40 Q22 28 32 40', fill: color }),
    ],
    escape: [
      svg('path', { d: 'M4 40 L18 22 L26 30 L40 8', stroke: color, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      svg('path', { d: 'M30 8 L40 8 L40 18', stroke: color, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    ],
    meet: [
      svg('circle', { cx: 14, cy: 14, r: 6, fill: color }),
      svg('circle', { cx: 30, cy: 14, r: 6, fill: color }),
      svg('path', { d: 'M4 38 Q14 22 24 38 M20 38 Q30 22 40 38', fill: color }),
    ],
  };
  return svg('svg', { width: 44, height: 44, viewBox: '0 0 44 44', 'aria-hidden': 'true' }, ...paths[key]);
}

const CARD_COLOR = { protect: 'blue', escape: 'red', meet: 'green', calm: 'amber' } as const;

function actionsSection(t: TsunamiVM, generic = false): HTMLElement {
  const cards = kidActions(t, generic).map((c) => {
    const tone = c.red ? 'red' : c.key === 'escape' ? CARD_COLOR.calm : CARD_COLOR[c.key];
    const color = { blue: '#2F6FDB', red: '#D9381E', green: '#1B8A5A', amber: '#B86A12' }[tone];
    return el('div', { class: `kid-action kid-tone-${tone}`, id: `kid-action-${c.key}` },
      el('div', { class: 'kid-action-icon' }, actionIcon(c.key, color)),
      el('div', { class: 'kid-action-text' },
        el('p', { class: 'kid-small' }, c.small),
        el('p', { class: 'kid-big' }, c.big),
        el('p', { class: 'kid-note' }, c.note)));
  });
  return el('section', { class: 'kid-actions', id: 'kid-actions' }, el('h2', {}, KIDS_TEXT.doTitle), ...cards);
}

export type KidsResultArgs = {
  home: ScenarioHome | 'loading';
  scenario: Scenario;
  tsunami: TsunamiVM;
  /** 「うごきで みて みよう」（再生できないときは null） */
  player: HTMLElement | null;
  onAdult: () => void;
  /** 読み込めなかった タブを もう いちど（おとなの「もう一度読み込む」と同じ） */
  onRetry: () => void;
};

/** こどもモードの結果の中身（タブの下）。 */
export function kidsResultNodes(a: KidsResultArgs): Node[] {
  const mapLink = el('button', { type: 'button', class: 'kid-link', id: 'kid-adult-map' }, KIDS_TEXT.mapLink);
  mapLink.addEventListener('click', a.onAdult);
  const status = a.home === 'loading' ? 'loading' : a.home.status;
  const top: Node[] = [];
  if (status === 'outside') {
    top.push(el('section', { class: 'kid-card', id: 'kid-outside' }, el('p', { class: 'kid-nodata' }, KIDS_TEXT.outside)));
  } else if (status === 'error') {
    const retry = el('button', { type: 'button', class: 'kid-btn kid-btn-outline', id: 'kid-retry' }, KIDS_TEXT.retry);
    retry.addEventListener('click', a.onRetry);
    top.push(el('section', { class: 'kid-card', id: 'kid-error' }, el('p', { class: 'kid-nodata' }, KIDS_TEXT.error), retry), tsunamiSection(a.tsunami));
  } else {
    top.push(shakeSection(a.home, a.scenario), houseSection(a.home), tsunamiSection(a.tsunami));
  }
  return [
    ...top,
    actionsSection(a.tsunami, status === 'outside'),
    ...(a.player ? [a.player] : []),
    el('a', { href: '#family', class: 'kid-btn kid-btn-outline', id: 'kid-family' }, KIDS_TEXT.family),
    el('p', { class: 'kid-closing', id: 'kid-closing' }, KIDS_TEXT.closing[0], el('br', {}), KIDS_TEXT.closing[1]),
    mapLink,
  ];
}

/** 結果の上の ひとこと（タブの上）。 */
export function kidsIntro(): HTMLElement {
  return el('div', { class: 'kid-card kid-intro', id: 'kid-intro' },
    el('p', { class: 'kid-intro-big' }, KIDS_TEXT.intro),
    el('p', { class: 'kid-intro-note' }, KIDS_TEXT.disclaimer));
}

export const playIcon = (): SVGElement => svg('svg', { width: 22, height: 22, viewBox: '0 0 22 22', 'aria-hidden': 'true' }, svg('path', { d: 'M6 3 L19 11 L6 19 Z', fill: '#FFFFFF' }));

// ---- かぞくの きまり（こども） ----

function familyIcon(kind: 'tsunami' | 'quake' | 'meet' | 'phone', color: string): SVGElement {
  const parts: Record<typeof kind, SVGElement[]> = {
    tsunami: [
      svg('path', { d: 'M2 46 L14 46 L14 36 L24 36 L24 24 L34 24 L34 12 L48 12', stroke: color, 'stroke-width': 4, fill: 'none', 'stroke-linejoin': 'round' }),
      svg('circle', { cx: 40, cy: 6, r: 4, fill: color }),
    ],
    quake: [
      svg('rect', { x: 8, y: 18, width: 34, height: 28, rx: 3, fill: 'none', stroke: color, 'stroke-width': 4 }),
      svg('path', { d: 'M4 20 L25 4 L46 20', stroke: color, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      svg('rect', { x: 20, y: 30, width: 10, height: 16, fill: color }),
    ],
    meet: [
      svg('path', { d: 'M25 46 C25 46 8 30 8 18 A17 17 0 0 1 42 18 C42 30 25 46 25 46 Z', fill: 'none', stroke: color, 'stroke-width': 4 }),
      svg('circle', { cx: 25, cy: 18, r: 6, fill: color }),
    ],
    phone: [
      svg('rect', { x: 14, y: 4, width: 22, height: 42, rx: 5, fill: 'none', stroke: color, 'stroke-width': 4 }),
      svg('circle', { cx: 25, cy: 38, r: 3, fill: color }),
    ],
  };
  return svg('svg', { width: 50, height: 50, viewBox: '0 0 50 50', 'aria-hidden': 'true' }, ...parts[kind]);
}

const val = (s: string): HTMLElement => (s.trim() ? el('p', { class: 'kid-fam-value' }, s.trim()) : el('p', { class: 'kid-fam-empty' }, KIDS_EMPTY));

export type FamilyKidsOpts = { store: Storage | null; onAdult: () => void; onExit: () => void };

export function renderFamilyKids(root: HTMLElement, o: FamilyKidsOpts): void {
  const m: FamilyMemo = o.store ? loadFamily(o.store) : emptyFamily();
  const back = el('button', { type: 'button', class: 'kid-back', id: 'kid-family-back' }, '← もどる');
  back.addEventListener('click', o.onExit);
  const adult = el('button', { type: 'button', class: 'kid-btn kid-btn-outline', id: 'kid-family-adult' }, 'おうちの ひとが かく（おとなの がめん）');
  adult.addEventListener('click', o.onAdult);
  const head = (kind: Parameters<typeof familyIcon>[0], color: string, bg: string) =>
    el('div', { class: 'kid-fam-icon', style: `background:${bg}` }, familyIcon(kind, color));
  const rows = m.rows.filter((r) => r.who.trim() || r.memo.trim());
  const reviewed = kidReviewed(m.reviewed);
  root.replaceChildren(el('div', { class: 'kid-family', id: 'kid-family' },
    el('div', { class: 'kid-fam-top' }, back, el('p', { class: 'kid-muted' }, 'おうちの ひとが かいたよ')),
    el('h2', { class: 'kid-fam-title' }, 'わが', el('ruby', {}, '家', el('rt', {}, 'や')), 'の', el('br', {}), 'じしんの ときの きまり'),
    el('section', { class: 'kid-fam-card kid-tone-red', id: 'kid-fam-tsunami' },
      head('tsunami', '#D9381E', '#FCE7E3'),
      el('div', { class: 'kid-fam-body' }, el('p', { class: 'kid-small kid-red-text' }, 'つなみの ときに にげる ところ'), val(m.tsunami))),
    el('section', { class: 'kid-fam-card kid-tone-blue', id: 'kid-fam-quake' },
      head('quake', '#2F6FDB', '#E4EEFC'),
      el('div', { class: 'kid-fam-body' }, el('p', { class: 'kid-small kid-blue-text' }, 'じしん・かじの ときに にげる ところ'), val(m.quake))),
    el('section', { class: 'kid-fam-card kid-fam-col kid-tone-green', id: 'kid-fam-meet' },
      el('div', { class: 'kid-fam-row' }, head('meet', '#1B8A5A', '#E1F4EA'), el('p', { class: 'kid-small kid-green-text' }, 'はぐれたら ここで あう')),
      el('div', { class: 'kid-fam-grid' },
        el('div', { class: 'kid-fam-cell' }, el('p', { class: 'kid-fam-label' }, 'まず ここ'), val(m.meet1)),
        el('div', { class: 'kid-fam-cell' }, el('p', { class: 'kid-fam-label' }, 'だめなら ここ'), val(m.meet2)))),
    el('section', { class: 'kid-fam-card kid-fam-col kid-tone-purple', id: 'kid-fam-171' },
      el('div', { class: 'kid-fam-row' }, head('phone', '#7A4FBF', '#EFE7FA'),
        el('div', {}, el('p', { class: 'kid-small kid-purple-text' }, 'れんらくの しかた'), el('p', { class: 'kid-171' }, '171'))),
      el('p', { class: 'kid-fam-text' }, 'でんわで 171に かけて、', el('br', {}), 'きくときは「2」。', el('br', {}), 'いえの でんわばんごうを いれるよ。'),
      el('p', { class: 'kid-fam-tip' }, 'まいつき 1にち・15にちに れんしゅう できるよ。')),
    el('section', { class: 'kid-fam-card kid-fam-col kid-fam-plain', id: 'kid-fam-rows' },
      el('p', { class: 'kid-fam-h' }, 'だれが どこに いる？'),
      ...(rows.length
        ? rows.map((r) => el('div', { class: 'kid-fam-person' }, el('span', { class: 'kid-fam-who' }, r.who.trim() || '…'), el('span', { class: 'kid-fam-memo' }, r.memo.trim())))
        : [el('p', { class: 'kid-fam-empty' }, KIDS_EMPTY)])),
    el('p', { class: 'kid-muted kid-center', id: 'kid-fam-reviewed' }, reviewed ?? `みなおした ひ：${KIDS_EMPTY}`),
    adult));
}
