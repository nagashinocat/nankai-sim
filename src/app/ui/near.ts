/**
 * #near「いまいる場所から近い避難場所」。
 * 現在地は「現在地を使う」を押したときだけ取り、メモリだけに持つ（保存・URL・共有に入れない）。dispose で捨てる。
 */
import type { LatLon, Shelter } from '../../core/types.ts';
import type { HomeTsunami } from '../tsunami-tile.ts';
import { homeTsunamiLines, homeTsunamiVM } from '../viewmodel.ts';
import { HAZARD_PORTAL, TSUNAMI_ATTRIBUTION } from '../text.ts';
import { KIDS_NEAR, KIDS_TEXT } from '../kids.ts';
import { NEAR_TEXT, accuracyNote, geoErrorKind, nearLists, walkText, type GeoErrorKind, type NearList } from '../near.ts';
import { approxDistance, minimapModel } from '../minimap.ts';
import { el } from './dom.ts';
import { headingIcon } from './visuals.ts';
import { MINIMAP_SIZE, renderMinimap } from './minimap.ts';
import { mapToggle, shelterNoticeNodes } from './shelters.ts';

export type NearDeps = {
  kids: boolean;
  geolocation: Geolocation | undefined;
  sheltersNear(pos: LatLon, radiusM: number): Promise<Shelter[]>;
  /** 現在地の津波（地理院タイル。電波が要る） */
  tsunami(pos: LatLon): Promise<HomeTsunami>;
  online(): boolean;
  onAdult(): void;
  onExit(): void;
  /** 避難場所のデータを端末に保存する欄（無ければ出さない） */
  savePanel?(): HTMLElement | null;
  /** 対応範囲か（結果画面と同じ L2 の index と 250m の行）。読めなければ例外（電波なしなど） */
  covers?(pos: LatLon): Promise<boolean>;
  /** 避難場所のデータを端末に保存しているか */
  isSaved?(): Promise<boolean>;
};

export type NearHandle = { setKids(on: boolean): void; dispose(): void };

type Fix = { pos: LatLon; accuracy: number | null };
type State =
  | { phase: 'idle' }
  | { phase: 'locating' }
  | { phase: 'geoError'; kind: GeoErrorKind }
  | { phase: 'loading'; fix: Fix }
  | { phase: 'loadError'; fix: Fix; offline: boolean }
  | { phase: 'outside'; fix: Fix }
  | { phase: 'done'; fix: Fix; lists: NearList[] };

type TsunamiState = { kind: 'loading' } | { kind: 'offline' } | { kind: 'ok'; value: HomeTsunami };

