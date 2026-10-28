// Same key as syncKeyFor in index.html: SHA-256 of 'matttrips-sync:' + password, as base64url.
async function syncKeyFor(password) {
  var hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('matttrips-sync:' + password));
  return btoa(String.fromCharCode.apply(null, new Uint8Array(hash))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
var msg = document.getElementById('msg');
chrome.storage.local.get('syncKey').then(function (s) { if (s.syncKey) msg.textContent = 'A password is saved.'; });
document.getElementById('f').addEventListener('submit', async function (ev) {
  ev.preventDefault();
  var pw = document.getElementById('pw');
  await chrome.storage.local.set({ syncKey: await syncKeyFor(pw.value), lastRun: 0 });
  pw.value = '';
  msg.textContent = 'Saved. Open the crew portal and the import runs by itself.';
});
