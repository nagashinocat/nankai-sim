/**
 * 「▶ 地震から津波までを再生」の再生画面（DOM・インライン SVG・requestAnimationFrame だけ）。
 * 筋書きは timeline.ts（画面に出している値から作る）。動きを減らす設定では、動かさずに「次へ」で場面を進める。
 */
import {
  PLAYER_TEXT, buildTimeline, clockText, sceneAt, type Phase, type TimedPhase, type Timeline, type TimelineInput,
} from '../timeline.ts';
import { PICTURE_MAX_M, intensityLevel, tsunamiMid } from '../visuals.ts';
import { EVAC_START_MIN } from '../../core/evacuation.ts';
import { el } from './dom.ts';
import { intensityBadge, tsunamiPicture } from './visuals.ts';
import { KIDS_TEXT, fun, intensityReading, intensityRuby, kidClock, kidEndLines, kidSceneCaption } from '../kids.ts';
import { kidsTsunamiPicture, playIcon, rubyNodes } from './kids.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]): SVGElement {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  for (const c of children) n.append(c);
  return n;
}

/** 震度の段階ごとの揺れの幅（px） */
const SHAKE_PX: Record<string, number> = { le4: 1, '5-': 1.5, '5+': 2, '6-': 3, '6+': 4, '7': 5 };

// 舞台（viewBox 340×150）の置き場所
const W = 340, H = 150, GROUND = 118, COAST_X = 292, HOME_X = 205, SHELTER_X = 42;
const WAVE_RUN_PX = 70;
/** 浸水の絵の 1m あたりの px（家の高さ 26px ≒ 6m） */
const PX_PER_M = 26 / 6;

export type Launcher = { node: HTMLElement; destroy(): void; isOpen(): boolean; open(): void };
export type PlayerOpts = { /** こどもモード（ことば・ボタンを こども向けに。筋書きは同じ） */ kids?: boolean };

/** 「ひと目でわかる」の下のボタンと、開いたときの再生画面。destroy でアニメーションを止めて外す。 */
export function playerLauncher(input: () => TimelineInput, opts: PlayerOpts = {}): Launcher {
  let player: Player | null = null;
  const kids = !!opts.kids;
  const btn = kids
    ? el('button', { type: 'button', class: 'kid-btn kid-btn-primary player-open', id: 'player-open', 'aria-expanded': 'false', 'aria-controls': 'player' }, playIcon(), KIDS_TEXT.player)
    : el('button', { type: 'button', class: 'secondary player-open', id: 'player-open', 'aria-expanded': 'false', 'aria-controls': 'player' }, PLAYER_TEXT.open);
  const node = el('div', { class: kids ? 'player-launcher kid-player-launcher' : 'player-launcher' }, btn);
  const close = (focus: boolean): void => {
    player?.destroy();
    player = null;
    btn.setAttribute('aria-expanded', 'false');
    if (focus) btn.focus();
  };
  const open = (): void => {
    if (player) return;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    player = createPlayer(buildTimeline(input()), reduced, () => close(true), kids);
    node.append(player.node);
    btn.setAttribute('aria-expanded', 'true');
    player.node.focus();
  };
  btn.addEventListener('click', () => { if (player) close(false); else open(); });
  return { node, destroy: () => close(false), isOpen: () => !!player, open };
}

type Player = { node: HTMLElement; destroy(): void };

