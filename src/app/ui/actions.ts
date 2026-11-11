import type { LatLon, Shelter } from '../../core/types.ts';
import { el } from './dom.ts';
import { loadChecklist, saveChecklist } from '../storage.ts';

function store(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

export const CHECKLIST = [
  '水（1人1日3L×7日分）',
  '食料（7日分）',
  '簡易トイレ',
  '家具の固定',
  '寝室に倒れる家具を置かない',
  '懐中電灯',
  'モバイルバッテリー',
  '家族の連絡方法を決めておく',
];

/** 経路リンク。目的地（避難場所）の座標だけを載せる。自宅の住所・座標は載せない（裁定 W2）。 */
export function directionsUrl(dest: LatLon): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lon}&travelmode=walking`;
}

const link = (href: string, text: string) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'btn-link' }, text);

export type ActionsInput = {
  shelters: Shelter[]; // 画面に一覧した順（地震用）
  municipality: string | null;
  shareText: string | null; // 結果が出ているときだけ
  onSelectShelter?(index: number): void;
};

export function renderActions(input: ActionsInput): HTMLElement {
  // 1. 避難
  const evacBody: (Node | string)[] = [];
  if (input.shelters.length > 0) {
    const select = el('select', { id: 'route-shelter', 'aria-label': '経路を調べる地震の避難場所' }, ...input.shelters.map((s, i) => el('option', { value: String(i) }, `${i + 1}. ${s.name}`)));
    const a = link(directionsUrl(input.shelters[0].pos), '選んだ避難場所までの経路を地図アプリで開く');
    select.addEventListener('change', () => {
      const i = Number(select.value);
      a.href = directionsUrl(input.shelters[i].pos);
      input.onSelectShelter?.(i);
    });
    evacBody.push(el('label', { for: 'route-shelter' }, '地震の避難場所を選ぶ'), select, a);
  }
  evacBody.push(link('https://disaportal.gsi.go.jp/', 'ハザードマップポータルサイトで周辺の危険を見る'));

  // 2. 耐震
  const q = encodeURIComponent(`${input.municipality ?? ''} 木造住宅 耐震診断 補助`.trim());
  const seismic = [
    el('p', {}, '古い木造住宅は、専門家による診断と補強で被害を減らせる場合があります。'),
    link('https://www.kenchiku-bosai.or.jp/taishin_portal/', '日本建築防災協会「誰でもできるわが家の耐震診断」'),
    link(`https://www.google.com/search?q=${q}`, input.municipality ? `${input.municipality}の耐震補助制度を検索する` : 'お住まいの市町の耐震補助制度を検索する'),
  ];

  // 3. 備え
  const st = store();
  const saved = st ? loadChecklist(st) : CHECKLIST.map(() => false);
  const boxes = CHECKLIST.map((_, i) => el('input', { type: 'checkbox', id: `chk-${i}`, checked: saved[i] === true }));
  const checklist = el('ul', { class: 'checklist' }, ...CHECKLIST.map((t, i) => el('li', {}, boxes[i], el('label', { for: `chk-${i}` }, t))));
  checklist.addEventListener('change', () => { if (st) saveChecklist(boxes.map((b) => b.checked), st); });

  // 4. 共有
  const shareBody: Node[] = [];
  if (input.shareText) {
    const ta = el('textarea', { id: 'share-text', rows: 6, readOnly: true }, '');
    ta.value = input.shareText;
    const btn = el('button', { type: 'button', class: 'secondary' }, '家族に共有する');
    const msg = el('p', { class: 'status', role: 'status' });
    btn.addEventListener('click', async () => {
      try {
        if (navigator.share) await navigator.share({ text: ta.value });
        else {
          await navigator.clipboard.writeText(ta.value);
          msg.textContent = 'コピーしました。メッセージアプリなどに貼り付けてください。';
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') msg.textContent = '共有できませんでした。上の文面を長押ししてコピーしてください。';
      }
    });
    shareBody.push(el('p', { class: 'hint' }, '共有される文面です。住所・位置情報は含まれません。'), ta, btn, msg);
  } else shareBody.push(el('p', {}, '結果が出ると、市町名と結果だけの文面を共有できます。'));

  const card = (title: string, ...body: (Node | string)[]) => el('section', { class: 'card action' }, el('h3', {}, title), ...body);
  return el(
    'div',
    { class: 'actions' },
    el('h2', {}, '今日できること'),
    card('1. 避難先と経路を確認する', ...evacBody),
    card('2. 家の耐震を調べる', ...seismic),
    card('3. 備えを確認する', checklist),
    card('4. 家族に共有する', ...shareBody),
  );
}
