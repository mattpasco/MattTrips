/**
 * Contract tests for extension/importer.js, which turns the schedule data of the crew portal into the
 * records of this app. Run: node --test test/
 * The fixtures copy the shape of the portal's answers. The data is made up: the repository is public,
 * so never put a real answer of the portal here.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../extension/importer.js');
const T = require('../trips.js');

// ---------- builders: the answer of the portal for one trip ----------

const z = s => '2026-' + s + ':00Z';
const seg = (segmentType, originIATACode, destinationIATACode, start, end, more = {}) =>
  ({ segmentType, originIATACode, destinationIATACode, scheduledStartTime: z(start), scheduledEndTime: z(end), ...more });
const flightSeg = (type, airline, no, o, d, start, end, minutes, more = {}) =>
  seg(type, o, d, start, end, { airlineCode: airline, flightNumber: no, scheduledDurationMinutes: minutes, ...more });
const gt = (pickup, dropoff, from, to) => ({
  status: 20, svcType: 1,
  gtSvcReservation: { pickupTime: z(pickup).replace('Z', '.000+00:00'), dropoffTime: z(dropoff).replace('Z', '.000+00:00'), pickupPlace: from, dropoffPlace: to,
    gtvendor: { vendorScheduleName: 'TEST CARS', contacts: [{ phone: '+1-212-555-0102' }] } },
});
const ramp = (pickup, dropoff) => ({
  status: 20, svcType: 1,
  gtSvcReservation: { pickupTime: z(pickup).replace('Z', '.000+00:00'), dropoffTime: z(dropoff).replace('Z', '.000+00:00'), pickupPlace: 'Ramp', dropoffPlace: 'Term',
    gtvendor: { vendorScheduleName: 'TEST RAMP', contacts: [{ phone: '+1-901-555-0101' }] } },
});
const hotel = (arrival, name, phone) => ({
  status: 20, svcType: 0,
  hotelReservation: { arrivalTime: z(arrival).replace('Z', '.000+00:00'), hotelVendor: { vendorScheduleName: name, contacts: [{ phone }] } },
});
const meal = (dep, meals) => ({ status: 20, svcType: 2, cateringReservation: { meals, flightDepartureDtTmZ: z(dep).replace('Z', '.000+00:00') }, pilotReservations: [] });
const duty = (show, end, dutyMinutes, layoverMinutes) => ({ showTime: z(show), endTime: z(end), dutyMinutes, layoverMinutes });
const person = (id, seat, seatName, assignment, first, last) => ({
  pilotID: id, seatAbbreviation: seat, tripAssignmentReasonAbbreviation: assignment, pilotInfo: { firstName: first, lastName: last, pilotId: id }, crewSeat: { name: seatName },
});

/** A trip like one that starts with a duty row and a ramp pickup, deadheads out, and has two layovers. */
function apiTrip(patch = {}) {
  return {
    trip: {
      number: '901', operatingDate: '2026-10-21T00:00:00Z', baseStationCode: 'MEM', aircraftCode: '77', typeAbbrev: 'REG',
      tripStartTime: z('10-21T06:48'), tripEndTime: z('10-23T22:49'),
      totalBlockMinutes: 404, scheduledPayMinutes: 1024, scheduledAwayMinutes: 3841, actualAwayMinutes: 0, actualPayMinutes: 0,
      tripCrews: [person('111111', 'CAP', 'Captain', 'CMU', 'JOHN', 'DOE'), person('222222', 'FO', 'First Officer', '', 'JANE', 'ROE')],
      focusSegments: [
        seg('StbySegment', 'MEM', 'MEM', '10-21T06:48', '10-21T10:00', { airlineCode: '', flightNumber: 'DTDUTY' }),
        seg('TurnSegment', 'MEM', 'MEM', '10-21T10:00', '10-21T11:00'),
        flightSeg('CommercialSegment', 'UA', '3642', 'MEM', 'EWR', '10-21T11:00', '10-21T13:51', 171),
        seg('DebriefSegment', 'EWR', 'EWR', '10-21T13:51', '10-21T14:21'),
        seg('LayoverSegment', 'EWR', 'EWR', '10-21T14:21', '10-22T02:18'),
        seg('BriefSegment', 'EWR', 'EWR', '10-22T02:18', '10-22T03:18'),
        flightSeg('FedExSegment', 'FX', '1621', 'EWR', 'IND', '10-22T03:18', '10-22T05:26', 128),
        seg('TurnSegment', 'IND', 'IND', '10-22T05:26', '10-22T07:45'),
        flightSeg('FedExSegment', 'FX', '1700', 'IND', 'EWR', '10-22T07:45', '10-22T09:32', 107),
        seg('DebriefSegment', 'EWR', 'EWR', '10-22T09:32', '10-22T10:02'),
        seg('LayoverSegment', 'EWR', 'EWR', '10-22T10:02', '10-23T18:30'),
        seg('BriefSegment', 'EWR', 'EWR', '10-23T18:30', '10-23T19:30'),
        flightSeg('FedExSegment', 'FX', '6030', 'EWR', 'MEM', '10-23T19:30', '10-23T22:19', 169),
        seg('DebriefSegment', 'MEM', 'MEM', '10-23T22:19', '10-23T22:49'),
      ],
      dutyPeriodInfos: [duty('10-21T06:48', '10-21T14:21', 453, 717), duty('10-22T02:18', '10-22T10:02', 464, 1948), duty('10-23T18:30', '10-23T22:49', 259, 0)],
    },
    tripServiceReservation: {
      svcReservations: [
        ramp('10-21T10:00', '10-21T11:00'),
        gt('10-21T13:51', '10-21T14:16', 'Term', 'Hotel'),
        hotel('10-21T13:51', 'FIRST TEST HOTEL', '+1-201-555-0103'),
        gt('10-22T01:43', '10-22T02:18', 'Hotel', 'Ramp'),
        meal('10-22T03:18', 'DM'),
        meal('10-22T07:45', 'BS'),
        gt('10-22T09:32', '10-22T10:37', 'Ramp', 'Hotel'),
        hotel('10-22T09:32', 'SECOND TEST HOTEL', '+1-646-555-0104'),
        gt('10-23T17:25', '10-23T18:30', 'Hotel', 'Ramp'),
        meal('10-23T19:30', 'MS'),
      ],
    },
    acceptableFares: { deadheads: [{ origin: 'MEM', destination: 'EWR', classOfService: 'Y', baselineFare: 394.4, segments: [{ airlineCode: 'UA', flightNumber: '3642' }] }] },
    ...patch,
  };
}
const car = (a, b) => ({ co: 'TEST CARS', ph: '+1-212-555-0102', a: z(a), b: z(b) });

