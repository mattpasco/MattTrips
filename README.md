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
