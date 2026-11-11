import type { LatLon, Shelter } from '../../core/types.ts';
import type { AreaVM, EvacVM, HomeVM } from '../viewmodel.ts';
import { CASE_NAME, HAZARD_PORTAL, OUTSIDE_DETAIL, OUTSIDE_TITLE } from '../text.ts';
import { DISCLAIMER, clear, el } from './dom.ts';
import { shelterListNodes, tsunamiNotice } from './shelters.ts';
import { createResultMap, legendElement, type MeshRate } from './map.ts';
import { renderActions } from './actions.ts';

export type ResultData = {
  pos: LatLon;
  municipality: string | null;
  home: HomeVM;
  area: AreaVM;
  meshRates: MeshRate[];
  evac: EvacVM[];
  /** evac[i].items と同じ順の避難場所 */
  evacShelters: Shelter[][];
  shareText: string | null;
  /** 「〜付近で計算しました」。画面に出すだけ（保存・共有しない）。 */
  locationNote: string;
};

const portalLink = () => el('a', { href: HAZARD_PORTAL.url, target: '_blank', rel: 'noopener noreferrer', class: 'btn-link' }, HAZARD_PORTAL.label);

export function renderResult(root: HTMLElement, d: ResultData): void {
  clear(root);
  const homeSection = el('section', { class: 'card', id: 'home-result' }, el('h2', {}, '自宅の結果'));
  const h = d.home;
  if (h.status === 'outside') {
    homeSection.append(el('p', { class: 'strong' }, OUTSIDE_TITLE), el('p', {}, OUTSIDE_DETAIL), portalLink());
  } else if (h.status === 'nodata') {
    homeSection.append(el('p', { class: 'strong' }, 'この場所のデータなし'), el('p', {}, '想定のデータがない場所のため、推測では埋めていません。市町のハザードマップなどで確認してください。'), portalLink());
  } else {
    homeSection.append(
      el('p', { class: 'big' }, '想定される揺れ：', el('strong', {}, h.intensityLabel)),
      row('全壊', h.collapse),
      row('半壊', h.half),
      ...(h.liquefaction ? [el('p', {}, h.liquefaction)] : []),
      ...h.notes.map((n) => el('p', { class: 'note' }, n)),
    );
  }

  const areaSection = el('section', { class: 'card' }, el('h2', {}, '周辺1km（推計）'));
  if (d.area.status === 'ok') {
    areaSection.append(el('p', {}, `全壊 約${d.area.collapse.toLocaleString()}棟、半壊 約${d.area.half.toLocaleString()}棟（推計。建物と想定のデータがある${d.area.meshes}マスの合計）`));
  } else if (d.area.status === 'unavailable') areaSection.append(el('p', {}, '建物データに問題があるため、周辺の棟数は推計できませんでした'));
  else areaSection.append(el('p', {}, '建物データなし（周辺の棟数は推計できません）'));
  const mapNode = el('div', { id: 'result-map', class: 'map' });
  areaSection.append(el('p', { class: 'hint' }, '地図の色は、250mマスごとの全壊率の推計です。'), mapNode, legendElement());

  const evacSection = el('section', { class: 'card', id: 'evac' }, el('h2', {}, '避難できる場所'), ...shelterListNodes(d.evac));
  const mapShelters = d.evacShelters[0] ?? [];

  const actions = renderActions({
    shelters: mapShelters,
    municipality: d.municipality,
    shareText: d.shareText,
    onSelectShelter: (i) => handle.highlightShelter(i),
  });

  root.append(
    el('section', { class: 'card disclaimer', id: 'result-disclaimer' }, el('strong', {}, DISCLAIMER)),
    el('p', { class: 'case' }, '想定ケース：', el('strong', {}, CASE_NAME), d.municipality ? `　／　${d.municipality}` : null),
    el('p', { class: 'case', id: 'location-note' }, d.locationNote),
    tsunamiNotice(),
    homeSection, areaSection, evacSection, actions,
  );
  const handle = createResultMap(mapNode, d.pos, d.meshRates, mapShelters);
  handle.highlightShelter(0);
  handle.map.invalidateSize();
  root.scrollIntoView({ behavior: 'auto', block: 'start' });
}

function row(label: string, r: { min: string; max: string; central: string }): HTMLElement {
  return el('p', { class: 'big' }, `${label}（代表値）：`, el('strong', {}, r.central), el('br'), `幅 ${r.min}〜${r.max}`);
}
