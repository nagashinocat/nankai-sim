/**
 * 簡易地図（SVG）。地図画像（タイル）は使わず、外部通信なしで描く。
 * 中心 = いまいる場所（または自宅）、避難場所への直線の向きと距離、北の向き、目盛り、ほかの避難場所（薄い点）。
 * 向きを合わせる（コンパス）と、図全体を -heading 回す（北の矢印も回る。文字は立てたまま）。
 */
import { dir8, dir8Kids, type MinimapModel } from '../minimap.ts';
import { startCompass as defaultStartCompass } from '../compass.ts';
import { el } from './dom.ts';
import { rubyNodes, svg } from './kids.ts';

/** 簡易地図の一辺（SVG の単位。画面では幅に合わせて縮む） */
export const MINIMAP_SIZE = 260;
export const MINIMAP_CAUTION = '直線の方向と距離です。道は実際に確かめてください';
export const MINIMAP_CAUTION_KIDS = 'まっすぐの むきと きょり だよ。みちは おうちの ひとと たしかめてね';

export type MinimapOpts = {
  kids?: boolean;
  /** 最初の向き（度）。null・省略は北が上 */
  headingDeg?: number | null;
  /** 中心の名前: here = いま（現在地）、home = 自宅 */
  center?: 'here' | 'home';
  /** 「向きを合わせる」ボタンを出す（既定 true） */
  compass?: boolean;
  /** テスト用の差し替え */
  startCompass?: typeof defaultStartCompass;
};

const GREEN = '#1b6b3a';
const BLUE = '#1f4e79';
const SCALE_H = 30;

function shortName(name: string, max = 9): string {
  const chars = [...name];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : name;
}

/** 中心 (c, c) のまわりに、点を -heading（度）回す（画面の座標は下が +y）。 */
function rotate(x: number, y: number, c: number, headingDeg: number): { x: number; y: number } {
  const t = (-headingDeg * Math.PI) / 180;
  const dx = x - c, dy = y - c;
  return { x: c + dx * Math.cos(t) - dy * Math.sin(t), y: c + dx * Math.sin(t) + dy * Math.cos(t) };
}

