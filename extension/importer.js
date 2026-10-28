/**
 * Turns the schedule data of the crew portal into the records of this app, and works out which records
 * to change. Plain script (also runnable under Node via `require`). No dependencies. It does not call
 * the portal: content.js does that, and gives the answers to the functions here.
 */
(function (global) {
'use strict';

// A bid day starts at 0130 Central, so a time minus 90 minutes is on the day that it belongs to.
var BID_DAY_SHIFT = 90 * 60000;
var NOT_A_LEG = /^(Stby|Turn|Brief|Debrief|Layover)Segment$/;
var AIRLINES = { FDX: 'FX', UAL: 'UA' };
var RESERVE = { RA: 1, RB: 1, R24: 1 };

function hm(n) { return Math.floor(n / 60) + ':' + ('0' + (n % 60)).slice(-2); }
/** [scheduled, actual] as h:mm. With no actual value (nothing flown yet) the actual is the scheduled one. */
function pair(sched, actual) { return [hm(sched), hm(actual > 0 ? actual : sched)]; }
function iso(s) { return new Date(s).toISOString().slice(0, 19) + 'Z'; }
function ms(s) { return Date.parse(s); }
/** The day (YYYY-MM-DD) that a time belongs to. A local time with an offset is read by its own clock. */
function dayOf(s) { return new Date(ms(s.slice(0, 16) + ':00Z') - BID_DAY_SHIFT).toISOString().slice(0, 10); }
function titleCase(s) { return String(s || '').replace(/\S+/g, function (t) { return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); }); }
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  return JSON.stringify(v);
}
function same(a, b) { return canon(a) === canon(b); }
function phoneOf(vendor) { return (vendor && vendor.contacts && vendor.contacts[0] && vendor.contacts[0].phone) || ''; }

// ---------- one trip ----------

function carOf(r) {
  var g = r.gtSvcReservation;
  return { co: (g.gtvendor && g.gtvendor.vendorScheduleName) || '', ph: phoneOf(g.gtvendor), a: iso(g.pickupTime), b: iso(g.dropoffTime) };
}

/** The layover between two flights: from the ground rides and the hotel that fall between them. null if there are fewer than two rides. */
function layoverBetween(prev, next, services) {
  var from = ms(prev.s[1]), to = ms(next.s[0]);
  var rides = services.filter(function (r) { return r.gtSvcReservation && ms(r.gtSvcReservation.pickupTime) >= from && ms(r.gtSvcReservation.pickupTime) < to; })
    .sort(function (a, b) { return ms(a.gtSvcReservation.pickupTime) - ms(b.gtSvcReservation.pickupTime); });
  if (rides.length < 2) return null;
  var hotel = services.filter(function (r) { return r.hotelReservation && ms(r.hotelReservation.arrivalTime) >= from && ms(r.hotelReservation.arrivalTime) < to; })[0];
  var gin = carOf(rides[0]), gout = carOf(rides[rides.length - 1]);
  var vendor = hotel && hotel.hotelReservation.hotelVendor;
  return { t: 'l', stn: prev.d, hotel: (vendor && vendor.vendorScheduleName) || 'Hotel', ph: phoneOf(vendor) || gin.ph, in: gin.b, out: gout.a, gin: gin, gout: gout };
}

function legOf(s, meals) {
  var number = String(s.flightNumber).replace(/^0+/, '');
  var f = {
    t: 'f', no: s.airlineCode === 'FX' || !s.airlineCode ? number : s.airlineCode + number,
    o: s.originIATACode, d: s.destinationIATACode,
    s: [iso(s.scheduledStartTime), iso(s.scheduledEndTime)], blk: pair(s.scheduledDurationMinutes, s.actualDurationMinutes),
  };
  if (s.segmentType === 'CommercialSegment') f.dh = true;
  if (s.actualStartTime && s.actualEndTime) f.a = [iso(s.actualStartTime), iso(s.actualEndTime)];
  if (s.tailNumber) f.tail = 'N' + s.tailNumber + 'FD';
  var m = meals.filter(function (r) { return ms(r.cateringReservation.flightDepartureDtTmZ) === ms(s.scheduledStartTime); })[0];
  if (m) f.meals = m.cateringReservation.meals;
  return f;
}

