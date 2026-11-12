import type { OkHomeVM, RangeVM } from '../viewmodel.ts';
import { el } from './dom.ts';

/** 全壊・半壊の1行（代表値と幅）。結果と前回の結果で共通。 */
export const rangeRow = (label: string, r: RangeVM): HTMLElement =>
  el('p', { class: 'big' }, `${label}（代表値）：`, el('strong', {}, r.central), el('br'), `幅 ${r.min}〜${r.max}`);

/** 自宅の揺れの被害（震度の行、全壊・半壊。時間差は先発と合計の2段階）。結果と前回の結果で共通。 */
export function damageNodes(h: OkHomeVM): Node[] {
  const out: Node[] = [el('p', { class: 'big' }, '想定される揺れ：', el('strong', {}, h.intensityLabel))];
  if (h.stages) {
    for (const s of h.stages) out.push(el('div', { class: 'stage' }, el('h3', {}, s.label), rangeRow('全壊', s.collapse), rangeRow('半壊', s.half)));
  } else out.push(rangeRow('全壊', h.collapse), rangeRow('半壊', h.half));
  return out;
}
