import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EvacVM, OkHomeVM, TsunamiVM } from '../../src/app/viewmodel.ts';
import {
  PLAYER_TEXT, arrivalCaption, buildTimeline, clockText, parseWalkMin, realDurationSec, sceneAt, type TimedPhase,
} from '../../src/app/timeline.ts';

const range = { min: '1.0%', max: '5.0%', central: '2.0%' };
const home = (intensityLabel = '震度6強'): OkHomeVM => ({
  status: 'ok', intensityLabel, collapse: range, half: range, liquefaction: null, tsunami: { kind: 'none' }, notes: [],
});
const item = (name: string, walkSlow: string) => ({ name, distance: '約300m', walkStandard: '約4分', walkSlow, reach: 'n/a' as const, reachText: '' });
const evac = (tsunamiWalk = '約8分', cm: number | null = 30): EvacVM[] => [
  { hazard: 'earthquake', notices: [], arrivalCm: null, items: [item('○○小学校', '約6分')] },
  { hazard: 'tsunami', notices: [], arrivalCm: cm, items: [item('△△津波避難ビル', tsunamiWalk)] },
];
const band = (arrivalMin: number | null, urgent = false): TsunamiVM => ({
  kind: 'band', depth: '1〜3m', arrival: arrivalMin === null ? null : `海岸への到達 最短約${arrivalMin}分（30cm）`, urgent, mid: 2, arrivalMin,
});

test('L2・浸水域内・到達15分: 揺れ→避難→到達→浸水→まとめ の順と分', () => {
  const tl = buildTimeline({ scenario: 'L2', home: home(), tsunami: band(15), evac: evac() });
  assert.deepEqual(tl.scenes.map((s) => [s.kind, s.atMin]), [['shake', 0], ['evac', 5], ['arrival', 15], ['water', null], ['end', null]]);
  const main = tl.phases[0] as TimedPhase;
  assert.equal(main.type, 'timed');
  assert.equal(main.clockLabel, '地震発生から');
  assert.equal(main.intensity, '震度6強');
  assert.equal(main.arrivalMin, 15);
  assert.deepEqual(main.walk, { startMin: 5, endMin: 13, walkMin: 8, shelter: '△△津波避難ビル', hazard: 'tsunami' });
  assert.equal(tl.scenes[0].caption, PLAYER_TEXT.shake);
  assert.equal(tl.scenes[1].caption, '揺れが収まったらすぐ高い所へ');
  assert.equal(tl.scenes[2].caption, '最短約15分で海岸に津波（30cm）');
  assert.equal(tl.end.walk?.text, '避難場所に着く：約13分（揺れが収まってから歩いた場合）');
  assert.equal(tl.end.arrival?.text, '海岸に津波：最短約15分');
  assert.equal(tl.end.late, null);
  assert.equal(tl.end.tight, PLAYER_TEXT.tight); // 8 + 5 = 13 は 15 − 5 より遅い
  assert.equal(main.late, false);
  assert.equal(tl.end.strong, '到達時間を待たずに、すぐ高い所へ');
  assert.equal(tl.end.note, 'これは想定をもとにした目安の再現です');
  // 再生は90秒以内
  assert.ok(realDurationSec(tl) <= 90);
  assert.ok(tl.speed >= 10);
  // 時刻からの場面
  assert.equal(sceneAt(tl, 0, 0), 0);
  assert.equal(sceneAt(tl, 0, 4.9), 0);
  assert.equal(sceneAt(tl, 0, 5), 1);
  assert.equal(sceneAt(tl, 0, 15), 2);
});

test('到達時間の高さが30cmより高いときは「— これより低い津波は…」を足す', () => {
  assert.equal(arrivalCaption(15, 100), '最短約15分で海岸に津波（1m）— これより低い津波はもっと早く着くことがあります');
  assert.equal(arrivalCaption(15.4, 30), '最短約15分で海岸に津波（30cm）');
  const tl = buildTimeline({ scenario: 'L2', home: home(), tsunami: band(20), evac: evac('約8分', 50) });
  assert.match(tl.scenes.find((s) => s.kind === 'arrival')!.caption, /（50cm）— これより低い/);
});

