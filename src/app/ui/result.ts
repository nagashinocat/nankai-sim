import type { LatLon, Shelter } from '../../core/types.ts';
import { homeTsunamiLines, type AreaVM, type EvacVM, type TsunamiVM } from '../viewmodel.ts';
import { SCENARIOS, SCENARIO_EXPLAIN, SCENARIO_LABELS, type Scenario, type ScenarioHome, type ScenarioResult } from '../scenario.ts';
import {
  CASE_NAME, HAZARD_PORTAL, NO_SCENARIO_DATA, OUTSIDE_DETAIL, OUTSIDE_TITLE, SCENARIO_RETRY,
  TSUNAMI_SCENARIO_NOTE, buildShareText,
} from '../text.ts';
import { DISCLAIMER, el } from './dom.ts';
import { shelterListNodes, tsunamiNotice } from './shelters.ts';
import { createResultMap, legendElement, tsunamiCaption, tsunamiLegendElement, type MeshRate } from './map.ts';
import { renderActions, updateShare } from './actions.ts';
import { damageNodes } from './stages.ts';
import { headingIcon, summaryCard, tsunamiPicture } from './visuals.ts';
import { PRACTICE_ENTRY } from '../practice/scenes.ts';
import { FAMILY_LINK_RESULT } from './family.ts';
import { playerLauncher, type Launcher } from './player.ts';
import { KIDS_TAB_LABELS } from '../kids.ts';
import { kidsIntro, kidsResultNodes } from './kids.ts';

export type ResultData = {
  pos: LatLon;
  municipality: string | null;
  /** 最初に表示する結果（最大クラス） */
  result: ScenarioResult;
  evac: EvacVM[];
  /** evac[i].items と同じ順の避難場所 */
  evacShelters: Shelter[][];
  /** 「〜付近で計算しました」。画面に出すだけ（保存・共有しない）。 */
  locationNote: string;
  /** 自宅の場所の津波（どのタブでも同じ。自宅の結果が無いタブにも出す） */
  tsunami: TsunamiVM;
  /** こどもモードで出す（表示だけ。計算・保存は同じ） */
  kids?: boolean;
};

export type ResultHooks = {
  /** タブが選ばれた（キーボード操作も含む）。結果は handle.showLoading / showResult で渡す */
  onSelect(scenario: Scenario): void;
  /** 「もう一度読み込む」。そのタブだけ再試行する */
  onRetry(scenario: Scenario): void;
  /** タブの結果を画面に出した（保存などに使う） */
  onShown(result: ScenarioResult): void;
  /** こどもモードの「おとなの がめんで ちずを みる」 */
  onAdult?(): void;
};

export type ResultHandle = {
  showLoading(scenario: Scenario): void;
  showResult(result: ScenarioResult): void;
  /** こども / おとな を切り替える（計算しなおさない。開いていた再生は、切り替えた画面で開きなおす） */
  setKids(kids: boolean): void;
};