// ---------- one trip ----------

test('a trip: id, base, aircraft, report and release come from the trip; the totals are as minutes in hours', () => {
  const t = I.tripFromApi(apiTrip());
  assert.deepEqual([t.id, t.base, t.eq, t.show, t.end], ['901', 'MEM', '77', '2026-10-21T06:48:00Z', '2026-10-23T22:49:00Z']);
  assert.deepEqual([t.block, t.pay, t.away], [['6:44', '6:44'], ['17:04', '17:04'], ['64:01', '64:01']]);
  assert.equal(t.opDate, '2026-10-21');
  assert.equal(t.src, 'fx');
});

test('a trip: the duty row and the brief, debrief, turn, and layover rows are not legs', () => {
  const t = I.tripFromApi(apiTrip());
  assert.deepEqual(t.items.map(i => i.t), ['f', 'l', 'f', 'f', 'l', 'f']);
  assert.deepEqual(t.items.filter(i => i.t === 'f').map(f => f.no), ['UA3642', '1621', '1700', '6030']);
});

test('a company flight number has no leading zero, like the recap shows it', () => {
  const a = apiTrip();
  a.trip.focusSegments[6].flightNumber = '0621';
  assert.equal(I.tripFromApi(a).items.filter(i => i.t === 'f')[1].no, '621');
  a.trip.focusSegments[2].airlineCode = 'DL';
  a.trip.focusSegments[2].flightNumber = '0082';
  assert.equal(I.tripFromApi(a).items.filter(i => i.t === 'f')[0].no, 'DL82');
});

