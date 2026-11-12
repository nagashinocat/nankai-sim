import type { OkHomeVM, RangeVM } from '../viewmodel.ts';
import { el } from './dom.ts';
import { houseRow, intensityNodes, rangeBar } from './visuals.ts';

/** 全壊・半壊の1行（代表値と幅）。結果と前回の結果で共通。 */
export const rangeRow = (label: string, r: RangeVM): HTMLElement =>
  el('p', { class: 'big' }, `${label}（代表値）：`, el('strong', {}, r.central), el('br'), `幅 ${r.min}〜${r.max}`);

/** 全壊・半壊の1段階：「10軒あったら」の家の列、数値の行、それぞれの幅の横棒。 */
function stageNodes(collapse: RangeVM, half: RangeVM): Node[] {
  return [
    houseRow(collapse, half),
    rangeRow('全壊', collapse), rangeBar('全壊', collapse),
    rangeRow('半壊', half), rangeBar('半壊', half),
  ].filter((n): n is HTMLElement => n !== null);
}

/** 自宅の揺れの被害（震度の行、全壊・半壊。時間差は先発と合計の2段階）。結果と前回の結果で共通。 */
export function damageNodes(h: OkHomeVM): Node[] {
  const out: Node[] = [el('p', { class: 'big shindo-line' }, '想定される揺れ：', ...intensityNodes(h.intensityLabel))];
  if (h.stages) {
    for (const s of h.stages) out.push(el('div', { class: 'stage' }, el('h3', {}, s.label), ...stageNodes(s.collapse, s.half)));
  } else out.push(...stageNodes(h.collapse, h.half));
  return out;
}