export function renderResult(root: HTMLElement, d: ResultData, hooks: ResultHooks): ResultHandle {
  root.replaceChildren();
  let selected: Scenario = d.result.scenario;
  let kids = !!d.kids;

  // ---- タブ（role=tablist。矢印キー・Home・End で移動。選ぶと同時に切り替わる）----
  const tabs = SCENARIOS.map((sc) => el('button', {
    type: 'button', role: 'tab', id: `tab-${sc}`, class: 'tab', 'aria-controls': 'scenario-panel',
    'aria-selected': 'false', tabindex: '-1',
  }, (kids ? KIDS_TAB_LABELS : SCENARIO_LABELS)[sc]));
  const tablist = el('div', { role: 'tablist', class: 'tabs', 'aria-label': '想定するケース' }, ...tabs);
  const labelTabs = (): void => {
    tabs.forEach((t, i) => { t.textContent = (kids ? KIDS_TAB_LABELS : SCENARIO_LABELS)[SCENARIOS[i]]; });
    tablist.setAttribute('aria-label', kids ? 'どんな じしん？' : '想定するケース');
  };
  const choose = (sc: Scenario, focus: boolean): void => {
    if (sc === selected) { if (focus) tabs[SCENARIOS.indexOf(sc)].focus(); return; }
    selected = sc;
    syncTabs();
    if (focus) tabs[SCENARIOS.indexOf(sc)].focus();
    hooks.onSelect(sc);
  };
  const syncTabs = (): void => {
    tabs.forEach((t, i) => {
      const on = SCENARIOS[i] === selected;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `tab-${selected}`);
    caseName.textContent = selected === 'L2' ? CASE_NAME : SCENARIO_LABELS[selected];
  };
  tabs.forEach((t, i) => t.addEventListener('click', () => choose(SCENARIOS[i], false)));
  tablist.addEventListener('keydown', (e) => {
    const cur = SCENARIOS.indexOf(selected);
    const next = e.key === 'ArrowRight' ? (cur + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (cur + tabs.length - 1) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(SCENARIOS[next], true);
  });

  // ---- タブの中身（説明・自宅・周辺・地図）。地図は作り直さず、色だけ差し替える ----
  const explain = el('p', { class: 'note scenario-explain' });
  const noticeSlot = el('div', {});
  const homeSection = el('section', { class: 'card', id: 'home-result' });
  const areaText = el('div', {});
  const areaSection = el('section', { class: 'card' }, el('h2', {}, headingIcon('🗺️'), '周辺1km（推計）'), areaText);
  const mapNode = el('div', { id: 'result-map', class: 'map' });
  areaSection.append(el('p', { class: 'hint' }, '地図の色は、250mマスごとの全壊率の推計です。'), mapNode, legendElement(), tsunamiLegendElement(), tsunamiCaption());
  // 「ひと目でわかる」はタブの説明・注意の下（タブを替えると作り直す）
  const summarySlot = el('div', {});
  const adultPanel = el('div', { id: 'adult-panel' }, explain, noticeSlot, summarySlot, homeSection, areaSection);
  const kidsView = el('div', { id: 'kids-result', class: 'kids-result' });
  const panel = el('div', { role: 'tabpanel', id: 'scenario-panel', class: 'tabpanel', tabindex: '0' }, adultPanel, kidsView);

  // 対応範囲外（隣県など）では避難場所を出さない。5県のデータだけの一覧は、その場所の避難場所が欠けて向きを誤らせる（Ruling F1）。
  // 範囲外かどうかは場所で決まり、タブでは変わらない。
  const outside = d.result.home.status === 'outside';
  const evacSection = outside ? null : el('section', { class: 'card', id: 'evac' }, el('h2', {}, headingIcon('🏃'), '避難できる場所'), ...shelterListNodes(d.evac));
  const mapShelters = outside ? [] : d.evacShelters[0] ?? [];

  const shareOf = (r: ScenarioResult): string | null => {
    const h = r.home;
    if (h.status !== 'ok') return null;
    return buildShareText(d.municipality, h.collapse, h.half, r.scenario === 'L2' ? undefined : { label: SCENARIO_LABELS[r.scenario], lagTotal: h.stages !== undefined });
  };
  const actions = renderActions({
    shelters: mapShelters,
    municipality: d.municipality,
    shareText: shareOf(d.result),
    onSelectShelter: (i) => handle.highlightShelter(i),
  });

  const caseName = el('strong', {}, CASE_NAME);
  const intro = kidsIntro();
  const adultTop = [
    el('section', { class: 'card disclaimer', id: 'result-disclaimer' }, el('strong', {}, DISCLAIMER)),
    el('p', { class: 'case', id: 'case-line' }, '想定ケース：', caseName, d.municipality ? `　／　${d.municipality}` : null),
    el('p', { class: 'case', id: 'location-note' }, d.locationNote),
  ];
  const adultBottom = [
    ...(evacSection ? [evacSection] : []),
    el('a', { href: '#family', class: 'btn-link', id: 'family-entry' }, FAMILY_LINK_RESULT), actions,
    el('a', { href: '#practice', class: 'btn-link', id: 'practice-entry' }, PRACTICE_ENTRY),
  ];
  root.append(...adultTop, intro, tablist, panel, ...adultBottom);
  const handle = createResultMap(mapNode, d.pos, d.result.meshRates, mapShelters);
  handle.highlightShelter(0);
  handle.map.invalidateSize();

  // 「▶ 地震から津波までを再生」。タブを替えたら止めて作り直す（そのタブの値で再生する）
  let launcher: Launcher | null = null;
  let kidLauncher: Launcher | null = null;
  let cur: { sc: Scenario; h: ScenarioHome | 'loading' } = { sc: selected, h: d.result.home };
  const drawKids = (sc: Scenario, h: ScenarioHome | 'loading'): void => {
    kidLauncher?.destroy();
    kidLauncher = !kids || h === 'loading' || h.status === 'outside' ? null
      : playerLauncher(() => ({ scenario: sc, home: h, tsunami: d.tsunami, evac: d.evac }), { kids: true });
    kidsView.replaceChildren(...(kids ? kidsResultNodes({ home: h, scenario: sc, tsunami: d.tsunami, player: kidLauncher?.node ?? null, onAdult: () => hooks.onAdult?.(), onRetry: () => hooks.onRetry(sc) }) : []));
  };
  const showMode = (): void => {
    for (const n of [...adultTop, ...adultBottom, adultPanel]) n.hidden = kids;
    intro.hidden = !kids;
    kidsView.hidden = !kids;
    labelTabs();
  };
  const setHome = (sc: Scenario, h: ScenarioHome | 'loading'): void => {
    cur = { sc, h };
    drawKids(sc, h);
    launcher?.destroy();
    launcher = h === 'loading' || h.status === 'outside' ? null
      : playerLauncher(() => ({ scenario: sc, home: h, tsunami: d.tsunami, evac: d.evac }));
    explain.textContent = SCENARIO_EXPLAIN[sc] ?? '';
    explain.hidden = !SCENARIO_EXPLAIN[sc];
    // 津波の行は、自宅の計算結果が無いタブ（データなし・読み込み失敗・読み込み中）にも出す。注意文は範囲外か津波が判定できないときだけ。
    noticeSlot.replaceChildren(...((h !== 'loading' && h.status === 'outside') || d.tsunami.kind === 'unknown' ? [tsunamiNotice()] : []));
    // 対応範囲外では出さない（揺れも津波の行も出さないので、まとめも出さない）
    summarySlot.replaceChildren(...(h !== 'loading' && h.status === 'outside' ? [] : [summaryCard(h, d.tsunami)]), ...(launcher ? [launcher.node] : []));
    homeSection.replaceChildren(el('h2', {}, headingIcon('🏠'), '自宅の結果'), ...homeNodes(h, sc, d.tsunami, () => hooks.onRetry(sc)));
    panel.setAttribute('aria-busy', String(h === 'loading'));
  };
  const setArea = (a: AreaVM | 'loading' | 'error' | 'nodata'): void => {
    areaText.replaceChildren(areaNode(a));
  };
  const greyed = (): MeshRate[] => d.result.meshRates.map((m) => ({ mesh: m.mesh, rate: null }));

  setHome(selected, d.result.home);
  setArea(d.result.area);
  syncTabs();
  showMode();
  root.scrollIntoView({ behavior: 'auto', block: 'start' });
  hooks.onShown(d.result);

  return {
    showLoading(sc) {
      selected = sc;
      syncTabs();
      setHome(sc, 'loading');
      setArea('loading');
      handle.setMeshRates(greyed());
    },
    showResult(r) {
      selected = r.scenario;
      syncTabs();
      setHome(r.scenario, r.home);
      // 想定のデータが無いタブで周辺が出せないのは、建物データのせいではない（最大クラスでは出せているとき）
      const noScenarioData = r.scenario !== 'L2' && r.area.status === 'nostock' && d.result.area.status !== 'nostock';
      setArea(r.home.status === 'error' ? 'error' : noScenarioData ? 'nodata' : r.area);
      handle.setMeshRates(r.meshRates);
      updateShare(actions, shareOf(r));
      hooks.onShown(r);
    },
    setKids(on) {
      if (on === kids) return;
      const wasOpen = (kids ? kidLauncher : launcher)?.isOpen() ?? false;
      kids = on;
      setHome(cur.sc, cur.h);
      showMode();
      if (!kids) handle.map.invalidateSize();
      if (wasOpen) (kids ? kidLauncher : launcher)?.open();
    },
  };
}

const portalLink = () => el('a', { href: HAZARD_PORTAL.url, target: '_blank', rel: 'noopener noreferrer', class: 'btn-link' }, HAZARD_PORTAL.label);

/**
 * 自宅の津波の行・深さの絵と、最大クラス以外の注記（範囲外以外のどの状態でも出す。津波は場所で決まる）。
 * 絵は場所の津波（tsunami。段階の代表値を持つ）から。
 */
function tsunamiNodes(t: TsunamiVM, sc: Scenario, place: TsunamiVM = t): Node[] {
  const lines = homeTsunamiLines(t);
  const pic = tsunamiPicture(place);
  return [
    ...(lines.length ? [el('h3', { class: 'tsunami-heading' }, headingIcon('🌊'), '津波')] : []),
    ...lines.map((l) => el('p', { class: l.cls }, l.text)),
    ...(sc !== 'L2' ? [el('p', { class: 'note tsunami-scenario-note' }, TSUNAMI_SCENARIO_NOTE)] : []),
    // 絵はそのタブの津波の文の全部（注意・到達の注記・「揺れが収まったらすぐ高い所へ」・タブの注記）の後
    ...(pic ? [pic] : []),
  ];
}

function homeNodes(h: ScenarioHome | 'loading', sc: Scenario, tsunami: TsunamiVM, onRetry: () => void): Node[] {
  if (h === 'loading') return [el('p', { class: 'status', role: 'status', 'aria-live': 'polite' }, '読み込んでいます…'), ...tsunamiNodes(tsunami, sc)];
  if (h.status === 'outside') return [el('p', { class: 'strong' }, OUTSIDE_TITLE), el('p', {}, OUTSIDE_DETAIL), portalLink()];
  if (h.status === 'nodata') {
    // 最大クラス（L2）は場所のデータが無いこと、ほかのタブはその想定のデータが無いこと
    return sc === 'L2'
      ? [el('p', { class: 'strong' }, 'この場所のデータなし'), el('p', {}, '想定のデータがない場所のため、推測では埋めていません。市町村のハザードマップなどで確認してください。'), portalLink(), ...tsunamiNodes(tsunami, sc)]
      : [el('p', { class: 'strong' }, NO_SCENARIO_DATA), el('p', {}, 'この場所は、この想定のデータがないため、推測では埋めていません。ほかのタブや、市町村のハザードマップなどで確認してください。'), portalLink(), ...tsunamiNodes(tsunami, sc)];
  }
  if (h.status === 'error') {
    const retry = el('button', { type: 'button', class: 'secondary' }, SCENARIO_RETRY);
    retry.addEventListener('click', onRetry);
    return [el('p', { class: 'strong' }, 'この想定のデータを読み込めませんでした'), el('p', {}, '通信状況を確認して、もう一度お試しください。ほかのタブは使えます。'), retry, ...tsunamiNodes(tsunami, sc)];
  }
  return [
    ...damageNodes(h),
    ...(h.liquefaction ? [el('p', {}, h.liquefaction)] : []),
    ...tsunamiNodes(h.tsunami, sc, tsunami),
    ...h.notes.map((n) => el('p', { class: 'note' }, n)),
  ];
}

function areaNode(a: AreaVM | 'loading' | 'error' | 'nodata'): HTMLElement {
  if (a === 'nodata') return el('p', {}, NO_SCENARIO_DATA);
  if (a === 'loading') return el('p', { class: 'status' }, '読み込んでいます…');
  if (a === 'error') return el('p', {}, 'この想定のデータを読み込めなかったため、周辺の棟数は推計できません');
  if (a.status === 'ok') return el('p', {}, `全壊 約${a.collapse.toLocaleString()}棟、半壊 約${a.half.toLocaleString()}棟（推計。建物と想定のデータがある${a.meshes}マスの合計）`);
  if (a.status === 'unavailable') return el('p', {}, '建物データに問題があるため、周辺の棟数は推計できませんでした');
  return el('p', {}, '建物データなし（周辺の棟数は推計できません）');
}
