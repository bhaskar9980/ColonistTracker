/* Runs in the page's MAIN world at document_start (see manifest "world").
 *
 * colonist.io talks to its server over a WebSocket: a short JSON handshake,
 * then MessagePack frames shaped { id, data }. The board (tiles, numbers,
 * ports, buildings), every player's discard limit and the room's points-to-win
 * only exist in that stream, because the board itself is drawn on a WebGL
 * canvas. We wrap the WebSocket constructor so every socket the page opens
 * also reports its incoming frames to the extension's isolated world via
 * window.postMessage. Nothing is sent to the server and nothing is altered. */
(function () {
  'use strict';
  const codec = globalThis.__colonistTrackerMsgpack;
  try { delete globalThis.__colonistTrackerMsgpack; } catch (_) { /* ignore */ }
  if (!codec || typeof WebSocket === 'undefined' || WebSocket.__colonistTrackerPatched) return;

  const SOURCE = 'colonist-tracker';
  const NativeWebSocket = WebSocket;

  function post(payload) {
    try { window.postMessage(Object.assign({ source: SOURCE }, payload), window.location.origin); } catch (_) { /* ignore */ }
  }

  function handleFrame(data) {
    if (typeof data === 'string') {
      try { post({ kind: 'json', data: JSON.parse(data) }); } catch (_) { /* not JSON, ignore */ }
      return;
    }
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      try {
        const msg = codec.decode(data);
        if (msg && typeof msg === 'object') post({ kind: 'msgpack', id: msg.id, data: msg.data });
      } catch (e) {
        post({ kind: 'error', error: String(e && e.message || e) });
      }
      return;
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      data.arrayBuffer().then(handleFrame).catch(() => { /* ignore */ });
    }
  }

  function PatchedWebSocket(url, protocols) {
    const ws = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    try {
      ws.addEventListener('message', (event) => handleFrame(event.data));
      ws.addEventListener('open', () => post({ kind: 'open', url: String(url) }));
      ws.addEventListener('close', () => post({ kind: 'close', url: String(url) }));
    } catch (_) { /* ignore */ }
    return ws;
  }
  PatchedWebSocket.prototype = NativeWebSocket.prototype;
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) PatchedWebSocket[key] = NativeWebSocket[key];
  PatchedWebSocket.__colonistTrackerPatched = true;

  window.WebSocket = PatchedWebSocket;
  post({ kind: 'ready' });
})();
