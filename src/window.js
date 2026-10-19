/* Stand-alone tracker window. It renders the same Panel as the in-page
 * overlay, but from state broadcast by the colonist tab's content script, and
 * sends any control (rescan, settings, who-am-I) back to that tab. */
(function (root) {
  'use strict';
  const CT = root.ColonistTracker;
  const state = { snapshot: null, board: null, advice: null, diagnostics: null, tabId: null, receivedAt: 0 };
  let panel = null;

  const emptySnapshot = () => ({
    players: [], you: null, youSource: null, settings: { vpToWin: CT.DEFAULT_SETTINGS.vpToWin, discardLimit: CT.DEFAULT_SETTINGS.discardLimit, sources: { vpToWin: 'default', discardLimit: 'default' } },
    bank: [19, 19, 19, 19, 19], dice: new Array(13).fill(0), diceExpected: new Array(13).fill(0), rolls: 0,
    deck: { bought: 0, deck: 25, unplayedInHands: 0, played: {}, remaining: { knight: 14, vp: 5, monopoly: 2, roadBuilding: 2, yearOfPlenty: 2 }, nextOdds: { knight: 0, vp: 0, monopoly: 0, roadBuilding: 0, yearOfPlenty: 0 } },
    awards: {}, winner: null, currentTurn: null, worlds: 1, approximate: false, contradictions: 0, ignoredConstraints: 0,
    unknownCount: 0, pendingYouSteals: 0, desync: false, lastIndex: -1, recent: [], blocked: {}, eventCount: 0,
  });

  function command(name, args) {
    if (state.tabId === null || typeof chrome === 'undefined' || !chrome.tabs) return;
    chrome.tabs.sendMessage(state.tabId, { type: 'trackerCommand', command: name, args: args || {} }).catch(() => {});
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = new CT.Panel({
      mode: 'window',
      data: {
        snapshot: () => state.snapshot || emptySnapshot(),
        board: () => state.board,
        advice: () => state.advice,
        diagnostics: () => state.diagnostics,
      },
      hooks: {
        onRescan: () => command('rescan'),
        onSelectYou: (name) => command('setYou', { name }),
        onSetting: (key, value) => command('setSetting', { key, value }),
        onResetSettings: () => command('resetSettings'),
      },
    });
    return panel;
  }

  function onState(msg, sender) {
    state.snapshot = msg.state.snapshot;
    state.board = msg.state.board;
    state.advice = msg.state.advice;
    state.diagnostics = msg.state.diagnostics;
    state.tabId = sender && sender.tab ? sender.tab.id : state.tabId;
    state.receivedAt = Date.now();
    const waiting = document.getElementById('waiting');
    if (waiting) waiting.hidden = true;
    ensurePanel().render();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return false;
      if (msg.type === 'trackerState') { onState(msg, sender); return false; }
      if (msg.type === 'trackerWindowPing') {
        chrome.windows.getCurrent().then(w => sendResponse({ windowId: w.id })).catch(() => sendResponse({}));
        return true;
      }
      return false;
    });
    const announce = () => chrome.runtime.sendMessage({ type: 'trackerWindowReady' }).catch(() => {});
    announce();
    // Keep asking until a tab answers (the worker may have been asleep).
    const retry = setInterval(() => { if (state.receivedAt) clearInterval(retry); else announce(); }, 4000);
    // Ask for a refresh when the window regains focus so it never shows stale data.
    window.addEventListener('focus', () => command('resend'));
  }

  root.__colonistTrackerWindow = { state, ensurePanel, onState, command };
})(globalThis);