test('the legs: scheduled times, block, the turn after each leg, duty and layover on the last leg of a duty, meals', () => {
  const f = I.tripFromApi(apiTrip()).items.filter(i => i.t === 'f');
  assert.deepEqual(f[0], { t: 'f', no: 'UA3642', o: 'MEM', d: 'EWR', dh: true, s: [z('10-21T11:00'), z('10-21T13:51')],
    blk: ['2:51', '2:51'], turn: ['13:27', '13:27'], duty: ['7:33', '7:33'], lo: ['11:57', '11:57'] });
  assert.deepEqual(f[1], { t: 'f', no: '1621', o: 'EWR', d: 'IND', s: [z('10-22T03:18'), z('10-22T05:26')],
    blk: ['2:08', '2:08'], turn: ['2:19', '2:19'], meals: 'DM' });
  assert.deepEqual(f[2], { t: 'f', no: '1700', o: 'IND', d: 'EWR', s: [z('10-22T07:45'), z('10-22T09:32')],
    blk: ['1:47', '1:47'], turn: ['33:58', '33:58'], duty: ['7:44', '7:44'], lo: ['32:28', '32:28'], meals: 'BS' });
  assert.deepEqual(f[3], { t: 'f', no: '6030', o: 'EWR', d: 'MEM', s: [z('10-23T19:30'), z('10-23T22:19')],
    blk: ['2:49', '2:49'], duty: ['4:19', '4:19'], meals: 'MS' });
});

test('the layovers: the ride to the hotel, the hotel, and the ride back, between the two flights; a ramp ride before the first flight is not one', () => {
  const l = I.tripFromApi(apiTrip()).items.filter(i => i.t === 'l');
  assert.deepEqual(l[0], { t: 'l', stn: 'EWR', hotel: 'FIRST TEST HOTEL', ph: '+1-201-555-0103', in: z('10-21T14:16'), out: z('10-22T01:43'),
    gin: car('10-21T13:51', '10-21T14:16'), gout: car('10-22T01:43', '10-22T02:18') });
  assert.deepEqual(l[1], { t: 'l', stn: 'EWR', hotel: 'SECOND TEST HOTEL', ph: '+1-646-555-0104', in: z('10-22T10:37'), out: z('10-23T17:25'),
    gin: car('10-22T09:32', '10-22T10:37'), gout: car('10-23T17:25', '10-23T18:30') });
});

test('two ground rides and no hotel between two flights: a layover named Hotel, with the number of the ground company', () => {
  const a = apiTrip();
  a.tripServiceReservation.svcReservations = a.tripServiceReservation.svcReservations.filter(s => !s.hotelReservation);
  const l = I.tripFromApi(a).items.filter(i => i.t === 'l');
  assert.deepEqual([l[0].hotel, l[0].ph], ['Hotel', '+1-212-555-0102']);
});

test('one ground ride alone between two flights: no layover', () => {
  const a = apiTrip();
  a.tripServiceReservation.svcReservations = a.tripServiceReservation.svcReservations.filter(s => !(s.gtSvcReservation && s.gtSvcReservation.pickupPlace === 'Hotel' && s.gtSvcReservation.pickupTime.startsWith('2026-10-22T01')));
  const items = I.tripFromApi(a).items;
  assert.deepEqual(items.map(i => i.t), ['f', 'f', 'f', 'l', 'f']);
});

test('the crew: seat, assignment code, employee number, and the name in order; the seat name in lower case after the first letter', () => {
  assert.deepEqual(I.tripFromApi(apiTrip()).crew, [
    { seat: 'Captain', code: 'CMU', id: '111111', name: 'John Doe' },
    { seat: 'First officer', code: '', id: '222222', name: 'Jane Roe' },
  ]);
});

test('the deadhead fares: the airline, the route, the class, and the baseline fare in whole dollars', () => {
  assert.deepEqual(I.tripFromApi(apiTrip()).fares, [{ al: 'UA', od: 'MEM-EWR', cls: 'Y', amt: '394' }]);
  assert.deepEqual(I.tripFromApi(apiTrip({ acceptableFares: null })).fares, []);
});

test('a flown trip: the actual times, block, duty, layover, tail, and totals are kept next to the scheduled ones', () => {
  const a = apiTrip();
  Object.assign(a.trip, { actualAwayMinutes: 3788, actualPayMinutes: 1010 });
  a.trip.focusSegments[6] = flightSeg('FedExSegment', 'FX', '1621', 'EWR', 'IND', '10-22T03:18', '10-22T05:26', 128,
    { actualStartTime: z('10-22T03:17'), actualEndTime: z('10-22T05:00'), actualDurationMinutes: 103, tailNumber: '870' });
  a.trip.dutyPeriodInfos[1].actualDutyMinutes = 460;
  a.trip.dutyPeriodInfos[1].actualLayoverMinutes = 1950;
  const t = I.tripFromApi(a);
  assert.deepEqual([t.away, t.pay], [['64:01', '63:08'], ['17:04', '16:50']]);
  const f = t.items.filter(i => i.t === 'f');
  assert.deepEqual([f[1].a, f[1].blk, f[1].tail], [[z('10-22T03:17'), z('10-22T05:00')], ['2:08', '1:43'], 'N870FD']);
  assert.deepEqual([f[2].duty, f[2].lo], [['7:44', '7:40'], ['32:28', '32:30']]);
});

