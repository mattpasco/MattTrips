# Matt's trips

A single page that shows FedEx trips (legs, layovers, hotels, ground transport, crew) from pasted
trip recaps. Times show local to each airport and in Zulu.

Site: https://mattpasco.github.io/MattTrips/

## Files

- `index.html`: the page (markup, styles, rendering, and the sync client).
- `parse.js`: the trip recap parser. `parseTripPaste(text)` returns a trip.
- `trips.js`: the sync document and the rules that change it (add, remove, restore, purge, FO edit, merge).
- `sw.js`: offline launch. `worker/`: the sync server (a Cloudflare Worker).
- `test/`: contract tests for `parse.js` and `trips.js`. `worker/test/`: HTTP tests for the Worker.

## Use

1. Open the site and type your trips password (10 or more characters). Use the same password on
   each device. Your password manager can save it.
2. `+ Paste a trip recap`: on the trip recap page, select all, copy, and paste. Check the
   preview, then tap `Add this trip`.
3. Each change syncs to your other devices within a few seconds, and again each time you open
   the page. With no network, the button shows `Lock ⚠`, and the page tries again later.
4. `Lock` forgets the password and the trips on this device.

The trips are not in this repository (it is public). They are in the sync Worker, under a key
made from the password. Anyone who knows the password can see and change the trips.

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
