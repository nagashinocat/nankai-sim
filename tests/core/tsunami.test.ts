import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TSUNAMI_BANDS, bandFromRgba } from '../../src/core/tsunami.ts';
import { EVAC_START_MIN } from '../../src/core/evacuation.ts';


const LEGEND: [number, number, number][] = [
  [255, 255, 179], [247, 245, 169], [248, 225, 166], [255, 216, 192],
  [255, 183, 183], [255, 145, 145], [242, 133, 201], [220, 122, 220],
];

test('8 bands with verified legend RGB and ranges', () => {
  assert.equal(TSUNAMI_BANDS.length, 8);
  assert.deepEqual(TSUNAMI_BANDS.map((b) => b.rgb), LEGEND);
  const last = TSUNAMI_BANDS[7];
  assert.equal(last.hi, 20);
  assert.equal(last.mid, 20);
  for (const b of TSUNAMI_BANDS) assert.ok(b.lo <= b.mid && b.mid <= b.hi);
});

test('EVAC_START_MIN = 5', () => assert.equal(EVAC_START_MIN, 5));

test('bandFromRgba: exact legend colours', () => {
  LEGEND.forEach(([r, g, b], i) => assert.equal(bandFromRgba(r, g, b, 255), TSUNAMI_BANDS[i]));
});

test('bandFromRgba: colour off by distance 10 still matches', () => {
  LEGEND.forEach(([r, g, b], i) => {
    const r2 = r >= 10 ? r - 10 : r + 10;
    assert.equal(bandFromRgba(r2, g, b, 255), TSUNAMI_BANDS[i]);
  });
});

test('bandFromRgba: transparent = none, far colour = unknown', () => {
  assert.equal(bandFromRgba(255, 255, 179, 0), 'none');
  assert.equal(bandFromRgba(255, 255, 179, 127), 'none');
  assert.equal(bandFromRgba(0, 0, 255, 255), 'unknown');
});
