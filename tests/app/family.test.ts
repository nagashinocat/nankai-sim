import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILY_BACKUP_KEY, FAMILY_KEY, MAX_LINE, MAX_ROWS, emptyFamily, familyText, isEmptyFamily, loadFamily, parseFamily, saveFamily, serializeFamily,
} from '../../src/app/family.ts';

function memStore() {
  const raw = new Map<string, string>();
  return { raw, getItem: (k: string) => raw.get(k) ?? null, setItem: (k: string, v: string) => void raw.set(k, v) };
}

test('往復: 書いた値がそのまま戻る', () => {
  const m = { ...emptyFamily(), tsunami: '〇〇小学校の屋上', meet1: '公園', rows: [{ who: 'たろう', memo: '平日昼は小学校' }], reviewed: '2026-11-12', items: 'リュック（玄関）' };
  assert.deepEqual(parseFamily(serializeFamily(m)), m);
});

test('壊れた入力・知らない版・型違いでも空のメモを返し、例外を出さない', () => {
  for (const raw of [null, undefined, '', '{oops', '[]', '"x"', 'null', '{"v":2,"tsunami":"x"}', '{"tsunami":"x"}']) {
    assert.deepEqual(parseFamily(raw), emptyFamily(), String(raw));
  }
  const odd = parseFamily('{"v":1,"tsunami":5,"rows":"no","reviewed":"きのう"}');
  assert.deepEqual(odd, emptyFamily());
});

test('長さを切り詰める（1行200字・行は8件まで）', () => {
  const long = 'あ'.repeat(500);
  const rows = Array.from({ length: 12 }, () => ({ who: long, memo: long }));
  const m = parseFamily(JSON.stringify({ v: 1, tsunami: long, rows }));
  assert.equal(m.tsunami.length, MAX_LINE);
  assert.equal(m.rows.length, MAX_ROWS);
  assert.equal(m.rows[0].who.length, MAX_LINE);
  const again = parseFamily(serializeFamily({ ...emptyFamily(), tsunami: long, rows }));
  assert.equal(again.tsunami.length, MAX_LINE);
  assert.equal(again.rows.length, MAX_ROWS);
});

test('文面: 空の項目は出さず、書いた項目だけ。見直した日が末尾', () => {
  assert.equal(familyText(emptyFamily()), '【わが家の災害時の決まり】');
  assert.ok(isEmptyFamily(emptyFamily()));
  const t = familyText({ ...emptyFamily(), tsunami: '高台の公民館', meet2: '駅前', reviewed: '2026-01-05' });
  assert.ok(t.startsWith('【わが家の災害時の決まり】'));
  assert.match(t, /■津波のときの避難先\n高台の公民館/);
  assert.match(t, /第2：駅前/);
  assert.doesNotMatch(t, /第1/);
  assert.doesNotMatch(t, /地震（火事など）/);
  assert.doesNotMatch(t, /連絡のしかた/);
  assert.ok(t.endsWith('見直した日：2026年1月5日'));
});

test('文面: 家族の予定は空の行を飛ばし、名前だけ・メモだけも出す', () => {
  const t = familyText({ ...emptyFamily(), rows: [{ who: '母', memo: '平日昼は職場' }, { who: '', memo: '' }, { who: '祖母', memo: '' }, { who: '', memo: '塾' }] });
  assert.match(t, /■家族それぞれの予定\n・母：平日昼は職場\n・祖母\n・塾$/);
});

test('読み込み: 壊れた値は消さずバックアップに一度だけ写す', () => {
  const st = memStore();
  st.raw.set(FAMILY_KEY, '{broken');
  assert.deepEqual(loadFamily(st), emptyFamily());
  assert.equal(st.raw.get(FAMILY_KEY), '{broken');
  assert.equal(st.raw.get(FAMILY_BACKUP_KEY), '{broken');
  st.raw.set(FAMILY_KEY, '{broken2');
  loadFamily(st);
  assert.equal(st.raw.get(FAMILY_BACKUP_KEY), '{broken'); // 上書きしない
});

test('保存して読み込むと同じ。保存できない端末では false', () => {
  const st = memStore();
  const m = { ...emptyFamily(), meet1: '学校の校庭' };
  assert.equal(saveFamily(m, st), true);
  assert.deepEqual(loadFamily(st), m);
  assert.equal(saveFamily(m, { setItem: () => { throw new Error('quota'); } }), false);
});
