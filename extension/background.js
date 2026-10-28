// Copies a schedule from content.js into the sync Worker of Matt's trips. The Worker is called from here,
// not from the crew portal page, because the portal page may not call another site.
importScripts('importer.js');

var DEFAULT_URL = 'https://matttrips-sync.matttrips-sync.workers.dev/s/';

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (msg.type !== 'import') return false;
  chrome.storage.local.get(['syncKey', 'syncUrl']).then(function (s) {
    if (!s.syncKey) throw new Error("Open this extension's options and enter your Matt's trips password.");
    return Importer.syncImport({ fetch: fetch, url: s.syncUrl || DEFAULT_URL, key: s.syncKey, payload: msg.payload, now: Date.now() });
  }).then(function (r) { reply({ summary: r.summary }); }, function (e) { reply({ error: e.message }); });
  return true; // the reply comes later
});
