/* Service worker: opens the stand-alone tracker window (a real browser window
 * you can drag to another monitor and maximise) and nudges content scripts to
 * resend their state when that window appears. Needs no permissions. */
'use strict';

const WINDOW_URL = chrome.runtime.getURL('window.html');
let trackerWindowId = null;

async function focusOrOpenWindow() {
  if (trackerWindowId !== null) {
    try {
      await chrome.windows.update(trackerWindowId, { focused: true });
      return trackerWindowId;
    } catch (_) { trackerWindowId = null; }
  }
  // The worker may have restarted and forgotten the id: ask any open tracker window.
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'trackerWindowPing' });
    if (reply && Number.isInteger(reply.windowId)) {
      trackerWindowId = reply.windowId;
      await chrome.windows.update(trackerWindowId, { focused: true });
      return trackerWindowId;
    }
  } catch (_) { /* nobody answered */ }
  const win = await chrome.windows.create({ url: WINDOW_URL, type: 'popup', width: 980, height: 760 });
  trackerWindowId = win.id;
  return trackerWindowId;
}

/** Ask every tab to resend its tracker state (only colonist tabs answer). */
async function requestResend() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (_) { return; }
  await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'trackerCommand', command: 'resend' }).catch(() => {})));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  if (msg.type === 'openTrackerWindow') {
    focusOrOpenWindow().then(() => requestResend()).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'trackerWindowReady') {
    if (sender.tab && Number.isInteger(sender.tab.windowId)) trackerWindowId = sender.tab.windowId;
    requestResend().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

chrome.windows.onRemoved.addListener((id) => { if (id === trackerWindowId) trackerWindowId = null; });

chrome.action.onClicked.addListener(() => { focusOrOpenWindow().then(() => requestResend()).catch(() => {}); });
