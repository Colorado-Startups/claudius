// quality/score-log.mjs: the score and work queue lines the pages build prints (#81).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { queueLine, scoreLines } from '../quality/score-log.mjs';

const overall = { master: { score: 92, metricsMeasured: 56, metricsTotal: 59 }, quality: { score: 85 }, speed: { score: 100 }, consumption: { score: 90 } };
const row = { gain: 5.6, tab: 'cp-threads', status: 'misses', entry: { value: 60 }, def: { id: 'cp_threads.attributed_share', unit: '%', goal: 100, direction: 'higher' } };

test('score-log: the head line gives the master score, each category and the metrics read', () => {
  assert.equal(scoreLines(overall, [])[0], 'score 92 (quality 85, speed 100, consumption 90); 56 of 59 metrics read');
});

test('score-log: a run with nothing short says so, and one with misses lists each by gain', () => {
  assert.equal(scoreLines(overall, [])[1], 'every metric read meets its goal');
  const lines = scoreLines(overall, [row]);
  assert.equal(lines[1], '1 metric(s) short of their goal, by master points gained:');
  assert.equal(lines[2], '  +5.6 cp-threads cp_threads.attributed_share misses 60 % (goal 100, at least)');
});

test('score-log: a lower-is-better goal reads at most, and a metric with no unit prints none', () => {
  const lower = { ...row, def: { id: 'x.y', goal: 5, direction: 'lower' }, status: 'near', entry: { value: 7 } };
  assert.equal(queueLine(lower), '  +5.6 cp-threads x.y near 7 (goal 5, at most)');
});