test('a leg that has not been flown: no actual times', () => {
  const f = I.tripFromApi(apiTrip()).items.filter(i => i.t === 'f');
  assert.ok(f.every(x => !('a' in x) && !('tail' in x)));
});

// ---------- vacation, jumpseats, reserve ----------

const FX = { vac: u => I.eventsFromApi({ unavailabilityAssignments: [u] }) };
const vac = (start, end, type = 'VAC') => ({ uaType: type, scheduledLBTStartTime: start, scheduledLBTEndTime: end });

test('a vacation: it starts at 0130 of its first day and ends at 0129 after its last day, so its days are first to last', () => {
  const [e] = FX.vac(vac('2026-11-14T01:30:00-06:00', '2026-11-26T01:29:00-06:00'));
  assert.deepEqual(e, { id: 'event-fx-vac-2026-11-14', event: { type: 'VAC', from: '2026-11-14', to: '2026-11-25' } });
  const [one] = FX.vac(vac('2026-08-08T01:30:00-05:00', '2026-08-09T01:29:00-05:00'));
  assert.deepEqual(one.event, { type: 'VAC', from: '2026-08-08', to: '2026-08-08' });
});

test('other kinds of unavailability (sick, medical, training course): not imported', () => {
  ['SCK', 'MED', 'TRC'].forEach(k => assert.deepEqual(FX.vac(vac('2026-06-10T01:30:00-05:00', '2026-06-12T01:29:00-05:00', k)), []));
});

const jump = (extra = {}) => ({ flightNbr: '0637', comapnyId: 'FDX', flightZuluDate: '2026-10-01', iataoriginCode: 'EWR', iatadestinationCode: 'MEM',
  scheduledOutLocalTime: '2026-10-01 09:10:00', scheduledOutZuluTime: '2026-10-01 13:10:00', ...extra });
const jumps = (...j) => I.eventsFromApi({ jumpseats: j });

test('a jumpseat: the company flight number, the airports, and the local departure day and time', () => {
  assert.deepEqual(jumps(jump())[0], { id: 'event-fx-js-2026-10-01-FX637-EWR',
    event: { type: 'JMP', from: '2026-10-01', to: '2026-10-01', flight: 'FX637', dep: 'EWR', arr: 'MEM', fromTime: '09:10' } });
});

test('a jumpseat that leaves the evening before in Zulu: the day is the local day', () => {
  const e = jumps(jump({ flightNbr: '1235', iataoriginCode: 'BDL', iatadestinationCode: 'MEM', flightZuluDate: '2026-10-21',
    scheduledOutLocalTime: '2026-10-20 21:37:00', scheduledOutZuluTime: '2026-10-21 01:37:00' }))[0];
  assert.deepEqual([e.event.from, e.event.fromTime, e.event.flight], ['2026-10-20', '21:37', 'FX1235']);
});

test('a jumpseat on another airline: the two-letter code of the airline', () => {
  assert.equal(jumps(jump({ comapnyId: 'UAL', flightNbr: '3642' }))[0].event.flight, 'UA3642');
  assert.equal(jumps(jump({ comapnyId: 'ZZZ', flightNbr: '12' }))[0].event.flight, 'ZZZ12');
});

const rsv = (type, date, cancel = null) => ({ raType: type, raOperatingDate: date + 'T00:00:00.000+0000', raCancelType: cancel });
const rsvs = (...r) => I.eventsFromApi({ reserves: r });

