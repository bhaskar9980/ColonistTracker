'use strict';
// The stand-alone tracker window: renders broadcast state and sends commands
// back to the colonist tab through a faked chrome API.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CT, name, text, img, row, play } = require('./helpers');
const { mapState, roomState } = require('./fixtures');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* optional */ }

test('window page renders state and relays controls to the game tab', { skip: !JSDOM && 'jsdom not installed (npm install)' }, async () => {
  const dom = new JSDOM('<!doctype html><body><div id="waiting">waiting</div></body>', { url: 'https://tracker.example/window.html', pretendToBeVisual: true });
  const saved = {};
  const keys = ['window', 'document', 'localStorage', 'getComputedStyle', 'HTMLElement', 'Node', 'MutationObserver', 'chrome'];
  for (const k of keys) saved[k] = globalThis[k];
  for (const k of keys.slice(0, -1)) globalThis[k] = dom.window[k];
  const runtimeSent = [];
  const tabSent = [];
  const listeners = [];
  globalThis.chrome = {
    runtime: {
      id: 'abc',
      onMessage: { addListener: (fn) => listeners.push(fn) },
      sendMessage: (m) => { runtimeSent.push(m); return Promise.resolve({ ok: true }); },
    },
    tabs: { sendMessage: (id, m) => { tabSent.push([id, m]); return Promise.resolve(); } },
    windows: { getCurrent: () => Promise.resolve({ id: 42 }) },
  };
  try {
    delete CT.Panel;
    for (const f of ['../src/panel.js', '../src/window.js']) delete require.cache[require.resolve(f)];
    require('../src/panel.js');
    require('../src/window.js');
    const win = globalThis.__colonistTrackerWindow;
    assert.equal(runtimeSent[0].type, 'trackerWindowReady');
    assert.equal(listeners.length, 1);

    // build a realistic state the way main.js would
    const game = new CT.Game();
    play(game, [
      row([name('Ahab', '#e27174'), text('placed a'), img('settlement')]),
      row([name('Beth', '#223697'), text('placed a'), img('settlement')]),
      row([name('Beth', '#223697'), text('received starting resources'), img('ore'), img('grain')]),
    ]);
    game.setYou('Ahab', 'session');
    game.setSetting('vpToWin', 13, 'game');
    game.setSetting('discardLimit', 9, 'game');
    const board = new CT.Board();
    board.applyMessage(roomState());
    board.applyMessage({ mapState: mapState() });
    const state = { snapshot: game.snapshot(), board: board.summary(), advice: CT.advise(board, 1), diagnostics: { hello: 'world' } };

    listeners[0]({ type: 'trackerState', state }, { tab: { id: 7 } }, () => {});
    const panel = win.ensurePanel();
    assert.ok(panel.panel.classList.contains('window'));
    assert.equal(dom.window.document.getElementById('waiting').hidden, true);
    const body = () => panel.refs.body.innerHTML;
    assert.match(body(), /Ahab/);
    assert.match(body(), /class="who">you/);
    assert.match(panel.refs.facts.textContent, /13 to win, discard over 9/);
    // overlay-only buttons are hidden in the window
    assert.equal(panel.shadow.querySelector('[data-act="hide"]').hidden, true);
    assert.equal(panel.shadow.querySelector('[data-act="collapse"]').hidden, true);
    assert.equal(panel.shadow.querySelector('[data-act="window"]').hidden, true);

    panel.shadow.querySelector('[data-tab="spots"]').click();
    assert.match(body(), /Best first settlement/);
    assert.match(body(), /Ore 8, Sheep 5, Wood 3/);

    // controls go back to tab 7
    panel.shadow.querySelector('[data-act="rescan"]').click();
    assert.deepEqual(tabSent.pop(), [7, { type: 'trackerCommand', command: 'rescan', args: {} }]);
    panel.shadow.querySelector('[data-act="drawer"]').click();
    const vp = panel.shadow.querySelector('[data-field="vpToWin"]');
    vp.value = '15';
    vp.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.deepEqual(tabSent.pop(), [7, { type: 'trackerCommand', command: 'setSetting', args: { key: 'vpToWin', value: 15 } }]);

    // diagnostics come from the broadcast state
    panel.shadow.querySelector('[data-act="diag"]').click();
    assert.match(body(), /"hello": "world"/);

    // the worker's ping is answered with our window id
    let reply = null;
    const async = listeners[0]({ type: 'trackerWindowPing' }, {}, (r) => { reply = r; });
    assert.equal(async, true);
    await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(reply, { windowId: 42 });
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k]; }
  }
});
