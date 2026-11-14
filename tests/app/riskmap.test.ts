import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellClass, cellFill, escapeTarget, homeQuadrant, legendFor, mapAlt, noArrowText, RISK_COLORS } from '../../src/app/riskmap.ts';
import type { Shelter } from '../../src/core/types.ts';

const O = { lat: 34.7, lon: 136.5 };
const sh = (id: string, lat: number, lon: number): Shelter => ({ id, name: id, pos: { lat, lon }, earthquake: true, tsunami: true });

test('cellClass: 倒壊の分け目は 10%・1%、津波は 0 より大きいとあり、null は判定できない', () => {
  assert.deepEqual(cellClass(0.1, 0), { collapse: 'high', tsunami: 'no' });
  assert.deepEqual(cellClass(0.0999, 0.5), { collapse: 'mid', tsunami: 'yes' });
  assert.deepEqual(cellClass(0.01, null), { collapse: 'mid', tsunami: 'unknown' });
  assert.deepEqual(cellClass(0.0099, 0), { collapse: 'low', tsunami: 'no' });
  assert.deepEqual(cellClass(null, 0), { collapse: 'none', tsunami: 'no' });
  assert.deepEqual(cellClass(Number.NaN, Number.NaN), { collapse: 'none', tsunami: 'unknown' });
});

test('cellFill: 両方モードの色（デザインどおり）と波の模様', () => {
  assert.deepEqual(cellFill(cellClass(0.2, 2), 'both'), { fill: '#8E7CC3', hatch: true, unknownHatch: false });
  assert.deepEqual(cellFill(cellClass(0.02, 2), 'both'), { fill: '#8FBCE8', hatch: true, unknownHatch: false });
  assert.deepEqual(cellFill(cellClass(0.2, 0), 'both'), { fill: '#E8A33D', hatch: false, unknownHatch: false });
  assert.deepEqual(cellFill(cellClass(0.02, 0), 'both'), { fill: '#E3E1DA', hatch: false, unknownHatch: false });
});

test('cellFill: 津波が判定できないマスは津波なし扱いにせず斜線（波の模様なし）', () => {
  const lo = cellFill(cellClass(0.02, null), 'both');
  assert.equal(lo.hatch, false);
  assert.equal(lo.unknownHatch, true);
  assert.notEqual(lo.fill, RISK_COLORS.lowBoth);
  const hi = cellFill(cellClass(0.2, null), 'both');
  assert.equal(hi.fill, RISK_COLORS.high);
  assert.equal(hi.unknownHatch, true);
  const t = cellFill(cellClass(0.2, null), 'tsunami');
  assert.equal(t.unknownHatch, true);
  assert.equal(t.hatch, false);
});

test('cellFill: 揺れモードは 大・中・低（津波は無視）、津波モードは浸水のあり・なし（倒壊は無視）', () => {
  assert.equal(cellFill(cellClass(0.2, 3), 'shake').fill, '#E8A33D');
  assert.equal(cellFill(cellClass(0.05, 3), 'shake').fill, '#F6D58E');
  assert.equal(cellFill(cellClass(0.001, 3), 'shake').fill, '#EEEBE3');
  assert.equal(cellFill(cellClass(0.2, 3), 'shake').hatch, false);
  assert.equal(cellFill(cellClass(null, 0), 'shake').unknownHatch, true);
  assert.deepEqual(cellFill(cellClass(0.2, 3), 'tsunami'), { fill: '#8FBCE8', hatch: true, unknownHatch: false });
  assert.deepEqual(cellFill(cellClass(0.2, 0), 'tsunami'), { fill: '#EEEBE3', hatch: false, unknownHatch: false });
});

test('legendFor: モードごとの言葉。灰色は「備えは同じく必要」', () => {
  assert.deepEqual(legendFor('both', false).map((l) => l.title), ['両方に注意', 'すぐ高い所へ', '家の倒壊に注意', '比較的低い']);
  assert.deepEqual(legendFor('shake', false).map((l) => l.title), ['倒壊の危険 大', '倒壊の危険 中', '比較的低い']);
  assert.deepEqual(legendFor('tsunami', false).map((l) => l.title), ['津波の浸水想定', '想定なし']);
  assert.equal(legendFor('both', false).find((l) => l.key === 'low')!.desc, '備えは同じく必要');
  assert.ok(legendFor('tsunami', false).find((l) => l.key === 'none')!.desc.includes('想定を超える津波'));
  assert.equal(legendFor('both', false, true).at(-1)!.unknownHatch, true);
  // 津波の行は模様つき
  assert.ok(legendFor('both', false).filter((l) => l.hatch).every((l) => l.key === 'both' || l.key === 'tsunami'));
});

