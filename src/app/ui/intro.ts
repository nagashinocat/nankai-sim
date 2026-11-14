// 1ページ目のサイト説明と「住所の扱い」。住所の扱いはパッと見て分かるように、いちばん上・大きく置く。
// 2回目から（前回の結果がある人）は1行に小さくする。
import { el } from './dom.ts';

export const INTRO_TEXT = {
  whatTitle: 'このサイトでできること',
  what: [
    '住所と家の建て方から、南海トラフ地震で家がどれくらい壊れやすいか・津波が来るかの目安を出します（静岡・愛知・岐阜・三重・和歌山）',
    '近くの避難場所と、逃げる方向を地図で確かめられます',
    '国の想定から計算した統計的な目安です。耐震診断ではありません',
  ],
  addrTitle: '🔒 住所の扱い',
  addr: [
    { mark: '✅', strong: '保存しません', text: '住所・現在地・ピンの位置は、このサイトにもスマホにも残りません（残るのは市町村名と結果の数字だけ）' },
    { mark: '✅', strong: '送りません', text: '運営者のサーバーはありません。家族への共有文にも住所は入りません' },
    { mark: '⚠️', strong: '国土地理院には送ります', text: '住所を地図上の位置に変えるため、国土地理院の住所検索へ送ります。地図の画像も、その場所のぶんを国土地理院から取ります' },
  ],
  more: 'くわしく',
  compact: '🔒 住所は保存しません（地図のため国土地理院へは送ります）',
  kids: 'おうちの ばしょは どこにも のこらないよ',
} as const;

/** compact: 前回の結果がある人向けの1行表示。kids: こどもモードの1行。 */
export function renderIntro(root: HTMLElement, opts: { compact: boolean; kids: boolean }): void {
  const more = (): HTMLElement => el('a', { href: '#privacy', class: 'intro-more' }, INTRO_TEXT.more);
  if (opts.kids) {
    root.replaceChildren(el('p', { class: 'intro-line', id: 'intro-addr-line' }, '🔒 ', INTRO_TEXT.kids));
    return;
  }
  if (opts.compact) {
    root.replaceChildren(el('p', { class: 'intro-line', id: 'intro-addr-line' }, INTRO_TEXT.compact, '　', more()));
    return;
  }
  root.replaceChildren(
    el('section', { class: 'card intro-addr', id: 'intro-addr' },
      el('h2', { id: 'intro-addr-h' }, INTRO_TEXT.addrTitle),
      el('ul', { class: 'intro-addr-list' }, ...INTRO_TEXT.addr.map((a) =>
        el('li', {}, el('span', { class: 'intro-mark', 'aria-hidden': 'true' }, a.mark), el('span', {}, el('strong', {}, a.strong), '：', a.text)))),
      el('p', {}, more())),
    el('section', { class: 'card intro-what' },
      el('h2', { id: 'intro-what-h' }, INTRO_TEXT.whatTitle),
      el('ul', {}, ...INTRO_TEXT.what.map((t) => el('li', {}, t)))),
  );
}
