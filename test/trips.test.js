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

// ---------- calendar events: reserve days, training, vacation ----------
// An event is a record of the same document: { updatedAt, event: { type, from, to, fromTime?, toTime? } }.
// type is RA, RB, R24 (reserve days), TRN (training, with times), or VAC (vacation).
// It is not a trip, so every trip list and total ignores it.

const eventsOf = doc => T.events(doc).map(e => [e.type, e.from, e.to]);
const day = (type, from, to) => ({ type, from, to });
const training = (from, fromTime, to, toTime) => ({ type: 'TRN', from, fromTime, to, toTime });

test('the reserve types: RA is 0130 to 1330 Central, RB is 1330 to 0130 the next day, R24 is the whole day', () => {
  assert.deepEqual(T.RESERVE_TYPES.RA, { start: '01:30', end: '13:30', nextDay: false });
  assert.deepEqual(T.RESERVE_TYPES.RB, { start: '13:30', end: '01:30', nextDay: true });
  assert.deepEqual(T.RESERVE_TYPES.R24, { start: '00:00', end: '24:00', nextDay: false });
});

test('an added reserve block: listed with its type and days, and it is not a trip', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  const id = T.addEvent(doc, day('RB', '2026-10-20', '2026-10-22'), 30);
  assert.match(id, /^event-/);
  assert.deepEqual(T.events(doc), [{ id, type: 'RB', from: '2026-10-20', to: '2026-10-22' }]);
  assert.equal(doc.trips[id].updatedAt, 30);
  assert.deepEqual(ids(T.visibleTrips(doc)), ['a']);
  assert.deepEqual(T.hiddenTrips(doc), []);
  assert.equal(T.hasTrip(doc, id), false);
  assert.equal(T.totals(T.visibleTrips(doc)).count, 1);
});

test('a block of one day (first day equals last day): added', () => {
  const doc = T.emptyDoc();
  assert.ok(T.addEvent(doc, day('R24', '2026-10-20', '2026-10-20'), 1));
  assert.deepEqual(eventsOf(doc), [['R24', '2026-10-20', '2026-10-20']]);
});

test('an event that is not valid: nothing is added, and the problem is told in words', () => {
  const doc = T.emptyDoc();
  const bad = [
    [day('RC', '2026-10-20', '2026-10-20'), 'Choose RA, RB, or R24.'],
    [day('toString', '2026-10-20', '2026-10-20'), 'Choose RA, RB, or R24.'],
    [day('', '2026-10-20', '2026-10-20'), 'Choose RA, RB, or R24.'],
    [day('RA', '2026-10-22', '2026-10-20'), 'The last day is before the first day.'],
    [day('VAC', '2026-10-22', '2026-10-20'), 'The last day is before the first day.'],
    [day('RA', '2026-02-30', '2026-03-01'), 'Choose the first and last day.'],
    [day('VAC', '', ''), 'Choose the first and last day.'],
  ];
  bad.forEach(([e, problem]) => {
    assert.equal(T.eventProblem(e), problem);
    assert.equal(T.addEvent(doc, e, 5), null);
  });
  assert.deepEqual(doc, { trips: {} });
});

test('a valid event: no problem', () => {
  assert.equal(T.eventProblem(day('RA', '2026-10-20', '2026-10-21')), '');
  assert.equal(T.eventProblem(day('VAC', '2026-10-20', '2026-10-24')), '');
  assert.equal(T.eventProblem(training('2026-10-20', '08:00', '2026-10-20', '17:00')), '');
});

test('training: the first day and time and the last day and time are kept', () => {
  const doc = T.emptyDoc();
  const id = T.addEvent(doc, training('2026-10-20', '08:00', '2026-10-22', '17:00'), 1);
  assert.deepEqual(T.events(doc), [{ id, type: 'TRN', from: '2026-10-20', fromTime: '08:00', to: '2026-10-22', toTime: '17:00' }]);
});

test('training that runs over midnight (22:00 to 06:00 the next day): added', () => {
  const doc = T.emptyDoc();
  assert.ok(T.addEvent(doc, training('2026-10-20', '22:00', '2026-10-21', '06:00'), 1));
});

test('training with a missing or bad time, or an end that is not after the start: nothing is added', () => {
  const doc = T.emptyDoc();
  const bad = [
    [training('2026-10-20', '', '2026-10-20', '17:00'), 'Choose the start and end times.'],
    [training('2026-10-20', '08:00', '2026-10-20', ''), 'Choose the start and end times.'],
    [training('2026-10-20', '25:00', '2026-10-20', '17:00'), 'Choose the start and end times.'],
    [training('2026-10-20', '8:00', '2026-10-20', '17:00'), 'Choose the start and end times.'],
    [training('2026-10-20', '17:00', '2026-10-20', '08:00'), 'The end is before the start.'],
    [training('2026-10-20', '08:00', '2026-10-20', '08:00'), 'The end is before the start.'],
    [training('2026-10-22', '08:00', '2026-10-20', '17:00'), 'The last day is before the first day.'],
  ];
  bad.forEach(([e, problem]) => {
    assert.equal(T.eventProblem(e), problem);
    assert.equal(T.addEvent(doc, e, 5), null);
  });
  assert.deepEqual(doc, { trips: {} });
});