/** The trip of this app from the answer of the portal for one trip (`bytripkey`: { trip, tripServiceReservation, acceptableFares }). */
function tripFromApi(r) {
  var t = r.trip, services = ((r.tripServiceReservation && r.tripServiceReservation.svcReservations) || []).filter(Boolean);
  var meals = services.filter(function (s) { return s.cateringReservation; });
  var legs = t.focusSegments.filter(function (s) { return !NOT_A_LEG.test(s.segmentType) && s.flightNumber && !/DUTY$/i.test(s.flightNumber); });
  var flights = legs.map(function (s) { return legOf(s, meals); });
  flights.forEach(function (f, i) {
    var next = flights[i + 1];
    if (next) {
      var sched = Math.round((ms(next.s[0]) - ms(f.s[1])) / 60000);
      var act = f.a && next.a ? Math.round((ms(next.a[0]) - ms(f.a[1])) / 60000) : sched;
      f.turn = [hm(sched), hm(act)];
    }
  });
  (t.dutyPeriodInfos || []).forEach(function (d) {
    var inDuty = flights.filter(function (f) { return ms(f.s[0]) >= ms(d.showTime) && ms(f.s[0]) <= ms(d.endTime); });
    var last = inDuty[inDuty.length - 1];
    if (!last) return;
    last.duty = pair(d.dutyMinutes, d.actualDutyMinutes);
    if (d.layoverMinutes > 0) last.lo = pair(d.layoverMinutes, d.actualLayoverMinutes);
  });
  var items = [];
  flights.forEach(function (f, i) {
    if (i) { var l = layoverBetween(flights[i - 1], f, services); if (l) items.push(l); }
    items.push(f);
  });
  var crew = (t.tripCrews || []).map(function (c) {
    var p = c.pilotInfo || {}, seat = (c.crewSeat && c.crewSeat.name) || c.seatAbbreviation || '';
    return { seat: seat.charAt(0).toUpperCase() + seat.slice(1).toLowerCase(), code: c.tripAssignmentReasonAbbreviation || '', id: String(c.pilotID || ''), name: titleCase(p.firstName + ' ' + p.lastName) };
  }).filter(function (c) { return c.id && c.name.trim(); });
  var fares = ((r.acceptableFares && r.acceptableFares.deadheads) || []).map(function (d) {
    return { al: (d.segments && d.segments[0] && d.segments[0].airlineCode) || '', od: d.origin + '-' + d.destination, cls: d.classOfService, amt: String(Math.round(d.baselineFare)) };
  });
  return {
    id: String(t.number), base: t.baseStationCode, eq: String(t.aircraftCode), show: iso(t.tripStartTime), end: iso(t.tripEndTime),
    away: pair(t.scheduledAwayMinutes, t.actualAwayMinutes), block: pair(t.totalBlockMinutes), pay: pair(t.scheduledPayMinutes, t.actualPayMinutes),
    crew: crew, fares: fares, items: items, opDate: String(t.operatingDate).slice(0, 10), src: 'fx',
  };
}

// ---------- vacation, jumpseats, reserve ----------

/** The events of this app, as [{ id, event }], from { unavailabilityAssignments, jumpseats, reserves } (lists from the portal). */
function eventsFromApi(d) {
  var out = [];
  (d.unavailabilityAssignments || []).forEach(function (u) {
    if (u.uaType !== 'VAC') return;
    var from = dayOf(u.scheduledLBTStartTime), to = dayOf(u.scheduledLBTEndTime);
    out.push({ id: 'event-fx-vac-' + from, event: { type: 'VAC', from: from, to: to } });
  });
  (d.jumpseats || []).forEach(function (j) {
    var local = j.scheduledOutLocalTime, day = local.slice(0, 10);
    var flight = (AIRLINES[j.comapnyId] || j.comapnyId) + String(j.flightNbr).replace(/^0+/, '');
    out.push({ id: 'event-fx-js-' + day + '-' + flight + '-' + j.iataoriginCode,
      event: { type: 'JMP', from: day, to: day, flight: flight, dep: j.iataoriginCode, arr: j.iatadestinationCode, fromTime: local.slice(11, 16) } });
  });
  (d.reserves || []).forEach(function (r) {
    if (!RESERVE[r.raType] || r.raCancelType) return;
    var day = String(r.raOperatingDate).slice(0, 10);
    out.push({ id: 'event-fx-' + r.raType + '-' + day, event: { type: r.raType, from: day, to: day } });
  });
  return out;
}

// ---------- who, and which periods ----------

function pilotIdFromToken(token) {
  try {
    var b = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return String(JSON.parse(atob(b + '==='.slice((b.length + 3) % 4))).sub || '') || null;
  } catch (e) { return null; }
}
/** 'MEM77CAP' as { base, equipment, seat }. */
function parseAward(s) {
  var m = /^([A-Z]{3})([0-9]{2,3})([A-Z]+)$/.exec(s || '');
  return m ? { base: m[1], equipment: m[2], seat: m[3] } : null;
}
/** The windows (as the portal takes them) of the bid period that holds `now` and the next ones, `count` in all,
 *  and the `before` periods before it (a trip that was just flown gets its final times a few days later). */
