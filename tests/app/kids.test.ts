import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIDS_KEY, arrivalLine, bandPhrase, depthReading, fun, houseLegend, intensityFace, intensityPhrase, intensityRuby, intensityStep,
  kidActions, kidClock, kidReviewed, kidSceneCaption, kidShake, loadKids, saveKids, tsunamiKidText,
} from '../../src/app/kids.ts';
import { buildTimeline } from '../../src/app/timeline.ts';
import type { EvacVM, OkHomeVM, TsunamiVM } from '../../src/app/viewmodel.ts';

test('intensityPhrase / step / face: 震度ごと', () => {
  const cases: [string, number, string, string][] = [
    ['震度3以下', 1, 'calm', 'ものが ゆれて おどろく'],
    ['震度4', 2, 'calm', 'ものが ゆれて おどろく'],
    ['震度5弱', 3, 'worried', 'たなの ものが おちる ことも'],
    ['震度5強', 4, 'worried', 'あるくのが むずかしい'],
    ['震度6弱', 5, 'distressed', 'たって いるのが むずかしい'],
    ['震度6強', 6, 'distressed', 'たって いられない。はって うごくのも むずかしい'],
    ['震度7', 7, 'distressed', 'たって いられない。からだが とばされる ことも'],
  ];
  for (const [l, step, face, phrase] of cases) {
    assert.equal(intensityStep(l), step, l);
    assert.equal(intensityFace(l), face, l);
    assert.equal(intensityPhrase(l), phrase, l);
  }
});

test('intensityRuby: 漢字に読み', () => {
  assert.deepEqual(intensityRuby('震度6強'), [{ text: '震度', rt: 'しんど' }, { text: ' 6' }, { text: '強', rt: 'きょう' }]);
  assert.deepEqual(intensityRuby('震度5弱')[2], { text: '弱', rt: 'じゃく' });
  assert.deepEqual(intensityRuby('震度7'), [{ text: '震度', rt: 'しんど' }, { text: ' 7' }]);
  assert.deepEqual(intensityRuby('震度3以下')[2], { text: '以下', rt: 'いか' });
});

test('kidShake: 時間差は強いほうと「Nかいめの じしんで」', () => {
  const s = kidShake('先に東側で震度5強、後に西側で震度6強', true)!;
  assert.equal(s.label, '震度6強');
  assert.equal(s.prefix, '2かいめの じしんで');
  assert.equal(kidShake('先に東側で震度6強、後に西側で震度5強', true)!.prefix, '1かいめの じしんで');
  assert.equal(kidShake('震度6弱', false)!.prefix, null);
  assert.equal(kidShake('なし', false), null);
});

test('fun: ふん／ぷん', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 15, 21, 33].map(fun),
    ['1ぷん', '2ふん', '3ぷん', '4ぷん', '5ふん', '6ぷん', '7ふん', '8ぷん', '9ふん', '10ぷん', 'すぐ', '15ふん', '21ぷん', '33ぷん']);
  assert.equal(kidClock('じしんから', 0), 'じしんが おきた ところ');
  assert.equal(kidClock('1かいめの じしんから', 0.5), '1かいめの じしんが おきた ところ');
  assert.equal(kidClock('じしんから', 5), 'じしんから 5ふん');
  assert.equal(kidClock('じしんから', 2.99), 'じしんから 2ふん');
});

test('bandPhrase: 段階の代表値ごと', () => {
  assert.equal(bandPhrase(0.15), 'あしくび くらい。それでも ながされる ことが ある');
  assert.equal(bandPhrase(0.4), 'ひざ くらい。おとなでも あるけない');
  assert.equal(bandPhrase(0.75), 'こしより ふかい');
  assert.equal(bandPhrase(2), 'おとなの せたけより ふかい');
  assert.equal(bandPhrase(4), 'いえの 2かいまで');
  assert.equal(bandPhrase(7.5), 'やねの ちかくまで');
  assert.equal(bandPhrase(15), 'いえより たかい');
  assert.equal(depthReading('1〜3m'), '1から 3メートル');
});

test('houseLegend: おとなの 10軒と同じ数。1軒未満は「1けんより すくない」', () => {
  const a = houseLegend(0.6, 0.3);
  assert.equal(a.full, 6); assert.equal(a.half, 3);
  assert.equal(a.fullText, 'こわれて すめなくなる … 6けんくらい');
  assert.equal(a.halfText, 'かたむいたり ひびが はいる … 3けんくらい');
  assert.equal(a.restText, 'のこり（すこしは こわれるかも）');
  const b = houseLegend(0.0005, 0.02);
  assert.equal(b.full, 0);
  assert.equal(b.fullText, 'こわれて すめなくなる … 1けんより すくない');
  assert.equal(b.halfText, 'かたむいたり ひびが はいる … 1けんより すくない');
  assert.equal(houseLegend(0, 0).fullText, 'こわれて すめなくなる … 0けんくらい');
});

const band = (arrivalMin: number | null, mid = 2, kind: 'band' | 'nearby' = 'band'): TsunamiVM =>
  ({ kind, depth: '1〜3m', arrival: null, urgent: arrivalMin === null || arrivalMin <= 5, mid, arrivalMin });

test('arrivalLine: N分 / すぐ（不明・5分以内）/ なし', () => {
  assert.equal(arrivalLine(band(15.2))!.text, 'はやいと 15ふんで うみに つく。もっと はやく くる ことも あるよ。まって いたら まにあわない！');
  assert.equal(arrivalLine(band(3))!.text, 'すぐ くるかも。まって いたら まにあわない！');
  assert.equal(arrivalLine(band(5))!.soon, true);
  assert.equal(arrivalLine(band(null))!.text, 'すぐ くるかも。まって いたら まにあわない！');
  assert.equal(arrivalLine({ kind: 'none' }), null);
});

