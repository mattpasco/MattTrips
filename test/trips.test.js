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

test('a crew edit: changes that member only, and the stored recap stays the same', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  T.editCrew(doc, 'a', 1, { name: 'New Fo', id: '7' }, 20);
  assert.deepEqual(T.visibleTrips(doc)[0].crew, [
    { seat: 'Captain', code: '', id: '1', name: 'Cap' },
    { seat: 'First officer', code: '', id: '7', name: 'New Fo' },
  ]);
  assert.equal(doc.trips.a.trip.crew[1].name, 'Fo');
  assert.equal(doc.trips.a.updatedAt, 20);
});

test('a crew edit of a third recap member: works the same as the first officer', () => {
  const t = trip('a', '2026-10-01T00:00:00Z');
  t.crew.push({ seat: 'Relief officer', code: '', id: '3', name: 'Rel' });
  const doc = docWith(t);
  T.editCrew(doc, 'a', 2, { name: 'Other', id: '33' }, 20);
  assert.deepEqual(T.visibleTrips(doc)[0].crew[2], { seat: 'Relief officer', code: '', id: '33', name: 'Other' });
  assert.equal(T.visibleTrips(doc)[0].crew[1].name, 'Fo');
});

test('a crew edit with blank fields: a recap member stays, with blank name and number', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  T.editCrew(doc, 'a', 1, { name: '', id: '' }, 20);
  assert.deepEqual(T.visibleTrips(doc)[0].crew[1], { seat: 'First officer', code: '', id: '', name: '' });
});

test('an added crew member: shows after the recap crew, marked as added; the role defaults to Crew', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  T.addCrew(doc, 'a', { seat: 'Jumpseat', name: 'Jay', id: '5' }, 20);
  T.addCrew(doc, 'a', { seat: '  ', name: 'Kay', id: '' }, 21);
  const crew = T.visibleTrips(doc)[0].crew;
  assert.deepEqual(crew.slice(2), [
    { seat: 'Jumpseat', code: '', id: '5', name: 'Jay', added: true },
    { seat: 'Crew', code: '', id: '', name: 'Kay', added: true },
  ]);
  assert.equal(doc.trips.a.trip.crew.length, 2, 'the stored recap is not changed');
  assert.equal(doc.trips.a.updatedAt, 21);
});

test('an added crew member with no name and no number: nothing is added and nothing changes', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  T.addCrew(doc, 'a', { seat: 'Jumpseat', name: ' ', id: '' }, 20);
  assert.equal(T.visibleTrips(doc)[0].crew.length, 2);
  assert.equal(doc.trips.a.updatedAt, 1);
});

test('a crew edit with blank fields on an added member: removes that member', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  T.addCrew(doc, 'a', { seat: 'Jumpseat', name: 'Jay', id: '5' }, 20);
  T.editCrew(doc, 'a', 2, { name: '', id: '' }, 21);
  assert.equal(T.visibleTrips(doc)[0].crew.length, 2);
});

test('a crew edit with a phone number: the member shows it; a blank phone removes it', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  T.editCrew(doc, 'a', 1, { name: 'Fo', id: '2', phone: '+1-901-555-0100' }, 20);
  assert.deepEqual(T.visibleTrips(doc)[0].crew[1], { seat: 'First officer', code: '', id: '2', name: 'Fo', phone: '+1-901-555-0100' });
  T.editCrew(doc, 'a', 1, { name: 'Fo', id: '2', phone: '' }, 21);
  assert.deepEqual(T.visibleTrips(doc)[0].crew[1], { seat: 'First officer', code: '', id: '2', name: 'Fo' });
});

test('an added crew member with only a phone number: is added, with the phone', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  T.addCrew(doc, 'a', { seat: '', name: '', id: '', phone: ' 555-0101 ' }, 20);
  assert.deepEqual(T.visibleTrips(doc)[0].crew[2], { seat: 'Crew', code: '', id: '', name: '', phone: '555-0101', added: true });
});

test('an added member cleared of name and number but not phone: stays; all three blank: removed', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  T.addCrew(doc, 'a', { seat: 'Jumpseat', name: 'Jay', id: '5', phone: '555-0102' }, 20);
  T.editCrew(doc, 'a', 2, { name: '', id: '', phone: '555-0102' }, 21);
  assert.equal(T.visibleTrips(doc)[0].crew.length, 3);
  T.editCrew(doc, 'a', 2, { name: '', id: '', phone: '' }, 22);
  assert.equal(T.visibleTrips(doc)[0].crew.length, 2);
});

test('an old FO edit (fo field, from before crew edits): still shows, and the next crew edit keeps it', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  doc.trips.a.fo = { name: 'Old Fo', id: '8' };
  assert.equal(T.visibleTrips(doc)[0].crew[1].name, 'Old Fo');
  T.addCrew(doc, 'a', { seat: 'Jumpseat', name: 'Jay', id: '5' }, 20);
  assert.equal(doc.trips.a.fo, undefined);
  assert.deepEqual(T.visibleTrips(doc)[0].crew.map(c => c.name), ['Cap', 'Old Fo', 'Jay']);
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
  T.editCrew(server, 'a', 1, { name: 'X', id: '9' }, 40);
  const m = T.mergeDocs(local, server);
  assert.deepEqual(Object.keys(m.trips).sort(), ['a', 'b', 'c']);
  assert.equal(m.trips.a.removed, true);
  assert.equal(m.trips.a.crew, undefined);
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
