/* Bootstrap: find colonist's game log, rebuild history, watch for new rows,
 * listen to the game connection (relayed by inject.js), read game settings,
 * work out who you are, and keep the overlay (and the stand-alone window)
 * in sync.
 *
 * The log is a virtual scroller that only keeps the rows near the viewport in
 * the DOM, so on load (or after a refresh mid-game) we scroll through it once
 * to capture the whole history. Rows are keyed by their `data-index` and fed
 * to the parser strictly in order. */
(function (root) {
  'use strict';
  const CT = root.ColonistTracker;
  if (!CT || CT.__booted) return;
  CT.__booted = true;
  const { SELECTORS, TIMING, SETTING_TEXT_PATTERNS, GAME_STORAGE_PREFIX, DEFAULT_SETTINGS } = CT;

  const game = new CT.Game();
  const board = new CT.Board();
  let panel = null;
  let container = null;
  let observer = null;
  let bodyObserver = null;
  let processed = -1;         // highest contiguous data-index handed to the game
  const pending = new Map();  // data-index -> tokenized row waiting for its turn
  let sweeping = false;
  let gapSince = null;
  let mutationTimer = null;
  let panelTimer = null;
  let renderTimer = null;
  let scanTimer = null;
  let broadcastTimer = null;
  let lastPanelCounts = null;
  let currentHash = location.hash;
  const scanQueue = [];
  const connection = { injectReady: false, opens: 0, closes: 0, frames: 0, errors: 0 };
  let windowConnected = false;
  let sendFailures = 0;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const log = (...args) => console.debug('[ColonistTracker]', ...args);
  const hasRuntime = () => typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);

  /** Re-render the overlay and, when the stand-alone window is open, mirror
   *  the state to it. All state changes funnel through here. */
  function refresh() {
    if (game.players.length) inferColorMap();
    panel.render();
    scheduleBroadcast();
  }

  function requestRefresh() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; refresh(); }, 40);
  }

  // ---- per-game persistence (settings survive a refresh) -----------------

  function gameKey() { return GAME_STORAGE_PREFIX + (location.hash || 'lobby').replace(/^#/, ''); }

  function saveGameFacts() {
    try {
      const facts = { settings: game.settings, colorMap: game.colorMap, discardLimits: game.playerDiscardLimits, you: game.youSource === 'manual' ? game.you : null };
      localStorage.setItem(gameKey(), JSON.stringify(facts));
    } catch (_) { /* ignore */ }
  }

  function restoreGameFacts() {
    try {
      const facts = JSON.parse(localStorage.getItem(gameKey()) || 'null');
      if (!facts) return;
      if (facts.settings && facts.settings.sources) for (const key of Object.keys(DEFAULT_SETTINGS)) game.setSetting(key, facts.settings[key], facts.settings.sources[key]);
      if (facts.colorMap) game.setColorMap(facts.colorMap);
      if (facts.discardLimits) for (const [name, limit] of Object.entries(facts.discardLimits)) game.setPlayerDiscardLimit(name, limit);
      if (facts.you) game.setYou(facts.you, 'manual');
    } catch (_) { /* ignore */ }
  }

  // ---- locating the log --------------------------------------------------

  /** Game-log rows carry icon images (dice, cards, buildings) or <hr>
   *  separators; chat rows are plain text, so they score zero here. */
  function looksLikeLogRow(el) {
    return !!(el.querySelector('hr') || el.querySelector('img[alt]'));
  }

  function findLogContainer() {
    const scores = new Map();
    document.querySelectorAll(SELECTORS.logRow).forEach(row => {
      const parent = row.parentElement;
      if (!parent || !looksLikeLogRow(row)) return;
      scores.set(parent, (scores.get(parent) || 0) + 1);
    });
    let best = null;
    let bestScore = 0;
    for (const [el, score] of scores) if (score > bestScore) { best = el; bestScore = score; }
    return best;
  }

  function scrollableAncestor(el) {
    let node = el;
    while (node && node !== document.body) {
      const cs = getComputedStyle(node);
      if (/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 5) return node;
      node = node.parentElement;
    }
    return null;
  }

  // ---- capturing rows ----------------------------------------------------

  function captureRow(el) {
    const attr = el.getAttribute('data-index');
    if (attr === null) return;
    const idx = parseInt(attr, 10);
    if (Number.isNaN(idx) || idx <= processed || pending.has(idx)) return;
    pending.set(idx, CT.tokenizeRow(el)); // tokenize now: the scroller recycles nodes
  }

  function captureVisible() {
    if (!container) return;
    for (const child of container.children) {
      if (child.hasAttribute('data-index')) captureRow(child);
      else child.querySelectorAll(SELECTORS.logRow).forEach(captureRow);
    }
  }

  function processRow(row) {
    const ev = CT.parseRow(row);
    if (ev) game.applyEvent(ev);
    else if (Number.isFinite(row.index) && row.index > game.lastIndex) game.lastIndex = row.index;
  }

  function drain() {
    let count = 0;
    while (pending.has(processed + 1)) {
      processed++;
      processRow(pending.get(processed));
      pending.delete(processed);
      count++;
    }
    if (pending.size) { if (gapSince === null) gapSince = Date.now(); } else gapSince = null;
    if (count && game.pendingYouSteals && game.you) game.replay();
    return count;
  }

  function flush() {
    const keys = Array.from(pending.keys()).sort((a, b) => a - b);
    for (const k of keys) {
      processRow(pending.get(k));
      pending.delete(k);
      processed = Math.max(processed, k);
    }
    gapSince = null;
    if (game.pendingYouSteals && game.you) game.replay();
  }

  async function sweepHistory() {
    if (!container || sweeping) return;
    sweeping = true;
    panel.setSyncing(true);
    try {
      const scroller = scrollableAncestor(container);
      if (!scroller) { captureVisible(); drain(); flush(); return; }
      for (let sweep = 1; sweep <= TIMING.maxSweeps; sweep++) {
        scroller.scrollTop = 0;
        await sleep(TIMING.sweepSettleMs);
        let guard = 0;
        while (guard++ < 3000) {
          captureVisible();
          const maxScroll = scroller.scrollHeight - scroller.clientHeight;
          if (scroller.scrollTop >= maxScroll - 2) break;
          const step = Math.max(40, Math.floor(scroller.clientHeight * 0.5));
          scroller.scrollTop = Math.min(scroller.scrollTop + step, maxScroll);
          await sleep(TIMING.sweepStepMs);
        }
        captureVisible();
        drain();
        if (!pending.size) break;
        log(`sweep ${sweep}/${TIMING.maxSweeps} left ${pending.size} rows behind a gap`);
      }
      if (pending.size) { log('giving up on gap; processing what we have'); flush(); }
      scroller.scrollTop = scroller.scrollHeight;
    } finally {
      sweeping = false;
      panel.setSyncing(false);
      detectYou();
      schedulePanelCheck();
      refresh();
    }
  }

  // ---- side channels: player panel, "you", colours, settings text --------

  function panelBlocks() {
    const rootEl = document.querySelector(SELECTORS.playerPanel);
    return rootEl ? Array.from(rootEl.querySelectorAll(SELECTORS.playerBlock)) : [];
  }

  /** Longest known player name that appears in a piece of text. */
  function playerInText(text) {
    if (!text) return null;
    const names = game.players.map(p => p.name).sort((a, b) => b.length - a.length);
    return names.find(n => text.includes(n)) || null;
  }

  function readPanelCounts() {
    const out = {};
    for (const block of panelBlocks()) {
      const name = playerInText(block.textContent || '');
      if (!name) continue;
      const el = block.querySelector(SELECTORS.playerCardCount);
      if (!el) continue;
      const n = parseInt((el.textContent || '').trim(), 10);
      if (!Number.isNaN(n)) out[name] = n;
    }
    return Object.keys(out).length ? out : null;
  }

  function schedulePanelCheck() {
    clearTimeout(panelTimer);
    panelTimer = setTimeout(() => {
      if (sweeping || pending.size) return;
      const counts = readPanelCounts();
      if (!counts) return;
      const key = JSON.stringify(counts);
      if (key !== lastPanelCounts) { lastPanelCounts = key; schedulePanelCheck(); return; }
      const result = game.applyPanelCounts(counts);
      if (result !== 'noop') refresh();
      if (result === 'conflict') log('panel hand sizes disagree with the log', counts);
    }, TIMING.panelCheckDelayMs);
  }

  function matchPlayer(name) {
    if (!name) return null;
    const players = game.players.map(p => p.name);
    const lower = name.toLowerCase();
    return players.find(p => p === name)
      || players.find(p => p.toLowerCase() === lower)
      || players.find(p => p.toLowerCase().startsWith(lower) || lower.startsWith(p.toLowerCase()))
      || null;
  }

  /** Colonist renders your own player card as a direct child of the player
   *  panel; opponents sit inside a scroller. */
  function myPanelBlock() {
    const rootEl = document.querySelector(SELECTORS.playerPanel);
    if (!rootEl) return null;
    for (const child of rootEl.children) if (child.matches(SELECTORS.playerBlock)) return child;
    return null;
  }

  /** Who are we? Weaker sources never override stronger ones (see YOU_PRIORITY):
   *  chosen by hand > our session on the game connection > our own player card
   *  > the page header username > inferred from a "You stole" line. */
  function detectYou() {
    if (game.youSource === 'manual' || !game.players.length) return;
    if (board.myColor) {
      const name = matchPlayer(board.nameOf(board.myColor) || game.colorMap[board.myColor]);
      if (name) game.setYou(name, 'session');
    }
    const mine = myPanelBlock();
    if (mine) {
      const name = playerInText(mine.textContent || '');
      if (name) game.setYou(name, 'panel');
    }
    const header = document.querySelector(SELECTORS.headerUsername);
    const fromHeader = matchPlayer(header ? (header.textContent || '').trim() : '');
    if (fromHeader) game.setYou(fromHeader, 'header');
  }

  /** Colour enum -> player name, from the connection when we have it, else
   *  from the player cards' data-player-color, else from the log's name colours. */
  function inferColorMap() {
    const map = {};
    for (const block of panelBlocks()) {
      const color = CT.Board.colorFromAttr(block.getAttribute('data-player-color'));
      const name = playerInText(block.textContent || '');
      if (color && name && !map[color]) map[color] = name;
    }
    for (const p of game.players) {
      if (Object.values(map).includes(p.name)) continue;
      const color = CT.Board.colorFromCss(p.color);
      if (color && !map[color]) map[color] = p.name;
    }
    for (const [color, name] of board.colorNames) map[color] = name;
    if (Object.keys(map).length) game.setColorMap(map);
  }

  /** Look for "Card Discard Limit: 7" / "First player to reach 10 wins" etc. */
  function scanTextForSettings(text) {
    if (!text || text.length > 200000) return false;
    let changed = false;
    for (const [key, patterns] of Object.entries(SETTING_TEXT_PATTERNS)) {
      for (const re of patterns) {
        const m = text.match(re);
        if (m && game.setSetting(key, parseInt(m[1], 10), 'ui')) { changed = true; break; }
      }
    }
    if (changed) { saveGameFacts(); requestRefresh(); }
    return changed;
  }

  function flushScanQueue() {
    scanTimer = null;
    const seen = new Set();
    while (scanQueue.length) {
      const node = scanQueue.pop();
      if (!node || seen.has(node) || !node.isConnected) continue;
      seen.add(node);
      const text = node.textContent;
      if (text && /discard|win|point/i.test(text)) scanTextForSettings(text);
    }
  }

  function watchSettingsText() {
    if (bodyObserver || !document.body) return;
    bodyObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) if (node.nodeType === 1 && node !== panel.host) scanQueue.push(node);
        if (m.type === 'characterData' && m.target.parentElement) scanQueue.push(m.target.parentElement);
      }
      if (scanQueue.length > 400) scanQueue.splice(0, scanQueue.length - 400);
      if (!scanTimer) scanTimer = setTimeout(flushScanQueue, 400);
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    scanTextForSettings(document.body.textContent);
  }

  // ---- game connection (relayed from the MAIN world by inject.js) --------

  function applyBoardFacts() {
    let changed = false;
    if (board.colorNames.size) { inferColorMap(); changed = true; }
    for (const [color, st] of board.playerStates) {
      const name = board.nameOf(color) || game.colorMap[color];
      if (name && st.discardLimit) { game.setPlayerDiscardLimit(name, st.discardLimit); changed = true; }
    }
    if (board.myColor) {
      const me = board.nameOf(board.myColor) || game.colorMap[board.myColor] || game.you;
      if (me && game.setKnownDevCards(me, board.knownDevCards(board.myColor))) changed = true;
    }
    if (board.settings.vpToWin && game.setSetting('vpToWin', board.settings.vpToWin, 'game')) changed = true;
    if (board.settings.discardLimit && game.setSetting('discardLimit', board.settings.discardLimit, 'game')) changed = true;
    if (!board.settings.discardLimit && board.playerStates.size) {
      // Joined mid-game: no room-level value, so use the limit every player shares.
      const limits = Array.from(board.playerStates.values()).map(s => s.discardLimit).filter(Boolean);
      if (limits.length && limits.every(l => l === limits[0]) && game.setSetting('discardLimit', limits[0], 'game')) changed = true;
    }
    if (changed) saveGameFacts();
    return changed;
  }

  function onWindowMessage(event) {
    const msg = event.data;
    if ((event.source && event.source !== window) || !msg || msg.source !== 'colonist-tracker') return;
    switch (msg.kind) {
      case 'ready': connection.injectReady = true; return;
      case 'open': connection.opens++; return;
      case 'close': connection.closes++; return;
      case 'error': connection.errors++; board.lastError = msg.error; return;
      case 'json': case 'msgpack': break;
      default: return;
    }
    connection.frames++;
    if (!board.applyMessage(msg.data, msg.id)) return;
    applyBoardFacts();
    detectYou();
    requestRefresh();
  }

  function adviseForYou() {
    const color = board.myColor || (game.you ? game.colorEnumFor(game.you) : null);
    return CT.advise(board, color);
  }

  // ---- stand-alone tracker window (via the service worker) ---------------

  function diagnostics() {
    const s = game.snapshot();
    let version = 'unknown';
    try { version = chrome.runtime.getManifest().version; } catch (_) { /* not in an extension context */ }
    const header = document.querySelector(SELECTORS.headerUsername);
    const mine = myPanelBlock();
    return {
      version, time: new Date().toISOString(), page: location.pathname + location.hash,
      browser: (navigator.userAgent.match(/(Chrome|Edg)\/[\d.]+/g) || []).join(' '),
      you: s.you, youSource: s.youSource,
      players: s.players.map(p => ({ name: p.name, cssColor: p.color, colorEnum: p.colorEnum, discardLimit: p.discardLimit })),
      settings: s.settings, colorMap: game.colorMap,
      log: {
        containerFound: !!container, rowsRendered: container ? container.querySelectorAll(SELECTORS.logRow).length : 0,
        lastIndex: s.lastIndex, events: s.eventCount, unknown: s.unknownCount, contradictions: s.contradictions,
        ignoredConstraints: s.ignoredConstraints, pendingYouSteals: s.pendingYouSteals, desync: s.desync,
        recent: s.recent.slice(-25).map(e => `#${e.index} [${e.type}] ${e.text}${e.note ? ' <' + e.note + '>' : ''}`),
      },
      dom: {
        headerUsername: header ? (header.textContent || '').trim() : null,
        myPanelBlock: mine ? { color: mine.getAttribute('data-player-color'), text: (mine.textContent || '').trim().slice(0, 60) } : null,
        panelBlocks: panelBlocks().map(b => ({ color: b.getAttribute('data-player-color'), text: (b.textContent || '').trim().slice(0, 60) })),
      },
      connection: Object.assign({}, connection, board.summary()),
    };
  }

  function buildState() {
    const snapshot = game.snapshot();
    snapshot.recent = snapshot.recent.slice(-80);
    return { snapshot, board: board.summary(), advice: adviseForYou(), diagnostics: diagnostics() };
  }

  function broadcast() {
    if (!hasRuntime() || !windowConnected) return;
    let sent;
    try { sent = chrome.runtime.sendMessage({ type: 'trackerState', state: buildState() }); } catch (_) { sendFailures++; return; }
    if (sent && sent.then) sent.then(() => { sendFailures = 0; }).catch(() => { if (++sendFailures >= 3) windowConnected = false; });
  }

  function scheduleBroadcast() {
    if (!windowConnected || broadcastTimer) return;
    broadcastTimer = setTimeout(() => { broadcastTimer = null; broadcast(); }, 250);
  }

  function openWindow() {
    if (!hasRuntime()) return;
    windowConnected = true;
    try { chrome.runtime.sendMessage({ type: 'openTrackerWindow' }).catch(() => {}); } catch (_) { /* ignore */ }
  }

  /** Commands from the stand-alone window (or the worker asking for a resend). */
  function onRuntimeMessage(msg, sender, sendResponse) {
    if (!msg || msg.type !== 'trackerCommand') return false;
    windowConnected = true;
    sendFailures = 0;
    const args = msg.args || {};
    switch (msg.command) {
      case 'rescan': rescan(); break;
      case 'setYou': game.setYou(args.name, 'manual'); saveGameFacts(); break;
      case 'setSetting': if (game.setSetting(args.key, args.value, 'manual')) saveGameFacts(); break;
      case 'resetSettings': game.clearManualSettings(); applyBoardFacts(); saveGameFacts(); break;
      default: break;
    }
    refresh();
    broadcast();
    if (typeof sendResponse === 'function') sendResponse({ ok: true });
    return false;
  }

  // ---- live updates ------------------------------------------------------

  function onMutations() {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      captureVisible();
      const n = drain();
      if (pending.size && gapSince !== null && Date.now() - gapSince > TIMING.gapPatienceMs && !sweeping) {
        log('gap in the log; re-sweeping history');
        sweepHistory();
      }
      if (n) { detectYou(); refresh(); schedulePanelCheck(); }
    }, TIMING.mutationDebounceMs);
  }

  function attach(el) {
    container = el;
    observer = new MutationObserver(onMutations);
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-index'] });
    log('attached to game log');
    sweepHistory();
  }

  function detach() {
    if (observer) observer.disconnect();
    observer = null;
    container = null;
  }

  function resetSettings() {
    game.settings.vpToWin = DEFAULT_SETTINGS.vpToWin;
    game.settings.discardLimit = DEFAULT_SETTINGS.discardLimit;
    game.settings.sources = { vpToWin: 'default', discardLimit: 'default' };
    game.colorMap = {};
    game.playerDiscardLimits = {};
  }

  /** Rebuild from scratch. Keeps board/connection facts unless the game changed. */
  function resetAll(newGame) {
    detach();
    pending.clear();
    processed = -1;
    gapSince = null;
    lastPanelCounts = null;
    game.you = null;
    game.youSource = null;
    game.reset();
    if (newGame) { board.reset(); resetSettings(); }
    restoreGameFacts();
    applyBoardFacts();
    refresh();
  }

  function rescan() {
    resetAll(false);
    const el = findLogContainer();
    if (el) attach(el);
  }

  function tick() {
    if (location.hash !== currentHash) {
      currentHash = location.hash;
      log('game changed');
      resetAll(true);
      const el = findLogContainer();
      if (el) attach(el);
      return;
    }
    if (container && !document.contains(container)) { log('log container removed'); detach(); }
    const best = findLogContainer();
    if (!best) return;
    if (!container) { attach(best); return; }
    if (best !== container && !sweeping) { log('log container changed; rebuilding'); rescan(); }
  }

  function boot() {
    panel = new CT.Panel({
      mode: 'overlay',
      data: { snapshot: () => game.snapshot(), board: () => board.summary(), advice: adviseForYou, diagnostics },
      hooks: {
        onRescan: rescan,
        onSelectYou: (name) => { game.setYou(name, 'manual'); saveGameFacts(); scheduleBroadcast(); },
        onSetting: (key, value) => { if (game.setSetting(key, value, 'manual')) saveGameFacts(); scheduleBroadcast(); },
        onResetSettings: () => { game.clearManualSettings(); applyBoardFacts(); saveGameFacts(); scheduleBroadcast(); },
        onOpenWindow: hasRuntime() ? openWindow : null,
      },
    });
    window.addEventListener('message', onWindowMessage);
    if (hasRuntime() && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(onRuntimeMessage);
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) panel.toggleHidden();
    });
    restoreGameFacts();
    watchSettingsText();
    const intervalId = setInterval(tick, TIMING.findContainerMs);
    tick();
    CT.debug = {
      game, board, panel, rescan, pending, diagnostics, connection,
      get processed() { return processed; },
      get windowConnected() { return windowConnected; },
      shutdown() {
        clearInterval(intervalId);
        for (const t of [mutationTimer, panelTimer, renderTimer, scanTimer, broadcastTimer]) clearTimeout(t);
        detach();
        if (bodyObserver) bodyObserver.disconnect();
        bodyObserver = null;
        window.removeEventListener('message', onWindowMessage);
      },
    };
  }

  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);
})(globalThis);