test('vacation and reserve days keep no times, even when times are passed in', () => {
  const doc = T.emptyDoc();
  const v = T.addEvent(doc, { type: 'VAC', from: '2026-10-20', to: '2026-10-24', fromTime: '08:00', toTime: '17:00' }, 1);
  const r = T.addEvent(doc, { type: 'RA', from: '2026-10-20', to: '2026-10-24', fromTime: '08:00', toTime: '17:00' }, 2);
  assert.deepEqual(doc.trips[v].event, { type: 'VAC', from: '2026-10-20', to: '2026-10-24' });
  assert.deepEqual(doc.trips[r].event, { type: 'RA', from: '2026-10-20', to: '2026-10-24' });
});

test('events: listed by first day, then by type', () => {
  const doc = T.emptyDoc();
  T.addEvent(doc, day('RB', '2026-10-21', '2026-10-21'), 1);
  T.addEvent(doc, day('R24', '2026-10-20', '2026-10-20'), 2);
  T.addEvent(doc, day('RA', '2026-10-20', '2026-10-20'), 3);
  T.addEvent(doc, day('VAC', '2026-10-20', '2026-10-21'), 4);
  assert.deepEqual(eventsOf(doc).map(e => e[0] + ' ' + e[1]), ['R24 2026-10-20', 'RA 2026-10-20', 'VAC 2026-10-20', 'RB 2026-10-21']);
});

test('the days on the calendar: reserve days fill whole days; vacation runs from 0130 of the first day to 0129 after the last day; training runs from its start to its end', () => {
  assert.deepEqual(T.eventSpan(day('RB', '2026-10-20', '2026-10-22')), { from: '2026-10-20', to: '2026-10-22', fromMin: 0, toMin: 1440 });
  assert.deepEqual(T.eventSpan(day('VAC', '2026-10-20', '2026-10-24')), { from: '2026-10-20', to: '2026-10-24', fromMin: 90, toMin: 1530 });
  assert.deepEqual(T.eventSpan(training('2026-10-20', '08:00', '2026-10-22', '17:00')), { from: '2026-10-20', to: '2026-10-22', fromMin: 480, toMin: 1020 });
});

test('a removed event: gone from the list, and a stale copy does not bring it back', () => {
  const doc = T.emptyDoc();
  const id = T.addEvent(doc, day('VAC', '2026-10-20', '2026-10-22'), 1);
  const stale = JSON.parse(JSON.stringify(doc));
  T.removeEvent(doc, id, 9);
  assert.deepEqual(T.events(doc), []);
  assert.deepEqual(doc.trips[id], { updatedAt: 9, purged: true });
  assert.deepEqual(T.events(T.mergeDocs(doc, stale)), []);
  assert.deepEqual(T.events(T.mergeDocs(stale, doc)), []);
});

test('two devices each add an event: a merge keeps both', () => {
  const phone = T.emptyDoc(), pc = T.emptyDoc();
  T.addEvent(phone, day('RA', '2026-10-20', '2026-10-21'), 5);
  T.addEvent(pc, training('2026-10-25', '08:00', '2026-10-26', '17:00'), 6);
  assert.deepEqual(eventsOf(T.mergeDocs(phone, pc)), [['RA', '2026-10-20', '2026-10-21'], ['TRN', '2026-10-25', '2026-10-26']]);
});

test('a trip edit with the id of an event: changes nothing', () => {
  const doc = T.emptyDoc();
  const id = T.addEvent(doc, day('RA', '2026-10-20', '2026-10-20'), 1);
  const before = JSON.stringify(doc);
  T.removeTrip(doc, id, 2);
  T.addCrew(doc, id, { name: 'X' }, 3);
  T.editCrew(doc, id, 0, { name: 'X', id: '1' }, 4);
  assert.equal(JSON.stringify(doc), before);
});

test('removing an id that is not an event (a trip, or nothing): changes nothing', () => {
  const doc = docWith(trip('a', '2026-10-01T00:00:00Z'));
  const before = JSON.stringify(doc);
  T.removeEvent(doc, 'a', 9);
  T.removeEvent(doc, 'nope', 9);
  assert.equal(JSON.stringify(doc), before);
});

// ---------- jumpseat ----------
// A jumpseat is an event of type JMP on one day: the flight number, the departure and arrival airports,
// and the departure time local to the departure airport. It is stored with from and to the same day.

const jumpseat = (from, flight, dep, arr, fromTime) => ({ type: 'JMP', from, flight, dep, arr, fromTime });