test('到達時間がわからない・5分以内: 数え下ろさず、避難の場面で「すぐ」', () => {
  for (const a of [null, 4]) {
    const tl = buildTimeline({ scenario: 'L2', home: home(), tsunami: band(a, true), evac: evac() });
    assert.deepEqual(tl.scenes.map((s) => s.kind), ['shake', 'evac', 'water', 'end']);
    assert.equal(tl.scenes[1].caption, '到達時間がわからない／とても早い：揺れが収まったらすぐ');
    assert.equal((tl.phases[0] as TimedPhase).arrivalMin, null);
    assert.equal(tl.end.arrival, null);
    assert.match(tl.end.late!, /近くの高い建物（津波避難ビル）や高台へ/);
    assert.match(tl.end.arrivalUnknown!, /到達時間がわからない／とても早い/);
  }
});

test('間に合うかの判定は避難場所リストと同じ（reachBeforeTsunami・丸めない到達時間）', () => {
  const late = buildTimeline({ scenario: 'L2', home: home(), tsunami: band(15), evac: evac('約11分') });
  assert.equal(late.end.walk?.min, 16);
  assert.equal(late.end.late, '間に合わないおそれ：近くの高い建物（津波避難ビル）や高台へ');
  assert.equal(late.end.tight, null);
  const p = late.phases[0] as TimedPhase;
  assert.equal(p.late, true);
  // 着く時刻まで歩かせず、到達で止める
  assert.equal(p.endMin, 15.5);
  const tight = buildTimeline({ scenario: 'L2', home: home(), tsunami: band(15), evac: evac('約10分') });
  assert.equal(tight.end.late, null);
  assert.equal(tight.end.tight, 'ぎりぎり：迷わずすぐ。より近い高い場所も考えて');
  assert.equal((tight.phases[0] as TimedPhase).late, false);
  // 9分 + 5分 = 14 は 15 − 5 より遅いので「ぎりぎり」（リストと同じ）
  assert.equal(buildTimeline({ scenario: 'L2', home: home(), tsunami: band(15), evac: evac('約9分') }).end.tight, PLAYER_TEXT.tight);
  const ok = buildTimeline({ scenario: 'L2', home: home(), tsunami: band(15), evac: evac('約4分') });
  assert.equal(ok.end.late, null);
  assert.equal(ok.end.tight, null);
  // 丸めない到達時間と比べる: 表示は同じ「約15分」どうしでも 14.6 分なら間に合わないおそれ、15.4 分ならぎりぎり
  const a = buildTimeline({ scenario: 'L2', home: home(), tsunami: band(14.6), evac: evac('約10分') });
  assert.equal(a.end.arrival?.min, 15);
  assert.equal(a.end.late, PLAYER_TEXT.late);
  const b = buildTimeline({ scenario: 'L2', home: home(), tsunami: band(15.4), evac: evac('約10分') });
  assert.equal(b.end.late, null);
  assert.equal(b.end.tight, PLAYER_TEXT.tight);
});

test('判定できない（unknown）: まとめに「判定できませんでした」', () => {
  const tl = buildTimeline({ scenario: 'L2', home: home(), tsunami: { kind: 'unknown' }, evac: evac() });
  assert.deepEqual(tl.scenes.map((s) => s.kind), ['shake', 'evac', 'end']);
  assert.equal(tl.end.unknown, 'この場所の津波の想定を判定できませんでした。海の近くでは強い揺れを感じたらすぐ高い所へ');
  assert.equal(tl.end.outside, null);
  assert.equal(buildTimeline({ scenario: 'L2', home: home(), tsunami: { kind: 'none' }, evac: evac() }).end.unknown, null);
});

test('避難場所はあるが徒歩の時間が読めない: 「徒歩の時間がわかりません」', () => {
  const tl = buildTimeline({ scenario: 'L2', home: home(), tsunami: band(15), evac: evac('—') });
  const p = tl.phases[0] as TimedPhase;
  assert.equal(p.walk, null);
  assert.deepEqual(p.shelter, { name: '△△津波避難ビル', hazard: 'tsunami' });
  assert.equal(tl.end.walkUnknown, '徒歩の時間がわかりません');
  assert.equal(tl.end.noShelter, null);
  assert.equal(tl.end.late, null);
});

