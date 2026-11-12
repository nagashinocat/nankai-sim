import {
  FAMILY_BACKUP_KEY, FAMILY_KEY, MAX_AREA, MAX_LINE, MAX_ROWS, emptyFamily, familyText, formatReviewed, isEmptyFamily, loadFamily, saveFamily, type FamilyMemo,
} from '../family.ts';
import { clear, el } from './dom.ts';

/** 近くの避難場所（名前と徒歩の目安だけ。座標は持たない） */
export type FamilyShelter = { name: string; walk: string };
export type FamilyShelters = { tsunami: FamilyShelter[]; quake: FamilyShelter[] };
export type FamilyOpts = { store: Storage | null; shelters: FamilyShelters | null; onExit: () => void };

export const FAMILY_NOTICE = 'このメモはこのスマホの中だけに保存されます。外には送りません。機種変更やブラウザの履歴削除で消えることがあります。';
export const FAMILY_LINK_RESULT = '家族の決まりをメモする';
export const FAMILY_LINK_PRACTICE = '家族の決まりを確認する';
export const FAMILY_ENTRY = '👪 家族の決まり（避難先・集合場所のメモ）';
const SAVE_DELAY = 400;

let pendingFlush: (() => void) | null = null;
/** 保存待ちがあれば今すぐ保存する（画面を離れるとき）。 */
export function flushFamily(): void { pendingFlush?.(); }

let listening = false;
/** 画面を離れる・隠れるときに保存待ちを保存する。一度だけ登録する。 */
function listenFlush(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('pagehide', flushFamily);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushFamily(); });
}

