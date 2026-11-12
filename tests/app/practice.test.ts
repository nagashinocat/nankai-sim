import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCENES, PRACTICE_NOTICE, SUMMARY_WARNING, TSUNAMI_URGENT_LINE, TSUNAMI_UNKNOWN_LINE, SHAKE_LINE, summaryLines, isUrgentTsunami } from '../../src/app/practice/scenes.ts';

test('場面は6つ。各場面の最適は1つだけ。選択肢は3つ', () => {
  assert.equal(SCENES.length, 6);
  for (const s of SCENES) {
    assert.equal(s.choices.length, 3);
    assert.equal(s.choices.filter((c) => c.best).length, 1);
  }
  assert.deepEqual(SCENES.map((s) => s.day), ['0日目 夜', '1日目 朝', '2日目', '3日目 夜', '5日目', '7日目']);
});

test('文言: 主要な文字列が計画どおり', () => {
  assert.equal(PRACTICE_NOTICE, 'これは練習です。臨時情報は地震の予知ではなく、発表されても実際に地震が起きるかはわかりません。実際に発表されたときは、テレビ・ラジオ・自治体の情報に従ってください');
  const s = SCENES;
  assert.equal(s[0].situation, '南海トラフ沿いでM7クラスの地震が起き、『南海トラフ地震臨時情報（巨大地震注意）』が発表されました。あなたの住む地域では大きな被害はありません');
  assert.equal(s[0].question, '今夜、どうしますか？');
  assert.deepEqual(s[0].choices, [
    { text: 'すぐ逃げられる服装で寝て、非常持出品を枕元に置く', best: true },
    { text: '念のため家族全員で避難所に泊まりに行く', best: false },
    { text: 'いつもどおりパジャマで寝る', best: false },
  ]);
  assert.equal(s[0].explanation, '巨大地震注意では事前の避難は求められません。日頃の備えを確かめ、すぐ逃げられる態勢をとったうえで、普段の生活を続けます');
  assert.equal(s[1].question, '仕事や学校はどうしますか？');
  assert.equal(s[1].choices[0].text, '普段どおり行くが、非常持出品を持ち歩く');
  assert.equal(s[1].choices[1].text, '1週間は家から出ない');
  assert.equal(s[1].choices[2].text, '何も持たずに普段どおり行く');
  assert.equal(s[1].explanation, '社会経済活動は続けます。そのうえで、非常持出品を常に持ち歩くなどの『特別な備え』をします');
  assert.equal(s[2].question, '家の中で確かめておくことは？');
  assert.equal(s[2].choices[0].text, '避難場所と避難経路、家族との連絡方法、家具の固定、備蓄を確かめる');
  assert.equal(s[2].choices[1].text, '水と食料を大量に買い足す');
  assert.equal(s[2].choices[2].text, '特に何もしない');
  assert.equal(s[2].explanation, '日頃からの備えの再確認が呼びかけられます：避難場所・避難経路の確認、家族との連絡手段の確認、家具等の固定、非常食などの備蓄の確認');
  assert.equal(s[3].question, 'どの部屋で寝ますか？');
  assert.deepEqual(s[3].choices.map((c) => c.text), ['倒れてくる家具がない、なるべく安全な部屋', 'いつもの部屋（たんすの横）', '車の中']);
  assert.equal(s[3].explanation, '屋内のできるだけ安全な場所で過ごし、寝るときもすぐ逃げられるようにします');
  assert.equal(s[4].situation, 'SNSで『今週中に必ず巨大地震が来る』という投稿が広まっています');
  assert.deepEqual(s[4].choices.map((c) => c.text), ['気象庁や自治体の情報を確かめ、むやみに広めない', '家族や友人にすぐ転送する', '怖いので情報を見ないようにする']);
  assert.equal(s[4].explanation, '臨時情報は地震の予知ではありません。公式の情報を確かめましょう');
  assert.equal(s[5].situation, '地震発生から1週間が過ぎ、特別な注意の呼びかけが終わりました');
  assert.equal(s[5].question, 'これからは？');
  assert.deepEqual(s[5].choices.map((c) => c.text), ['普段の生活に戻るが、地震の可能性がなくなったわけではないので備えは続ける', 'もう大きな地震は来ないので、非常持出品を片づける', '念のためあと1か月は家から出ない']);
  assert.equal(s[5].explanation, '呼びかけは1週間（地震発生から168時間経過した以降の正時まで）です。終わっても大規模地震の可能性がなくなったわけではありません');
});

test('まとめ: 自宅の結果なし／津波が急ぐ／それ以外', () => {
  assert.equal(SUMMARY_WARNING, '『巨大地震警戒』が出た場合は、地震が起きてからの避難では間に合わないおそれのある地域で、1週間の事前避難が求められます。お住まいの地域が対象かは市町村に確認してください');
  assert.deepEqual(summaryLines(4, null), [expect4(), SUMMARY_WARNING]);
  assert.deepEqual(summaryLines(6, { urgentTsunami: true, tsunamiUnknown: false }), [expect(6), SUMMARY_WARNING, TSUNAMI_URGENT_LINE]);
  assert.deepEqual(summaryLines(0, { urgentTsunami: false, tsunamiUnknown: false }), [expect(0), SUMMARY_WARNING, SHAKE_LINE]);
  assert.deepEqual(summaryLines(3, { urgentTsunami: false, tsunamiUnknown: true }), [expect(3), SUMMARY_WARNING, TSUNAMI_UNKNOWN_LINE]);
  assert.equal(TSUNAMI_UNKNOWN_LINE, '津波の想定を確かめられませんでした。お住まいの市町村のハザードマップで確認してください');
  assert.equal(TSUNAMI_URGENT_LINE, 'あなたの家は津波の到達が早い／浸水が想定される場所です。『巨大地震警戒』のときに事前避難の対象になっていないか、市町村に確認してください');
  assert.equal(SHAKE_LINE, '揺れへの備え（家具の固定・耐震）を確かめておきましょう');
});
const expect = (n: number) => `最適な行動を選べた数：6問中 ${n}問`;
const expect4 = () => expect(4);

test('isUrgentTsunami: 津波の段階あり、または到達10分以内', () => {
  assert.equal(isUrgentTsunami('band', null), true);
  assert.equal(isUrgentTsunami('nearby', 40), true);
  assert.equal(isUrgentTsunami('none', 10), true);
  assert.equal(isUrgentTsunami('none', 10.5), false);
  assert.equal(isUrgentTsunami('none', null), false);
  assert.equal(isUrgentTsunami('unknown', 30), false);
  assert.equal(isUrgentTsunami('none', NaN), false);
});