function windowsFor(periods, now, count, before) {
  var list = periods.map(function (p) {
    return { from: p.scheduledbidaybasestarttime.slice(0, 10), to: p.scheduledbidaybaseendtime.slice(0, 10) };
  }).sort(function (a, b) { return a.from < b.from ? -1 : 1; });
  var today = new Date(now - BID_DAY_SHIFT).toISOString().slice(0, 10);
  var first = list.findIndex(function (p) { return p.from <= today && today < p.to; });
  if (first < 0) return [];
  return list.slice(Math.max(0, first - (before || 0)), first + count).map(function (p) { return { startTm: p.from + 'T01:30:00.000Z', endTm: p.to + 'T01:29:00.000Z' }; });
}
/** The first and last day that the windows cover. */
function scopeOf(windows) {
  return { from: dayOf(windows[0].startTm), to: dayOf(windows[windows.length - 1].endTm) };
}

// ---------- what to change in the document ----------

function sameTrip(rec, t) {
  var old = rec.trip;
  if (old.opDate && t.opDate) return old.opDate === t.opDate;
  return Math.abs(ms(old.show) - ms(t.show)) < 12 * 3600000;
}
function inScope(day, scope) { return day >= scope.from && day <= scope.to; }

/**
 * Compare what the portal says with the document, and return only the records to change:
 *   { changes: { <id>: record }, summary }.
 * A trip that was imported before keeps its crew edits and its removed mark. A record that the user
 * deleted for good is not brought back. An imported trip or event that the portal no longer shows,
 * inside the days that were read, is removed (a trip moves to Removed, an event is deleted).
 * ponytail: a delete cannot tell the user's from ours, so a day that was cancelled and given again stays gone.
 */
function applyImport(doc, data, now) {
  var changes = {}, s = { tripsAdded: 0, tripsUpdated: 0, eventsAdded: 0, eventsUpdated: 0, eventsRemoved: 0, tripsRemoved: 0, skipped: 0 };
  var seen = {};
  data.trips.forEach(function (t) {
    var id = null, dated = t.id + '-' + t.opDate.replace(/-/g, '');
    [t.id, dated].some(function (c) {
      var rec = doc.trips[c];
      if (rec && rec.purged) { id = false; return true; }
      if (!rec || !rec.trip || sameTrip(rec, t)) { id = c; return true; }
      return false;
    });
    if (id === false) { s.skipped++; return; }
    if (id === null) id = dated;
    var next = Object.assign({}, t, { id: id }), rec = doc.trips[id];
    seen[id] = true;
    if (!rec || !rec.trip) { changes[id] = { updatedAt: now, trip: next }; s.tripsAdded++; return; }
    if (same(rec.trip, next)) return;
    changes[id] = Object.assign({}, rec, { updatedAt: now, trip: next });
    s.tripsUpdated++;
  });
  data.events.forEach(function (e) {
    var rec = doc.trips[e.id];
    seen[e.id] = true;
    if (rec && rec.purged) { s.skipped++; return; }
    if (rec && rec.event && same(rec.event, e.event)) return;
    changes[e.id] = { updatedAt: now, event: e.event };
    if (rec && rec.event) s.eventsUpdated++; else s.eventsAdded++;
  });
  Object.keys(doc.trips).forEach(function (id) {
    var rec = doc.trips[id];
    if (seen[id] || !rec) return;
    if (rec.trip && rec.trip.src === 'fx' && !rec.removed && inScope(rec.trip.show.slice(0, 10), data.scope)) {
      changes[id] = Object.assign({}, rec, { updatedAt: now, removed: true });
      s.tripsRemoved++;
    } else if (rec.event && /^event-fx-/.test(id) && inScope(rec.event.from, data.scope)) {
      changes[id] = { updatedAt: now, purged: true };
      s.eventsRemoved++;
    }
  });
  return { changes: changes, summary: s };
}

/** Read the document from the sync Worker, send only the records that change, and return what applyImport returns. */
async function syncImport(o) {
  var res = await o.fetch(o.url + o.key);
  if (!res.ok) throw new Error('Sync failed (' + res.status + ')');
  var r = applyImport(await res.json(), o.payload, o.now);
  if (Object.keys(r.changes).length) {
    res = await o.fetch(o.url + o.key, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trips: r.changes }) });
    if (!res.ok) throw new Error('Sync failed (' + res.status + ')');
  }
  return r;
}

var api = {
  tripFromApi: tripFromApi, eventsFromApi: eventsFromApi, pilotIdFromToken: pilotIdFromToken, parseAward: parseAward,
  windowsFor: windowsFor, scopeOf: scopeOf, applyImport: applyImport, syncImport: syncImport,
};
global.Importer = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
