/**
 * MattTrips sync: one document per sync key, with the newest record of each trip.
 *   GET /s/<key>  returns { trips: { <id>: { updatedAt, ... } } }
 *   PUT /s/<key>  merges a document of the same shape and returns the result
 * There is no login. The key (22 to 64 base64url characters, from the sync password) is the secret.
 */
import { DurableObject } from 'cloudflare:workers';

const KEY = /^\/s\/([A-Za-z0-9_-]{22,64})$/;
const ORIGIN = /^(https:\/\/mattpasco\.github\.io|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;
const MAX_BODY = 1024 * 1024;

/** The sync document of one key. */
export class SyncDoc extends DurableObject {
  async read() {
    return (await this.ctx.storage.get('doc')) || { trips: {} };
  }

  /** Keep, for each trip, the record with the newest updatedAt. Last write wins. */
  async merge(incoming) {
    const doc = await this.read();
    for (const [id, rec] of Object.entries(incoming.trips)) {
      if (typeof rec?.updatedAt !== 'number') continue;
      if (!doc.trips[id] || rec.updatedAt > doc.trips[id].updatedAt) doc.trips[id] = rec;
    }
    await this.ctx.storage.put('doc', doc);
    return doc;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = ORIGIN.test(origin) ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    } : {};
    const reply = (body, status = 200) => Response.json(body, { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    // Slow down password guessing. Cloudflare advises against IP keys when many users share an
    // address; MattTrips has one user, so an IP key is correct here.
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (!(await env.LIMITER.limit({ key: ip })).success) return reply({ error: 'too many requests' }, 429);

    const key = new URL(request.url).pathname.match(KEY);
    if (!key) return reply({ error: 'not found' }, 404);
    const doc = env.SYNC.getByName(key[1]);
    if (request.method === 'GET') return reply(await doc.read());
    if (request.method !== 'PUT') return reply({ error: 'method not allowed' }, 405);

    if (Number(request.headers.get('Content-Length')) > MAX_BODY) return reply({ error: 'too large' }, 413);
    const text = await request.text();
    if (text.length > MAX_BODY) return reply({ error: 'too large' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return reply({ error: 'bad JSON' }, 400); }
    if (!body || typeof body.trips !== 'object' || body.trips === null) return reply({ error: 'bad document' }, 400);
    return reply(await doc.merge(body));
  },
};
