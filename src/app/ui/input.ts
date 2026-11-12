import type { Era, HomeInput, LatLon, Structure } from '../../core/types.ts';
import type { Candidate } from '../geocode.ts';
import { clear, el } from './dom.ts';
import { createPinPicker, disposePinPicker } from './map.ts';

export type InputHandlers = {
  onSearch(query: string, home: HomeInput): void;
  onLocate(home: HomeInput): void;
  /** label は候補リストから選んだときの住所（地図のピンなら undefined） */
  onPick(pos: LatLon, home: HomeInput, label?: string): void;
};

export type InputView = {
  setBusy(busy: boolean): void;
  /** onRetry を渡すと「もう一度試す」ボタンも出す */
  message(text: string | null, onRetry?: () => void): void;
  showCandidates(list: Candidate[]): void;
  showPinPicker(): void;
  clearExtras(): void;
};

const ERAS: [Era | 'unknown', string][] = [
  ['pre1981', '1981年5月以前'],
  ['y1981_2000', '1981年6月〜2000年5月'],
  ['post2000', '2000年6月以降'],
  ['unknown', 'わからない'],
];
const STRUCTURES: [Structure | 'unknown', string][] = [
  ['wood', '木造'],
  ['steel', '鉄骨'],
  ['rc', '鉄筋コンクリート'],
  ['unknown', 'わからない'],
];

export function renderInput(root: HTMLElement, handlers: InputHandlers): InputView {
  clear(root);
  const address = el('input', { id: 'f-address', type: 'text', autocomplete: 'off', placeholder: '例：愛知県名古屋市中区三の丸3丁目1', enterkeyhint: 'search' });
  const era = el('select', { id: 'f-era' }, ...ERAS.map(([v, t]) => el('option', { value: v }, t)));
  era.value = 'unknown';
  const structure = el('select', { id: 'f-structure' }, ...STRUCTURES.map(([v, t]) => el('option', { value: v }, t)));
  structure.value = 'unknown';
  const floors = el('input', { id: 'f-floors', type: 'number', min: 1, max: 99, inputMode: 'numeric', placeholder: '例：5' });
  const floorsField = el('div', { class: 'field', hidden: true }, el('label', { for: 'f-floors' }, '階数'), floors, el('p', { class: 'hint' }, '鉄骨・鉄筋コンクリートのときだけ。入れると幅が狭くなります。'));
  const retro = el('input', { id: 'f-retro', type: 'checkbox' });
  const status = el('p', { class: 'status', role: 'status' });
  const retryBox = el('div', { class: 'retry' });
  const extras = el('div', { class: 'extras' });
  const search = el('button', { type: 'submit', class: 'primary' }, '調べる');
  const locate = el('button', { type: 'button', class: 'secondary' }, '現在地を使う');

  structure.addEventListener('change', () => {
    floorsField.hidden = !(structure.value === 'steel' || structure.value === 'rc');
  });

  const home = (): HomeInput => {
    const s = structure.value as Structure | 'unknown';
    const n = Math.floor(Number(floors.value));
    const useFloors = (s === 'steel' || s === 'rc') && floors.value !== '' && n >= 1 && n <= 99;
    return { structure: s, era: era.value as Era | 'unknown', retrofitted: retro.checked, ...(useFloors ? { floors: n } : {}) };
  };

  const form = el(
    'form',
    { class: 'card', novalidate: true },
    el('h2', {}, 'お住まいを入力'),
    el('div', { class: 'field' }, el('label', { for: 'f-address' }, '住所'), address, el('div', { class: 'row' }, locate)),
    el('div', { class: 'field' }, el('label', { for: 'f-era' }, '建築年'), era),
    el('div', { class: 'field' }, el('label', { for: 'f-structure' }, '構造'), structure),
    floorsField,
    el('div', { class: 'field check' }, retro, el('label', { for: 'f-retro' }, '耐震補強をした')),
    search,
    status,
    retryBox,
    extras,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = address.value.trim();
    if (!q) return view.message('住所を入力してください（または「現在地を使う」を押してください）');
    view.message(null);
    handlers.onSearch(q, home());
  });
  locate.addEventListener('click', () => {
    view.message(null);
    handlers.onLocate(home());
  });
  root.append(form);

  const view: InputView = {
    setBusy(busy) {
      search.disabled = busy;
      extras.querySelectorAll('button').forEach((b) => (b.disabled = busy));
      locate.disabled = busy;
      retryBox.querySelectorAll('button').forEach((b) => (b.disabled = busy));
      if (busy) status.textContent = '調べています…';
    },
    message(text, onRetry) {
      status.textContent = text ?? '';
      clear(retryBox);
      if (onRetry) {
        const b = el('button', { type: 'button', class: 'secondary' }, 'もう一度試す');
        b.addEventListener('click', onRetry);
        retryBox.append(b);
      }
    },
    clearExtras() {
      disposePinPicker();
      clear(extras);
    },
    showCandidates(list) {
      disposePinPicker();
      clear(extras);
      extras.append(
        el('p', { class: 'strong' }, '候補が複数見つかりました。お住まいの場所を選んでください。'),
        el(
          'ul',
          { class: 'candidates' },
          ...list.map((c) => {
            const b = el('button', { type: 'button', class: 'candidate' }, c.label);
            b.addEventListener('click', () => handlers.onPick(c.pos, home(), c.label));
            return el('li', {}, b);
          }),
        ),
      );
    },
    showPinPicker() {
      clear(extras);
      const mapNode = el('div', { id: 'pin-map', class: 'map pin-map' });
      const confirm = el('button', { type: 'button', class: 'primary' }, 'この場所で調べる');
      extras.append(
        el('p', { class: 'strong' }, '住所が見つかりませんでした。地図で「自宅」のピンを動かして場所を決めてください。'),
        el('p', { class: 'hint' }, 'ピンをドラッグするか、地図をタップしてください。'),
        mapNode,
        confirm,
      );
      const picker = createPinPicker(mapNode, () => {});
      confirm.addEventListener('click', () => handlers.onPick(picker.get(), home()));
      setTimeout(() => picker.map.invalidateSize(), 0);
    },
  };
  return view;
}