test('reserve days: one event for each day, of the type RA, RB, or R24', () => {
  assert.deepEqual(rsvs(rsv('RA', '2026-11-03'), rsv('RB', '2026-11-04'), rsv('R24', '2026-11-05')).map(e => e.event), [
    { type: 'RA', from: '2026-11-03', to: '2026-11-03' }, { type: 'RB', from: '2026-11-04', to: '2026-11-04' }, { type: 'R24', from: '2026-11-05', to: '2026-11-05' }]);
  assert.equal(rsvs(rsv('RA', '2026-11-03'))[0].id, 'event-fx-RA-2026-11-03');
});

test('a reserve day that is cancelled, or of a type that this app does not have: not imported', () => {
  assert.deepEqual(rsvs(rsv('RA', '2026-11-03', 'CXL'), rsv('XX', '2026-11-04')), []);
});

test('every imported event is a valid event of this app', () => {
  const all = I.eventsFromApi({
    unavailabilityAssignments: [vac('2026-11-14T01:30:00-06:00', '2026-11-26T01:29:00-06:00')],
    jumpseats: [jump()], reserves: [rsv('RA', '2026-11-03'), rsv('RB', '2026-11-04'), rsv('R24', '2026-11-05')],
  });
  assert.equal(all.length, 5);
  all.forEach(e => assert.equal(T.eventProblem(e.event), '', e.id));
});

// ---------- who, and which periods ----------

const jwt = claims => 'x.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.y';

test('the employee number is the sub of the login token', () => {
  assert.equal(I.pilotIdFromToken(jwt({ sub: '111111', exp: 1 })), '111111');
  assert.equal(I.pilotIdFromToken('garbage'), null);
});

test('the base, aircraft, and seat from the award: MEM77CAP', () => {
  assert.deepEqual(I.parseAward('MEM77CAP'), { base: 'MEM', equipment: '77', seat: 'CAP' });
  assert.deepEqual(I.parseAward('ANC747FO'), { base: 'ANC', equipment: '747', seat: 'FO' });
  assert.equal(I.parseAward('nonsense'), null);
});

const period = (n, from, to) => ({ bidperiodnumber: n, bidperiodyear: 2026, scheduledbidaybasestarttime: from + 'T01:30:00.000+0000', scheduledbidaybaseendtime: to + 'T01:29:00.000+0000' });
const PERIODS = [period(12, '2026-11-30', '2027-01-04'), period(10, '2026-09-28', '2026-10-26'), period(11, '2026-10-26', '2026-11-30')];

test('the periods to read: the one that holds now and the next ones, with the windows the portal takes', () => {
  const now = Date.parse('2026-10-28T14:00:00Z');
  assert.deepEqual(I.windowsFor(PERIODS, now, 2), [
    { startTm: '2026-10-26T01:30:00.000Z', endTm: '2026-11-30T01:29:00.000Z' },
    { startTm: '2026-11-30T01:30:00.000Z', endTm: '2027-01-04T01:29:00.000Z' },
  ]);
  assert.equal(I.windowsFor(PERIODS, now, 1).length, 1);
});

test('the periods to read: with some periods before the current one, so a trip that was just flown gets its final times', () => {
  const now = Date.parse('2026-10-28T14:00:00Z');
  assert.deepEqual(I.windowsFor(PERIODS, now, 2, 1).map(w => w.startTm.slice(0, 10)), ['2026-09-28', '2026-10-26', '2026-11-30']);
  assert.equal(I.windowsFor(PERIODS, now, 1, 5).length, 2); // only one period exists before this one
});

test('the periods to read: before the first period or after the last, nothing is invented', () => {
  assert.deepEqual(I.windowsFor(PERIODS, Date.parse('2030-01-01T00:00:00Z'), 2), []);
});

test('the dates that a set of windows covers', () => {
  assert.deepEqual(I.scopeOf([{ startTm: '2026-10-26T01:30:00.000Z', endTm: '2026-11-30T01:29:00.000Z' }, { startTm: '2026-11-30T01:30:00.000Z', endTm: '2027-01-04T01:29:00.000Z' }]),
    { from: '2026-10-26', to: '2027-01-03' });
});

// ---------- what to change in the document ----------

const NOW = 1000;
const trip = (id, extra = {}) => ({ id, base: 'MEM', eq: '77', show: '2026-10-21T06:48:00Z', end: '2026-10-23T22:49:00Z', opDate: '2026-10-21', src: 'fx', crew: [], fares: [], items: [], ...extra });
const ev = (id, event) => ({ id, event });
const SCOPE = { from: '2026-10-26', to: '2026-12-01' };
const apply = (doc, trips, events, scope = SCOPE) => I.applyImport(doc, { trips, events, scope }, NOW);
const empty = () => ({ trips: {} });

