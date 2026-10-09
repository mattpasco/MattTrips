/**
 * The month grid of the calendar view.
 * Plain browser script (also runnable under Node via `require`). No dependencies.
 *
 * monthGrid(year, month, trips, tzOf) returns the weeks of the month, from Sunday to Saturday:
 *   [ { days: [{ date: 'YYYY-MM-DD', inMonth }] x7,
 *       bars: [{ id, from, to, lane, inLeft, inRight, continuesLeft, continuesRight }] } ]
 * A bar is the part of one item in one week. from and to are columns 0 (Sunday) to 6. inLeft and
 * inRight are the part of the first and the last day that the bar leaves empty (0 to 1).
 * An item is a trip { id, base, show, end }: it covers the local dates of its base (tzOf(base)) from
 * report to release. Or it is { id, from, to, fromMin?, toMin? } with dates 'YYYY-MM-DD': it runs from
 * fromMin minutes after midnight of from (default 0) to toMin minutes after midnight of to (default
 * 1440, the end of the day; it can be more, to end on a later day).
 */
(function (global) {
'use strict';

var formats = {};
/** The date 'YYYY-MM-DD' of an instant, in a time zone. */
function localDate(iso, tz) {
  if (!formats[tz]) formats[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  var o = {};
  formats[tz].formatToParts(new Date(iso)).forEach(function (p) { o[p.type] = p.value; });
  return o.year + '-' + o.month + '-' + o.day;
}

var DAY = 86400000, MIN = 1440; // MIN: minutes in a day
function dayNum(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY; }
function dayDate(n) { return new Date(n * DAY).toISOString().slice(0, 10); }

function monthGrid(year, month, trips, tzOf) {
  var first = Date.UTC(year, month, 1) / DAY, last = Date.UTC(year, month + 1, 0) / DAY;
  var start = first - new Date(first * DAY).getUTCDay(), end = last + 6 - new Date(last * DAY).getUTCDay();
  var spans = trips.map(function (t) {
    // a and b: the start and the end of the item, in minutes on the day line (day number x 1440)
    if (t.from) return { id: t.id, a: dayNum(t.from) * MIN + (t.fromMin || 0), b: dayNum(t.to) * MIN + (t.toMin === undefined ? MIN : t.toMin) };
    var tz = tzOf(t.base);
    return { id: t.id, a: dayNum(localDate(t.show, tz)) * MIN, b: (dayNum(localDate(t.end, tz)) + 1) * MIN };
  }).sort(function (x, y) { return x.a - y.a || (x.id < y.id ? -1 : 1); });

  var weeks = [];
  for (var w = start; w <= end; w += 7) {
    var days = [];
    for (var i = 0; i < 7; i++) days.push({ date: dayDate(w + i), inMonth: new Date((w + i) * DAY).getUTCMonth() === month });
    var laneEnd = [], bars = [];
    var ws = w * MIN, we = (w + 7) * MIN;
    spans.filter(function (s) { return s.a < we && s.b > ws; }).forEach(function (s) {
      var a = Math.max(s.a, ws) - ws, b = Math.min(s.b, we) - ws; // minutes into the week
      var from = Math.floor(a / MIN), to = Math.floor((b - 1) / MIN), lane = 0;
      while (laneEnd[lane] !== undefined && laneEnd[lane] >= from) lane++;
      laneEnd[lane] = to;
      bars.push({ id: s.id, from: from, to: to, lane: lane, inLeft: (a - from * MIN) / MIN, inRight: ((to + 1) * MIN - b) / MIN,
        continuesLeft: s.a < ws, continuesRight: s.b > we });
    });
    weeks.push({ days: days, bars: bars });
  }
  return weeks;
}

var api = { localDate: localDate, monthGrid: monthGrid };
global.CalGrid = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