export function renderMinimap(model: MinimapModel, opts: MinimapOpts = {}): HTMLElement {
  const kids = !!opts.kids;
  const S = model.size;
  const c = S / 2;
  const R = c - 2;
  const centerLabel = opts.center === 'home' ? (kids ? 'おうち' : '自宅') : 'いま';
  const label = kids
    ? `ちず：${model.target.name}は、この むきに ${model.distanceText}`
    : `簡易地図：${centerLabel}の場所から${model.target.name}は${model.dirText}`;
  const pic = svg('svg', { viewBox: `0 0 ${S} ${S + SCALE_H}`, width: S, height: S + SCALE_H, role: 'img', 'aria-label': label, class: 'minimap-svg' });
  const status = el('p', { class: 'minimap-status hint', 'aria-live': 'polite' });
  let heading: number | null = typeof opts.headingDeg === 'number' && Number.isFinite(opts.headingDeg) ? opts.headingDeg : null;

  const draw = (): void => {
    const h = heading ?? 0;
    const rot = (x: number, y: number) => rotate(x, y, c, h);
    const parts: SVGElement[] = [
      svg('circle', { cx: c, cy: c, r: R, fill: kids ? '#FFFFFF' : '#f7faf7', stroke: '#9aa3ad', 'stroke-width': 1.5 }),
      svg('circle', { cx: c, cy: c, r: R / 2, fill: 'none', stroke: '#d5dae0', 'stroke-width': 1, 'stroke-dasharray': '3 4' }),
    ];
    // ほかの避難場所（こどもは出さない。矢印1つだけ）
    if (!kids) {
      for (const o of model.others) {
        const p = rot(o.x, o.y);
        if (Math.hypot(p.x - c, p.y - c) > R - 6) continue;
        parts.push(svg('circle', { cx: p.x, cy: p.y, r: 5, fill: GREEN, 'fill-opacity': 0.25, stroke: GREEN, 'stroke-opacity': 0.45, class: 'minimap-other' }));
      }
    }
    // 北の矢印（円のふち、回す）
    const n = rot(c, 18);
    const nTip = rot(c, 6), nL = rot(c - 7, 22), nR = rot(c + 7, 22);
    parts.push(
      svg('path', { d: `M${nTip.x} ${nTip.y} L${nL.x} ${nL.y} L${nR.x} ${nR.y} Z`, fill: '#333', class: 'minimap-north' }),
      svg('text', { x: n.x, y: n.y + 20, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: '#333' }, kids ? 'きた' : '北'),
    );
    // 避難場所への矢印
    const t = rot(model.target.x, model.target.y);
    const len = Math.hypot(t.x - c, t.y - c);
    if (len >= 12) {
      const ux = (t.x - c) / len, uy = (t.y - c) / len;
      const head = kids ? 22 : 14;
      const wHead = kids ? 14 : 9;
      const bx = t.x - ux * head, by = t.y - uy * head;
      parts.push(
        svg('line', { x1: c + ux * 10, y1: c + uy * 10, x2: bx, y2: by, stroke: kids ? BLUE : GREEN, 'stroke-width': kids ? 10 : 5, 'stroke-linecap': 'round', class: 'minimap-arrow' }),
        svg('path', { d: `M${t.x} ${t.y} L${bx - uy * wHead} ${by + ux * wHead} L${bx + uy * wHead} ${by - ux * wHead} Z`, fill: kids ? BLUE : GREEN }),
      );
    }
    parts.push(svg('circle', { cx: t.x, cy: t.y, r: kids ? 10 : 7, fill: '#fff', stroke: GREEN, 'stroke-width': 3, class: 'minimap-target' }));
    // 矢印の向き（同じ地点なら下向きとして文字を置く）
    const ux = len >= 1 ? (t.x - c) / len : 0, uy = len >= 1 ? (t.y - c) / len : 1;
    if (!kids) {
      // 名前は矢印の先の向こう側に（矢印と重ねない）
      const name = shortName(model.target.name);
      const w = [...name].length * 12;
      const anchor = ux > 0.35 ? 'start' : ux < -0.35 ? 'end' : 'middle';
      let tx = t.x + ux * 14;
      const left = anchor === 'start' ? tx : anchor === 'end' ? tx - w : tx - w / 2;
      if (left < 2) tx += 2 - left;
      if (left + w > S - 2) tx -= left + w - (S - 2);
      const ty = Math.min(Math.max(t.y + uy * 16 + 4, 14), S - 4);
      parts.push(svg('text', { x: tx, y: ty, 'text-anchor': anchor, 'font-size': 12, 'font-weight': 700, fill: GREEN, stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke', class: 'minimap-target-name' }, name));
    }
    // 中心（立てたまま）
    parts.push(
      svg('circle', { cx: c, cy: c, r: 8, fill: BLUE, stroke: '#fff', 'stroke-width': 3, class: 'minimap-center' }),
      svg('text', { x: c - ux * 22, y: c - uy * 22 + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: BLUE, stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke' }, centerLabel),
    );
    // 目盛り（回さない）
    const sx = 8, sy = S + 16;
    const px = Math.min(model.scale.px, S - 70);
    parts.push(
      svg('path', { d: `M${sx} ${sy - 5} L${sx} ${sy} L${sx + px} ${sy} L${sx + px} ${sy - 5}`, stroke: '#333', 'stroke-width': 2, fill: 'none', class: 'minimap-scale' }),
      svg('text', { x: sx + px + 6, y: sy + 4, 'font-size': 12, fill: '#333' }, model.scale.label),
    );
    pic.replaceChildren(...parts);
    // 読み上げの文は、8方位が変わったときだけ書きかえる（向きが少し動くたびに読み上げない）
    const next = heading === null
      ? (kids ? 'うえが きた だよ' : '北が上です')
      : (kids ? `スマホの むきに あわせて いるよ（うえは ${dir8Kids(heading)}）` : `向きを合わせています（スマホの上は${dir8(heading)}）`);
    if (status.textContent !== next) status.textContent = next;
  };
  draw();

  const caption = kids
    ? el('p', { class: 'minimap-text kid-minimap-text' }, 'この むきに ', ...rubyNodes([{ text: '約', rt: 'やく' }]), model.distanceText.replace(/^約/, ''))
    : el('p', { class: 'minimap-text' }, `${model.dirText}・ゆっくり歩いて約${model.walkSlowMin}分`);
  const caution = el('p', { class: 'minimap-caution' }, kids ? MINIMAP_CAUTION_KIDS : MINIMAP_CAUTION);
  const node = el('figure', { class: kids ? 'minimap kid-minimap' : 'minimap' }, pic, caption, caution, status);

  if (opts.compass !== false) {
    const start = opts.startCompass ?? defaultStartCompass;
    const onLabel = kids ? 'むきを あわせる' : '🧭 向きを合わせる';
    const offLabel = kids ? 'きたを うえに もどす' : '北を上にもどす';
    const btn = el('button', { type: 'button', class: 'secondary minimap-compass' }, onLabel);
    let active = false;
    let pending: number | null = null;
    let raf: number | null = null;
    let stop: (() => void) | null = null;
    const off = (): void => {
      active = false;
      pending = null;
      stop?.();
      stop = null;
      heading = null;
      btn.textContent = onLabel;
      draw();
    };
    btn.addEventListener('click', () => {
      if (active) { off(); return; }
      active = true;
      btn.textContent = offLabel;
      // iPhone の許可の問い合わせはクリックの中で始める
      void start((deg) => {
        if (!active) return;
        if (!node.isConnected) { off(); return; }
        if (deg === null) {
          off();
          status.textContent = kids ? 'この スマホでは むきを あわせられないよ。うえが きた だよ' : 'この端末では向きを合わせられません。北が上のままです';
          return;
        }
        // 向きの知らせは多いので、描きなおしは1コマに1回
        pending = deg;
        if (raf === null) {
          const run = (): void => { raf = null; if (!active || pending === null) return; heading = pending; draw(); };
          raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : (setTimeout(run, 16) as unknown as number);
        }
      }).then((s) => {
        if (active) stop = s; else s();
      });
    });
    node.append(btn);
  }
  return node;
}