test('a new trip and a new event: both are added with the time of the import', () => {
  const r = apply(empty(), [trip('901')], [ev('event-fx-vac-2026-11-14', { type: 'VAC', from: '2026-11-14', to: '2026-11-25' })]);
  assert.deepEqual(r.changes, {
    901: { updatedAt: NOW, trip: trip('901') },
    'event-fx-vac-2026-11-14': { updatedAt: NOW, event: { type: 'VAC', from: '2026-11-14', to: '2026-11-25' } },
  });
  assert.deepEqual(r.summary, { tripsAdded: 1, tripsUpdated: 0, eventsAdded: 1, eventsUpdated: 0, eventsRemoved: 0, tripsRemoved: 0, skipped: 0 });
});

test('the same data again: nothing changes, so no time of a change is touched', () => {
  const doc = { trips: { 901: { updatedAt: 5, trip: trip('901') }, e1: { updatedAt: 5, event: { type: 'VAC', from: '2026-11-14', to: '2026-11-25' } } } };
  const r = apply(doc, [trip('901')], [ev('e1', { type: 'VAC', from: '2026-11-14', to: '2026-11-25' })]);
  assert.deepEqual(r.changes, {});
  assert.equal(r.summary.tripsUpdated + r.summary.eventsUpdated, 0);
});

test('a changed trip: its data is replaced, and the crew edits, the removed mark, and the older edit of the first officer stay', () => {
  const old = { updatedAt: 5, trip: trip('901', { block: ['1:00', '1:00'] }), crew: [{ seat: 'Captain', name: 'Edited' }], removed: true, fo: { name: 'X', id: '1' } };
  const r = apply({ trips: { 901: old } }, [trip('901', { block: ['2:00', '2:00'] })], []);
  assert.deepEqual(r.changes[901], { updatedAt: NOW, trip: trip('901', { block: ['2:00', '2:00'] }), crew: old.crew, removed: true, fo: old.fo });
  assert.equal(r.summary.tripsUpdated, 1);
});

test('a trip that the user pasted before: it is updated, and from now on it is marked as imported', () => {
  const pasted = { updatedAt: 5, trip: trip('901', { src: undefined, opDate: undefined, block: ['1:00', '1:00'] }) };
  const r = apply({ trips: { 901: pasted } }, [trip('901')], []);
  assert.equal(r.changes[901].trip.src, 'fx');
});

test('a trip that the user deleted for good (a purge): it is not brought back', () => {
  const r = apply({ trips: { 901: { updatedAt: 5, purged: true } } }, [trip('901')], []);
  assert.deepEqual(r.changes, {});
  assert.equal(r.summary.skipped, 1);
});

test('the same trip number on another day: it gets its own id, with the day', () => {
  const doc = { trips: { 901: { updatedAt: 5, trip: trip('901', { opDate: '2026-09-01', show: '2026-09-01T06:48:00Z', end: '2026-09-03T22:49:00Z' }) } } };
  const r = apply(doc, [trip('901')], []);
  assert.deepEqual(Object.keys(r.changes), ['901-20261021']);
  assert.equal(r.changes['901-20261021'].trip.id, '901-20261021');
});

test('an imported trip that is no longer on the schedule, in the days that were read: it moves to Removed, not deleted', () => {
  const gone = { updatedAt: 5, trip: trip('902', { show: '2026-11-10T06:48:00Z', end: '2026-11-12T22:49:00Z', opDate: '2026-11-10' }) };
  const r = apply({ trips: { 902: gone } }, [], []);
  assert.deepEqual(r.changes[902], { updatedAt: NOW, trip: gone.trip, removed: true });
  assert.equal(r.summary.tripsRemoved, 1);
});

test('a trip outside the days that were read, or one that was pasted by hand: left alone', () => {
  const doc = { trips: {
    903: { updatedAt: 5, trip: trip('903', { show: '2026-08-10T06:48:00Z', end: '2026-08-12T22:49:00Z', opDate: '2026-08-10' }) },
    904: { updatedAt: 5, trip: trip('904', { show: '2026-11-10T06:48:00Z', end: '2026-11-12T22:49:00Z', src: undefined }) },
  } };
  assert.deepEqual(apply(doc, [], []).changes, {});
});

