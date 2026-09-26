/**
 * Contract tests for trips.js, the sync document of the app. Run: node --test test/
 * The document is { trips: { <id>: { updatedAt, trip?, removed?, fo?, purged? } } }.
 * Each trip merges on its own: the newest updatedAt wins.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../trips.js');

const trip = (id, show, extra = {}) => ({
  id, base: 'MEM', show, end: show, away: ['1:00', '1:00'], block: ['2:00', '2:30'], pay: ['3:00', '3:15'],
  crew: [{ seat: 'Captain', code: '', id: '1', name: 'Cap' }, { seat: 'First officer', code: '', id: '2', name: 'Fo' }],
  fares: [], items: [], ...extra,
});
const ids = list => list.map(t => t.id);
function docWith(...trips) {
  const doc = T.emptyDoc();
  trips.forEach((t, n) => T.addTrip(doc, t, n + 1));
  return doc;
}

test('an empty doc: no visible trips, no hidden trips', () => {
  const doc = T.emptyDoc();
  assert.deepEqual(doc, { trips: {} });
  assert.deepEqual(T.visibleTrips(doc), []);
  assert.deepEqual(T.hiddenTrips(doc), []);
});

test('added trips: visible, sorted by report time', () => {
  const doc = docWith(trip('b', '2026-10-05T00:00:00Z'), trip('a', '2026-10-01T00:00:00Z'));
  assert.deepEqual(ids(T.visibleTrips(doc)), ['a', 'b']);
  assert.equal(T.hasTrip(doc, 'a'), true);
  assert.equal(T.hasTrip(doc, 'zzz'), false);
});

test('a removed trip: leaves the visible list, shows in the hidden list; restore brings it back', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'), trip('b', '2026-10-02T00:00:00Z'));
  T.removeTrip(doc, 'a', 10);
  assert.deepEqual(ids(T.visibleTrips(doc)), ['b']);
  assert.deepEqual(ids(T.hiddenTrips(doc)), ['a']);
  assert.equal(doc.trips.a.updatedAt, 10);
  T.restoreTrip(doc, 'a', 11);
  assert.deepEqual(ids(T.visibleTrips(doc)), ['a', 'b']);
  assert.deepEqual(T.hiddenTrips(doc), []);
});

test('a purged trip: a tombstone with no trip data, shown nowhere, and it can be pasted again', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  T.removeTrip(doc, 'a', 10);
  T.purgeTrip(doc, 'a', 11);
  assert.deepEqual(doc.trips.a, { updatedAt: 11, purged: true });
  assert.deepEqual(T.visibleTrips(doc), []);
  assert.deepEqual(T.hiddenTrips(doc), []);
  assert.equal(T.hasTrip(doc, 'a'), false);
  T.addTrip(doc, trip('a', '2026-10-01T00:00:00Z'), 12);
  assert.deepEqual(ids(T.visibleTrips(doc)), ['a']);
});

test('an FO override: changes the first officer only, and keeps blank fields', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  T.setFO(doc, 'a', { name: 'New Fo', id: '' }, 20);
  const crew = T.visibleTrips(doc)[0].crew;
  assert.deepEqual(crew, [
    { seat: 'Captain', code: '', id: '1', name: 'Cap' },
    { seat: 'First officer', code: '', id: '2', name: 'New Fo' },
  ]);
  assert.equal(doc.trips.a.trip.crew[1].name, 'Fo', 'the stored trip is not changed');
  assert.equal(doc.trips.a.updatedAt, 20);
});

test('totals: count and block/pay sums of the given trips, planned and actual', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'), trip('b', '2026-10-02T00:00:00Z', { pay: ['0:45', '0:50'] }));
  T.removeTrip(doc, 'b', 5);
  assert.deepEqual(T.totals(T.visibleTrips(doc)), { count: 1, block: ['2:00', '2:30'], pay: ['3:00', '3:15'] });
  T.restoreTrip(doc, 'b', 6);
  assert.deepEqual(T.totals(T.visibleTrips(doc)), { count: 2, block: ['4:00', '5:00'], pay: ['3:45', '4:05'] });
});

test('a merge: for each trip the newer updatedAt wins, and trips on one side only are kept', () => {
  const local = docWith(trip('a', '2026-10-01T00:00:00Z'), trip('b', '2026-10-02T00:00:00Z'));
  const server = docWith(trip('a', '2026-10-01T00:00:00Z'), trip('c', '2026-10-03T00:00:00Z'));
  T.removeTrip(local, 'a', 50);
  T.setFO(server, 'a', { name: 'X', id: '9' }, 40);
  const m = T.mergeDocs(local, server);
  assert.deepEqual(Object.keys(m.trips).sort(), ['a', 'b', 'c']);
  assert.equal(m.trips.a.removed, true);
  assert.equal(m.trips.a.fo, undefined);
});

test('a merge: an older copy does not revive a purged trip', () => {
  const local = docWith(trip('a', '2026-10-01T00:00:00Z'));
  const stale = JSON.parse(JSON.stringify(local));
  T.purgeTrip(local, 'a', 99);
  assert.deepEqual(T.mergeDocs(local, stale).trips.a, { updatedAt: 99, purged: true });
  assert.deepEqual(T.mergeDocs(stale, local).trips.a, { updatedAt: 99, purged: true });
});

test('a merge: records with no numeric updatedAt are ignored', () => {
  const m = T.mergeDocs(T.emptyDoc(), { trips: { a: { trip: trip('a', '2026-10-01T00:00:00Z') } } });
  assert.deepEqual(m, { trips: {} });
});
