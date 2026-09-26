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

## Sync

- The document is `{ trips: { <id>: { updatedAt, trip?, removed?, fo?, purged? } } }`. Each trip
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
  Cloudflare account. `SYNC_URL` in `index.html` holds the workers.dev URL.