test('an event that changed: updated. An event that the user deleted: not brought back', () => {
  const doc = { trips: { e1: { updatedAt: 5, event: { type: 'VAC', from: '2026-11-14', to: '2026-11-20' } }, e2: { updatedAt: 5, purged: true } } };
  const r = apply(doc, [], [ev('e1', { type: 'VAC', from: '2026-11-14', to: '2026-11-25' }), ev('e2', { type: 'RA', from: '2026-11-03', to: '2026-11-03' })]);
  assert.deepEqual(Object.keys(r.changes), ['e1']);
  assert.equal(r.changes.e1.event.to, '2026-11-25');
});

test('an imported event that is no longer on the schedule: deleted. A manual event, or one outside the days read: left alone', () => {
  const doc = { trips: {
    'event-fx-RA-2026-11-03': { updatedAt: 5, event: { type: 'RA', from: '2026-11-03', to: '2026-11-03' } },
    'event-fx-RA-2026-08-03': { updatedAt: 5, event: { type: 'RA', from: '2026-08-03', to: '2026-08-03' } },
    'event-k1abc-x': { updatedAt: 5, event: { type: 'RA', from: '2026-11-03', to: '2026-11-03' } },
  } };
  const r = apply(doc, [], []);
  assert.deepEqual(r.changes, { 'event-fx-RA-2026-11-03': { updatedAt: NOW, purged: true } });
  assert.equal(r.summary.eventsRemoved, 1);
});

test('the answer that is merged: the changed records, applied to the document, give what the import wants', () => {
  const doc = { trips: { 901: { updatedAt: 5, trip: trip('901', { block: ['1:00', '1:00'] }) } } };
  const r = apply(doc, [trip('901', { block: ['2:00', '2:00'] }), trip('905')], [ev('event-fx-js-x', { type: 'JMP', from: '2026-11-01', to: '2026-11-01', flight: 'FX1', dep: 'MEM', arr: 'ATL', fromTime: '08:00' })]);
  const merged = T.mergeDocs(doc, { trips: r.changes });
  assert.deepEqual(T.visibleTrips(merged).map(t => t.id), ['901', '905']);
  assert.equal(T.visibleTrips(merged)[0].block[0], '2:00');
  assert.deepEqual(T.events(merged).map(e => e.id), ['event-fx-js-x']);
});

// ---------- talking to the sync Worker ----------

/** A stand-in for the sync Worker: one document, merged like the real one. */
function fakeWorker(doc) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', url]);
    if (init.method === 'PUT') {
      Object.entries(JSON.parse(init.body).trips).forEach(([id, rec]) => { if (!doc.trips[id] || rec.updatedAt > doc.trips[id].updatedAt) doc.trips[id] = rec; });
    }
    return { ok: true, status: 200, json: async () => doc };
  };
  return { fetch, calls, doc };
}

test('send to the Worker: it reads the document, sends only the changed records, and says what it did', async () => {
  const w = fakeWorker({ trips: { 901: { updatedAt: 5, trip: trip('901') } } });
  const r = await I.syncImport({ fetch: w.fetch, url: 'https://w.example/s/', key: 'KEY', payload: { trips: [trip('901'), trip('905')], events: [], scope: SCOPE }, now: NOW });
  assert.deepEqual(w.calls, [['GET', 'https://w.example/s/KEY'], ['PUT', 'https://w.example/s/KEY']]);
  assert.deepEqual(Object.keys(w.doc.trips).sort(), ['901', '905']);
  assert.equal(r.summary.tripsAdded, 1);
});

test('send to the Worker: with nothing changed, it does not send anything', async () => {
  const w = fakeWorker({ trips: { 901: { updatedAt: 5, trip: trip('901') } } });
  const r = await I.syncImport({ fetch: w.fetch, url: 'https://w.example/s/', key: 'KEY', payload: { trips: [trip('901')], events: [], scope: SCOPE }, now: NOW });
  assert.deepEqual(w.calls, [['GET', 'https://w.example/s/KEY']]);
  assert.equal(r.summary.tripsAdded + r.summary.tripsUpdated, 0);
});

test('send to the Worker: a Worker that refuses is an error with its status', async () => {
  const fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(() => I.syncImport({ fetch, url: 'https://w.example/s/', key: 'KEY', payload: { trips: [], events: [], scope: SCOPE }, now: NOW }), /429/);
});
