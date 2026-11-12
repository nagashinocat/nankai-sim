import { PRACTICE_NOTICE, PRACTICE_SOURCES, PRACTICE_TITLE, SCENES, summaryLines, type PracticeHome } from '../practice/scenes.ts';
import { el } from './dom.ts';
import { FAMILY_LINK_PRACTICE } from './family.ts';

export type PracticeOpts = { home: PracticeHome | null; onExit: () => void };

/** 進み具合は画面内だけ（保存しない）。answers[i] = 場面iで選んだ選択肢の番号。 */
export function renderPractice(root: HTMLElement, opts: PracticeOpts): void {
  let answers: number[] = [];
  let index = 0;

  const draw = (justAnswered = false): void => {
    const total = SCENES.length;
    const done = index >= total;
    const head = el('h2', { tabindex: '-1', id: 'practice-heading' }, PRACTICE_TITLE);
    const notice = el('section', { class: 'card disclaimer practice-notice' }, el('strong', {}, PRACTICE_NOTICE));
    const exit = el('button', { type: 'button', class: 'secondary', id: 'practice-exit' }, '結果の画面にもどる');
    exit.addEventListener('click', opts.onExit);
    const nodes: Node[] = [head, notice];

    if (done) {
      const score = answers.filter((a, i) => SCENES[i].choices[a].best).length;
      const [first, ...rest] = summaryLines(score, opts.home);
      nodes.push(el('section', { class: 'card', id: 'practice-summary' }, el('h3', {}, 'まとめ'), el('p', { class: 'strong big' }, first), ...rest.map((l) => el('p', {}, l))));
      const sources = el('section', { class: 'card' }, el('h3', {}, '出典'),
        el('ul', {}, ...PRACTICE_SOURCES.map((s) => el('li', {}, el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.label)))));
      const back = el('button', { type: 'button', class: 'secondary' }, '前の場面にもどる');
      back.addEventListener('click', () => { index = total - 1; draw(); });
      const again = el('button', { type: 'button', class: 'primary', id: 'practice-restart' }, '最初からやり直す');
      again.addEventListener('click', restart);
      nodes.push(sources, back, again, exit);
    } else {
      const scene = SCENES[index];
      const chosen = answers[index];
      const answered = chosen !== undefined;
      const list = el('div', { class: 'choices', role: 'group', 'aria-labelledby': 'practice-question' });
      scene.choices.forEach((ch, i) => {
        const cls = ['choice', answered && ch.best ? 'best' : '', answered && i === chosen ? 'picked' : ''].filter(Boolean).join(' ');
        const b = el('button', { type: 'button', class: cls, ...(answered ? { 'aria-disabled': 'true' } : {}) },
          ch.text, answered && i === chosen ? el('span', { class: 'tag' }, '　（あなたの選択）') : null, answered && ch.best ? el('span', { class: 'tag' }, '　（最適）') : null);
        b.addEventListener('click', () => {
          if (answers[index] !== undefined) return;
          answers[index] = i;
          draw(true);
          (root.querySelector('#practice-feedback') as HTMLElement | null)?.focus();
        });
        list.append(b);
      });
      const card = el('section', { class: 'card', id: 'practice-scene' },
        el('p', { class: 'hint' }, `${index + 1} / ${total}`),
        el('h3', { tabindex: '-1' }, scene.day),
        scene.situation ? el('p', {}, scene.situation) : null,
        el('p', { class: 'strong', id: 'practice-question' }, scene.question),
        list);
      nodes.push(card);
      if (answered) {
        const ok = scene.choices[chosen].best;
        nodes.push(el('section', { class: 'card', id: 'practice-feedback', tabindex: '-1', role: 'status' },
          el('p', { class: 'strong' }, ok ? '最適な行動です' : '最適な行動ではありません'),
          el('p', {}, scene.explanation)));
        const next = el('button', { type: 'button', class: 'primary', id: 'practice-next' }, '次へ');
        next.addEventListener('click', () => { index += 1; draw(); });
        nodes.push(next);
      }
      if (index > 0) {
        const prev = el('button', { type: 'button', class: 'secondary' }, '前の場面にもどる');
        prev.addEventListener('click', () => { index -= 1; draw(); });
        nodes.push(prev);
      }
      const again = el('button', { type: 'button', class: 'secondary', id: 'practice-restart' }, '最初からやり直す');
      again.addEventListener('click', restart);
      nodes.push(again, exit);
    }
    nodes.push(el('a', { href: '#family', class: 'btn-link', id: 'family-entry-practice' }, FAMILY_LINK_PRACTICE));
    root.replaceChildren(...nodes);
    if (!justAnswered) { (done ? head : root.querySelector<HTMLElement>('#practice-scene h3') ?? head).focus({ preventScroll: true }); window.scrollTo(0, 0); }
  };
  const restart = (): void => { answers = []; index = 0; draw(); };
  draw();
}
