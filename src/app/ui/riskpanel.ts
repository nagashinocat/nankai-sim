/**
 * 周辺1km の「やることマップ」の画面部品（おとな・こども）。地図は ui/map.ts の createRiskMap、言葉と色は riskmap.ts。
 * 地図タイルが読めなくても、マス・避難場所の印・矢印・凡例は出る（タイル以外は手元で描く）。
 */
import type { LatLon, Shelter } from '../../core/types.ts';
import {
  RISK_MODES, RISK_MODE_LABELS, escapeTarget, homeQuadrant, legendFor, mapAlt, noArrowText, cellClass, cellFill,
  type HomeKind, type HomeQuadrant, type RiskMode,
} from '../riskmap.ts';
import { KIDS_MAP_TEXT } from '../kids.ts';
import { el } from './dom.ts';
import { createRiskMap, shelterSwatch, swatchSvg, tsunamiCaption, tsunamiLegendElement, type MeshRate, type RiskMapHandle } from './map.ts';

/** 選んだ表示（揺れ・津波・両方）。メモリだけ（タブや場所を変えても残る。保存しない）。 */
let chosenMode: RiskMode = 'both';

export type RiskPanelInput = {
  home: LatLon;
  meshes: MeshRate[];
  tsunamiShelters: Shelter[];
  quakeShelters: Shelter[];
  homeKind: HomeKind;
  /** 入力した家の全壊率の推計（自宅の結果の代表値。無ければ null） */
  homeRate: number | null;
  /** 自宅が対応範囲外 */
  outside: boolean;
};

export type RiskPanel = {
  node: HTMLElement;
  /** node を画面に入れたあとに呼ぶ（Leaflet の地図を作る） */
  mount(): void;
  setMeshRates(meshes: MeshRate[]): void;
  /** 入力した家の推計（タブで変わる）と、いま選んでいるタブが最大クラスか */
  setHome(homeRate: number | null, l2: boolean): void;
  highlightShelter(index: number): void;
  /** 表示した（大きさが変わった）あとに呼ぶ */
  refresh(): void;
  remove(): void;
};

const QUAD_TONE: Record<string, { border: string; title: string }> = {
  both: { border: '#6E5BB0', title: '#4A3A8C' },
  tsunami: { border: '#3F7FC0', title: '#185FA5' },
  collapse: { border: '#C98420', title: '#8A5300' },
  high: { border: '#C98420', title: '#8A5300' },
  mid: { border: '#D9B254', title: '#7A5A00' },
};
const tone = (key: string) => QUAD_TONE[key] ?? { border: '#9A978E', title: '#3E4658' };

/** 今のモードで、斜線（判定できない）で描くマスがあるか（凡例の「判定できません」はそのときだけ）。 */
const hasUnknown = (meshes: MeshRate[], mode: RiskMode): boolean =>
  meshes.some((m) => cellFill(cellClass(m.rate, m.tsunami ?? null), mode).unknownHatch);

function legendList(mode: RiskMode, kids: boolean, unknown: boolean, shelters: { tsunami: boolean; quake: boolean }): HTMLElement {
  const row = (swatch: Element, title: string, desc: string, cls = '') =>
    el('li', { class: `rm-legend-row${cls}` }, swatch, el('div', {}, el('strong', {}, title), desc ? el('span', { class: 'rm-legend-desc' }, `　${desc}`) : null));
  const items = legendFor(mode, kids, unknown);
  return el('ul', { class: kids ? 'rm-legend rm-legend-kids' : 'rm-legend', 'aria-label': kids ? 'ちずの みかた' : '凡例' },
    // 避難場所がいちばん大事なので、凡例の先頭に
    ...(shelters.tsunami ? [row(shelterSwatch('tsunami', kids), kids ? 'にげる ばしょ（たかい ところ・たかい たてもの）' : '津波の避難場所（高い所・建物の上の階）', kids ? '' : '揺れが収まったら、ここへ（番号は近い順）', ' rm-legend-shelter')] : []),
    ...(shelters.quake && !kids ? [row(shelterSwatch('quake'), '地震の避難場所', '津波のおそれがあるときは緑の印へ', ' rm-legend-shelter')] : []),
    ...items.map((l) => row(swatchSvg(l.fill, l.hatch, l.unknownHatch, kids ? 40 : 28, kids ? 30 : 20), l.title, l.desc)));
}

function arrowIcon(kids = false): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  const [w, h] = kids ? [56, 40] : [28, 20];
  s.setAttribute('width', String(w));
  s.setAttribute('height', String(h));
  s.setAttribute('viewBox', '0 0 56 40');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path d="M4 20 L40 20" stroke="#1B6E3C" stroke-width="8" stroke-linecap="round"></path><path d="M34 6 L54 20 L34 34 Z" fill="#1B6E3C"></path>';
  return s;
}