export function renderNear(root: HTMLElement, deps: NearDeps): NearHandle {
  let kids = deps.kids;
  let state: State = { phase: 'idle' };
  let tsunami: TsunamiState = { kind: 'loading' };
  let token = 0;
  let disposed = false;
  /** 電波がなく、避難場所のデータも保存していない（開いたときに調べる） */
  let offlineUnsaved = false;
  const tsunamiSlot = el('div', { id: 'near-tsunami' });

  const set = (s: State): void => { if (!disposed) { state = s; draw(); } };

  const locate = (): void => {
    const my = ++token;
    tsunami = { kind: 'loading' };
    const geo = deps.geolocation;
    if (!geo) { set({ phase: 'geoError', kind: 'unsupported' }); return; }
    set({ phase: 'locating' });
    geo.getCurrentPosition(
      (p) => {
        if (my !== token || disposed) return;
        const fix: Fix = { pos: { lat: p.coords.latitude, lon: p.coords.longitude }, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null };
        void load(fix, my);
      },
      (err) => { if (my === token) set({ phase: 'geoError', kind: geoErrorKind(err?.code) }); },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  const load = async (fix: Fix, my: number): Promise<void> => {
    set({ phase: 'loading', fix });
    // 津波は並行して（電波があるときだけ。失敗・電波なしは「調べられません」）
    if (deps.online()) {
      deps.tsunami(fix.pos).then(
        (value) => { if (my === token && !disposed) { tsunami = value === 'unknown' ? { kind: 'offline' } : { kind: 'ok', value }; drawTsunami(); } },
        () => { if (my === token && !disposed) { tsunami = { kind: 'offline' }; drawTsunami(); } },
      );
    } else {
      tsunami = { kind: 'offline' };
    }
    // 対応範囲は結果画面と同じ決め方。読めない（電波なしで想定データが無い）ときは一覧を出す（5県だけの注意は常に出す）
    const covered: Promise<boolean | null> = deps.covers ? deps.covers(fix.pos).catch(() => null) : Promise.resolve(null);
    try {
      const [shelters, inside] = await Promise.all([deps.sheltersNear(fix.pos, 5000), covered]);
      if (my !== token) return;
      if (inside === false) { set({ phase: 'outside', fix }); return; }
      set({ phase: 'done', fix, lists: nearLists(fix.pos, shelters) });
    } catch {
      if (my !== token) return;
      set({ phase: 'loadError', fix, offline: !deps.online() });
    }
  };

  // ---- 津波の1行 ----
  const drawTsunami = (): void => {
    if (state.phase !== 'loading' && state.phase !== 'done' && state.phase !== 'loadError' && state.phase !== 'outside') { tsunamiSlot.replaceChildren(); return; }
    if (kids) {
      const t = tsunami.kind === 'ok' ? homeTsunamiVM(tsunami.value, null) : null;
      const node = tsunami.kind === 'loading' ? el('p', { class: 'kid-note' }, KIDS_NEAR.loading)
        : !t || t.kind === 'unknown' ? el('p', { class: 'kid-near-tsunami' }, KIDS_TEXT.tsunamiUnknown)
        : t.kind === 'none' ? el('p', { class: 'kid-near-tsunami' }, KIDS_TEXT.tsunamiNone)
        : el('p', { class: 'kid-near-tsunami kid-red' }, KIDS_NEAR.tsunamiBand);
      tsunamiSlot.replaceChildren(node);
      return;
    }
    if (tsunami.kind === 'loading') { tsunamiSlot.replaceChildren(el('p', { class: 'status' }, NEAR_TEXT.tsunamiLoading)); return; }
    const vm = tsunami.kind === 'ok' ? homeTsunamiVM(tsunami.value, null) : null;
    if (!vm || vm.kind === 'unknown') { tsunamiSlot.replaceChildren(el('p', { class: 'strong tsunami-offline' }, NEAR_TEXT.tsunamiOffline)); return; }
    tsunamiSlot.replaceChildren(
      ...homeTsunamiLines(vm).map((l) => el('p', { class: l.cls }, l.text)),
      el('p', { class: 'hint' }, TSUNAMI_ATTRIBUTION),
    );
  };

  // ---- 一覧 ----
  const adultList = (list: NearList, fix: Fix, firstOpen: boolean): Node[] => {
    const out: Node[] = [el('h3', {}, NEAR_TEXT.heading[list.hazard])];
    if (list.hazard === 'tsunami') out.push(el('p', { class: 'strong near-sea-first' }, NEAR_TEXT.seaFirst));
    if (list.widened) out.push(el('p', { class: 'hint' }, NEAR_TEXT.widened));
    if (list.hits.length === 0) { out.push(el('p', {}, NEAR_TEXT.noneList)); return out; }
    out.push(el('ol', { class: 'shelters' }, ...list.hits.map((h, i) => {
      const w = walkText(h.distanceM);
      return el('li', {},
        el('strong', {}, h.shelter.name), el('br'),
        `直線距離 ${approxDistance(h.distanceM)}　徒歩の目安 標準${w.standard}／ゆっくり${w.slow}`,
        mapToggle(() => renderMinimap(minimapModel(fix.pos, h.shelter, list.pool, MINIMAP_SIZE), { center: 'here' }), firstOpen && i === 0));
    })));
    return out;
  };

  const kidList = (list: NearList, fix: Fix, open: boolean): Node[] => {
    const h = list.hits[0];
    const title = list.hazard === 'tsunami' ? KIDS_NEAR.tsunami : KIDS_NEAR.earthquake;
    const sea = list.hazard === 'tsunami' ? el('p', { class: 'kid-near-sea near-sea-first' }, KIDS_NEAR.seaFirst) : null;
    if (!h) return [el('section', { class: 'kid-card kid-near' }, el('h2', {}, title), sea, el('p', {}, KIDS_NEAR.none))];
    const make = () => renderMinimap(minimapModel(fix.pos, h.shelter, [], MINIMAP_SIZE), { center: 'here', kids: true });
    return [el('section', { class: 'kid-card kid-near', id: `kid-near-${list.hazard}` },
      el('h2', {}, title),
      sea,
      el('p', { class: 'kid-near-name' }, h.shelter.name),
      mapToggle(make, open, { open: 'ちずを みる', close: 'ちずを とじる' }))];
  };

  const todoList = (): HTMLElement => el('div', { class: 'near-todo-wrap', id: 'near-todo' },
    el('p', { class: 'strong' }, NEAR_TEXT.todoTitle),
    el('ul', { class: 'near-todo' }, ...NEAR_TEXT.notSavedDo.map((t) => el('li', {}, t))));

  const draw = (): void => {
    const K = kids;
    const s0 = state;
    const btn = el('button', { type: 'button', class: 'primary', id: 'near-locate' },
      K ? KIDS_NEAR.locate : state.phase === 'done' || state.phase === 'loadError' ? NEAR_TEXT.relocate : NEAR_TEXT.locate);
    btn.disabled = state.phase === 'locating' || state.phase === 'loading';
    btn.addEventListener('click', locate);
    const back = el('button', { type: 'button', class: 'secondary', id: 'near-back' }, K ? KIDS_NEAR.back : NEAR_TEXT.back);
    back.addEventListener('click', deps.onExit);
    const adultBtn = el('button', { type: 'button', class: 'kid-link', id: 'near-adult' }, KIDS_NEAR.adult);
    adultBtn.addEventListener('click', deps.onAdult);

    const head: Node[] = K
      ? [el('section', { class: 'kid-card kid-intro' }, el('h2', { id: 'near-heading', tabindex: '-1' }, KIDS_NEAR.title), el('p', {}, KIDS_NEAR.lead))]
      : [el('h2', { id: 'near-heading', tabindex: '-1' }, headingIcon('📍'), NEAR_TEXT.title), el('p', {}, NEAR_TEXT.lead), el('p', { class: 'hint' }, NEAR_TEXT.privacy)];
    head.push(el('p', { class: K ? 'kid-note near-coverage' : 'hint near-coverage', id: 'near-coverage' }, K ? KIDS_NEAR.coverage : NEAR_TEXT.coverage));
    // 電波がなく、保存もしていないときは、ボタンの前に「出せません」とできること
    if (offlineUnsaved && (s0.phase === 'idle' || s0.phase === 'geoError')) {
      head.push(el('section', { class: K ? 'kid-card near-offline-first' : 'card disclaimer near-offline-first', id: 'near-offline-first' },
        el('p', { class: 'strong near-error' }, K ? KIDS_NEAR.notSaved : NEAR_TEXT.notSaved),
        ...(K ? [] : [todoList()])));
    }

    const status = el('div', { id: 'near-status', role: 'status', 'aria-live': 'polite' });
    const body: Node[] = [];
    const s = state;
    if (s.phase === 'locating') status.append(el('p', { class: 'status' }, K ? KIDS_NEAR.locating : NEAR_TEXT.locating));
    if (s.phase === 'loading') status.append(el('p', { class: 'status' }, K ? KIDS_NEAR.loading : NEAR_TEXT.loading));
    if (s.phase === 'geoError') {
      const msg = K ? (s.kind === 'failed' ? KIDS_NEAR.failed : KIDS_NEAR.denied) : NEAR_TEXT[s.kind];
      status.append(el('p', { class: 'strong near-error', id: 'near-error' }, msg));
    }
    if (s.phase === 'loadError') {
      if (s.offline) status.append(el('p', { class: 'strong near-error', id: 'near-not-saved' }, K ? KIDS_NEAR.notSaved : NEAR_TEXT.notSaved));
      else status.append(el('p', { class: 'strong near-error', id: 'near-error' }, K ? KIDS_TEXT.error : NEAR_TEXT.loadFailed));
      if (!K) body.push(todoList());
    }
    if (s.phase === 'outside') {
      body.push(el('section', { class: K ? 'kid-card' : 'card', id: 'near-outside' },
        ...(K ? [el('p', { class: 'kid-nodata' }, KIDS_TEXT.outside)]
          : [el('p', { class: 'strong' }, NEAR_TEXT.outside), el('p', {}, NEAR_TEXT.outsideDo),
            el('a', { href: HAZARD_PORTAL.url, target: '_blank', rel: 'noopener noreferrer', class: 'btn-link' }, HAZARD_PORTAL.label)])));
    }
    if (s.phase === 'loading' || s.phase === 'done' || s.phase === 'loadError' || s.phase === 'outside') {
      const acc = accuracyNote(s.fix.accuracy);
      if (acc && !K) body.unshift(el('p', { class: 'note', id: 'near-accuracy' }, acc));
      body.unshift(tsunamiSlot);
    }
    if (s.phase === 'done') {
      const empty = s.lists.every((l) => l.hits.length === 0);
      if (empty) {
        body.push(el('p', { class: 'strong', id: 'near-none' }, K ? KIDS_NEAR.none : NEAR_TEXT.none));
      } else if (K) {
        const [t, q] = s.lists;
        body.push(...kidList(t, s.fix, true), ...kidList(q, s.fix, t.hits.length === 0));
      } else {
        body.push(el('section', { class: 'card', id: 'near-list' }, ...s.lists.flatMap((l, i) => adultList(l, s.fix, i === 0 || s.lists[0].hits.length === 0 && i === 1))));
      }
    }
    // 国土地理院の避難場所の注意（そのまま）と出典。一覧が出ないときも出す
    const notices = el('div', { class: K ? 'near-notices kid-near-notices' : 'near-notices' }, ...shelterNoticeNodes());
    const save = K ? null : deps.savePanel?.() ?? null;
    root.replaceChildren(
      el('section', { class: K ? 'near kid-near-root' : 'card near' }, ...head, btn, status, ...body),
      notices,
      ...(save ? [save] : []),
      ...(K ? [adultBtn] : []),
      back,
    );
    drawTsunami();
  };

  draw();
  if (!deps.online() && deps.isSaved) {
    void deps.isSaved().then((saved) => { if (!disposed && !saved) { offlineUnsaved = true; draw(); } }, () => {});
  }
  return {
    setKids(on) { if (on !== kids) { kids = on; draw(); } },
    dispose() {
      disposed = true;
      token++;
      state = { phase: 'idle' }; // 現在地を捨てる
      tsunami = { kind: 'loading' };
      root.replaceChildren();
    },
  };
}
