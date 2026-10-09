/**
 * The sync document of the app and the rules that change it.
 * Plain browser script (also runnable under Node via `require`). No dependencies.
 *
 * doc = { trips: { <id>: { updatedAt, trip?, removed?, crew?, fo?, reserve?, purged? } } }
 * crew is the edited crew list (it replaces trip.crew). fo is an older FO edit, still read.
 * reserve is { type, from, to }: a block of reserve days, with no trip. Every trip function ignores it.
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

// Reserve days, in Central time. RB ends on the day after the day that it starts.
var RESERVE_TYPES = {
  RA: { start: '01:30', end: '13:30', nextDay: false },
  RB: { start: '13:30', end: '01:30', nextDay: true },
  R24: { start: '00:00', end: '24:00', nextDay: false },
};
function reserveTimes(type) {
  var r = RESERVE_TYPES[type];
  if (type === 'R24') return 'All day';
  return r.start.replace(':', '') + ' to ' + r.end.replace(':', '') + ' CT' + (r.nextDay ? ', next day' : '');
}
function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
}
function liveReserve(rec) { return !!(rec && rec.reserve && !rec.purged); }
/** Add a block of reserve days. Returns its id, or null (nothing added) if the type or the days are not valid. */
function addReserve(doc, r, now) {
  if (!Object.prototype.hasOwnProperty.call(RESERVE_TYPES, r.type)) return null;
  if (!validDate(r.from) || !validDate(r.to) || r.to < r.from) return null;
  var id = 'reserve-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  doc.trips[id] = { updatedAt: now, reserve: { type: r.type, from: r.from, to: r.to } };
  return id;
}
function removeReserve(doc, id, now) {
  if (liveReserve(doc.trips[id])) doc.trips[id] = { updatedAt: now, purged: true };
}
/** The reserve blocks, by first day, then type. */
function reserves(doc) {
  return Object.keys(doc.trips).filter(function (id) { return liveReserve(doc.trips[id]); }).map(function (id) {
    var r = doc.trips[id].reserve;
    return { id: id, type: r.type, from: r.from, to: r.to };
  }).sort(function (a, b) {
    return a.from < b.from ? -1 : a.from > b.from ? 1 : a.type < b.type ? -1 : a.type > b.type ? 1 : a.id < b.id ? -1 : 1;
  });
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
  purgeTrip: purgeTrip, RESERVE_TYPES: RESERVE_TYPES, reserveTimes: reserveTimes, addReserve: addReserve,
  removeReserve: removeReserve, reserves: reserves, editCrew: editCrew, addCrew: addCrew, applyCrewOverride: applyCrewOverride, visibleTrips: visibleTrips,
  hiddenTrips: hiddenTrips, totals: totals, mergeDocs: mergeDocs,
};
global.Trips = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
