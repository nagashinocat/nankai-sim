import { DETOUR_FACTOR, WALK_SPEED } from '../../core/evacuation.ts';
import { REACH_TEXT, SHELTER_NOTICES, homeTsunamiLines, reachHintText, type TsunamiVM } from '../viewmodel.ts';
import { TSUNAMI_NOTICE } from '../text.ts';
import { el } from './dom.ts';

export type ShelterListLike = {
  hazard: 'earthquake' | 'tsunami';
  items: { name: string; distance: string; walkStandard: string; walkSlow: string; reachText?: string }[];
  arrivalCm?: number | null;
};

export const SHELTER_HEADING = { earthquake: '地震の避難場所（近い順）', tsunami: '津波の避難場所（近い順）' } as const;
const REACH_MARK: Record<string, string> = { [REACH_TEXT.ok]: '○', [REACH_TEXT.tight]: '△', [REACH_TEXT.no]: '×' };

/** 地震・津波の避難場所リストと、必ず出す注意（結果画面と前回の結果で共通）。 */
export function shelterListNodes(lists: ShelterListLike[]): Node[] {
  const out: Node[] = [];
  for (const e of lists) {
    out.push(el('h3', {}, SHELTER_HEADING[e.hazard]));
    if (e.hazard === 'earthquake') out.push(el('p', { class: 'hint' }, '津波のおそれがあるときは、下の「津波の避難場所」へ逃げてください。'));
    if (e.items.length === 0) out.push(el('p', {}, '近くに該当する避難場所のデータがありません。'));
    else
      out.push(el('ol', { class: 'shelters' }, ...e.items.map((it) => el('li', {},
        el('strong', {}, it.name), el('br'),
        `直線距離 ${it.distance}　徒歩の目安 標準${it.walkStandard}／ゆっくり${it.walkSlow}`,
        it.reachText ? [el('br'), el('span', { class: 'reach' }, `${REACH_MARK[it.reachText] ?? ''} ${it.reachText}`.trim())] : null))));
    if (e.hazard === 'tsunami' && e.items.some((it) => it.reachText && it.reachText !== REACH_TEXT['n/a']))
      out.push(el('p', { class: 'hint' }, reachHintText(e.arrivalCm)));
  }
  out.push(
    el('p', { class: 'hint' }, `徒歩時間は直線距離からの目安です（直線距離×${DETOUR_FACTOR}を道のりとし、標準${WALK_SPEED.standard.toFixed(1)}m/s・ゆっくり${WALK_SPEED.slow.toFixed(1)}m/sで計算）。`),
    el('ul', { class: 'notices' }, ...SHELTER_NOTICES.map((n) => el('li', {}, n))),
    el('p', { class: 'hint' }, '出典: 国土地理院 指定緊急避難場所データ（最終更新 2026-11-06）'),
  );
  return out;
}

/** 津波の注意（結果・前回の結果の上の方に必ず出す。裁定 F2）。 */
export function tsunamiNotice(): HTMLElement {
  return el('section', { class: 'card disclaimer tsunami-notice', role: 'note' }, el('strong', {}, TSUNAMI_NOTICE));
}

/** 自宅の津波の行（結果・前回の結果で共通）。文言は viewmodel の homeTsunamiLines。 */
export function homeTsunamiNodes(t: TsunamiVM): HTMLElement[] {
  return homeTsunamiLines(t).map((l) => el('p', { class: l.cls }, l.text));
}
