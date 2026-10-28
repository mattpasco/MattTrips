# Matt's trips

A single page that shows FedEx trips (legs, layovers, hotels, ground transport, crew) from pasted
trip recaps. Times show local to each airport and in Zulu.

Site: https://mattpasco.github.io/MattTrips/

## Files

- `index.html`: the page (markup, styles, rendering, and the sync client).
- `parse.js`: the trip recap parser. `parseTripPaste(text)` returns a trip.
- `trips.js`: the sync document and the rules that change it (add, remove, restore, purge, crew edits, calendar events (reserve days, training, vacation), merge).
- `calendar.js`: the month grid of the calendar view (which days, and which part of a day, each trip or event covers).
- `sw.js`: offline launch. `worker/`: the sync server (a Cloudflare Worker).
- `test/`: contract tests for `parse.js`, `trips.js`, and `calendar.js`. `worker/test/`: HTTP tests for the Worker.

## Use

1. Open the site and type your trips password (10 or more characters). Use the same password on
   each device. Your password manager can save it.
2. `Download schedule` opens the FedEx crew calendar in a new tab. Log in there and open a trip recap.
   Select all (Ctrl/Cmd+A) and copy. Back in this app, tap `+ Paste a trip recap`: the app reads
   the clipboard and shows the trip for review (your browser may ask you to allow the paste). If the
   clipboard has no recap, or the browser does not let the page read it, a box opens to paste into.
   Check the preview, then tap `Add this trip`.
3. The page opens on the calendar: the trips on a month grid (weeks start on Sunday). A trip is a bar across
   the days from its report to its release, by Memphis time. A trip that crosses a month end shows
   in both months. The grid also has one more week before the month and one after it (both
   dimmed), so you see a bid month that starts in the last week of the previous month, and a trip that
   carries over into the next month. Use the arrows to change the month, and `Today` to come back. Tap a bar to open
   that trip in the list. `Trip list` shows the list, and `Calendar view` goes back.
4. In the calendar, tap a day for four choices. Each opens its own page, and `Calendar` or `Cancel`
   goes back. The day (or the first and last day) starts as the day that you tapped.
   - `Add reserve days`: choose `RA`, `RB`, or `R24`, and the first and last day. Green bar.
   - `Add training`: the first day and start time, and the last day and end time (Central time).
     Orange bar, from the start time to the end time.
   - `Add vacation`: the first and last day. Blue bar. A vacation runs from 0130 Central on the first
     day to 0129 Central after the last day, so the bar starts 1.5 hours into the first day and ends
     1.5 hours into the day after the last day.
   - `Add jumpseat`: the flight number, the departure airport, the arrival airport, and the departure
     time local to the departure airport (type it as 24-hour digits, like `0830`). `Local show time` below it fills in by itself: one hour
     before the departure (on the day before, for a departure before 0100). Pink bar on that day,
     with the flight number.

   Tap a bar to see it and remove it.
5. Each change syncs to your other devices within a few seconds, and again each time you open
   the page. With no network, the button shows `Lock ⚠`, and the page tries again later.
6. `Lock` forgets the password and the trips on this device.

## Offline and iPhone

The page and your last saved trips stay on the device, so the page opens in airplane mode. This
works after one launch with a network (open the page once after each update).

On an iPhone, Chrome and Safari both use Apple's web engine. It can delete the saved trips of a
site that you have not opened for 7 days. A Home Screen app is kept. So:

1. Open the site in Chrome (iOS 16.4 or later). Tap Share, then `Add to Home Screen`, then `Add`.
   (In Safari: Share, `Add to Home Screen`, and keep `Open as Web App` on.) The icon must open
   full screen, with no address bar. If it opens in a browser tab, remove the icon and add it again.
2. Always open Matt's trips from the Home Screen icon. It has its own storage, so open it once
   with a network and type the password there.

## Run locally

The page uses the local Worker when it is served from `localhost`, so a local run never
changes the real trips.

```bash
cd worker && npm ci && npx wrangler dev --ip 127.0.0.1 --port 8787
```

```bash
npx http-server@14.1.1 -p 8765 -c-1
```

Open `http://localhost:8765/`. The local Worker starts empty. Paste a recap to add a trip.

## Test

```bash
node --test "test/*.test.js"
```

```bash
cd worker && npm test
```