test('浸水域外（none）: 地震の避難場所へ、浸水の場面なし、最後に「想定を超える津波も」', () => {
  const tl = buildTimeline({ scenario: 'L2', home: home(), tsunami: { kind: 'none' }, evac: evac() });
  assert.deepEqual(tl.scenes.map((s) => s.kind), ['shake', 'evac', 'end']);
  assert.equal((tl.phases[0] as TimedPhase).walk?.shelter, '○○小学校');
  assert.equal(tl.end.outside, '想定の浸水域外ですが、想定を超える津波もあり得ます');
  assert.equal(tl.end.arrival, null);
  assert.equal(tl.end.arrivalUnknown, null);
  assert.equal(tl.scenes[1].caption, '揺れが収まったらすぐ高い所へ');
});

test('近く（nearby）: 浸水の場面は「近く（自宅の地点は浸水域外）」', () => {
  const t: TsunamiVM = { ...band(15), kind: 'nearby', depth: '3〜5m', mid: 4 } as TsunamiVM;
  const tl = buildTimeline({ scenario: 'L2', home: home(), tsunami: t, evac: evac() });
  assert.match(tl.scenes.find((s) => s.kind === 'water')!.caption, /^近く（自宅の地点は浸水域外）の浸水（想定 3〜5m/);
});

test('時間差のタブ: 先発の揺れ→後発までの間→後発の揺れ（津波はそのあと）', () => {
  const tl = buildTimeline({ scenario: 'LAG_EW', home: home('先に東側で震度6弱、後に西側で震度6強'), tsunami: band(15), evac: evac() });
  assert.deepEqual(tl.scenes.map((s) => [s.kind, s.phase, s.atMin]), [
    ['shake', 0, 0], ['evac', 0, 5], ['gap', 1, null], ['shake', 2, 0], ['evac', 2, 5], ['arrival', 2, 15], ['water', 3, null], ['end', 4, null],
  ]);
  // 先発の地震でも津波は来うる（波は描かない）
  assert.equal(tl.scenes[1].caption, '先発の地震でも津波が来ることがあります。揺れが収まったらすぐ高い所へ（この再現では津波を後発の地震でまとめて示しています）');
  assert.equal(tl.scenes[2].caption, '後発の地震：数時間後〜数年後かもしれません（わからない）');
  const p0 = tl.phases[0] as TimedPhase, p2 = tl.phases[2] as TimedPhase;
  assert.equal(p0.intensity, '震度6弱');
  assert.equal(p0.walk, null);
  assert.equal(p0.arrivalMin, null);
  assert.ok(p0.endMin > 5);
  assert.equal(p2.intensity, '震度6強');
  assert.equal(p2.clockLabel, '後発の地震発生から');
  assert.equal(p2.arrivalMin, 15);
  assert.ok(realDurationSec(tl) <= 90);
});

test('半割れは最大クラスと同じ筋書き。自宅の結果が無くても再生できる（震度なし）', () => {
  const tl = buildTimeline({ scenario: 'HALF_E', home: { status: 'nodata' }, tsunami: band(15), evac: evac() });
  assert.deepEqual(tl.scenes.map((s) => s.kind), ['shake', 'evac', 'arrival', 'water', 'end']);
  assert.equal((tl.phases[0] as TimedPhase).intensity, null);
});

test('到達が遅い・歩くのが長いときは時計を速くして90秒以内', () => {
  const tl = buildTimeline({ scenario: 'L2', home: home(), tsunami: band(90), evac: evac('約70分') });
  assert.ok(tl.speed > 15);
  assert.ok(realDurationSec(tl) <= 90);
});

test('避難場所が無いときは歩く場面の人を出さず、まとめに一言', () => {
  const ev = evac().map((e) => ({ ...e, items: [] }));
  const tl = buildTimeline({ scenario: 'L2', home: home(), tsunami: band(15), evac: ev });
  assert.equal((tl.phases[0] as TimedPhase).walk, null);
  assert.equal(tl.end.walk, null);
  assert.equal(tl.end.noShelter, '近くに該当する避難場所のデータがありません');
  assert.equal(tl.end.walkUnknown, null);
  assert.equal((tl.phases[0] as TimedPhase).shelter, null);
});

test('clockText・parseWalkMin', () => {
  assert.equal(clockText('地震発生から', 0), '地震発生から 0分00秒');
  assert.equal(clockText('地震発生から', 5.5), '地震発生から 5分30秒');
  assert.equal(parseWalkMin('約12分'), 12);
  assert.equal(parseWalkMin('—'), null);
});
