# Agent guide: Matt's trips

A static page on GitHub Pages plus a Cloudflare Worker for sync. No build step. Read `README.md`
first for the user workflow.

## Rules

- **Never put trip data in git.** The repository is public. Trip recaps contain crew names,
  employee IDs, hotels, and phone numbers. Test data is synthetic. `.local/` is gitignored for
  one-off scripts and exports.
- Work test first. For each change to `parse.js` or `trips.js`, first write a contract test that
  fails, then change the code. The test name gives the precondition and the effect.
- `index.html` (rendering and DOM wiring) has no automated test. For a change there, run the page
  locally (`README.md`, "Run locally") and do the changed task by hand. Do this before each push.
- If the page loads a new file, add it to `FILES` in `sw.js`, or the page does not open offline.

## Run the tests

```bash
node --test "test/*.test.js"
```

If you change `worker/`, also run its tests. They start `wrangler dev` (local, no account):

```bash
cd worker && npm ci && npm test
```

## Recap facts that the tests use

- A leg row has a flight number in its first cell. A duty row (`DTDUTY`, org and destination the
  same, for example `MEM-MEM`) also has something in its first cell, but it is not a leg. Any first
  cell that ends in `DUTY` is skipped.
- Ground rows (`GT`) and hotel rows (`HOTEL`) have an empty first cell. A layover is the rows between
  two flights with two or more `GT` rows: the first `GT` is the ride to the hotel, the last is the ride
  back, and a `HOTEL` row gives the name and number. A `GT` before the first flight (a ramp pickup), after
  the last flight, or alone is not a layover. Do not pair `GT` rows across a flight.
- The last lines of a recap, `Trip show date & time:` and `End date & time:` (Zulu), give the report and
  the release. A trip that starts with a duty row reports before its first flight, so use them. Without
  them the report is 60 minutes before the first flight and the release 30 minutes after the last.

## Sync

- The document is `{ trips: { <id>: { updatedAt, trip?, removed?, crew?, fo?, event?, purged? } } }`.
  `crew` is the edited crew list; `fo` is an older FO-only edit that `trips.js` still reads.
  `event` is `{ type, from, to, fromTime?, toTime?, flight?, dep?, arr? }` (id `event-...`): `RA`,
  `RB`, or `R24` reserve days, `TRN` training (with times, Central), `VAC` vacation, or `JMP` jumpseat
  (one day, `from` = `to`; `fromTime` is local to `dep`). It has no `trip`, so trip lists and
  totals skip it, and the Worker and old cached pages keep it without a change. Each trip
  merges on its own: the newest `updatedAt` wins (`mergeDocs` in `trips.js`, `merge` in
  `worker/src/index.js`; keep them the same). A purge keeps `{ updatedAt, purged: true }`.
- Only a real change may set `updatedAt`. If a device sets it without an edit, its old copy
  overwrites newer edits from other devices.
- The sync key is SHA-256 of `matttrips-sync:` plus the password, as base64url (`syncKeyFor` in
  `index.html`). If you change this, each device must type the password again, and the old
  document stays under the old key.
- The Worker takes 1 MB per request and 60 requests a minute for each client address.
- Phones can run an old copy of the page from the service worker cache. If you change the API,
  keep the old requests working.

## Deploy

- Page: push to `main`. GitHub Pages serves the repository root in about a minute.
- Worker: `npm test`, then `npm run deploy` in `worker/`. It needs `wrangler login` to the owner's
  Cloudflare account. The URL is `https://matttrips-sync.matttrips-sync.workers.dev`, and `SYNC_URL` in `index.html`
  uses it.