function createPlayer(tl: Timeline, reduced: boolean, onClose: () => void, kids = false): Player {
  /** こどもモードの ことば（場面ごと） */
  const kidCaps = tl.scenes.map((_, i) => kidSceneCaption(tl, i));
  const lagged = tl.phases.some((p) => p.type === 'hold' && p.kind === 'gap');
  // ---- 状態 ----
  let phase = 0;
  /** timed: 分。hold: 経過秒 */
  let t = 0;
  let playing = false;
  let raf = 0;
  let last = 0;
  let shownScene = -1;
  let destroyed = false;

  // ---- 舞台 ----
  const land = svg('g', { class: 'player-land' });
  const shelter = svg('g', {},
    svg('rect', { x: SHELTER_X - 14, y: GROUND - 58, width: 28, height: 58, fill: '#dfe6ee', stroke: '#4a5b70', 'stroke-width': 1.5 }),
    ...[0, 1, 2, 3].map((r) => svg('rect', { x: SHELTER_X - 9, y: GROUND - 52 + r * 13, width: 18, height: 6, fill: '#9fb3c8' })),
    svg('text', { x: SHELTER_X, y: GROUND - 64, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#1f4e79' }, kids ? (tl.tsunami.kind === 'none' ? 'ひなんばしょ' : 'たかい ところ') : '避難場所'));
  const house = svg('g', {},
    svg('path', { d: `M${HOME_X} ${GROUND - 30} L${HOME_X + 16} ${GROUND - 18} L${HOME_X + 12} ${GROUND - 18} L${HOME_X + 12} ${GROUND} L${HOME_X - 12} ${GROUND} L${HOME_X - 12} ${GROUND - 18} L${HOME_X - 16} ${GROUND - 18} Z`, fill: '#fff', stroke: '#555', 'stroke-width': 1.5 }),
    svg('text', { x: HOME_X, y: GROUND - 36, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#333' }, kids ? 'いえ' : '自宅'));
  const shakeMarks = svg('g', { stroke: '#b3261e', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' },
    svg('path', { d: `M${HOME_X - 26} ${GROUND - 28} q-4 6 0 12` }), svg('path', { d: `M${HOME_X - 32} ${GROUND - 30} q-5 8 0 16` }),
    svg('path', { d: `M${HOME_X + 26} ${GROUND - 28} q4 6 0 12` }), svg('path', { d: `M${HOME_X + 32} ${GROUND - 30} q5 8 0 16` }));
  const track = svg('line', { x1: SHELTER_X + 16, y1: GROUND + 9, x2: HOME_X, y2: GROUND + 9, stroke: '#1f4e79', 'stroke-width': 2, 'stroke-dasharray': '5 4' });
  const arrow = svg('path', { d: `M${SHELTER_X + 16} ${GROUND + 9} l7 -4 l0 8 Z`, fill: '#1f4e79' });
  const walkGroup = svg('g', {}, track, arrow);
  const person = svg('g', { fill: '#e08a00', stroke: '#333', 'stroke-width': 0.8 },
    svg('circle', { cx: 0, cy: -21, r: 4 }),
    svg('rect', { x: -3.5, y: -16, width: 7, height: 10, rx: 2 }),
    svg('path', { d: 'M-3 -6 L-5 0 M3 -6 L5 0', 'stroke-width': 2.2, stroke: '#333', fill: 'none' }));
  const ground = svg('line', { x1: 0, y1: GROUND, x2: COAST_X, y2: GROUND, stroke: '#5b4a3a', 'stroke-width': 3 });
  land.append(ground, shelter, house, walkGroup, person);
  const sea = svg('rect', { x: COAST_X, y: GROUND + 4, width: W - COAST_X, height: H - GROUND - 4, fill: 'rgba(30,110,210,0.45)' });
  const coast = svg('g', {},
    svg('line', { x1: COAST_X, y1: GROUND - 34, x2: COAST_X, y2: GROUND + 4, stroke: '#0b2e66', 'stroke-width': 2 }),
    svg('text', { x: COAST_X, y: GROUND - 38, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#0b2e66' }, kids ? 'うみ' : '海岸'));
  const wave = svg('path', { class: 'player-wave', d: `M0 ${GROUND + 4} q8 -26 26 -22 q-12 4 -8 22 Z`, fill: 'rgba(30,91,176,0.85)' });
  const flood = svg('rect', { class: 'player-flood', x: 0, y: GROUND, width: 0, height: 0, fill: 'rgba(30,110,210,0.45)' });
  const floodLabel = svg('text', { x: W - 4, y: 14, 'text-anchor': 'end', 'font-size': 12, 'font-weight': 700, fill: '#0b2e66' }, kids ? 'ちかくの みず' : PLAYER_TEXT.nearbyLabel);
  const gapText = svg('text', { x: W / 2, y: 40, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: '#333' }, kids ? '……　じかんが たつ　……' : '……　時間がたつ　……');
  const diagram = svg('text', { x: 4, y: H - 6, 'font-size': 12, fill: '#555' }, kids ? KIDS_TEXT.diagram : PLAYER_TEXT.diagram);
  const stage = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'player-stage', 'aria-hidden': 'true', focusable: 'false' },
    svg('rect', { x: 0, y: 0, width: W, height: H, fill: '#f4f8fc' }), shakeMarks, land, flood, sea, coast, wave, floodLabel, gapText, diagram);

  // ---- 文字 ----
  const clock = el('span', { class: 'player-clock' });
  const countdown = el('span', { class: 'player-countdown' });
  const badge = el('span', { class: 'player-badge' });
  const info = el('p', { class: 'player-info' });
  const caption = el('p', { class: kids ? 'player-caption kid-big' : 'player-caption strong', id: 'player-caption' });
  const capSmall = el('p', { class: 'kid-small player-cap-small' });
  const capNote = el('p', { class: 'kid-note player-cap-note' });
  const lateNote = el('p', { class: 'strong end-late player-late' }, kids ? 'とおくに いく より、ちかくの たかい たてものへ' : PLAYER_TEXT.late);
  const live = kids
    ? el('div', { class: 'player-live kid-cap', 'aria-live': 'polite', id: 'player-live' }, capSmall, caption, capNote, lateNote)
    : el('div', { class: 'player-live', 'aria-live': 'polite', id: 'player-live' }, caption, lateNote);
  const extra = el('div', { class: 'player-extra' });

  // ---- 操作 ----
  const L = kids
    ? { pause: 'とめる', play: 'うごかす', again: 'もう いちど', next: 'つぎへ', prev: 'まえへ', restart: 'さいしょから', close: 'とじる' }
    : { pause: '一時停止', play: '再生', again: 'もう一度再生', next: '次へ', prev: '前へ', restart: '最初から', close: '閉じる' };
  const playBtn = el('button', { type: 'button', class: 'secondary player-play' }, L.pause);
  const nextBtn = el('button', { type: 'button', class: kids ? 'kid-btn kid-btn-primary player-next' : 'secondary player-next' }, L.next);
  const prevBtn = el('button', { type: 'button', class: 'kid-btn kid-btn-outline player-prev' }, L.prev);
  const restartBtn = el('button', { type: 'button', class: 'secondary player-restart' }, L.restart);
  const closeBtn = el('button', { type: 'button', class: 'secondary player-close' }, L.close);
  const stepBtns = tl.scenes.map((s, i) => {
    const b = el('button', { type: 'button', class: 'player-step' }, `${i + 1}. ${kids ? kidCaps[i].title : s.title}`);
    b.addEventListener('click', () => goScene(i));
    return b;
  });
  const steps = el('ol', { class: 'player-steps', 'aria-label': kids ? 'ばめん' : '場面' }, ...stepBtns.map((b) => el('li', {}, b)));
  const controls = kids
    ? el('div', { class: 'kid-player-controls' },
      el('div', { class: 'kid-player-nav' }, prevBtn, nextBtn),
      el('div', { class: 'player-controls' }, ...(reduced ? [] : [playBtn]), restartBtn, closeBtn))
    : el('div', { class: 'player-controls' }, reduced ? nextBtn : playBtn, restartBtn, closeBtn);

  const node = kids
    ? el('section', { class: 'card player kid-player', id: 'player', tabindex: '-1', 'aria-labelledby': 'player-heading' },
      el('h2', { id: 'player-heading' }, 'うごきで みる'),
      steps,
      el('div', { class: 'player-top kid-clock' }, clock, countdown),
      badge, stage, live, extra, controls)
    : el('section', { class: 'card player', id: 'player', tabindex: '-1', 'aria-labelledby': 'player-heading' },
      el('h2', { id: 'player-heading' }, '地震から津波までの再生'),
      el('div', { class: 'player-top' }, clock, countdown),
      badge, stage, info, live, extra, controls, steps);

  // ---- 描画 ----
  const cur = (): Phase => tl.phases[phase];
  /** 浸水・まとめの段階で使う、直前の時計の段階 */
  const lastTimed = (): TimedPhase | null => {
    for (let i = phase; i >= 0; i--) { const p = tl.phases[i]; if (p.type === 'timed') return p; }
    return null;
  };
  const sceneIndex = (): number => {
    const p = cur();
    if (p.type === 'timed') return sceneAt(tl, phase, t);
    return tl.scenes.findIndex((s) => s.phase === phase);
  };
  const show = (n: SVGElement, on: boolean): void => { n.style.display = on ? '' : 'none'; };

  function drawStage(now: number): void {
    const p = cur();
    const tp = lastTimed();
    const timed = p.type === 'timed' ? p : null;
    // 時計の段階の中の時刻（浸水・まとめは直前の段階の終わり）
    const tm = timed ? t : tp ? tp.endMin : 0;
    const walk = tp?.walk ?? null;
    const isGap = p.type === 'hold' && p.kind === 'gap';
    // 揺れ
    const shaking = !!timed && tm < timed.shakeEndMin && !isGap;
    show(shakeMarks, shaking);
    const lvl = intensityLevel(tp?.intensity ?? '');
    const amp = shaking && !reduced ? SHAKE_PX[lvl] ?? 2 : 0;
    land.setAttribute('transform', amp ? `translate(${(amp * Math.sin(now / 23)).toFixed(2)} ${(amp * 0.4 * Math.sin(now / 31)).toFixed(2)})` : '');
    // 歩く人
    const showWalk = !!walk && !isGap && tm >= walk.startMin;
    show(walkGroup, showWalk);
    show(person, !isGap);
    const from = HOME_X + 22, to = SHELTER_X + 20;
    let x = from;
    if (walk && tm >= walk.startMin) {
      // 動きを減らす設定では「避難」の場面を途中（半分）で見せる
      const frac = (m: number) => Math.min(1, (m - walk.startMin) / Math.max(walk.endMin - walk.startMin, 1e-6));
      // 間に合わないおそれのときは、海岸に津波が着く時刻の位置で止める（避難場所に着いた絵にしない）
      const stopAt = tp?.late && tp.arrivalMin !== null ? frac(tp.arrivalMin) : 1;
      const f = reduced && timed && tm === walk.startMin ? Math.min(0.5, stopAt) : Math.min(frac(tm), stopAt);
      x = from + f * (to - from);
    }
    person.setAttribute('transform', `translate(${x.toFixed(1)} ${GROUND})`);
    // 波（海岸に着く時刻まで右から近づく）
    const arr = tp?.arrivalMin ?? null;
    const waveOn = arr !== null && !isGap && tm >= arr * 0.4;
    show(wave, waveOn);
    if (waveOn && arr !== null) {
      const f = Math.min(1, (tm - arr * 0.4) / Math.max(arr * 0.6, 1e-6));
      wave.setAttribute('transform', `translate(${(COAST_X + (1 - f) * WAVE_RUN_PX).toFixed(1)} 0)`);
    }
    // 浸水（band は自宅まで、nearby は自宅の横まで）
    const water = p.type === 'hold' && p.kind === 'water';
    const after = p.type === 'end' && tl.phases.some((q) => q.type === 'hold' && q.kind === 'water');
    const mid = tsunamiMid(tl.tsunami);
    if ((water || after) && mid !== null) {
      const rise = water && !reduced ? Math.min(1, t / (p.seconds * 0.6)) : 1;
      const hPx = Math.max(4, Math.min(PICTURE_MAX_M, mid) * PX_PER_M) * rise;
      const x0 = tl.tsunami.kind === 'nearby' ? HOME_X + 30 : HOME_X - 50;
      flood.setAttribute('x', String(x0));
      flood.setAttribute('width', String(COAST_X - x0));
      flood.setAttribute('y', (GROUND - hPx).toFixed(1));
      flood.setAttribute('height', hPx.toFixed(1));
      show(flood, true);
      show(floodLabel, tl.tsunami.kind === 'nearby');
    } else {
      show(flood, false);
      show(floodLabel, false);
    }
    show(gapText, isGap);
    show(diagram, !isGap);
    stage.classList.toggle('player-dim', isGap);
  }

  function drawText(): void {
    const p = cur();
    const tp = lastTimed();
    const arr = p.type === 'timed' ? p.arrivalMin : null;
    if (kids) {
      const label = !lagged ? 'じしんから' : phase === 0 ? '1かいめの じしんから' : '2かいめの じしんから';
      clock.textContent = p.type === 'timed' ? kidClock(label, t)
        : p.type === 'hold' && p.kind === 'gap' ? 'つぎの じしんまで：わからない'
        : p.type === 'hold' ? 'しばらく して' : 'そのあと';
      countdown.textContent = arr !== null && p.type === 'timed'
        ? (t < arr ? `うみに つなみまで あと ${fun(Math.ceil(arr - t))}` : 'つなみが うみに ついた') : '';
    } else {
      if (p.type === 'timed') clock.textContent = clockText(p.clockLabel, t);
      else if (p.type === 'hold' && p.kind === 'gap') clock.textContent = '後発の地震まで：時間はわかりません';
      else if (p.type === 'hold') clock.textContent = '浸水の想定（時刻は示しません）';
      else clock.textContent = 'まとめ';
      countdown.textContent = arr !== null && p.type === 'timed'
        ? (t < arr ? `海岸に津波まで 最短あと約${Math.ceil(arr - t)}分` : '海岸に津波が到達') : '';
    }
    const walk = tp?.walk ?? null;
    const sh = tp?.shelter ?? null;
    const tm = p.type === 'timed' ? t : Infinity;
    const isGap = p.type === 'hold' && p.kind === 'gap';
    info.textContent = sh && p.type !== 'end' && tm >= EVAC_START_MIN && !isGap
      ? `${sh.name}（${sh.hazard === 'tsunami' ? '津波の避難場所' : '地震の避難場所'}）　${walk ? `徒歩 約${walk.walkMin}分（ゆっくり歩く場合）` : PLAYER_TEXT.walkUnknown}`
      : '';
    info.hidden = kids || !info.textContent;
    // 間に合わないおそれ: 海岸に津波が着いた後の場面に赤で（まとめの札にもある）
    lateNote.hidden = !(tp?.late && tp.arrivalMin !== null && !isGap && p.type !== 'end' && tm >= tp.arrivalMin);
  }

  function syncScene(): void {
    const i = sceneIndex();
    if (i === shownScene) return;
    shownScene = i;
    const s = tl.scenes[i];
    stepBtns.forEach((b, j) => (j === i ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
    const tp = lastTimed();
    nextBtn.disabled = i >= tl.scenes.length - 1;
    prevBtn.disabled = i <= 0;
    if (kids) {
      const k = kidCaps[i] ?? kidSceneCaption(tl, -1);
      capSmall.textContent = k.small;
      caption.textContent = k.big;
      capNote.textContent = k.note;
      capNote.classList.toggle('kid-note-red', !!k.noteRed);
      live.classList.toggle('kid-cap-red', k.red);
      badge.replaceChildren(...(s?.kind === 'shake' && tp?.intensity
        ? [el('span', { class: 'kid-badge' }, el('span', { 'aria-hidden': 'true' }, ...rubyNodes(intensityRuby(tp.intensity))), el('span', { class: 'sr-only' }, intensityReading(tp.intensity)))]
        : s?.kind === 'shake' ? ['ゆれの よそうは ないよ'] : []));
      const pic = s?.kind === 'water' ? kidsTsunamiPicture(tl.tsunami) : null;
      extra.replaceChildren(...(pic ? [el('div', { class: 'kid-player-pic' }, pic)] : s?.kind === 'end' ? [kidEndCard()] : []));
      return;
    }
    caption.textContent = s?.caption ?? '';
    badge.replaceChildren(...(s?.kind === 'shake' && tp?.intensity ? [intensityBadge(tp.intensity)] : s?.kind === 'shake' ? ['震度：データなし'] : []));
    extra.replaceChildren(...(s?.kind === 'water' ? [tsunamiPicture(tl.tsunami)].filter((x): x is HTMLElement => !!x) : s?.kind === 'end' ? [endCard()] : []));
  }

  function kidEndCard(): HTMLElement {
    return el('div', { class: 'player-end kid-player-end' },
      ...kidEndLines(tl).map((l) => el('p', { class: l.red ? 'kid-line kid-line-red' : 'kid-line' }, l.text)),
      el('p', { class: 'kid-closing' }, KIDS_TEXT.closing[0], el('br', {}), KIDS_TEXT.closing[1]));
  }

  function endCard(): HTMLElement {
    const e = tl.end;
    const max = Math.max(e.walk?.min ?? 0, e.arrival?.min ?? 0, 1) * 1.1;
    const bar = (cls: string, label: string, min: number) => el('div', { class: `end-row ${cls}` },
      el('p', { class: 'end-label' }, label),
      el('div', { class: 'end-track', 'aria-hidden': 'true' }, el('span', { class: 'end-bar', style: `width:${((min / max) * 100).toFixed(1)}%` })));
    return el('div', { class: 'player-end' },
      ...(e.walk ? [bar('end-walk', e.walk.text, e.walk.min)] : []),
      ...(e.arrival ? [bar('end-arrival', e.arrival.text, e.arrival.min)] : []),
      ...(e.walk && e.arrival ? [el('p', { class: 'end-axis', 'aria-hidden': 'true' }, el('span', {}, '0分'), el('span', {}, `${Math.round(max)}分`))] : []),
      ...(e.arrivalUnknown ? [el('p', { class: 'strong' }, e.arrivalUnknown)] : []),
      ...(e.noShelter ? [el('p', {}, e.noShelter)] : []),
      ...(e.walkUnknown ? [el('p', {}, e.walkUnknown)] : []),
      ...(e.late ? [el('p', { class: 'strong end-late end-late-card' }, e.late)] : []),
      ...(e.tight ? [el('p', { class: 'strong end-tight' }, e.tight)] : []),
      ...(e.outside ? [el('p', {}, e.outside)] : []),
      ...(e.unknown ? [el('p', {}, e.unknown)] : []),
      el('p', { class: 'strong end-strong' }, e.strong),
      el('p', { class: 'note' }, e.note));
  }

  function render(now = 0): void {
    drawStage(now);
    drawText();
    syncScene();
    playBtn.textContent = playing ? L.pause : cur().type === 'end' ? L.again : L.play;
  }

  // ---- 進める ----
  function advance(dtSec: number): void {
    let left = dtSec;
    while (left > 0 && cur().type !== 'end') {
      const p = cur();
      if (p.type === 'timed') {
        const need = ((p.endMin - t) * 60) / tl.speed;
        if (left < need) { t += (left * tl.speed) / 60; left = 0; }
        else { left -= need; phase++; t = 0; }
      } else if (p.type === 'hold') {
        const need = p.seconds - t;
        if (left < need) { t += left; left = 0; }
        else { left -= need; phase++; t = 0; }
      }
    }
    if (cur().type === 'end') stop();
  }
  function frame(now: number): void {
    raf = 0;
    if (destroyed || !node.isConnected) { stop(); return; }
    const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
    last = now;
    advance(dt);
    render(now);
    if (playing) raf = requestAnimationFrame(frame);
  }
  function play(): void {
    if (reduced || destroyed) return;
    if (cur().type === 'end') { phase = 0; t = 0; }
    playing = true;
    last = 0;
    if (!raf) raf = requestAnimationFrame(frame);
    render();
  }
  function stop(): void {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function goScene(i: number): void {
    const s = tl.scenes[i];
    if (!s) return;
    phase = s.phase;
    t = s.atMin ?? 0;
    render(performance.now());
  }

  playBtn.addEventListener('click', () => (playing ? stop() : play(), render()));
  nextBtn.addEventListener('click', () => { stop(); goScene(Math.min(tl.scenes.length - 1, sceneIndex() + 1)); });
  prevBtn.addEventListener('click', () => { stop(); goScene(Math.max(0, sceneIndex() - 1)); });
  restartBtn.addEventListener('click', () => { phase = 0; t = 0; shownScene = -1; if (reduced) render(); else { stop(); play(); } });
  closeBtn.addEventListener('click', onClose);

  render();
  if (!reduced) play();

  return {
    node,
    destroy() {
      destroyed = true;
      stop();
      node.remove();
    },
  };
}
