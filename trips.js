/**
 * The sync document of the app and the rules that change it.
 * Plain browser script (also runnable under Node via `require`). No dependencies.
 *
 * doc = { trips: { <id>: { updatedAt, trip?, removed?, fo?, purged? } } }
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
function setFO(doc, id, fo, now) { edit(doc, id, now, function (r) { r.fo = { name: fo.name, id: fo.id }; }); }
function purgeTrip(doc, id, now) { doc.trips[id] = { updatedAt: now, purged: true }; }

/** The crew with the first officer replaced by the override. Blank override fields keep the recap value. */
function applyCrewOverride(crew, fo) {
  if (!fo) return crew;
  return crew.map(function (c) {
    if ((c.seat || '').toLowerCase() !== 'first officer') return c;
    return { seat: c.seat, code: c.code, name: fo.name || c.name, id: fo.id || c.id };
  });
}

/** The trips of the records that pass `keep`, with the FO override applied, by report time. */
function tripsWhere(doc, keep) {
  return Object.keys(doc.trips).map(function (id) { return doc.trips[id]; })
    .filter(function (r) { return live(r) && keep(r); })
    .map(function (r) {
      var t = Object.assign({}, r.trip);
      t.crew = applyCrewOverride(Array.isArray(t.crew) ? t.crew : [], r.fo);
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
  purgeTrip: purgeTrip, setFO: setFO, applyCrewOverride: applyCrewOverride, visibleTrips: visibleTrips,
  hiddenTrips: hiddenTrips, totals: totals, mergeDocs: mergeDocs,
};
global.Trips = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
