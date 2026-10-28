/**
 * Runs on the crew portal after you log in. Reads your schedule with the login you already have,
 * hands it to background.js to copy into Matt's trips, and shows the result in a small note.
 * Any failed request stops the whole import: a partial schedule would remove trips that are still there.
 */
(function () {
'use strict';

var PERIODS_BEFORE = 1;           // the bid period before today's: its last trips get their final times
var PERIODS_TO_READ = 2;          // the bid period that holds today and the next one
var MIN_GAP_MS = 30 * 60000;      // read the schedule at most every 30 minutes
var API = '/cis/gateway/';

async function get(path, headers, asText) {
  var res = await fetch(path, { credentials: 'include', headers: headers });
  if (!res.ok) throw new Error('The crew portal answered ' + res.status + ' for ' + path.split('?')[0]);
  if (asText) return res.text();
  var body = await res.json();
  if (body.status && body.status.success === false) throw new Error('The crew portal refused ' + path.split('?')[0]);
  return body.responseData || body;
}
function query(o) { return Object.keys(o).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }
async function inBatches(list, size, fn) {
  var out = [];
  for (var i = 0; i < list.length; i += size) out = out.concat(await Promise.all(list.slice(i, i + size).map(fn)));
  return out;
}

/** The schedule as { trips, events, scope } for the importer. */
async function collect() {
  var token = (await get('/cis/authn/rs/o2b/token/access/pfc', {}, true)).trim();
  var H = { Authorization: 'Bearer ' + token };
  var pilotId = Importer.pilotIdFromToken(token);
  if (!pilotId) throw new Error('Could not read your employee number from the login.');
  var who = await get(API + 'static/dictionary/pilot-lite/v2/' + pilotId, H);
  var award = Importer.parseAward(who.crewPositionAward);
  if (!award) throw new Error('Could not read your base and aircraft from "' + who.crewPositionAward + '".');

  var year = new Date().getFullYear(), periods = [];
  for (var y = year - 1; y <= year + 1; y++) {
    periods = periods.concat(await get(API + 'static/dictionary/bidperiodschedule/bybaseandyear?' + query({ base: award.base, years: y }), H));
  }
  var windows = Importer.windowsFor(periods, Date.now(), PERIODS_TO_READ, PERIODS_BEFORE);
  if (!windows.length) throw new Error('Today is not in a bid period that the portal lists.');

  var unavailability = [], reserves = [], jumpseats = [], keys = {};
  for (var w = 0; w < windows.length; w++) {
    var win = { pilotId: pilotId, startTm: windows[w].startTm, endTm: windows[w].endTm };
    var act = await get(API + 'crew/activity/v2?' + query(Object.assign({}, win, {
      base: award.base, equipment: award.equipment, seat: award.seat, fetchLocalTime: true, allowedCheckInWindowOnly: false,
      fetchTrainingScheduleEvents: false, fetchAdditionalSegments: false })), H);
    unavailability = unavailability.concat(act.unavailabilityAssignments || []);
    reserves = reserves.concat(act.reserveAssignments || []);
    (act.trips || []).forEach(function (t) { keys[t.number + ' ' + String(t.operatingDate).slice(0, 10)] = { number: t.number, date: String(t.operatingDate).slice(0, 10) }; });
    var js = await get(API + 'crew/activity/jumpseat?' + query(win), H);
    jumpseats = jumpseats.concat(js.jumpseatReservations || []);
  }
  var trips = await inBatches(Object.keys(keys).map(function (k) { return keys[k]; }), 4, async function (k) {
    return Importer.tripFromApi(await get(API + 'open-time/data-viewer/trip/bytripkey?' + query({
      base: award.base, equipment: award.equipment, operatingDate: k.date, tripNumber: k.number, clientText: 'TR_MOB' }), H));
  });
  return {
    trips: trips, scope: Importer.scopeOf(windows),
    events: Importer.eventsFromApi({ unavailabilityAssignments: unavailability, reserves: reserves, jumpseats: jumpseats }),
  };
}

function note(text, bad) {
  var el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;padding:10px 14px;border-radius:8px;' +
    'font:14px system-ui,sans-serif;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3);background:' + (bad ? '#b3261e' : '#1b5e20');
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, bad ? 15000 : 6000);
}
function describe(s) {
  var parts = [];
  if (s.tripsAdded) parts.push(s.tripsAdded + ' new trip' + (s.tripsAdded > 1 ? 's' : ''));
  if (s.tripsUpdated) parts.push(s.tripsUpdated + ' trip' + (s.tripsUpdated > 1 ? 's' : '') + ' updated');
  if (s.tripsRemoved) parts.push(s.tripsRemoved + ' trip' + (s.tripsRemoved > 1 ? 's' : '') + ' moved to Removed');
  var ev = s.eventsAdded + s.eventsUpdated + s.eventsRemoved;
  if (ev) parts.push(ev + ' calendar event' + (ev > 1 ? 's' : '') + ' changed');
  return parts.length ? "Matt's trips: " + parts.join(', ') + '.' : "Matt's trips is up to date.";
}

async function run() {
  var last = (await chrome.storage.local.get('lastRun')).lastRun || 0;
  if (Date.now() - last < MIN_GAP_MS) return;
  try {
    var payload = await collect();
    var reply = await chrome.runtime.sendMessage({ type: 'import', payload: payload });
    if (reply.error) throw new Error(reply.error);
    await chrome.storage.local.set({ lastRun: Date.now() });
    note(describe(reply.summary));
  } catch (e) {
    note("Matt's trips could not import: " + e.message, true);
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) run();
else globalThis.collectSchedule = collect; // a manual check from the console
})();
