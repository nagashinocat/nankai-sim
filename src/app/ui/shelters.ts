import { DETOUR_FACTOR, WALK_SPEED } from '../../core/evacuation.ts';
import { SHELTER_NOTICES } from '../viewmodel.ts';
import { TSUNAMI_NOTICE } from '../text.ts';
import { el } from './dom.ts';

type Reach = 'ok' | 'tight' | 'no' | 'n/a';
export type ShelterListLike = {
  hazard: 'earthquake' | 'tsunami';
  items: { name: string; distance: string; walkStandard: string; walkSlow: string; reach?: Reach }[];
};

export const SHELTER_HEADING = { earthquake: '地震の避難場所（近い順）', tsunami: '津波の避難場所（近い順）' } as const;
const REACH_TEXT = { ok: '津波が来る前に着ける見込み', tight: '津波到達までぎりぎり', no: '津波到達に間に合わない可能性が高い', 'n/a': '' } as const;
const REACH_MARK = { ok: '○', tight: '△', no: '×', 'n/a': '' } as const;

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
        it.reach && it.reach !== 'n/a' ? [el('br'), `${REACH_MARK[it.reach]} ${REACH_TEXT[it.reach]}`] : null))));
    if (e.hazard === 'tsunami' && e.items.length > 0 && e.items.every((it) => !it.reach || it.reach === 'n/a'))
      out.push(el('p', { class: 'hint' }, '津波が来るまでに着けるかどうかは判定していません。'));
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