/** 「自宅はここ」の小さな図（両方は 2×2、揺れは 大・中・低、津波は あり・なし）と点。 */
function quadFigure(q: HomeQuadrant, mode: RiskMode): HTMLElement {
  const legend = legendFor(mode, false, true);
  const cell = (key: string) => {
    const l = legend.find((x) => x.key === key)!;
    const on = q.key === key;
    return el('div', { class: `rm-quad-cell${on ? ' rm-quad-on' : ''}` }, swatchSvg(l.fill, l.hatch, l.unknownHatch, 44, 36),
      on ? el('span', { class: 'rm-quad-dot' }) : null);
  };
  if (mode === 'both') {
    return el('div', { class: 'rm-quad rm-quad-2x2', role: 'img', 'aria-label': q.aria },
      cell('tsunami'), cell('both'), cell('low'), cell('collapse'),
      el('div', { class: 'rm-quad-axis' }, el('span', {}, '倒壊 小'), el('span', {}, '大')));
  }
  const keys = mode === 'shake' ? ['high', 'mid', 'low'] : ['tsunami', 'none'];
  const names: Record<string, string> = { high: '大', mid: '中', low: '低', tsunami: 'あり', none: 'なし' };
  return el('div', { class: 'rm-quad rm-quad-col', role: 'img', 'aria-label': q.aria },
    ...keys.map((k) => el('div', { class: 'rm-quad-line' }, cell(k), el('span', { class: 'rm-quad-name' }, names[k]))));
}

export function adultRiskPanel(i: RiskPanelInput): RiskPanel {
  let meshes = i.meshes;
  let homeRate = i.homeRate;
  let mode = chosenMode;
  const escape = i.outside ? null : escapeTarget(i.home, i.tsunamiShelters, i.homeKind);
  const shelters = { tsunami: i.tsunamiShelters.length > 0, quake: i.quakeShelters.length > 0 };
  const buttons = RISK_MODES.map((m) => el('button', { type: 'button', class: 'rm-mode', id: `risk-mode-${m}`, 'aria-pressed': 'false' }, RISK_MODE_LABELS[m]));
  const toggle = el('div', { class: 'rm-modes', role: 'group', 'aria-label': '地図の表示' }, ...buttons);
  const mapNode = el('div', { id: 'result-map', class: 'map risk-map', role: 'region' });
  const legendSlot = el('div', { id: 'risk-legend' });
  const escapeSlot = el('div', { id: 'risk-escape' });
  const homeSlot = el('div', { id: 'risk-home' });
  const tsunamiLegendSlot = el('div', {});
  const notes = el('ul', { class: 'rm-notes' },
    el('li', {}, '倒壊「大きい」＝全壊率の推計が10%以上のマス（揺れの「中」は1%以上）'),
    el('li', {}, '津波＝浸水の想定があるマス（波の模様。色が分かりにくくても見分けられます）'),
    el('li', {}, 'マスの色はマスの中心の想定、自宅の判定は自宅の地点の想定です'),
    el('li', { class: 'rm-not-safe' }, '灰色も安全という意味ではありません。想定を超える揺れや津波もあり得ます'));
  // 半割れ・時間差のタブでは、津波のマスも最大クラスの想定であることを書く
  const scenarioNote = el('p', { class: 'note rm-scenario-note', id: 'risk-scenario-note', hidden: true }, '津波のマス（波の模様）と矢印は、どのタブでも最大クラスの想定です（自宅の結果の津波の注記と同じ）');
  const node = el('div', { class: 'risk-panel', id: 'risk-panel' },
    el('h3', { class: 'rm-title' }, '周辺1kmの危険マップ'),
    el('p', { class: 'hint' }, '250mマスごとの推計。緑の大きな印が津波の避難場所（高い所）です。'),
    toggle, scenarioNote, el('div', { class: 'rm-map-card' }, mapNode, legendSlot, escapeSlot), homeSlot, notes, tsunamiLegendSlot, tsunamiCaption());
  let handle: RiskMapHandle | null = null;

  const draw = (): void => {
    buttons.forEach((b, k) => {
      const on = RISK_MODES[k] === mode;
      b.setAttribute('aria-pressed', String(on));
    });
    const q = homeQuadrant(homeRate, i.homeKind, mode, i.outside);
    mapNode.setAttribute('aria-label', mapAlt(mode, q, escape));
    legendSlot.replaceChildren(legendList(mode, false, hasUnknown(meshes, mode), shelters));
    const showArrowText = mode !== 'shake';
    const noArrow = i.outside ? null : noArrowText(i.homeKind, shelters.tsunami);
    escapeSlot.replaceChildren(...(!showArrowText ? []
      : escape ? [el('p', { class: 'rm-escape', id: 'risk-escape-text' }, arrowIcon(), el('span', {}, el('strong', {}, escape.head), escape.rest))]
      : noArrow ? [el('p', { class: 'rm-escape rm-escape-none', id: 'risk-escape-text' }, el('span', {}, noArrow))] : []));
    const t = tone(q.key);
    homeSlot.replaceChildren(el('div', { class: 'rm-home', style: `border-color:${t.border}` },
      ...(q.key === 'outside' ? [] : [quadFigure(q, mode)]),
      el('div', { class: 'rm-home-text' },
        el('p', { class: 'rm-home-k' }, '自宅はここ'),
        el('p', { class: 'rm-home-title', style: `color:${t.title}` }, q.title),
        el('p', { class: 'rm-home-action' }, q.action),
        ...(q.key === 'outside' ? [] : [el('p', { class: 'rm-home-note' }, '入力した家の推計です。マスの色は地域の平均です')]))));
    // 浸水深の段階（8色）は、地理院の津波タイルを重ねる「津波」のときだけ
    tsunamiLegendSlot.replaceChildren(...(mode === 'tsunami' ? [tsunamiLegendElement()] : []));
  };
  buttons.forEach((b, k) => b.addEventListener('click', () => {
    if (RISK_MODES[k] === mode) return;
    mode = RISK_MODES[k];
    chosenMode = mode;
    handle?.setMode(mode);
    draw();
  }));
  draw();
  return {
    node,
    mount() {
      handle = createRiskMap(mapNode, { slot: 'result', home: i.home, meshes, tsunamiShelters: i.tsunamiShelters, quakeShelters: i.quakeShelters, escape, mode });
    },
    setMeshRates(list) { meshes = list; handle?.setMeshRates(list); draw(); },
    setHome(rate, l2) { homeRate = rate; scenarioNote.hidden = l2; draw(); },
    highlightShelter(index) { handle?.highlightShelter(index); },
    refresh() { handle?.refresh(); },
    remove() { handle?.remove(); handle = null; },
  };
}


