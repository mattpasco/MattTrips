/**
 * The sync document of the app and the rules that change it.
 * Plain browser script (also runnable under Node via `require`). No dependencies.
 *
 * doc = { trips: { <id>: { updatedAt, trip?, removed?, crew?, fo?, event?, purged? } } }
 * crew is the edited crew list (it replaces trip.crew). fo is an older FO edit, still read.
 * event is { type, from, to, fromTime?, toTime?, flight?, dep?, arr? }: reserve days (RA, RB, R24),
 * training (TRN), vacation (VAC), or a jumpseat (JMP), with no trip. Every trip function ignores it.
 * Each change sets updatedAt of that one trip. A merge keeps, for each trip, the record with the
 * newest updatedAt (the Worker does the same). A purge keeps { updatedAt, purged: true } so an
 * older copy on another device can not bring the trip back.
 */
(function (global) {
'use strict';

function emptyDoc() { return { trips: {} }; }

function live(rec) { return !!(rec && rec.trip && !rec.purged); }
function hasTrip(doc, id) { return live(doc.trips[id]); }

function addTrip(doc, trip, now) { doc.trips[trip.id] = { updatedAt: now, trip: trip }; }
function edit(doc, id, now, fn) {
  var rec = doc.trips[id];
  if (!live(rec)) return;
  fn(rec);
  rec.updatedAt = now;
}
function removeTrip(doc, id, now) { edit(doc, id, now, function (r) { r.removed = true; }); }
function restoreTrip(doc, id, now) { edit(doc, id, now, function (r) { delete r.removed; }); }

/** The crew of a record: the edited list if there is one, else the recap crew, with an old FO edit on top. */
function crewOf(rec) {
  var base = rec.crew || (Array.isArray(rec.trip.crew) ? rec.trip.crew : []);
  return applyCrewOverride(base, rec.fo);
}
function setCrew(doc, id, now, fn) {
  edit(doc, id, now, function (r) {
    var crew = crewOf(r).map(function (c) { return Object.assign({}, c); });
    fn(crew);
    r.crew = crew;
    delete r.fo;
  });
}
/** Set the name, number, and phone of crew member i. Blank all three on an added member removes that member. */
function editCrew(doc, id, i, who, now) {
  setCrew(doc, id, now, function (crew) {
    if (!crew[i]) return;
    if (crew[i].added && !who.name && !who.id && !who.phone) { crew.splice(i, 1); return; }
    crew[i].name = who.name; crew[i].id = who.id;
    if (who.phone) crew[i].phone = who.phone; else delete crew[i].phone;
  });
}
/** Add a crew member who is not on the recap. With no name, number, or phone, nothing changes. */
function addCrew(doc, id, who, now) {
  var name = (who.name || '').trim(), num = (who.id || '').trim(), phone = (who.phone || '').trim();
  if (!name && !num && !phone) return;
  setCrew(doc, id, now, function (crew) {
    var c = { seat: (who.seat || '').trim() || 'Crew', code: '', id: num, name: name };
    if (phone) c.phone = phone;
    c.added = true;
    crew.push(c);
  });
}
function purgeTrip(doc, id, now) { doc.trips[id] = { updatedAt: now, purged: true }; }

// Calendar events. Reserve days (RA, RB, R24) fill whole days. Times are Central. RB ends the day after it starts.
var RESERVE_TYPES = {
  RA: { start: '01:30', end: '13:30', nextDay: false },
  RB: { start: '13:30', end: '01:30', nextDay: true },
  R24: { start: '00:00', end: '24:00', nextDay: false },
};
// A vacation day runs from 0130 to 0129 Central: the calendar bar starts at 0130 of the first day and
// ends at the end of 0129 on the day after the last day.
var VACATION = { start: '01:30', end: '01:29', nextDay: true };
function hm(s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; }
function validDate(s) {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
}
function validTime(s) { return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(s); }
function isReserve(type) { return Object.prototype.hasOwnProperty.call(RESERVE_TYPES, type); }
function liveEvent(rec) { return !!(rec && rec.event && !rec.purged); }
function validAirport(s) { return /^[A-Za-z]{3}$/.test((s || '').trim()); }
/** What is wrong with an event { type, from, to, fromTime?, toTime? }, in words, or '' if nothing.
 *  A jumpseat (JMP) is { type, from, flight, dep, arr, fromTime }: one day, no `to`. */
function eventProblem(e) {
  if (e.type === 'JMP') {
    if (!validDate(e.from)) return 'Choose the day.';
    if (!(e.flight || '').trim()) return 'Enter the flight number.';
    if (!validAirport(e.dep) || !validAirport(e.arr)) return 'Use 3-letter airport codes, like MEM.';
    if (e.dep.trim().toUpperCase() === e.arr.trim().toUpperCase()) return 'The airports are the same.';
    if (!validTime(e.fromTime)) return 'Choose the departure time.';
    return '';
  }
  if (!isReserve(e.type) && e.type !== 'VAC' && e.type !== 'TRN') return 'Choose RA, RB, or R24.';
  if (!validDate(e.from) || !validDate(e.to)) return 'Choose the first and last day.';
  if (e.to < e.from) return 'The last day is before the first day.';
  if (e.type === 'TRN') {
    if (!validTime(e.fromTime) || !validTime(e.toTime)) return 'Choose the start and end times.';
    if (e.to + ' ' + e.toTime <= e.from + ' ' + e.fromTime) return 'The end is before the start.';
  }
  return '';
}
/** Add an event. Returns its id, or null (nothing added) if eventProblem finds a problem.
 *  Only a training and a jumpseat keep times. A jumpseat keeps its flight and airports in upper case. */
function addEvent(doc, e, now) {
  if (eventProblem(e)) return null;
  var ev = { type: e.type, from: e.from, to: e.to };
  if (e.type === 'TRN') { ev.fromTime = e.fromTime; ev.toTime = e.toTime; }
  if (e.type === 'JMP') {
    ev = { type: 'JMP', from: e.from, to: e.from, flight: e.flight.trim().toUpperCase(),
      dep: e.dep.trim().toUpperCase(), arr: e.arr.trim().toUpperCase(), fromTime: e.fromTime };
  }
  var id = 'event-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  doc.trips[id] = { updatedAt: now, event: ev };
  return id;
}
function removeEvent(doc, id, now) {
  if (liveEvent(doc.trips[id])) doc.trips[id] = { updatedAt: now, purged: true };
}
/** The events, by first day, then type. */
function events(doc) {
  return Object.keys(doc.trips).filter(function (id) { return liveEvent(doc.trips[id]); }).map(function (id) {
    return Object.assign({ id: id }, doc.trips[id].event);
  }).sort(function (a, b) {
    return a.from < b.from ? -1 : a.from > b.from ? 1 : a.type < b.type ? -1 : a.type > b.type ? 1 : a.id < b.id ? -1 : 1;
  });
}
/** The show time of a jumpseat: one hour before its local departure time, as { time: 'HH:MM', dayBefore }.
 *  dayBefore is true when that is on the day before. null if the departure time is not a valid time. */
function showTime(fromTime) {
  if (!validTime(fromTime)) return null;
  var m = hm(fromTime) - 60, dayBefore = m < 0;
  if (dayBefore) m += 1440;
  return { time: ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2), dayBefore: dayBefore };
}
/** Where an event sits on the calendar, as an item for CalGrid.monthGrid: minutes after midnight of from and of to. */
function eventSpan(e) {
  var span = { from: e.from, to: e.to, fromMin: 0, toMin: 1440 };
  if (e.type === 'VAC') {
    span.fromMin = hm(VACATION.start);
    span.toMin = (VACATION.nextDay ? 1440 : 0) + hm(VACATION.end) + 1;
  }
  if (e.type === 'TRN') { span.fromMin = hm(e.fromTime); span.toMin = hm(e.toTime); }
  return span;
}

/** The crew with the first officer's name and number replaced by an old FO edit. A blank field shows blank. */
function applyCrewOverride(crew, fo) {
  if (!fo) return crew;
  return crew.map(function (c) {
    if ((c.seat || '').toLowerCase() !== 'first officer') return c;
    return { seat: c.seat, code: c.code, name: fo.name, id: fo.id };
  });
}

/** The trips of the records that pass `keep`, with their crew edits, by report time. */
function tripsWhere(doc, keep) {
  return Object.keys(doc.trips).map(function (id) { return doc.trips[id]; })
    .filter(function (r) { return live(r) && keep(r); })
    .map(function (r) {
      var t = Object.assign({}, r.trip);
      t.crew = crewOf(r);
      return t;
    })
    .sort(function (a, b) { return Date.parse(a.show) - Date.parse(b.show); });
}
function visibleTrips(doc) { return tripsWhere(doc, function (r) { return !r.removed; }); }
function hiddenTrips(doc) { return tripsWhere(doc, function (r) { return !!r.removed; }); }

function toMin(s) { var p = s.split(':'); return (+p[0]) * 60 + (+p[1]); }
function fromMin(n) { return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); }
function sum(list, key, i) { return fromMin(list.reduce(function (n, t) { return n + toMin(t[key][i]); }, 0)); }
/** Count and [planned, actual] block and pay sums of a trip list. */
function totals(list) {
  return { count: list.length, block: [sum(list, 'block', 0), sum(list, 'block', 1)], pay: [sum(list, 'pay', 0), sum(list, 'pay', 1)] };
}

/** For each trip, the record with the newest updatedAt. A tie keeps `a`. Records with no numeric updatedAt are dropped. */
function mergeDocs(a, b) {
  var out = emptyDoc();
  [a, b].forEach(function (doc) {
    Object.keys((doc && doc.trips) || {}).forEach(function (id) {
      var rec = doc.trips[id];
      if (!rec || typeof rec.updatedAt !== 'number') return;
      if (!out.trips[id] || rec.updatedAt > out.trips[id].updatedAt) out.trips[id] = rec;
    });
  });
  return out;
}

var api = {
  emptyDoc: emptyDoc, hasTrip: hasTrip, addTrip: addTrip, removeTrip: removeTrip, restoreTrip: restoreTrip,
  purgeTrip: purgeTrip, RESERVE_TYPES: RESERVE_TYPES, eventProblem: eventProblem, addEvent: addEvent,
  removeEvent: removeEvent, events: events, eventSpan: eventSpan, showTime: showTime, editCrew: editCrew, addCrew: addCrew, applyCrewOverride: applyCrewOverride, visibleTrips: visibleTrips,
  hiddenTrips: hiddenTrips, totals: totals, mergeDocs: mergeDocs,
};
global.Trips = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
