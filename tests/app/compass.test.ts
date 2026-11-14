import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headingFromEvent } from '../../src/app/compass.ts';

test('iPhone: webkitCompassHeading（時計回り）をそのまま使う', () => {
  assert.equal(headingFromEvent({ webkitCompassHeading: 0, alpha: 123 }), 0);
  assert.equal(headingFromEvent({ webkitCompassHeading: 90, alpha: 10, absolute: false }), 90);
  assert.equal(headingFromEvent({ webkitCompassHeading: 359.5 }), 359.5);
});

test('Android: absolute の alpha（反時計回り）は 360 - alpha。東を向くと 90', () => {
  assert.equal(headingFromEvent({ alpha: 0, absolute: true }), 0);
  assert.equal(headingFromEvent({ alpha: 270, absolute: true }), 90); // 東向き（iPhone の 90 と同じ向き）
  assert.equal(headingFromEvent({ alpha: 90, absolute: true }), 270); // 西向き
  assert.equal(headingFromEvent({ alpha: 360, absolute: true }), 0);
});

test('北の基準が無い（相対の alpha）・値なしは null', () => {
  assert.equal(headingFromEvent({ alpha: 120, absolute: false }), null);
  assert.equal(headingFromEvent({ alpha: 120 }), null);
  assert.equal(headingFromEvent({ alpha: null, absolute: true }), null);
  assert.equal(headingFromEvent({ webkitCompassHeading: -1 }), null); // iOS の「不明」
  assert.equal(headingFromEvent({ webkitCompassHeading: Number.NaN, alpha: Number.NaN, absolute: true }), null);
  assert.equal(headingFromEvent({}), null);
});

test('画面の回転（横向き）を足す', () => {
  assert.equal(headingFromEvent({ webkitCompassHeading: 350 }, 90), 80);
  assert.equal(headingFromEvent({ alpha: 0, absolute: true }, 270), 270);
  assert.equal(headingFromEvent({ alpha: 0, absolute: true }, Number.NaN), 0);
});