test('a jumpseat: the day, flight, airports, and local departure time are kept, on one day', () => {
  const doc = T.emptyDoc();
  const id = T.addEvent(doc, jumpseat('2026-10-21', 'FX1234', 'ATL', 'MEM', '08:30'), 1);
  assert.deepEqual(T.events(doc), [{ id, type: 'JMP', from: '2026-10-21', to: '2026-10-21', flight: 'FX1234', dep: 'ATL', arr: 'MEM', fromTime: '08:30' }]);
  assert.equal(T.eventProblem(jumpseat('2026-10-21', 'FX1234', 'ATL', 'MEM', '08:30')), '');
});

test('a jumpseat typed in lower case with spaces around it: kept in upper case, trimmed', () => {
  const doc = T.emptyDoc();
  const id = T.addEvent(doc, jumpseat('2026-10-21', ' fx1234 ', ' atl ', 'mem ', '08:30'), 1);
  assert.deepEqual([doc.trips[id].event.flight, doc.trips[id].event.dep, doc.trips[id].event.arr], ['FX1234', 'ATL', 'MEM']);
});

test('a jumpseat that is not valid: nothing is added, and the problem is told in words', () => {
  const doc = T.emptyDoc();
  const bad = [
    [jumpseat('', 'FX1', 'ATL', 'MEM', '08:30'), 'Choose the day.'],
    [jumpseat('2026-02-30', 'FX1', 'ATL', 'MEM', '08:30'), 'Choose the day.'],
    [jumpseat('2026-10-21', '', 'ATL', 'MEM', '08:30'), 'Enter the flight number.'],
    [jumpseat('2026-10-21', '   ', 'ATL', 'MEM', '08:30'), 'Enter the flight number.'],
    [jumpseat('2026-10-21', 'FX1', '', 'MEM', '08:30'), 'Use 3-letter airport codes, like MEM.'],
    [jumpseat('2026-10-21', 'FX1', 'AT', 'MEM', '08:30'), 'Use 3-letter airport codes, like MEM.'],
    [jumpseat('2026-10-21', 'FX1', 'ATL', 'MEMP', '08:30'), 'Use 3-letter airport codes, like MEM.'],
    [jumpseat('2026-10-21', 'FX1', 'A1L', 'MEM', '08:30'), 'Use 3-letter airport codes, like MEM.'],
    [jumpseat('2026-10-21', 'FX1', 'MEM', 'mem', '08:30'), 'The airports are the same.'],
    [jumpseat('2026-10-21', 'FX1', 'ATL', 'MEM', ''), 'Choose the departure time.'],
    [jumpseat('2026-10-21', 'FX1', 'ATL', 'MEM', '8:30'), 'Choose the departure time.'],
    [jumpseat('2026-10-21', 'FX1', 'ATL', 'MEM', '24:00'), 'Choose the departure time.'],
  ];
  bad.forEach(([e, problem]) => {
    assert.equal(T.eventProblem(e), problem);
    assert.equal(T.addEvent(doc, e, 5), null);
  });
  assert.deepEqual(doc, { trips: {} });
});

test('a jumpseat on the calendar: the whole day of its local departure', () => {
  assert.deepEqual(T.eventSpan({ type: 'JMP', from: '2026-10-21', to: '2026-10-21', fromTime: '08:30' }),
    { from: '2026-10-21', to: '2026-10-21', fromMin: 0, toMin: 1440 });
});

test('a jumpseat: listed by its day with the other events, and it can be removed', () => {
  const doc = T.emptyDoc();
  T.addEvent(doc, day('VAC', '2026-10-22', '2026-10-23'), 1);
  const id = T.addEvent(doc, jumpseat('2026-10-21', 'FX1234', 'ATL', 'MEM', '08:30'), 2);
  assert.deepEqual(T.events(doc).map(e => e.type), ['JMP', 'VAC']);
  T.removeEvent(doc, id, 9);
  assert.deepEqual(T.events(doc).map(e => e.type), ['VAC']);
  assert.deepEqual(doc.trips[id], { updatedAt: 9, purged: true });
});

// ---------- show time of a jumpseat ----------
// The show time is one hour before the local departure time. Before 01:00 it is on the day before.

test('the show time: one hour before the departure time', () => {
  assert.deepEqual(T.showTime('08:30'), { time: '07:30', dayBefore: false });
  assert.deepEqual(T.showTime('23:59'), { time: '22:59', dayBefore: false });
  assert.deepEqual(T.showTime('10:00'), { time: '09:00', dayBefore: false });
});

test('a departure at 01:00 or later in the morning: the show time is still that day, down to 00:00', () => {
  assert.deepEqual(T.showTime('01:00'), { time: '00:00', dayBefore: false });
  assert.deepEqual(T.showTime('01:01'), { time: '00:01', dayBefore: false });
});

test('a departure before 01:00: the show time is on the day before', () => {
  assert.deepEqual(T.showTime('00:59'), { time: '23:59', dayBefore: true });
  assert.deepEqual(T.showTime('00:30'), { time: '23:30', dayBefore: true });
  assert.deepEqual(T.showTime('00:00'), { time: '23:00', dayBefore: true });
});

test('no show time without a valid departure time', () => {
  ['', '8:30', '24:00', '12:60', 'abc', undefined].forEach(t => assert.equal(T.showTime(t), null));
});