test('tsunamiKidText / kidActions: 種類ごと', () => {
  assert.deepEqual(tsunamiKidText(band(10)).lines, ['おとなの せたけより ふかい。']);
  assert.deepEqual(tsunamiKidText(band(10, 4, 'nearby')).lines, ['いえの ちかくまで みずが くる かも。', 'いえの 2かいまで。']);
  assert.equal(tsunamiKidText({ kind: 'none' }).lines[0], 'ここは みずが こない よそう。でも、よそうより おおきい つなみが くる ことも あるよ。うみの ちかくで つよく ゆれたら、たかい ところへ');
  assert.match(tsunamiKidText({ kind: 'unknown' }).lines[0], /^みずが くるか わからない/);
  assert.equal(kidActions(band(10))[1].big, 'たかい ところへ にげる');
  assert.equal(kidActions(band(10))[1].red, true);
  const none = kidActions({ kind: 'none' })[1];
  assert.equal(`${none.small} ${none.big}`, 'ゆれが とまったら たかい ところへ');
  assert.equal(none.red, false);
  const generic = kidActions(band(10), true)[1];
  assert.equal(`${generic.small} ${generic.big}`, 'ゆれが とまったら たかい ところへ');
  assert.equal(generic.red, false);
});

test('kidSceneCaption: 場面ごとの ことば（筋書きは buildTimeline）', () => {
  const home: OkHomeVM = { status: 'ok', intensityLabel: '震度6強', collapse: { min: '1%', max: '5%', central: '3%' }, half: { min: '1%', max: '5%', central: '3%' }, liquefaction: null, tsunami: band(15), notes: [] };
  const evac: EvacVM[] = [
    { hazard: 'earthquake', notices: [], arrivalCm: null, items: [{ name: 'A', distance: '約100m', walkStandard: '約2分', walkSlow: '約4分', reach: 'n/a', reachText: '' }] },
    { hazard: 'tsunami', notices: [], arrivalCm: 30, items: [{ name: 'B', distance: '約100m', walkStandard: '約2分', walkSlow: '約4分', reach: 'ok', reachText: '' }] },
  ];
  const tl = buildTimeline({ scenario: 'L2', home, tsunami: band(15), evac });
  const caps = tl.scenes.map((_, i) => kidSceneCaption(tl, i));
  assert.deepEqual(caps.map((c) => c.big), ['あたまを まもる', 'たかい ところへ にげる', 'もどっては だめ', 'みずが ここまで くる かも', 'きめた ばしょで あう']);
  assert.deepEqual(caps.map((c) => c.red), [false, true, true, false, false]);
  assert.match(caps[2].note, /はやいと 15ふんで うみに つく。もっと はやく くる ことも あるよ。/);
  assert.equal(caps[1].noteRed, undefined);
  assert.match(caps[3].note, /おとなの せたけより ふかい/);
  const lag = buildTimeline({ scenario: 'LAG_EW', home: { ...home, intensityLabel: '先に東側で震度5強、後に西側で震度6強' }, tsunami: band(15), evac });
  assert.equal(kidSceneCaption(lag, 1).note, '1かいめの じしんでも つなみが くる ことが あるよ。ゆれが とまったら たかい ところへ');
  // 間に合わない（避難場所が遠い）
  const far = evac.map((e) => ({ ...e, items: e.items.map((it) => ({ ...it, walkSlow: '約60分' })) }));
  const late = buildTimeline({ scenario: 'L2', home, tsunami: band(15), evac: far });
  assert.equal(kidSceneCaption(late, 1).note, 'とおくに いく より、ちかくの たかい たてものへ');
  assert.equal(kidSceneCaption(late, 1).noteRed, true);
  // ぎりぎり（ゆっくり 6分 + 5分 = 11分、到達 15分）
  const mid = evac.map((e) => ({ ...e, items: e.items.map((it) => ({ ...it, walkSlow: '約6分' })) }));
  const tight = buildTimeline({ scenario: 'L2', home, tsunami: band(15), evac: mid });
  assert.equal(kidSceneCaption(tight, 1).note, 'ぎりぎり。まよわず すぐ にげる。ちかくの たかい ところも かんがえて');
  assert.equal(kidSceneCaption(tight, 1).noteRed, true);
  // つなみが こない よそう
  const dry = buildTimeline({ scenario: 'L2', home, tsunami: { kind: 'none' }, evac });
  const ev = kidSceneCaption(dry, 1);
  assert.equal(`${ev.small} ${ev.big}`, 'ゆれが とまったら たかい ところへ');
  assert.equal(ev.red, false);
});

test('loadKids / saveKids: 既定は おとな。壊れた storage でも落ちない', () => {
  const m = new Map<string, string>();
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.equal(loadKids(st), false);
  saveKids(st, true);
  assert.equal(m.get(KIDS_KEY), '1');
  assert.equal(loadKids(st), true);
  saveKids(st, false);
  assert.equal(m.get(KIDS_KEY), '0');
  const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  assert.equal(loadKids(bad), false);
  saveKids(bad, true);
  assert.equal(loadKids(null), false);
});

test('kidReviewed', () => {
  assert.equal(kidReviewed('2026-11-12'), '2026ねん 11がつ12にち に みなおしたよ');
  assert.equal(kidReviewed(null), null);
});
