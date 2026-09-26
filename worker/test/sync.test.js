/**
 * HTTP contract tests for the sync Worker. They start `wrangler dev` (local runtime, no
 * account, no network), then call the API. Run: npm test (in worker/).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const APP = 'https://mattpasco.github.io';
// Local Durable Object storage. Each test uses new random keys, so old state does not matter.
// It is cleared at the start, not the end: on Windows workerd lets go of the files late.
const state = fileURLToPath(new URL('../.wrangler/test-state', import.meta.url));
let dev;

const newKey = () => randomBytes(16).toString('base64url');
const get = key => fetch(`${BASE}/s/${key}`, { headers: { Origin: APP } });
const put = (key, trips) => fetch(`${BASE}/s/${key}`, {
  method: 'PUT', headers: { Origin: APP, 'Content-Type': 'application/json' }, body: JSON.stringify({ trips }),
});

before(async () => {
  rmSync(state, { recursive: true, force: true });
  // shell: true runs the .cmd shim on Windows. It does not quote arguments, so quote the path (it has a space).
  dev = spawn('npx', ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(PORT), '--persist-to', JSON.stringify(state)],
    { stdio: 'ignore', shell: true });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/`)).status === 404) return; } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('wrangler dev did not start');
});

after(() => {
  // With shell: true, dev.kill() stops only the shell. Stop the whole process tree.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(dev.pid), '/t', '/f'], { stdio: 'ignore' });
  else dev.kill();
});

test('a new key: GET returns an empty document', async () => {
  assert.deepEqual(await (await get(newKey())).json(), { trips: {} });
});

test('a PUT: a later GET returns the same trips', async () => {
  const key = newKey();
  const trips = { 207: { updatedAt: 1, trip: { id: '207', items: [] } } };
  assert.deepEqual((await (await put(key, trips)).json()).trips, trips);
  assert.deepEqual((await (await get(key)).json()).trips, trips);
});

test('two devices PUT: each trip keeps its newest record', async () => {
  const key = newKey();
  await put(key, { a: { updatedAt: 5, removed: true }, b: { updatedAt: 1, trip: 'phone-b' } });
  const doc = await (await put(key, { a: { updatedAt: 3, trip: 'pc-a-older' }, b: { updatedAt: 9, trip: 'pc-b' } })).json();
  assert.deepEqual(doc.trips, { a: { updatedAt: 5, removed: true }, b: { updatedAt: 9, trip: 'pc-b' } });
});

test('a purge tombstone: an older copy of the trip does not bring it back', async () => {
  const key = newKey();
  await put(key, { a: { updatedAt: 9, purged: true } });
  const doc = await (await put(key, { a: { updatedAt: 2, trip: 'stale' } })).json();
  assert.deepEqual(doc.trips.a, { updatedAt: 9, purged: true });
});

test('two keys: each has its own document', async () => {
  const a = newKey(), b = newKey();
  await put(a, { x: { updatedAt: 1, trip: 'a' } });
  assert.deepEqual(await (await get(b)).json(), { trips: {} });
});

test('bad requests: short key, bad JSON, wrong shape, and a large body are refused', async () => {
  assert.equal((await get('short')).status, 404);
  assert.equal((await fetch(`${BASE}/s/${newKey()}`, { method: 'PUT', body: '{nope' })).status, 400);
  assert.equal((await fetch(`${BASE}/s/${newKey()}`, { method: 'PUT', body: '{"months":{}}' })).status, 400);
  const big = { x: { updatedAt: 1, trip: 'x'.repeat(1100 * 1024) } };
  assert.equal((await put(newKey(), big)).status, 413);
});

test('CORS: the app origin and localhost get the headers, another origin does not', async () => {
  const ok = await fetch(`${BASE}/s/${newKey()}`, { method: 'OPTIONS', headers: { Origin: APP } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), APP);
  const local = await fetch(`${BASE}/s/${newKey()}`, { headers: { Origin: 'http://localhost:8765' } });
  assert.equal(local.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8765');
  const other = await fetch(`${BASE}/s/${newKey()}`, { headers: { Origin: 'https://example.com' } });
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
});

// Keep this test last: it uses up the request limit of this client for one minute.
test('more than 60 requests in a minute from one client: the Worker answers 429', async () => {
  const codes = [];
  for (let i = 0; i < 70; i++) codes.push((await get(newKey())).status);
  assert.ok(codes.includes(429), `no 429 in ${codes.length} requests`);
  assert.equal(codes[0], 200);
});
