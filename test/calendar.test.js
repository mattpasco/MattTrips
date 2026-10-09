/**
 * Contract tests for calendar.js, the month grid of the calendar view. Run: node --test test/
 * A trip covers the days from its report to its release, as local dates of its base. Weeks start
 * on Sunday. October 2026 starts on a Thursday and ends on a Saturday: its grid is Sep 27 to Oct 31,
 * and then one more week, Nov 1 to 7: the first week of the next month, for a trip that carries over.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../calendar.js');

const tzOf = base => ({ MEM: 'America/Chicago', HNL: 'Pacific/Honolulu' })[base];
const trip = (id, show, end, base = 'MEM') => ({ id, base, show, end });
const OCT = 9; // month index of October
const grid = (trips, month = OCT, year = 2026) => C.monthGrid(year, month, trips, tzOf);
const bars = (weeks, w) => weeks[w].bars.map(b => [b.id, b.from, b.to, b.lane, b.continuesLeft, b.continuesRight]);

test('localDate: the date in the given time zone, not the Zulu date', () => {
  assert.equal(C.localDate('2026-10-02T03:00:00Z', 'America/Chicago'), '2026-10-01'); // 22:00 CDT
  assert.equal(C.localDate('2026-10-02T03:00:00Z', 'Asia/Tokyo'), '2026-10-02'); // 12:00 JST
  assert.equal(C.localDate('2026-12-01T05:59:00Z', 'America/Chicago'), '2026-11-30'); // 23:59 CST
  assert.equal(C.localDate('2026-12-01T06:00:00Z', 'America/Chicago'), '2026-12-01');
});

test('a month with no trips: whole weeks from Sunday to Saturday, days outside the month are marked', () => {
  const weeks = grid([]);
  assert.equal(weeks.length, 6);
  assert.ok(weeks.every(w => w.days.length === 7 && w.bars.length === 0));
  assert.deepEqual([weeks[0].days[0].date, weeks[0].days[0].inMonth], ['2026-09-27', false]);
  assert.deepEqual([weeks[0].days[4].date, weeks[0].days[4].inMonth], ['2026-10-01', true]);
  assert.deepEqual([weeks[4].days[6].date, weeks[4].days[6].inMonth], ['2026-10-31', true]);
  assert.equal(weeks.flatMap(w => w.days).filter(d => d.inMonth).length, 31);
});

test('a month that ends on a Saturday: one more week, the first week of the next month', () => {
  const weeks = grid([]); // October 2026 ends on Saturday Oct 31
  assert.deepEqual(weeks[5].days.map(d => d.date), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  assert.ok(weeks[5].days.every(d => !d.inMonth));
});

test('a month that does not end on a Saturday: one more week after its last week, so the next month shows to its 10th', () => {
  const weeks = grid([], 8); // September 2026 ends on Wednesday Sep 30: its last week is Sep 27 to Oct 3
  assert.equal(weeks.length, 6);
  assert.equal(weeks[4].days[6].date, '2026-10-03');
  assert.deepEqual([weeks[5].days[0].date, weeks[5].days[6].date], ['2026-10-04', '2026-10-10']);
  assert.ok(weeks[5].days.every(d => !d.inMonth));
});

test('a month that starts on Sunday and ends on Saturday: four weeks of the month, then the next month', () => {
  const weeks = grid([], 1); // February 2026
  assert.equal(weeks.length, 5);
  assert.ok(weeks.slice(0, 4).flatMap(w => w.days).every(d => d.inMonth));
  assert.deepEqual([weeks[4].days[0].date, weeks[4].days[0].inMonth], ['2026-03-01', false]);
});

test('a one-day trip: one bar on that day', () => {
  const weeks = grid([trip('a', '2026-10-14T13:00:00Z', '2026-10-14T20:00:00Z')]);
  assert.deepEqual(bars(weeks, 2), [['a', 3, 3, 0, false, false]]); // Wed Oct 14
  assert.deepEqual([0, 1, 3, 4].map(w => weeks[w].bars.length), [0, 0, 0, 0]);
});

test('a trip that crosses local midnight: it starts on the local day, not the Zulu day', () => {
  const weeks = grid([trip('a', '2026-10-14T03:30:00Z', '2026-10-14T20:00:00Z')]); // Oct 13 22:30 CDT
  assert.deepEqual(bars(weeks, 2), [['a', 2, 3, 0, false, false]]);
});

test('the base of each trip gives its time zone', () => {
  const weeks = grid([trip('mem', '2026-10-14T05:00:00Z', '2026-10-14T05:00:00Z'), trip('hnl', '2026-10-14T05:00:00Z', '2026-10-14T05:00:00Z', 'HNL')]);
  assert.deepEqual(bars(weeks, 2), [['hnl', 2, 2, 0, false, false], ['mem', 3, 3, 0, false, false]]); // Oct 13 HST, Oct 14 CDT
});

test('a trip over two weeks: one bar in each week, with the continuing ends marked', () => {
  const weeks = grid([trip('a', '2026-10-06T15:00:00Z', '2026-10-15T15:00:00Z')]); // Tue Oct 6 to Thu Oct 15
  assert.deepEqual(bars(weeks, 1), [['a', 2, 6, 0, false, true]]);
  assert.deepEqual(bars(weeks, 2), [['a', 0, 4, 0, true, false]]);
});

test('a trip over a month end: it shows in the grid of each month', () => {
  const t = trip('a', '2026-09-28T15:00:00Z', '2026-10-01T15:00:00Z'); // Mon Sep 28 to Thu Oct 1
  assert.deepEqual(bars(grid([t], OCT), 0), [['a', 1, 4, 0, false, false]]);
  assert.deepEqual(bars(grid([t], 8), 4), [['a', 1, 4, 0, false, false]]); // September: last week is Sep 27 to Oct 3
});

test('a trip outside the grid: no bar', () => {
  const weeks = grid([trip('early', '2026-09-20T15:00:00Z', '2026-09-22T15:00:00Z'), trip('late', '2026-11-09T15:00:00Z', '2026-11-10T15:00:00Z')]);
  assert.ok(weeks.every(w => w.bars.length === 0));
});

test('a trip that carries over into the next month: the end shows in the first week of the next month', () => {
  const weeks = grid([trip('a', '2026-10-30T15:00:00Z', '2026-11-03T15:00:00Z')]); // Fri Oct 30 to Tue Nov 3
  assert.deepEqual(bars(weeks, 4), [['a', 5, 6, 0, false, true]]);
  assert.deepEqual(bars(weeks, 5), [['a', 0, 2, 0, true, false]]);
});

test('a trip that is wholly in the first week of the next month: shows there', () => {
  const weeks = grid([trip('a', '2026-11-04T15:00:00Z', '2026-11-05T15:00:00Z')]); // Wed Nov 4 to Thu Nov 5
  assert.deepEqual(bars(weeks, 5), [['a', 3, 4, 0, false, false]]);
});

test('a trip on the 8th of the next month: not shown, the extra week ends on the 7th', () => {
  const weeks = grid([trip('a', '2026-11-08T15:00:00Z', '2026-11-08T20:00:00Z')]);
  assert.ok(weeks.every(w => w.bars.length === 0));
});

test('trips that overlap: separate lanes; a later trip takes the first free lane', () => {
  const weeks = grid([
    trip('b', '2026-10-13T15:00:00Z', '2026-10-15T15:00:00Z'),
    trip('a', '2026-10-12T15:00:00Z', '2026-10-14T15:00:00Z'),
    trip('c', '2026-10-16T15:00:00Z', '2026-10-16T20:00:00Z'),
  ]);
  assert.deepEqual(bars(weeks, 2), [['a', 1, 3, 0, false, false], ['b', 2, 4, 1, false, false], ['c', 5, 5, 0, false, false]]);
});

// A reserve block has no time: it is the days from `from` to `to` ('YYYY-MM-DD'), and needs no time zone.
const rsv = (id, from, to) => ({ id, from, to });
const noTz = () => { throw new Error('a reserve block needs no time zone'); };

test('a reserve block: one bar from its first day to its last day', () => {
  const weeks = C.monthGrid(2026, OCT, [rsv('r1', '2026-10-20', '2026-10-24')], noTz);
  assert.deepEqual(bars(weeks, 3), [['r1', 2, 6, 0, false, false]]); // Tue Oct 20 to Sat Oct 24
});

test('a reserve block over a week end: one bar in each week, with the continuing ends marked', () => {
  const weeks = C.monthGrid(2026, OCT, [rsv('r1', '2026-10-24', '2026-10-26')], noTz);
  assert.deepEqual(bars(weeks, 3), [['r1', 6, 6, 0, false, true]]);
  assert.deepEqual(bars(weeks, 4), [['r1', 0, 1, 0, true, false]]);
});

test('a reserve block and a trip on the same days: separate lanes', () => {
  const weeks = grid([trip('t', '2026-10-20T15:00:00Z', '2026-10-21T15:00:00Z'), rsv('r1', '2026-10-21', '2026-10-23')]);
  assert.deepEqual(bars(weeks, 3), [['t', 2, 3, 0, false, false], ['r1', 3, 5, 1, false, false]]);
});

test('a reserve block after the grid: no bar; one in the first week of the next month: a bar there', () => {
  assert.ok(grid([rsv('r1', '2026-11-10', '2026-11-11')]).every(w => w.bars.length === 0));
  assert.deepEqual(bars(grid([rsv('r1', '2026-11-03', '2026-11-04')]), 5), [['r1', 2, 3, 0, false, false]]);
});

// ---------- bars that start and end inside a day (training, vacation) ----------
// An item can say where in the day it starts and ends: fromMin and toMin are minutes after midnight of
// `from` and of `to` (toMin can pass 1440: it then ends on a later day). The default is whole days.
// A bar has inLeft and inRight: the part of its first and last day that it leaves empty (0 to 1).

const span = (id, from, to, fromMin, toMin) => ({ id, from, to, fromMin, toMin });
const edges = (weeks, w) => weeks[w].bars.map(b => [b.id, +b.inLeft.toFixed(4), +b.inRight.toFixed(4)]);

test('a whole-day item: it leaves no part of its days empty', () => {
  const weeks = grid([trip('t', '2026-10-14T13:00:00Z', '2026-10-14T20:00:00Z'), rsv('r', '2026-10-20', '2026-10-21')]);
  assert.deepEqual(edges(weeks, 2), [['t', 0, 0]]);
  assert.deepEqual(edges(weeks, 3), [['r', 0, 0]]);
});

test('training inside one day, 08:00 to 17:00: one bar on that day, empty before 08:00 and after 17:00', () => {
  const weeks = C.monthGrid(2026, OCT, [span('x', '2026-10-14', '2026-10-14', 480, 1020)], noTz);
  assert.deepEqual(bars(weeks, 2), [['x', 3, 3, 0, false, false]]);
  assert.deepEqual(edges(weeks, 2), [['x', 0.3333, 0.2917]]);
});

test('training over midnight, 22:00 to 06:00: from the end of one day to the start of the next', () => {
  const weeks = C.monthGrid(2026, OCT, [span('x', '2026-10-13', '2026-10-14', 1320, 360)], noTz);
  assert.deepEqual(bars(weeks, 2), [['x', 2, 3, 0, false, false]]);
  assert.deepEqual(edges(weeks, 2), [['x', 0.9167, 0.75]]);
});

test('vacation, 0130 of Oct 12 to 0129 after Oct 14: starts 1.5 hours into the first day, ends 1.5 hours into the day after the last', () => {
  const weeks = C.monthGrid(2026, OCT, [span('v', '2026-10-12', '2026-10-14', 90, 1530)], noTz);
  assert.deepEqual(bars(weeks, 2), [['v', 1, 4, 0, false, false]]); // Mon Oct 12 to a sliver of Thu Oct 15
  assert.deepEqual(edges(weeks, 2), [['v', 0.0625, 0.9375]]);
});

test('vacation that ends on a Saturday: the end goes over to the next week as a sliver of its first day', () => {
  const weeks = C.monthGrid(2026, OCT, [span('v', '2026-10-20', '2026-10-24', 90, 1530)], noTz);
  assert.deepEqual(bars(weeks, 3), [['v', 2, 6, 0, false, true]]);
  assert.deepEqual(edges(weeks, 3), [['v', 0.0625, 0]]);
  assert.deepEqual(bars(weeks, 4), [['v', 0, 0, 0, true, false]]);
  assert.deepEqual(edges(weeks, 4), [['v', 0, 0.9375]]);
});

test('an item that ends exactly at midnight of the next week: nothing goes over to that week', () => {
  const weeks = C.monthGrid(2026, OCT, [span('x', '2026-10-24', '2026-10-24', 0, 1440)], noTz);
  assert.deepEqual(bars(weeks, 3), [['x', 6, 6, 0, false, false]]);
  assert.equal(weeks[4].bars.length, 0);
});
