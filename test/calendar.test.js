/**
 * Contract tests for calendar.js, the month grid of the calendar view. Run: node --test test/
 * A trip covers the days from its report to its release, as local dates of its base. Weeks start
 * on Sunday. October 2026 starts on a Thursday and ends on a Saturday: its grid is Sep 27 to Oct 31.
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
  assert.equal(weeks.length, 5);
  assert.ok(weeks.every(w => w.days.length === 7 && w.bars.length === 0));
  assert.deepEqual([weeks[0].days[0].date, weeks[0].days[0].inMonth], ['2026-09-27', false]);
  assert.deepEqual([weeks[0].days[4].date, weeks[0].days[4].inMonth], ['2026-10-01', true]);
  assert.deepEqual([weeks[4].days[6].date, weeks[4].days[6].inMonth], ['2026-10-31', true]);
  assert.equal(weeks.flatMap(w => w.days).filter(d => d.inMonth).length, 31);
});

test('a month that starts on Sunday and ends on Saturday: exactly four weeks, no outside days', () => {
  const weeks = grid([], 1); // February 2026
  assert.equal(weeks.length, 4);
  assert.ok(weeks.flatMap(w => w.days).every(d => d.inMonth));
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
  const weeks = grid([trip('early', '2026-09-20T15:00:00Z', '2026-09-22T15:00:00Z'), trip('late', '2026-11-02T15:00:00Z', '2026-11-03T15:00:00Z')]);
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
