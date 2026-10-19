'use strict';
// Boots the real content-script entry point (main.js) against a jsdom page
// that mimics colonist's log and player panel, then appends live rows and
// relays game-connection messages the way inject.js does.
const test = require('node:test');
const assert = require('node:assert/strict');
const { CT } = require('./helpers');
const { gameState, roomState } = require('./fixtures');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* optional */ }

const NAME = (n, c) => `<span style="font-weight: 600; word-break: break-all; color: ${c}">${n}</span>`;
const ICON = (alt) => `<img src="https://cdn.colonist.io/x.svg" alt="${alt}" class="lobby-chat-text-icon">`;
const ROW = (index, inner) => `<div data-index="${index}" class="scrollItemContainer-x"><div class="feedMessage-x">${inner}</div></div>`;
// Like colonist: your own card is a direct child of the panel, opponents sit in a scroller.
const COLORS = { Ahab: 1, Beth: 2 };
const BLOCK = (n, c) => `<div data-player-color="${COLORS[n]}"><span>${n}</span><div data-resource-card>${c}</div><div data-development-card>0</div></div>`;
const PANEL = (counts, me = 'Ahab') => `<div data-player-information-container><div class="others">${Object.entries(counts).filter(([n]) => n !== me).map(([n, c]) => BLOCK(n, c)).join('')}</div>${BLOCK(me, counts[me])}</div>`;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test('main.js: log history, live rows, you-detection, settings and board from the connection', { skip: !JSDOM && 'jsdom not installed (npm install)' }, async () => {
  const history = [
    ROW(0, '<span>Happy settling! Learn how to play in the <a href="#open-rulebook">rulebook</a>.</span>'),
    ROW(1, '<span><hr></span>'),
    ROW(2, `<span>${NAME('Ahab', '#e27174')} placed a ${ICON('settlement')}</span>`),
    ROW(3, `<span>${NAME('Beth', '#223697')} placed a ${ICON('settlement')}</span>`),
    ROW(4, `<span>${NAME('Beth', '#223697')} received starting resources ${ICON('ore')}${ICON('grain')}</span>`),
    ROW(5, `<span>${NAME('Ahab', '#e27174')} received starting resources ${ICON('lumber')}</span>`),
  ].join('');
  const dom = new JSDOM(`<!doctype html><body>
    <p name="web-header-username">SomebodyElse</p>
    <div id="game"><div id="scroller" style="overflow-y: auto; height: 200px"><div id="log">${history}</div></div></div>
    ${PANEL({ Ahab: 1, Beth: 2 })}
    <div id="info"></div>
  </body>`, { url: 'https://colonist.io/#game1', pretendToBeVisual: true });

  const saved = {};
  const keys = ['window', 'document', 'localStorage', 'getComputedStyle', 'HTMLElement', 'Node', 'MutationObserver', 'location'];
  for (const k of keys) { saved[k] = globalThis[k]; try { globalThis[k] = dom.window[k]; } catch (_) { /* read-only in some runtimes */ } }
  const sent = [];
  const listeners = [];
  const savedChrome = globalThis.chrome;
  globalThis.chrome = { runtime: {
    id: 'test', getManifest: () => ({ version: '1.2.0' }),
    sendMessage: (m) => { sent.push(m); return Promise.resolve(); },
    onMessage: { addListener: (fn) => listeners.push(fn) },
  } };

  try {
    delete CT.Panel;
    delete CT.__booted;
    for (const f of ['../src/panel.js', '../src/main.js']) delete require.cache[require.resolve(f)];
    require('../src/panel.js');
    require('../src/main.js');
    const { game, board, panel } = CT.debug;
    const body = () => panel.refs.body.innerHTML;

    await sleep(600); // let the (non-virtualised) history sweep finish
    let s = game.snapshot();
    assert.deepEqual(s.players.map(p => p.name), ['Ahab', 'Beth']);
    assert.equal(s.players[1].hand.res[4].min, 1);
    assert.equal(s.you, 'Ahab', 'our own player card is the direct child of the panel');
    assert.equal(s.youSource, 'panel');
    assert.equal(s.players[0].colorEnum, 1, 'colour from data-player-color');
    assert.equal(s.players[1].colorEnum, 2);
    assert.equal(s.lastIndex, 5);
    assert.match(body(), /Beth/);
    assert.equal(s.settings.vpToWin, 10);

    // live rows: Beth robs Ahab (known, because we are the victim)
    const log = dom.window.document.getElementById('log');
    log.insertAdjacentHTML('beforeend', ROW(6, `<span>${NAME('Beth', '#223697')} rolled ${ICON('dice_3')}${ICON('dice_4')}</span>`));
    log.insertAdjacentHTML('beforeend', ROW(7, `<span>${NAME('Beth', '#223697')} moved Robber ${ICON('Robber')} to ${ICON('lumber tile')}</span>`));
    log.insertAdjacentHTML('beforeend', ROW(8, `<span>${NAME('Beth', '#223697')} stole ${ICON('Lumber')} from you</span>`));
    await sleep(300);
    s = game.snapshot();
    assert.equal(s.rolls, 1);
    assert.equal(s.players[0].hand.res[0].max, 0);
    assert.equal(s.players[1].hand.res[0].min, 1);
    assert.equal(s.players[1].handSize.min, 3);
    assert.equal(s.currentTurn, 'Beth');
    assert.equal(s.contradictions, 0);

    // a re-rendered (recycled) old row must not be double counted
    log.insertAdjacentHTML('beforeend', ROW(4, `<span>${NAME('Beth', '#223697')} received starting resources ${ICON('ore')}${ICON('grain')}</span>`));
    await sleep(200);
    assert.equal(game.snapshot().players[1].handSize.min, 3);

    // settings text appearing on screen (game-info tab / tooltip)
    dom.window.document.getElementById('info').innerHTML = '<div><span>Card Discard Limit: 9</span><span>Total points this player has. First player to reach 12 wins.</span></div>';
    await sleep(600);
    s = game.snapshot();
    assert.equal(s.settings.discardLimit, 9);
    assert.equal(s.settings.sources.discardLimit, 'ui');
    assert.equal(s.settings.vpToWin, 12);
    assert.match(panel.refs.facts.textContent, /12 to win/);
    assert.match(panel.refs.facts.textContent, /discard over 9/);

    // game connection frames relayed by inject.js: handshake, room state, full game state
    const post = (payload) => dom.window.postMessage(Object.assign({ source: 'colonist-tracker' }, payload), '*');
    post({ kind: 'json', data: { type: 'Connected', userSessionId: 's-ahab' } });
    post({ kind: 'msgpack', id: 5, data: roomState() });
    post({ kind: 'msgpack', id: 91, data: { gameState: gameState({ playerStates: { 1: Object.assign(gameState().playerStates[1], { cardDiscardLimit: 9 }), 2: Object.assign(gameState().playerStates[2], { cardDiscardLimit: 9 }) } }) } });
    // our own development cards arrive face up; opponents' face down
    post({ kind: 'msgpack', id: 91, data: { gameState: { mechanicDevelopmentCardsState: { bankDevelopmentCards: new Array(24).fill(10), players: { 1: { developmentCards: [12], developmentCardsUsed: [] }, 2: { developmentCards: [10], developmentCardsUsed: [] } } } } } });
    await sleep(250);
    s = game.snapshot();
    assert.deepEqual(s.players[0].knownDev, { knight: 0, vp: 1, monopoly: 0, roadBuilding: 0, yearOfPlenty: 0, total: 1 });
    assert.equal(s.players[0].maxVP, s.players[0].visibleVP + 1);
    assert.equal(s.players[1].knownDev, null);
    assert.equal(board.ready, true);
    assert.equal(s.settings.vpToWin, 13, 'connection outranks screen text');
    assert.equal(s.settings.sources.vpToWin, 'game');
    assert.equal(s.settings.discardLimit, 9);
    assert.equal(s.you, 'Ahab');
    assert.equal(s.youSource, 'session');
    assert.equal(s.players[0].colorEnum, 1);
    assert.equal(s.players[1].colorEnum, 2);
    assert.equal(s.players[1].discardLimit, 9);
    panel.prefs.tab = 'spots';
    panel.render();
    assert.match(body(), /Best first settlement/);
    assert.match(body(), /Ore 8, Sheep 5, Wood 3/);

    // the stand-alone window asks for state and gets a broadcast back
    assert.equal(listeners.length, 1);
    listeners[0]({ type: 'trackerCommand', command: 'resend' }, { tab: { id: 1 } }, () => {});
    const stateMsg = sent.filter(m => m.type === 'trackerState').pop();
    assert.ok(stateMsg, 'state broadcast to the window');
    assert.equal(stateMsg.state.snapshot.you, 'Ahab');
    assert.equal(stateMsg.state.board.ready, true);
    assert.equal(stateMsg.state.advice.phase, 'opening');
    assert.equal(stateMsg.state.diagnostics.dom.myPanelBlock.color, '1');
    assert.equal(stateMsg.state.diagnostics.version, '1.2.0');
    panel.shadow.querySelector('[data-act="window"]').click();
    assert.equal(sent.filter(m => m.type === 'openTrackerWindow').length, 1);
    listeners[0]({ type: 'trackerCommand', command: 'setSetting', args: { key: 'discardLimit', value: 11 } }, { tab: { id: 1 } }, () => {});
    assert.equal(game.snapshot().settings.discardLimit, 11);
    assert.equal(sent.filter(m => m.type === 'trackerState').pop().state.snapshot.settings.discardLimit, 11);
    game.clearManualSettings();

    // a manual override wins over everything and survives a rescan
    game.setSetting('vpToWin', 15, 'manual');
    CT.debug.rescan();
    await sleep(400);
    s = game.snapshot();
    assert.equal(s.settings.vpToWin, 15);
    assert.equal(s.settings.sources.vpToWin, 'manual');
    assert.equal(s.players.length, 2, 'log re-read after rescan');
    assert.equal(board.ready, true, 'board kept across a rescan');

    // the player panel agrees with the log once it has been stable for a moment
    dom.window.document.querySelector('[data-player-information-container]').outerHTML = PANEL({ Ahab: 0, Beth: 3 });
    await sleep(CT.TIMING.panelCheckDelayMs * 2 + 400);
    assert.equal(game.snapshot().desync, false);

    // a stale / wrong panel is reported as a desync instead of corrupting the hands
    dom.window.document.querySelector('[data-player-information-container]').outerHTML = PANEL({ Ahab: 5, Beth: 3 });
    log.insertAdjacentHTML('beforeend', ROW(9, `<span>${NAME('Beth', '#223697')} built a ${ICON('road')}</span>`)); // Beth has no brick: forced
    await sleep(CT.TIMING.panelCheckDelayMs * 2 + 400);
    s = game.snapshot();
    assert.equal(s.desync, true);
    assert.equal(s.contradictions, 1);
    assert.match(body(), /disagree with the log/);
  } finally {
    if (CT.debug) CT.debug.shutdown();
    if (savedChrome === undefined) delete globalThis.chrome; else globalThis.chrome = savedChrome;
    for (const k of keys) { try { if (saved[k] === undefined) delete globalThis[k]; else globalThis[k] = saved[k]; } catch (_) { /* ignore */ } }
  }
});
