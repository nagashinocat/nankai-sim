import type { Saved } from '../storage.ts';
import { SCENARIO_EXPLAIN, SCENARIO_LABELS } from '../scenario.ts';
import { CASE_NAME, TSUNAMI_SCENARIO_NOTE } from '../text.ts';
import { clear, el } from './dom.ts';
import { homeTsunamiNodes, shelterListNodes, tsunamiNotice } from './shelters.ts';
import { damageNodes } from './stages.ts';

export function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 前回の結果。地図は出さない（座標を保存していない）。 */
export function renderLast(root: HTMLElement, s: Saved, opts: { online: boolean; onDelete(): void }): void {
  clear(root);
  const h = s.home;
  // 保存されるのは結果が出たとき（status 'ok'）だけ。
  const home = el('div', {}, el('h3', {}, '自宅'),
    ...damageNodes(h),
    ...(h.liquefaction ? [el('p', {}, h.liquefaction)] : []), ...homeTsunamiNodes(h.tsunami), ...(s.scenario !== 'L2' ? [el('p', { class: 'note tsunami-scenario-note' }, TSUNAMI_SCENARIO_NOTE)] : []), ...h.notes.map((n) => el('p', { class: 'note' }, n)));
  const area = el('div', {}, el('h3', {}, '周辺1km（推計）'),
    s.area.status === 'ok'
      ? el('p', {}, `全壊 約${s.area.collapse.toLocaleString()}棟、半壊 約${s.area.half.toLocaleString()}棟（推計）`)
      : el('p', {}, s.area.status === 'unavailable' ? '推計できませんでした' : '建物データなし'));
  const evac = el('div', { id: 'last-evac' }, el('h3', {}, '避難できる場所'), ...shelterListNodes(s.shelters));
  const del = el('button', { type: 'button', class: 'secondary' }, '前回の結果を削除');
  del.addEventListener('click', opts.onDelete);
  root.append(
    el('section', { class: 'card', id: 'last-result' },
      el('h2', {}, `前回の結果（${formatSavedAt(s.savedAt)}）`),
      opts.online ? null : el('p', { class: 'strong' }, '通信できないため、この端末に保存した前回の結果を表示しています。'),
      el('p', { class: 'case' }, '想定ケース：', el('strong', {}, s.scenario === 'L2' ? CASE_NAME : SCENARIO_LABELS[s.scenario]), s.municipality ? `　／　${s.municipality}` : null),
      ...(SCENARIO_EXPLAIN[s.scenario] ? [el('p', { class: 'note scenario-explain' }, SCENARIO_EXPLAIN[s.scenario])] : []),
      ...(h.tsunami.kind === 'unknown' ? [tsunamiNotice()] : []),
      home, area, evac,
      el('p', { class: 'hint' }, 'この結果は、この端末の中にだけ保存されています（住所と位置情報は保存していません）。'),
      del),
  );
}
