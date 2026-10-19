/* The tracker UI. Used two ways:
 *   overlay  floating panel inside the colonist tab (shadow root, draggable)
 *   window   the stand-alone tracker window, fed by broadcast state
 * The header is built once and only its text changes; the body is re-rendered
 * from the data source but never while you are using a control inside it.
 * Buttons use event delegation on the panel element, so a log update arriving
 * mid-click cannot swallow the click. */
(function (root) {
  'use strict';
  const CT = root.ColonistTracker || (root.ColonistTracker = {});
  const { RESOURCES, RESOURCE_LABELS, DEV_LABELS, STORAGE_KEY } = CT;

  const RES_COLORS = ['#5aa86a', '#d0694a', '#b8dc7a', '#ecc04a', '#a3afc4'];
  const RES_SHORT = ['Wood', 'Brick', 'Sheep', 'Wheat', 'Ore'];
  const TABS = [['race', 'Race'], ['spots', 'Spots'], ['robber', 'Robber']];
  const HEX_PATTERN = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='48' viewBox='0 0 28 48'><path d='M14 1 27 8.5v15L14 31 1 23.5v-15zM14 33 27 40.5V48M14 33 1 40.5V48' fill='none' stroke='rgba(255,255,255,0.07)' stroke-width='1'/></svg>\")";

  const CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .panel {
      position: fixed; z-index: 2147483000; width: 440px; min-width: 340px; max-width: 96vw; max-height: 92vh;
      display: flex; flex-direction: column; overflow: hidden; resize: both;
      font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
      font-size: 12.5px; line-height: 1.4; color: #eef1f6; font-variant-numeric: tabular-nums;
      background: rgba(28, 34, 48, 0.94); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
      box-shadow: 0 14px 40px rgba(0,0,0,0.5); backdrop-filter: blur(8px);
    }
    .panel[hidden], .bubble[hidden] { display: none !important; }
    .panel.collapsed { resize: none; height: auto !important; }
    .panel.collapsed .body { display: none; }
    .panel.window { position: static; width: auto; min-width: 0; max-width: none; height: 100vh; max-height: none; resize: none;
      border: 0; border-radius: 0; box-shadow: none; backdrop-filter: none; background: #1c2230; font-size: 14px; }
    .head { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 12px; cursor: grab; user-select: none;
      background: rgba(255,255,255,0.04) ${HEX_PATTERN}; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .head:active { cursor: grabbing; }
    .panel.window .head { cursor: default; padding: 12px 18px; }
    .brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .hexmark { width: 16px; height: 18px; background: #ecc04a; clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); flex: none; }
    .title { font-size: 15px; font-weight: 700; letter-spacing: 0.2px; white-space: nowrap; }
    .panel.window .title { font-size: 18px; }
    .facts { color: #a3adc2; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
    .panel.window .facts { font-size: 14px; }
    .status { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: #2f7d4a; white-space: nowrap; }
    .status.warn { background: #9a6a1e; } .status.bad { background: #a33f3b; } .status.idle { background: #4a5468; }
    .actions { display: flex; gap: 4px; flex: none; }
    .actions button { width: 26px; height: 26px; padding: 0; font-size: 15px; line-height: 1; border-radius: 7px; }
    .actions button[hidden] { display: none; }
    button { font: inherit; color: inherit; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 7px; padding: 3px 9px; cursor: pointer; }
    button:hover { background: rgba(255,255,255,0.15); }
    button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid #7fb2ff; outline-offset: 1px; }
    button.on { background: #ecc04a; border-color: #ecc04a; color: #1c2230; font-weight: 600; }
    select, input[type=number] { font: inherit; color: inherit; background: #273042; border: 1px solid rgba(255,255,255,0.14); border-radius: 7px; padding: 3px 6px; }
    input[type=number] { width: 64px; }
    textarea { width: 100%; min-height: 160px; font: 11.5px/1.35 Consolas, "Cascadia Mono", monospace; color: #eef1f6; background: #11151e; border: 1px solid rgba(255,255,255,0.14); border-radius: 7px; padding: 6px; resize: vertical; }
    .body { overflow: auto; padding: 10px 12px 12px; }
    .panel.window .body { padding: 14px 18px 18px; flex: 1; }
    .notice { margin-bottom: 8px; padding: 7px 10px; border-radius: 8px; background: rgba(154,106,30,0.22); border: 1px solid rgba(242,193,78,0.35); }
    .notice.bad { background: rgba(163,63,59,0.22); border-color: rgba(239,123,116,0.4); }
    .notice.quiet { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); }
    .notice p { margin: 2px 0; }
    .drawer { margin-bottom: 10px; padding: 10px 12px; border-radius: 10px; background: #273042; border: 1px solid rgba(255,255,255,0.1); }
    .drawer h3 { margin: 0 0 8px; font-size: 13px; }
    .field { display: grid; grid-template-columns: 130px 1fr; gap: 6px 10px; align-items: center; margin: 5px 0; }
    .field .hint { grid-column: 2; margin-top: -2px; }
    .drawer .row { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 4px 5px; text-align: center; white-space: nowrap; vertical-align: middle; }
    .panel.window th, .panel.window td { padding: 6px 8px; }
    th { font-weight: 600; color: #a3adc2; font-size: 11.5px; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .panel.window th { font-size: 13px; }
    td.name, th.name { text-align: left; }
    th.res span { display: inline-block; min-width: 40px; padding: 2px 4px; color: #1c2230; font-weight: 700; font-size: 11px;
      clip-path: polygon(12% 0, 88% 0, 100% 50%, 88% 100%, 12% 100%, 0 50%); }
    .panel.window th.res span { min-width: 56px; font-size: 12.5px; }
    tbody tr { border-bottom: 1px solid rgba(255,255,255,0.05); }
    tr.you td { background: rgba(127,178,255,0.1); }
    tr.turn .pname::before { content: "▸ "; color: #ecc04a; }
    .pname { font-weight: 600; }
    .who { color: #a3adc2; font-size: 11px; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; border: 1px solid rgba(255,255,255,0.4); }
    .vpbar { height: 3px; width: 100px; background: rgba(255,255,255,0.1); border-radius: 2px; margin-top: 3px; overflow: hidden; }
    .panel.window .vpbar { width: 160px; height: 4px; }
    .vpbar i { display: block; height: 100%; background: #7fb2ff; }
    .vpbar i.hot { background: #ef7b74; }
    td.res { font-size: 15px; font-weight: 600; min-width: 46px; }
    .panel.window td.res { font-size: 20px; min-width: 64px; }
    td.res.zero { color: #56607a; font-weight: 400; }
    td.res .more { font-size: 11px; font-weight: 600; color: #f2c14e; margin-left: 1px; vertical-align: super; }
    .panel.window td.res .more { font-size: 13px; }
    td.res .avg { font-size: 12px; color: #d9dfea; font-weight: 500; }
    td.total { font-size: 14px; font-weight: 600; }
    .panel.window td.total { font-size: 18px; }
    tr.over td.total { color: #ef7b74; }
    tr.maybe-over td.total { color: #f2c14e; }
    td.vp b { font-size: 14px; }
    .exact { color: #9fd3a8; }
    tfoot td { border-top: 1px solid rgba(255,255,255,0.1); color: #a3adc2; padding-top: 6px; }
    tfoot td.low { color: #ef7b74; font-weight: 600; }
    .legend { margin: 8px 0 2px; color: #a3adc2; font-size: 11.5px; display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
    .panel.window .legend { font-size: 13px; }
    .legend b { color: #eef1f6; } .legend .more { color: #f2c14e; font-weight: 600; }
    .legend button { padding: 0 6px; font-size: 11px; }
    .tabs { display: flex; gap: 2px; margin: 10px 0 8px; border-bottom: 1px solid rgba(255,255,255,0.1); align-items: center; }
    .tabs button { background: none; border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 5px 10px; color: #a3adc2; }
    .tabs button:hover { color: #eef1f6; background: none; }
    .tabs button.on { color: #eef1f6; border-bottom-color: #ecc04a; background: none; font-weight: 600; }
    .tabs .auto { margin-left: auto; font-size: 11px; color: #f2c14e; }
    .section h4 { margin: 8px 0 4px; font-size: 12.5px; font-weight: 600; color: #eef1f6; display: flex; align-items: baseline; gap: 6px; }
    .panel.window .section h4 { font-size: 15px; }
    .section h4 small { color: #a3adc2; font-weight: 400; }
    .section h4 .right { margin-left: auto; }
    .muted { color: #a3adc2; }
    .hint { font-size: 11.5px; color: #a3adc2; margin: 4px 0 0; }
    .panel.window .hint { font-size: 13px; }
    .tag { display: inline-block; font-size: 10.5px; padding: 0 6px; border-radius: 8px; background: rgba(255,255,255,0.12); margin-left: 4px; vertical-align: 1px; }
    .tag.lr { background: #3b5bdb; } .tag.la { background: #a33f3b; } .tag.lead { background: #9a6a1e; }
    .log { max-height: 220px; overflow: auto; font-size: 11.5px; }
    .panel.window .log { max-height: 40vh; font-size: 13px; }
    .log div { padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .log .idx { color: #56607a; margin-right: 6px; }
    .log .note { color: #f2c14e; margin-left: 6px; } .log .note.bad { color: #ef7b74; }
    td.best { box-shadow: inset 0 0 0 2px #ecc04a; border-radius: 6px; }
    .spot { display: grid; grid-template-columns: 26px 1fr auto; gap: 4px 10px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); align-items: start; }
    .spot .rank { font-size: 17px; font-weight: 700; color: #ecc04a; line-height: 1.1; }
    .spot .where { font-size: 13.5px; font-weight: 600; }
    .panel.window .spot .where { font-size: 16px; }
    .spot .why { grid-column: 2 / 4; color: #a3adc2; font-size: 11.5px; }
    .panel.window .spot .why { font-size: 13px; }
    .spot .score { color: #a3adc2; font-size: 11.5px; text-align: right; white-space: nowrap; }
    .spot .score b { color: #eef1f6; font-size: 14px; }
    .diag { margin-top: 8px; }
    .diag .row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
    .bubble { position: fixed; z-index: 2147483000; right: 14px; bottom: 14px; display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 18px; cursor: pointer;
      font: 600 12px/1 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; color: #1c2230; background: #ecc04a; box-shadow: 0 6px 18px rgba(0,0,0,0.4); }
    .bubble .hexmark { width: 12px; height: 14px; background: #1c2230; }
    @media (prefers-reduced-motion: no-preference) { .vpbar i { transition: width 300ms ease; } }
  `;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x) => Math.round((x || 0) * 100) + '%';
  const fix1 = (x) => (Math.round((x || 0) * 10) / 10).toFixed(1);
  const DEFAULT_PREFS = { x: null, y: null, w: null, h: null, collapsed: false, hidden: false, tab: 'race', mode: 'range', need: '', legend: true, drawer: false, showLog: false };
  const KNOWN_DEV_LABELS = { knight: 'knight', vp: 'victory point', monopoly: 'monopoly', roadBuilding: 'road building', yearOfPlenty: 'year of plenty' };

  function loadPrefs(key) {
    try {
      const prefs = Object.assign({}, DEFAULT_PREFS, JSON.parse(localStorage.getItem(key) || '{}'));
      if (!TABS.some(([id]) => id === prefs.tab)) prefs.tab = 'race';
      return prefs;
    } catch (_) { return Object.assign({}, DEFAULT_PREFS); }
  }

  /** "1 knight, 1 victory point" for a hand whose faces we know. */
  function describeKnownDev(known) {
    const parts = Object.keys(KNOWN_DEV_LABELS).filter(k => known[k]).map(k => `${known[k]} ${KNOWN_DEV_LABELS[k]}${known[k] > 1 && k !== 'monopoly' ? 's' : ''}`);
    return parts.length ? parts.join(', ') : 'no development cards';
  }

  class Panel {
    /** context: {
     *   mode: 'overlay' | 'window',
     *   data: { snapshot(), board(), advice(), diagnostics() },
     *   hooks: { onRescan, onSelectYou, onSetting, onResetSettings, onOpenWindow } } */
    constructor(context) {
      this.mode = context.mode || 'overlay';
      this.data = context.data;
      this.hooks = context.hooks || {};
      this.storageKey = STORAGE_KEY + (this.mode === 'window' ? '.window' : '');
      this.prefs = loadPrefs(this.storageKey);
      if (this.mode === 'window') { this.prefs.hidden = false; this.prefs.collapsed = false; }
      this.syncing = false;
      this.dirty = false;
      this.diagText = null;
      this.diagStatus = '';
      this.autoTab = null; // {from} while the Robber tab was opened for you automatically

      this.host = document.createElement('div');
      this.host.id = 'colonist-tracker-host';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      this.shadow.appendChild(style);

      this.panel = document.createElement('div');
      this.panel.className = 'panel' + (this.mode === 'window' ? ' window' : '');
      const overlayOnly = this.mode === 'window' ? 'hidden' : '';
      this.panel.innerHTML = `
        <div class="head">
          <div class="brand"><span class="hexmark"></span><span class="title">Colonist Tracker</span></div>
          <span class="facts" data-ref="facts"></span>
          <span class="status idle" data-ref="status">waiting</span>
          <div class="actions">
            <button data-act="drawer" title="Settings: who you are, points to win, discard limit, event log" aria-label="Settings">⚙</button>
            <button data-act="rescan" title="Re-read the whole game log" aria-label="Re-read log">↻</button>
            <button data-act="window" title="Open in its own window (drag it to any screen)" aria-label="Open in a window" ${overlayOnly || (this.hooks.onOpenWindow ? '' : 'hidden')}>⧉</button>
            <button data-act="collapse" data-ref="collapse" title="Collapse" aria-label="Collapse" ${overlayOnly}>–</button>
            <button data-act="hide" title="Hide (Alt+Shift+C brings it back)" aria-label="Hide" ${overlayOnly}>×</button>
          </div>
        </div>
        <div class="body" data-ref="body"></div>`;
      this.shadow.appendChild(this.panel);
      this.refs = {};
      this.panel.querySelectorAll('[data-ref]').forEach(el => { this.refs[el.dataset.ref] = el; });

      this.bubble = document.createElement('div');
      this.bubble.className = 'bubble';
      this.bubble.innerHTML = '<span class="hexmark"></span>Tracker';
      this.bubble.title = 'Show Colonist Tracker (Alt+Shift+C)';
      this.bubble.hidden = true;
      this.bubble.addEventListener('click', () => this.setHidden(false));
      this.shadow.appendChild(this.bubble);

      (document.body || document.documentElement).appendChild(this.host);
      if (this.mode === 'overlay') {
        this._applyGeometry();
        this._wireDrag();
        this._wireResize();
      }
      this._wireDelegation();
      this.setHidden(this.prefs.hidden);
      this.render();
    }

    savePrefs() {
      try {
        const out = Object.assign({}, this.prefs);
        if (this.autoTab) out.tab = this.autoTab.from; // never remember an automatic switch
        localStorage.setItem(this.storageKey, JSON.stringify(out));
      } catch (_) { /* ignore */ }
    }

    _applyGeometry() {
      const p = this.prefs;
      const x = p.x === null ? Math.max(8, window.innerWidth - 460) : p.x;
      const y = p.y === null ? 56 : p.y;
      this.panel.style.left = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - 80)) + 'px';
      this.panel.style.top = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - 40)) + 'px';
      if (p.w) this.panel.style.width = p.w + 'px';
      this._applyCollapsed();
    }

    _applyCollapsed() {
      const collapsed = !!this.prefs.collapsed;
      this.panel.classList.toggle('collapsed', collapsed);
      this.panel.style.height = collapsed || !this.prefs.h ? '' : this.prefs.h + 'px';
      if (this.refs.collapse) { this.refs.collapse.textContent = collapsed ? '+' : '–'; this.refs.collapse.title = collapsed ? 'Expand' : 'Collapse'; }
    }

    _wireDrag() {
      let drag = null;
      const head = this.panel.querySelector('.head');
      head.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button, select, input')) return;
        drag = { dx: e.clientX - this.panel.offsetLeft, dy: e.clientY - this.panel.offsetTop };
        head.setPointerCapture(e.pointerId);
      });
      head.addEventListener('pointermove', (e) => {
        if (!drag) return;
        this.prefs.x = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - drag.dx));
        this.prefs.y = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - drag.dy));
        this.panel.style.left = this.prefs.x + 'px';
        this.panel.style.top = this.prefs.y + 'px';
      });
      const stop = () => { if (drag) { drag = null; this.savePrefs(); } };
      head.addEventListener('pointerup', stop);
      head.addEventListener('pointercancel', stop);
    }

    _wireResize() {
      if (typeof ResizeObserver === 'undefined') return;
      let first = true;
      new ResizeObserver(() => {
        if (first) { first = false; return; }
        if (this.prefs.collapsed || this.panel.hidden) return;
        this.prefs.w = this.panel.offsetWidth;
        this.prefs.h = this.panel.offsetHeight;
        this.savePrefs();
      }).observe(this.panel);
    }

    _wireDelegation() {
      this.panel.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-tab]');
        if (tab) {
          if (this.autoTab) this.autoSkip = this.lastPending; // you overrode the automatic switch: leave it for this robber phase
          this.autoTab = null;
          this.prefs.tab = tab.dataset.tab;
          this.savePrefs();
          this.render();
          return;
        }
        const el = e.target.closest('[data-act]');
        if (el) this._action(el.dataset.act, el);
      });
      this.panel.addEventListener('change', (e) => {
        const el = e.target.closest('[data-field]');
        if (el) this._field(el.dataset.field, el.value);
      });
      this.panel.addEventListener('focusout', () => { if (this.dirty) setTimeout(() => { if (!this._busy()) this.render(); }, 50); });
    }

    _busy() {
      const active = this.shadow.activeElement;
      return !!(active && this.refs.body.contains(active) && /^(SELECT|INPUT|TEXTAREA)$/.test(active.tagName));
    }

    _action(act) {
      switch (act) {
        case 'rescan': this.hooks.onRescan && this.hooks.onRescan(); break;
        case 'window': this.hooks.onOpenWindow && this.hooks.onOpenWindow(); break;
        case 'collapse': this.prefs.collapsed = !this.prefs.collapsed; this._applyCollapsed(); this.savePrefs(); this.render(); break;
        case 'hide': this.setHidden(true); break;
        case 'drawer': this.prefs.drawer = !this.prefs.drawer; this.savePrefs(); this.render(); break;
        case 'mode': this.prefs.mode = this.prefs.mode === 'mean' ? 'range' : 'mean'; this.savePrefs(); this.render(); break;
        case 'legend': this.prefs.legend = !this.prefs.legend; this.savePrefs(); this.render(); break;
        case 'log': this.prefs.showLog = !this.prefs.showLog; this.savePrefs(); this.render(); break;
        case 'resetSettings': this.hooks.onResetSettings && this.hooks.onResetSettings(); this.render(); break;
        case 'diag': this.copyDiagnostics(); break;
        case 'diagClose': this.diagText = null; this.diagStatus = ''; this.render(); break;
        default: break;
      }
    }

    _field(field, value) {
      switch (field) {
        case 'you': if (value && this.hooks.onSelectYou) this.hooks.onSelectYou(value); break;
        case 'need': this.prefs.need = value; this.savePrefs(); break;
        case 'vpToWin': case 'discardLimit': if (this.hooks.onSetting) this.hooks.onSetting(field, Number(value)); break;
        default: return;
      }
      this.render(true); // the control that fired the change still has focus: repaint anyway
    }

    /** Build the diagnostics report, copy it to the clipboard when allowed,
     *  and always show it in a text box for manual copying. */
    copyDiagnostics() {
      const diag = this.data.diagnostics ? this.data.diagnostics() : null;
      this.diagText = JSON.stringify(diag || { error: 'no diagnostics available' }, null, 2);
      this.diagStatus = 'Select the text below and copy it.';
      this.render(true);
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(this.diagText).then(() => { this.diagStatus = 'Copied to the clipboard. Paste it to Claude.'; this.render(); }).catch(() => { /* keep manual hint */ });
      }
    }

    setHidden(hidden) {
      if (this.mode === 'window') hidden = false;
      this.prefs.hidden = !!hidden;
      this.panel.hidden = !!hidden;
      this.bubble.hidden = !hidden;
      this.savePrefs();
      if (!hidden) this.render();
    }

    toggleHidden() { this.setHidden(!this.prefs.hidden); }
    setSyncing(flag) { this.syncing = !!flag; this.render(); }

    // ---- rendering -------------------------------------------------------

    /** Repaint. Body updates are held back while you are using a control
     *  inside it (a select or a number box) unless `force` is set. */
    render(force = false) {
      if (this.prefs.hidden) return;
      const s = this.data.snapshot();
      this._renderHead(s);
      if (this.prefs.collapsed) return;
      if (!force && this._busy()) { this.dirty = true; return; }
      this.dirty = false;
      this._autoTab(s);
      this.refs.body.innerHTML = this._drawer(s) + this._notices(s) + this._hands(s) + this._legend() + this._tabs() + this._tabBody(s) + (this.prefs.showLog ? this._log(s) : '');
    }

    /** When you roll a seven (or play a knight) the Robber tab opens by
     *  itself, and the previous tab comes back once the steal is done. */
    _autoTab(s) {
      const pending = s.robberPending && s.you && s.robberPending.player === s.you ? s.robberPending : null;
      this.lastPending = pending ? pending.index : null;
      if (!pending) this.autoSkip = null;
      if (pending && pending.index !== this.autoSkip && !this.autoTab && this.prefs.tab !== 'robber') {
        this.autoTab = { from: this.prefs.tab };
        this.prefs.tab = 'robber';
      } else if (!pending && this.autoTab) {
        this.prefs.tab = this.autoTab.from;
        this.autoTab = null;
      }
    }

    _renderHead(s) {
      let facts = `${s.settings.vpToWin} to win, discard over ${s.settings.discardLimit}`;
      if (s.winner) facts += `. ${s.winner} won`;
      else if (s.currentTurn) facts += `. ${s.currentTurn} to play`;
      this.refs.facts.textContent = facts;
      let cls = 'status';
      let text = 'tracking';
      if (this.syncing) { cls += ' warn'; text = 'reading log…'; }
      else if (!s.players.length) { cls += ' idle'; text = 'waiting for a game'; }
      else if (s.desync || s.contradictions) { cls += ' bad'; text = 'check log'; }
      else if (s.winner) { cls += ' idle'; text = 'game over'; }
      this.refs.status.className = cls;
      this.refs.status.textContent = text;
      this.refs.status.title = s.players.length ? `${s.worlds}${s.approximate ? '+' : ''} possible hand combination${s.worlds === 1 ? '' : 's'} being tracked` : '';
    }

    _sourceLabel(src) {
      return { default: 'default, set it if the room changed it', ui: 'read from the screen', game: 'read from the game', manual: 'set by you' }[src] || src;
    }

    _youLabel(src) {
      return { inferred: 'guessed from a “You stole” line', header: 'from the page header', panel: 'from your player card', session: 'from the game connection', manual: 'chosen by you' }[src] || src;
    }

    _drawer(s) {
      if (!this.prefs.drawer) return '';
      const opts = ['<option value="">not sure yet</option>'].concat(s.players.map(p => `<option value="${esc(p.name)}" ${p.isYou ? 'selected' : ''}>${esc(p.name)}</option>`)).join('');
      const b = this.data.board ? this.data.board() : null;
      return `<div class="drawer">
        <h3>Settings</h3>
        <div class="field"><label>You are</label><select data-field="you">${opts}</select>
          <p class="hint">${s.you ? `Detected as ${esc(s.you)}, ${this._youLabel(s.youSource)}` : 'Not detected yet. Pick your name if the tracker gets it wrong or never asks.'}</p></div>
        <div class="field"><label>Points to win</label><input type="number" min="3" max="40" data-field="vpToWin" value="${s.settings.vpToWin}">
          <p class="hint">${this._sourceLabel(s.settings.sources.vpToWin)}</p></div>
        <div class="field"><label>Discard when over</label><input type="number" min="1" max="30" data-field="discardLimit" value="${s.settings.discardLimit}">
          <p class="hint">${this._sourceLabel(s.settings.sources.discardLimit)}</p></div>
        <div class="field"><label>Uncertain counts</label><div><button data-act="mode" class="${this.prefs.mode === 'range' ? 'on' : ''}">range</button> <button data-act="mode" class="${this.prefs.mode === 'mean' ? 'on' : ''}">average</button></div></div>
        <div class="row"><button data-act="log" class="${this.prefs.showLog ? 'on' : ''}">${this.prefs.showLog ? 'Hide' : 'Show'} the event log</button><button data-act="legend">${this.prefs.legend ? 'Hide' : 'Show'} the reading guide</button><button data-act="resetSettings">Forget my overrides</button><button data-act="diag">Copy diagnostics</button></div>
        <p class="hint">Board data: ${b && b.ready ? `${b.tiles} tiles, ${b.ports} ports captured from the game connection` : 'not captured yet (arrives when you join or refresh during a game)'}.</p>
        ${this._diagBox()}
      </div>`;
    }

    _diagBox() {
      if (!this.diagText) return '';
      return `<div class="diag"><div class="row"><span class="muted">${esc(this.diagStatus)}</span><button data-act="diagClose">Close</button></div><textarea readonly>${esc(this.diagText)}</textarea></div>`;
    }

    _notices(s) {
      const out = [];
      if (!s.you && s.players.length) {
        const opts = s.players.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
        out.push(`<div class="notice"><p>Which player are you? <select data-field="you"><option value="">choose…</option>${opts}</select> <span class="muted">Needed for “You stole” lines and spot advice.</span></p></div>`);
      }
      const bad = [];
      if (s.desync) bad.push('Hand sizes on screen disagree with the log. Some lines were probably missed: press ↻ to re-read.');
      if (s.contradictions) bad.push(`${s.contradictions} impossible event${s.contradictions > 1 ? 's' : ''} had to be forced. Details in the event log (under ⚙).`);
      if (bad.length) out.push(`<div class="notice bad">${bad.map(b => `<p>${esc(b)}</p>`).join('')}</div>`);
      if (s.approximate) out.push('<div class="notice"><p>Many hidden steals: unlikely combinations were dropped, so counts are approximate.</p></div>');
      return out.join('');
    }

    _resCell(stat, mode) {
      const { min, max, mean, pHas } = stat;
      const tip = `title="at least ${min}, at most ${max}. Expected ${fix1(mean)}. ${pct(pHas)} chance of holding one."`;
      if (max === 0) return `<td class="res zero" ${tip}>0</td>`;
      if (min === max) return `<td class="res" ${tip}>${min}</td>`;
      if (mode === 'mean') return `<td class="res" ${tip}><span class="avg">${fix1(mean)}</span></td>`;
      return `<td class="res" ${tip}>${min}<span class="more">+${max - min}</span></td>`;
    }

    _devCell(p) {
      if (p.knownDev) return `<td class="exact" title="Your cards: ${esc(describeKnownDev(p.knownDev))}. Read from the game, so the points are exact.">${p.unplayedDev}</td>`;
      return `<td title="Development cards bought but not played. Any of them could be a hidden point.">${p.unplayedDev}</td>`;
    }

    _vpCell(p) {
      const title = p.knownDev
        ? `${p.visibleVP} on the board${p.knownDev.vp ? ` plus ${p.knownDev.vp} victory point card${p.knownDev.vp > 1 ? 's' : ''} in hand` : ''}`
        : 'Points on the board / maximum if every hidden card is a point';
      const max = p.maxVP > p.visibleVP ? `<span class="muted">/${p.maxVP}</span>` : '';
      return `<td class="vp" title="${esc(title)}"><b>${p.visibleVP}</b>${max}</td>`;
    }

    _hands(s) {
      if (!s.players.length) return '<p class="muted">Join a game. Counting starts as soon as the first settlement is placed.</p>';
      const head = RESOURCES.map((r, i) => `<th class="res" title="${RESOURCE_LABELS[r]}"><span style="background:${RES_COLORS[i]}">${RES_SHORT[i]}</span></th>`).join('');
      const rows = s.players.map(p => {
        const cls = [p.isYou ? 'you' : '', s.currentTurn === p.name ? 'turn' : '', p.overLimit ? 'over' : (p.maybeOverLimit ? 'maybe-over' : '')].join(' ');
        const total = p.handSize.min === p.handSize.max ? p.handSize.min : `${p.handSize.min}–${p.handSize.max}`;
        const tags = (p.longestRoad ? '<span class="tag lr" title="Longest Road">LR</span>' : '') + (p.largestArmy ? '<span class="tag la" title="Largest Army">LA</span>' : '');
        const progress = Math.min(100, Math.round((p.visibleVP / s.settings.vpToWin) * 100));
        const hot = s.settings.vpToWin - p.maxVP <= 2;
        const totalTitle = p.overLimit ? `Over the ${p.discardLimit}-card limit: discards on a 7` : `Cards in hand (limit ${p.discardLimit})`;
        return `<tr class="${cls}">
          <td class="name"><span class="dot" style="background:${esc(p.color) || '#888'}"></span><span class="pname">${esc(p.name)}</span>${p.isYou ? ' <span class="who">you</span>' : ''}${tags}
            <div class="vpbar" title="${p.visibleVP} of ${s.settings.vpToWin} points"><i class="${hot ? 'hot' : ''}" style="width:${progress}%"></i></div></td>
          ${p.hand.res.map(st => this._resCell(st, this.prefs.mode)).join('')}
          <td class="total" title="${totalTitle}">${total}</td>
          ${this._devCell(p)}
          ${this._vpCell(p)}
        </tr>`;
      }).join('');
      const bank = s.bank.map((b, i) => `<td class="${b <= 3 ? 'low' : ''}" title="${RESOURCE_LABELS[RESOURCES[i]]} left in the bank">${b}</td>`).join('');
      return `<table>
        <thead><tr><th class="name">Player</th>${head}<th title="Cards in hand">Cards</th><th title="Unplayed development cards">Dev</th><th title="Victory points">VP</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td class="name">Bank</td>${bank}<td colspan="3" class="muted">${s.deck.deck} dev cards left</td></tr></tfoot>
      </table>`;
    }

    _legend() {
      if (!this.prefs.legend) return '';
      return `<div class="legend"><span><b>3</b> = certain. <b>2<span class="more">+1</span></b> = 2 for sure, maybe 1 more from a hidden steal (hover for odds). Red total = over the discard limit.</span><button data-act="legend" title="Hide this guide">×</button></div>`;
    }

    _tabs() {
      const auto = this.autoTab ? '<span class="auto" title="Opened because you have to move the robber. Your previous tab returns after the steal.">your robber move</span>' : '';
      return `<div class="tabs">${TABS.map(([id, label]) => `<button data-tab="${id}" class="${this.prefs.tab === id ? 'on' : ''}">${label}</button>`).join('')}${auto}</div>`;
    }

    _tabBody(s) {
      switch (this.prefs.tab) {
        case 'robber': return this._robber(s);
        case 'spots': return this._spots(s);
        default: return this._race(s) + this._deck(s);
      }
    }

    _afford(a) {
      const item = (icon, prob, name) => `<span style="opacity:${(0.3 + 0.7 * prob).toFixed(2)}" title="${pct(prob)} chance they can pay for a ${name} now">${icon}${prob > 0 && prob < 1 ? `<sup>${Math.round(prob * 100)}</sup>` : ''}</span>`;
      return [item('🛣️', a.road, 'road'), item('🏠', a.settlement, 'settlement'), item('🏙️', a.city, 'city'), item('🎴', a.dev, 'development card')].join(' ');
    }

    _race(s) {
      if (!s.players.length) return '';
      const rows = s.players.slice().sort((a, b) => b.visibleVP - a.visibleVP || b.maxVP - a.maxVP).map(p => {
        const dp = p.devPlayed;
        const need = Math.max(0, s.settings.vpToWin - p.visibleVP);
        const played = [dp.knight && `${dp.knight} knight${dp.knight > 1 ? 's' : ''}`, dp.monopoly && `${dp.monopoly} monopoly`, dp.roadBuilding && `${dp.roadBuilding} road building`, dp.yearOfPlenty && `${dp.yearOfPlenty} year of plenty`].filter(Boolean).join(', ') || '<span class="muted">none</span>';
        const hidden = p.knownDev ? `<span class="exact" title="Read from the game">${esc(describeKnownDev(p.knownDev).replace('no development cards', 'none'))}</span>` : p.unplayedDev;
        return `<tr class="${p.isYou ? 'you' : ''}">
          <td class="name"><span class="dot" style="background:${esc(p.color) || '#888'}"></span>${esc(p.name)}</td>
          <td class="vp"><b>${p.visibleVP}</b>${p.maxVP > p.visibleVP ? `<span class="muted">/${p.maxVP}</span>` : ''}</td>
          <td>${need}</td>
          <td>${p.settlements} / ${p.cities} / ${p.roads}</td>
          <td title="Cards gained from dice per turn taken">${fix1(p.incomePerTurn)}</td>
          <td class="name" style="white-space:normal">${played}</td>
          <td class="name" style="white-space:normal">${hidden}</td>
          <td>${this._afford(p.afford)}</td>
        </tr>`;
      }).join('');
      return `<div class="section">
        <h4>Race to ${s.settings.vpToWin}</h4>
        <table><thead><tr><th class="name">Player</th><th title="points on board / max with hidden cards">VP</th><th title="Points still needed">Need</th><th title="Settlements / cities / roads">🏠 / 🏙️ / 🛣️</th><th title="Cards gained from dice per turn">Income</th><th class="name">Dev played</th><th class="name" title="Bought, not yet played">In hand</th><th title="What they can afford right now">Can build</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    }

    _deck(s) {
      const d = s.deck;
      const rem = Object.keys(DEV_LABELS).map(k => `<td title="${DEV_LABELS[k]} cards not yet played (in the deck or in hands)">${d.remaining[k]}</td>`).join('');
      const odds = Object.keys(DEV_LABELS).map(k => `<td class="muted">${pct(d.nextOdds[k])}</td>`).join('');
      return `<div class="section">
        <h4>Development deck <small>${d.deck} left, ${d.unplayedInHands} bought but unplayed</small></h4>
        <table><thead><tr><th class="name"></th>${Object.values(DEV_LABELS).map(l => `<th>${l}</th>`).join('')}</tr></thead>
        <tbody><tr><td class="name">Still unplayed</td>${rem}</tr><tr><td class="name">Next draw</td>${odds}</tr></tbody></table>
        <p class="hint">Next-draw odds treat the unplayed cards in hands as a random sample.</p>
      </div>`;
    }

    _robber(s) {
      const opponents = s.players.filter(p => !p.isYou);
      if (!opponents.length) return '<p class="muted">No opponents yet.</p>';
      const need = this.prefs.need;
      const needIdx = RESOURCES.indexOf(need);
      const leaderVP = Math.max(...opponents.map(p => p.visibleVP));
      let best = null;
      for (const p of opponents) {
        const score = needIdx >= 0 ? p.stealOdds.odds[needIdx] : p.stealOdds.pHasCards * (1 + p.visibleVP / s.settings.vpToWin) + p.handSize.mean / 100;
        if (!best || score > best.score) best = { name: p.name, score };
      }
      const rows = opponents.map(p => `<tr>
        <td class="name"><span class="dot" style="background:${esc(p.color) || '#888'}"></span>${esc(p.name)}${p.visibleVP === leaderVP ? ' <span class="tag lead">leader</span>' : ''}</td>
        <td>${p.handSize.min === p.handSize.max ? p.handSize.min : fix1(p.handSize.mean)}</td>
        <td>${p.visibleVP}</td>
        ${p.stealOdds.odds.map((o, i) => `<td class="${needIdx === i && best && best.name === p.name && o > 0 ? 'best' : ''}" style="color:${o > 0 ? RES_COLORS[i] : '#56607a'}">${o > 0 ? pct(o) : '0%'}</td>`).join('')}
      </tr>`).join('');
      const opts = ['<option value="">whoever hurts most</option>'].concat(RESOURCES.map((r, i) => `<option value="${r}" ${need === r ? 'selected' : ''}>${RES_SHORT[i]}</option>`)).join('');
      return `<div class="section">
        <h4>Who to rob <small>I need</small> <select data-field="need">${opts}</select></h4>
        <table><thead><tr><th class="name">Opponent</th><th title="Cards in hand">Cards</th><th>VP</th>${RESOURCES.map((r, i) => `<th style="color:${RES_COLORS[i]}" title="Chance the stolen card is ${RESOURCE_LABELS[r]}">${RES_SHORT[i]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
        <p class="hint">${best ? `Suggested target: <b>${esc(best.name)}</b>${needIdx >= 0 ? `, ${pct(best.score)} chance of ${RES_SHORT[needIdx]}` : ' (most cards and closest to winning)'}.` : ''} Anyone over their discard limit loses half their hand on a 7.</p>
      </div>`;
    }

    _spots(s) {
      const b = this.data.board ? this.data.board() : null;
      const diagButton = '<p><button data-act="diag">Copy diagnostics</button> <span class="muted">and paste them to Claude if this does not resolve itself.</span></p>';
      if (!b || !b.ready) {
        return `<div class="section"><h4>Where to settle</h4>
          <div class="notice quiet"><p>The board has not been captured yet. It is read from the game connection, so it appears when you join a room or refresh the page during a game.</p>
          <p class="muted">Captured so far: ${b ? `${b.tiles} tiles from ${b.messages} messages` : 'nothing'}${b && b.lastError ? `, last error: ${esc(b.lastError)}` : ''}.</p>${diagButton}</div>${this._diagBox()}</div>`;
      }
      const advice = this.data.advice ? this.data.advice() : null;
      if (!advice || advice.phase === 'none') {
        const reason = advice ? esc(advice.reason) : 'no advice yet';
        const help = !s.you ? 'Pick your name in the notice above or under ⚙.' : 'Your colour on the board is not known yet; it is read from your player card or the game connection.';
        return `<div class="section"><h4>Where to settle</h4><div class="notice quiet"><p>Board captured (${b.tiles} tiles, ${b.ports} ports) but ${reason}. ${help}</p>${diagButton}</div>${this._diagBox()}</div>`;
      }
      const title = advice.phase === 'opening' ? (advice.counts.settlements === 0 ? 'Best first settlement' : 'Best second settlement') : 'Best places to expand';
      const items = advice.suggestions.map((sp, i) => `<div class="spot">
        <div class="rank">${i + 1}</div>
        <div class="where">${esc(sp.text)}</div>
        <div class="score"><b>${sp.pips}</b> pips${advice.phase === 'expand' ? `<br>${sp.roads === 0 ? 'build now' : `${sp.roads} road${sp.roads > 1 ? 's' : ''}`}` : ''}</div>
        <div class="why">${esc(sp.why.join('. '))}.</div>
      </div>`).join('');
      return `<div class="section">
        <h4>${title} <small>${advice.considered} spots considered</small></h4>
        ${items || '<p class="muted">No legal spot with production found.</p>'}
        ${advice.strategy ? `<p class="hint">${esc(advice.strategy.text)}</p>` : ''}
        <p class="hint">Spots are named by their touching tiles: “Ore 6, Wheat 8, Sheep 5” is the corner where those three tiles meet.</p>
      </div>`;
    }

    _log(s) {
      const items = s.recent.slice(-60).reverse().map(e => {
        const bad = /CONTRADICTION/.test(e.note);
        return `<div><span class="idx">#${e.index}</span>${esc(e.text)}${e.note ? `<span class="note ${bad ? 'bad' : ''}">${esc(e.note)}</span>` : ''}</div>`;
      }).join('');
      const b = this.data.board ? this.data.board() : null;
      return `<div class="section log-section">
        <h4>Event log <small>${s.eventCount} parsed, ${s.unknownCount} ignored, ${s.ignoredConstraints} impossible offers or counts ignored</small><button class="right" data-act="log" title="Hide the event log">×</button></h4>
        <div class="log">${items || '<div class="muted">Nothing yet.</div>'}</div>
        <p class="hint">You: ${s.you ? `${esc(s.you)}, ${this._youLabel(s.youSource)}` : 'unknown'}. Last log line ${s.lastIndex}. ${b ? `Connection: ${b.messages} messages, ${b.tiles} tiles${b.myName ? `, you are ${esc(b.myName)}` : ''}.` : ''}</p>
        <p><button data-act="diag">Copy diagnostics</button> <span class="muted">Everything the tracker knows, for troubleshooting.</span></p>
        ${this._diagBox()}
      </div>`;
    }
  }

  CT.Panel = Panel;
})(typeof globalThis !== 'undefined' ? globalThis : window);