test('legendFor（こども）: 4行（はいいろ も）・ひらがなだけ。あかは使わない', () => {
  const l = legendFor('both', true);
  assert.equal(l.length, 4);
  assert.equal(l[3].title, 'はいいろ：わりと ひくい（でも ゆだんしない）');
  for (const x of [...l, ...legendFor('both', true, true)]) {
    assert.doesNotMatch(x.title, /[一-鿿]/);
    assert.doesNotMatch(x.fill, /^#(D9|B3|C0|FF0)/i);
  }
  assert.equal(legendFor('both', true, true).length, 5);
});

test('homeQuadrant: 両方モードの組み合わせ', () => {
  assert.equal(homeQuadrant(0.2, 'band').title, '両方に注意');
  assert.equal(homeQuadrant(0.2, 'band').key, 'both');
  assert.equal(homeQuadrant(0.02, 'nearby').title, 'すぐ高い所へ');
  assert.equal(homeQuadrant(0.2, 'none').title, '家の倒壊に注意');
  assert.equal(homeQuadrant(0.02, 'none').title, '比較的低い');
  assert.ok(homeQuadrant(0.02, 'none').action.includes('備えは同じく必要'));
  // 津波が判定できないときは「比較的低い」と言わない
  assert.equal(homeQuadrant(0.02, 'unknown').key, 'unknown');
  assert.ok(homeQuadrant(0.2, 'unknown').action.includes('判定できない'));
  assert.equal(homeQuadrant(null, 'none').key, 'unknown');
});

test('homeQuadrant: 揺れ・津波モードと対応範囲外', () => {
  assert.equal(homeQuadrant(0.2, 'band', 'shake').title, '倒壊の危険 大');
  assert.equal(homeQuadrant(0.05, 'band', 'shake').title, '倒壊の危険 中');
  assert.equal(homeQuadrant(0.001, 'band', 'shake').title, '比較的低い');
  assert.equal(homeQuadrant(0.2, 'band', 'tsunami').title, 'すぐ高い所へ');
  assert.ok(homeQuadrant(0.2, 'none', 'tsunami').action.includes('想定を超える津波'));
  assert.equal(homeQuadrant(0.2, 'unknown', 'tsunami').key, 'unknown');
  const out = homeQuadrant(null, 'unknown', 'both', true);
  assert.equal(out.key, 'outside');
  assert.ok(out.action.includes('対応範囲外'));
});

test('escapeTarget: 浸水域内・すぐ近くのときだけ、いちばん近い津波の避難場所。番号と8方位と距離', () => {
  const far = sh('far', O.lat + 0.01, O.lon);
  const nw = sh('nw', O.lat + 0.003, O.lon - 0.003 / Math.cos((O.lat * Math.PI) / 180));
  const t = escapeTarget(O, [far, nw], 'band')!;
  assert.equal(t.shelter.id, 'nw');
  assert.equal(t.index, 1);
  assert.equal(t.dir, '北西');
  assert.equal(t.dirKids, 'きたにし');
  assert.match(t.text, /^近い津波の避難場所「2」：北西に約4[67]0m（直線）。海から離れる方向とは限りません。道と方向は実際に確かめてください$/);
  assert.equal(t.head + t.rest, t.text);
  assert.equal(t.head, '近い津波の避難場所「2」');
  assert.ok(escapeTarget(O, [far], 'nearby'));
  assert.equal(escapeTarget(O, [far], 'none'), null);
  assert.equal(escapeTarget(O, [far], 'unknown'), null);
  assert.equal(escapeTarget(O, [], 'band'), null);
});

test('escapeTarget: 10m 未満は向きを言わない', () => {
  const t = escapeTarget(O, [sh('a', O.lat + 0.00002, O.lon)], 'band')!;
  assert.equal(t.here, true);
  assert.ok(t.text.includes('すぐ近く'));
});

test('noArrowText: 浸水域外は「念のため」、判定できないときも矢印なしの理由', () => {
  assert.equal(noArrowText('band', true), null);
  assert.ok(noArrowText('band', false)!.includes('データがありません'));
  assert.ok(noArrowText('none', true)!.includes('念のため'));
  assert.ok(noArrowText('unknown', true)!.includes('判定できない'));
});

test('mapAlt: モード・自宅・矢印で文が変わる。揺れモードでは矢印を言わない', () => {
  const e = escapeTarget(O, [sh('a', O.lat + 0.004, O.lon)], 'band');
  const both = mapAlt('both', homeQuadrant(0.2, 'band'), e);
  assert.ok(both.includes('両方の地図'));
  assert.ok(both.includes('近い津波の避難場所'));
  assert.ok(both.includes('両方に注意'));
  const shake = mapAlt('shake', homeQuadrant(0.2, 'band', 'shake'), e);
  assert.ok(shake.includes('揺れの地図'));
  assert.ok(!shake.includes('近い津波の避難場所'));
  assert.doesNotMatch(mapAlt('both', homeQuadrant(0.2, 'band'), e, true), /[一-鿿]/);
});