const today = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function renderFamily(root: HTMLElement, opts: FamilyOpts): void {
  flushFamily();
  listenFlush();
  let m: FamilyMemo = opts.store ? loadFamily(opts.store) : emptyFamily();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const status = el('p', { class: 'status family-status', role: 'status', 'aria-live': 'polite', id: 'family-status' },
    opts.store ? '入力すると、自動でこの端末に保存されます。' : 'この端末では保存できません（このページを閉じると消えます）。');

  const doSave = (): void => {
    if (timer) { clearTimeout(timer); timer = null; }
    pendingFlush = null;
    if (!opts.store) return;
    status.textContent = saveFamily(m, opts.store) ? '保存しました' : '保存できませんでした（端末の空きや設定を確認してください）';
  };
  const touch = (): void => {
    status.textContent = '保存しています…';
    if (timer) clearTimeout(timer);
    timer = setTimeout(doSave, SAVE_DELAY);
    pendingFlush = doSave;
  };

  type StrKey = 'tsunami' | 'quake' | 'meet1' | 'meet2' | 'contact' | 'relay' | 'items';
  const inputs = new Map<StrKey, HTMLInputElement | HTMLTextAreaElement>();
  const field = (key: StrKey, label: string, o: { area?: boolean; hint?: string; placeholder?: string } = {}): HTMLElement => {
    const id = `family-${key}`;
    const input = o.area
      ? el('textarea', { id, maxlength: MAX_AREA, rows: 4, placeholder: o.placeholder ?? '' })
      : el('input', { id, type: 'text', maxlength: MAX_LINE, placeholder: o.placeholder ?? '', autocomplete: 'off' });
    input.value = m[key];
    input.addEventListener('input', () => { m[key] = input.value; touch(); });
    inputs.set(key, input);
    return el('div', { class: 'field' }, el('label', { for: id }, label), o.hint ? el('p', { class: 'hint' }, o.hint) : null, input);
  };

  // 近くの避難場所から選ぶ（結果が出ているときだけ）
  const picker = (key: 'tsunami' | 'quake', list: FamilyShelter[] | undefined): HTMLElement | null => {
    if (!list || list.length === 0) return null;
    const box = el('div', { class: 'family-pick', id: `family-pick-${key}` },
      el('p', { class: 'hint' }, `近くの${key === 'tsunami' ? '津波' : '地震'}の避難場所から選ぶ（押すと上の欄に入ります）`));
    for (const s of list.slice(0, 5)) {
      const b = el('button', { type: 'button', class: 'secondary family-pick-btn' }, `${s.name}（徒歩${s.walk}）`);
      b.addEventListener('click', () => {
        m[key] = s.name.slice(0, MAX_LINE);
        inputs.get(key)!.value = m[key];
        touch();
      });
      box.append(b);
    }
    return box;
  };

  // 家族それぞれの予定
  const rowsBox = el('div', { id: 'family-rows' });
  const addRow = el('button', { type: 'button', class: 'secondary', id: 'family-add-row' }, '＋ 家族を追加');
  const drawRows = (): void => {
    rowsBox.replaceChildren(...m.rows.map((r, i) => {
      const who = el('input', { type: 'text', maxlength: MAX_LINE, placeholder: '名前・呼び名（例：たろう）', 'aria-label': `家族${i + 1}の名前・呼び名`, class: 'family-who', autocomplete: 'off' });
      const memo = el('input', { type: 'text', maxlength: MAX_LINE, placeholder: 'メモ（例：平日昼は〇〇小学校。お迎えは母）', 'aria-label': `家族${i + 1}のメモ`, class: 'family-memo', autocomplete: 'off' });
      who.value = r.who; memo.value = r.memo;
      who.addEventListener('input', () => { r.who = who.value; touch(); });
      memo.addEventListener('input', () => { r.memo = memo.value; touch(); });
      const del = el('button', { type: 'button', class: 'secondary family-row-del', 'aria-label': `家族${i + 1}の行を削除` }, '削除');
      del.addEventListener('click', () => { m.rows.splice(i, 1); drawRows(); touch(); addRow.focus(); });
      return el('div', { class: 'family-row' }, who, memo, del);
    }));
    addRow.disabled = m.rows.length >= MAX_ROWS;
    addRow.textContent = m.rows.length >= MAX_ROWS ? `家族は${MAX_ROWS}人まで` : '＋ 家族を追加';
  };
  addRow.addEventListener('click', () => {
    if (m.rows.length >= MAX_ROWS) return;
    m.rows.push({ who: '', memo: '' });
    drawRows(); touch();
    rowsBox.querySelector<HTMLInputElement>('.family-row:last-child .family-who')?.focus();
  });

  // 見直した日
  const date = el('input', { id: 'family-reviewed', type: 'date' });
  date.value = m.reviewed ?? '';
  date.addEventListener('input', () => { m.reviewed = date.value || null; touch(); });
  const todayBtn = el('button', { type: 'button', class: 'secondary', id: 'family-today' }, '今日にする');
  todayBtn.addEventListener('click', () => { m.reviewed = today(); date.value = m.reviewed; touch(); });

  // 文面コピー・印刷・消去
  const copyOut = el('div', { id: 'family-copy-out' });
  const copyBtn = el('button', { type: 'button', class: 'primary', id: 'family-copy' }, '文面をコピー');
  copyBtn.addEventListener('click', () => {
    const text = familyText(m);
    copyOut.replaceChildren();
    const fallback = (): void => {
      const ta = el('textarea', { id: 'family-copy-text', readonly: true, rows: 10, 'aria-label': 'コピー用の文面' });
      ta.value = text;
      copyOut.replaceChildren(el('p', { class: 'hint' }, 'コピーできませんでした。下の文面を選んでコピーしてください。'), ta);
      ta.focus(); ta.select();
    };
    try {
      if (!navigator.clipboard?.writeText) { fallback(); return; }
      navigator.clipboard.writeText(text).then(
        () => { copyOut.replaceChildren(el('p', { class: 'status', role: 'status' }, 'コピーしました')); },
        fallback,
      );
    } catch { fallback(); }
  });

  const printRoot = el('div', { id: 'family-print-view', hidden: true });
  const formRoot = el('div', { id: 'family-form' });
  const setPrinting = (on: boolean): void => {
    flushFamily();
    root.classList.toggle('family-printing', on);
    document.body.classList.toggle('family-printing', on);
    formRoot.hidden = on;
    printRoot.hidden = !on;
    if (on) {
      clear(printRoot);
      const back = el('button', { type: 'button', class: 'secondary no-print', id: 'family-print-back' }, '戻る');
      back.addEventListener('click', () => setPrinting(false));
      const again = el('button', { type: 'button', class: 'primary no-print', id: 'family-print-again' }, '印刷する');
      again.addEventListener('click', () => { try { window.print(); } catch { /* 印刷できない端末では画面の表示のまま */ } });
      const page = el('article', { class: 'family-page' }, el('h2', {}, '【わが家の災害時の決まり】'),
        isEmptyFamily(m) ? el('p', {}, '（まだ何も書かれていません）') : el('pre', { class: 'family-pre', id: 'family-print-text' }, familyText(m).split('\n').slice(1).join('\n').trim()));
      printRoot.append(page, el('p', { class: 'hint no-print' }, '印刷できないときは、画面を保存（スクリーンショット）してください。'), again, back);
      window.scrollTo(0, 0);
      try { window.print(); } catch { /* 印刷が止められていても表示は残る */ }
    }
  };
  const printBtn = el('button', { type: 'button', class: 'secondary', id: 'family-print' }, '印刷用に表示');
  printBtn.addEventListener('click', () => setPrinting(true));

  const confirmBox = el('div', { id: 'family-confirm', hidden: true, class: 'card disclaimer', role: 'alertdialog', 'aria-label': '消してよいかの確認' },
    el('p', { class: 'strong' }, 'このメモをすべて消します。元にもどせません。よろしいですか？'));
  const clearBtn = el('button', { type: 'button', class: 'secondary', id: 'family-clear' }, 'すべて消す');
  const yes = el('button', { type: 'button', class: 'primary', id: 'family-clear-yes' }, '消す');
  const no = el('button', { type: 'button', class: 'secondary', id: 'family-clear-no' }, 'やめる');
  confirmBox.append(yes, no);
  clearBtn.addEventListener('click', () => { confirmBox.hidden = false; clearBtn.hidden = true; no.focus(); });
  no.addEventListener('click', () => { confirmBox.hidden = true; clearBtn.hidden = false; clearBtn.focus(); });
  yes.addEventListener('click', () => {
    try { opts.store?.removeItem(FAMILY_KEY); opts.store?.removeItem(FAMILY_BACKUP_KEY); } catch {
      status.textContent = '消せませんでした';
      confirmBox.hidden = true; clearBtn.hidden = false;
      return;
    }
    if (timer) { clearTimeout(timer); timer = null; }
    pendingFlush = null;
    m = emptyFamily();
    renderFamily(root, opts);
    root.querySelector<HTMLElement>('#family-status')!.textContent = 'すべて消しました';
  });

  const exit = el('button', { type: 'button', class: 'secondary', id: 'family-exit' }, '入力画面にもどる');
  exit.addEventListener('click', () => { flushFamily(); opts.onExit(); });

  const help171 = el('section', { class: 'note family-171', id: 'family-171' },
    el('p', {}, '災害用伝言ダイヤル 171：171にかけて、録音は1、再生は2。自宅などの電話番号をキーに伝言を残します'),
    el('p', {}, '録音・再生のあと、連絡を取りたい人の電話番号（市外局番から）を入力します'),
    el('p', {}, '大きな災害のとき（提供開始後）や体験日（毎月1日・15日、正月三が日、防災週間・防災とボランティア週間）に使えます'),
    el('p', {}, '災害用伝言板 web171：', el('a', { href: 'https://www.web171.jp/', target: '_blank', rel: 'noopener noreferrer' }, 'https://www.web171.jp/')));

  const sh = opts.shelters;
  formRoot.append(
    el('section', { class: 'card' }, el('h3', {}, '1. 津波のときの避難先'),
      field('tsunami', '津波のときの避難先', { placeholder: '例：〇〇小学校の屋上' }), picker('tsunami', sh?.tsunami)),
    el('section', { class: 'card' }, el('h3', {}, '2. 地震（火事など）のときの避難先'),
      field('quake', '地震（火事など）のときの避難先', { placeholder: '例：〇〇公園' }), picker('quake', sh?.quake)),
    el('section', { class: 'card' }, el('h3', {}, '3. はぐれたときの集合場所'),
      field('meet1', '第1の集合場所'), field('meet2', '第2の集合場所（第1に行けないとき）')),
    el('section', { class: 'card' }, el('h3', {}, '4. 連絡のしかた'),
      field('contact', '連絡のしかた', { area: true, placeholder: '例：まず171に伝言を入れる。LINEは通じにくいことがある' }),
      help171,
      field('relay', '遠くの親戚など、連絡を中継する人')),
    el('section', { class: 'card' }, el('h3', {}, '5. 家族それぞれの予定'),
      el('p', { class: 'hint' }, '例：平日昼は〇〇小学校、お迎えは誰、など。最大8人。'), rowsBox, addRow),
    el('section', { class: 'card' }, el('h3', {}, '6. 持ち出す物・置き場所'),
      field('items', '持ち出す物・置き場所', { area: true, placeholder: '例：非常用リュックは玄関の収納。薬は冷蔵庫の横' })),
    el('section', { class: 'card' }, el('h3', {}, '7. 見直した日'),
      el('div', { class: 'field' }, el('label', { for: 'family-reviewed' }, '見直した日'), date), todayBtn),
    el('section', { class: 'card' }, el('h3', {}, '家族に見せる・送る'), copyBtn, copyOut, printBtn),
    clearBtn, confirmBox, exit,
  );
  drawRows();

  root.classList.remove('family-printing');
  document.body.classList.remove('family-printing');
  root.replaceChildren(
    el('h2', {}, FAMILY_ENTRY),
    el('section', { class: 'card disclaimer family-notice', id: 'family-notice' }, el('strong', {}, FAMILY_NOTICE)),
    status, formRoot, printRoot,
  );
}
