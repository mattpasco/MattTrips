/**
 * The month grid of the calendar view.
 * Plain browser script (also runnable under Node via `require`). No dependencies.
 *
 * monthGrid(year, month, trips, tzOf) returns the weeks of the month, from Sunday to Saturday:
 *   [ { days: [{ date: 'YYYY-MM-DD', inMonth }] x7,
 *       bars: [{ id, from, to, lane, continuesLeft, continuesRight }] } ]
 * A bar is the part of one item in one week. from and to are columns 0 (Sunday) to 6. An item is a
 * trip { id, base, show, end }: it covers the local dates of its base (tzOf(base)) from report to
 * release. Or it is a block of days { id, from, to } with dates 'YYYY-MM-DD' (reserve days).
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

var DAY = 86400000;
function dayNum(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY; }
function dayDate(n) { return new Date(n * DAY).toISOString().slice(0, 10); }

function monthGrid(year, month, trips, tzOf) {
  var first = Date.UTC(year, month, 1) / DAY, last = Date.UTC(year, month + 1, 0) / DAY;
  var start = first - new Date(first * DAY).getUTCDay(), end = last + 6 - new Date(last * DAY).getUTCDay();
  var spans = trips.map(function (t) {
    if (t.from) return { id: t.id, a: dayNum(t.from), b: dayNum(t.to) };
    var tz = tzOf(t.base);
    return { id: t.id, a: dayNum(localDate(t.show, tz)), b: dayNum(localDate(t.end, tz)) };
  }).sort(function (x, y) { return x.a - y.a || (x.id < y.id ? -1 : 1); });

  var weeks = [];
  for (var w = start; w <= end; w += 7) {
    var days = [];
    for (var i = 0; i < 7; i++) days.push({ date: dayDate(w + i), inMonth: new Date((w + i) * DAY).getUTCMonth() === month });
    var laneEnd = [], bars = [];
    spans.filter(function (s) { return s.a <= w + 6 && s.b >= w; }).forEach(function (s) {
      var from = Math.max(s.a, w) - w, to = Math.min(s.b, w + 6) - w, lane = 0;
      while (laneEnd[lane] !== undefined && laneEnd[lane] >= from) lane++;
      laneEnd[lane] = to;
      bars.push({ id: s.id, from: from, to: to, lane: lane, continuesLeft: s.a < w, continuesRight: s.b > w + 6 });
    });
    weeks.push({ days: days, bars: bars });
  }
  return weeks;
}

var api = { localDate: localDate, monthGrid: monthGrid };
global.CalGrid = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