/** こどもモードの地図（両方モードだけ）。文字はひらがな。あかは「にげる」の枠だけ。 */
export function kidsRiskPanel(i: RiskPanelInput): RiskPanel {
  const escape = i.outside ? null : escapeTarget(i.home, i.tsunamiShelters, i.homeKind);
  const mapNode = el('div', { id: 'kid-risk-map', class: 'map risk-map kid-risk-map', role: 'region' });
  const q = homeQuadrant(i.homeRate, i.homeKind, 'both', i.outside);
  mapNode.setAttribute('aria-label', mapAlt('both', q, escape, true));
  const go = escape
    ? el('div', { class: 'rm-kid-go', id: 'kid-risk-go' }, arrowIcon(true),
      el('div', {}, el('p', { class: 'rm-kid-go-small' }, KIDS_MAP_TEXT.goSmall), el('p', { class: 'rm-kid-go-big' }, KIDS_MAP_TEXT.goBig), el('p', { class: 'rm-kid-go-dir' }, `（${escape.kidsText}）`)))
    : i.tsunamiShelters.length > 0
      ? el('div', { class: 'rm-kid-go rm-kid-go-soft', id: 'kid-risk-go' }, shelterSwatch('tsunami', true),
        el('div', {}, el('p', { class: 'rm-kid-go-small' }, KIDS_MAP_TEXT.noArrowSmall), el('p', { class: 'rm-kid-go-big' }, KIDS_MAP_TEXT.noArrowBig)))
      : null;
  const node = el('section', { class: 'kid-card kid-risk', id: 'kid-risk' },
    el('h2', {}, KIDS_MAP_TEXT.title[0], el('br', {}), KIDS_MAP_TEXT.title[1]),
    el('div', { class: 'rm-kid-map-card' }, mapNode),
    legendList('both', true, hasUnknown(i.meshes, 'both'), { tsunami: i.tsunamiShelters.length > 0, quake: false }),
    go,
    el('p', { class: 'rm-kid-foot' }, KIDS_MAP_TEXT.foot[0], el('br', {}), KIDS_MAP_TEXT.foot[1]));
  let handle: RiskMapHandle | null = null;
  return {
    node,
    mount() {
      handle = createRiskMap(mapNode, { slot: 'kids', home: i.home, meshes: i.meshes, tsunamiShelters: i.tsunamiShelters, quakeShelters: [], escape, mode: 'both', kids: true });
    },
    setMeshRates(list) { handle?.setMeshRates(list); },
    setHome() { /* こどもは作り直す */ },
    highlightShelter() { /* こどもは経路の選択なし */ },
    refresh() { handle?.refresh(); },
    remove() { handle?.remove(); handle = null; },
  };
}
