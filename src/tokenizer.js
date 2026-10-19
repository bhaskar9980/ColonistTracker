/* DOM -> token list. This is the only parsing code that touches the DOM.
 * A log row becomes an ordered list of tokens:
 *   { t: 'name', v: 'Player', color: 'rgb(...)' }  bold player-name span
 *   { t: 'img',  v: 'lumber' }                      any <img alt> (lower-cased)
 *   { t: 'text', v: 'gave' }                        merged text runs
 * Keeping the parser off the DOM lets it be unit-tested in Node and makes the
 * keyword matching immune to player names that contain keywords. */
(function (root) {
  'use strict';
  const CT = root.ColonistTracker || (root.ColonistTracker = {});

  const TEXT_NODE = 3;
  const ELEMENT_NODE = 1;
  const BOLD_WEIGHTS = new Set(['600', '700', 'bold', 'bolder']);

  function isNameSpan(el) {
    if (el.tagName !== 'SPAN') return false;
    const weight = el.style && el.style.fontWeight;
    if (weight && BOLD_WEIGHTS.has(String(weight))) return true;
    const style = el.getAttribute('style') || '';
    return /font-weight:\s*(600|700|bold)/i.test(style);
  }

  function tokenizeRow(rowEl) {
    const tokens = [];
    let separator = false;

    const pushText = (value) => {
      const v = value.replace(/\s+/g, ' ');
      if (!v.trim()) return;
      const last = tokens[tokens.length - 1];
      if (last && last.t === 'text') last.v = (last.v + v).replace(/\s+/g, ' ');
      else tokens.push({ t: 'text', v });
    };

    const walk = (node) => {
      if (node.nodeType === TEXT_NODE) { pushText(node.nodeValue || ''); return; }
      if (node.nodeType !== ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'HR') { separator = true; return; }
      if (tag === 'SCRIPT' || tag === 'STYLE') return;
      if (tag === 'IMG') {
        const alt = (node.getAttribute('alt') || '').trim().toLowerCase();
        if (alt) tokens.push({ t: 'img', v: alt });
        return;
      }
      if (isNameSpan(node)) {
        const name = (node.textContent || '').trim();
        if (name) tokens.push({ t: 'name', v: name, color: (node.style && node.style.color) || '' });
        return;
      }
      for (const child of node.childNodes) walk(child);
    };

    walk(rowEl);
    for (const tok of tokens) if (tok.t === 'text') tok.v = tok.v.trim();

    const indexAttr = rowEl.getAttribute ? rowEl.getAttribute('data-index') : null;
    const index = indexAttr === null ? NaN : parseInt(indexAttr, 10);
    return { index, tokens: tokens.filter(t => t.t !== 'text' || t.v), separator };
  }

  CT.tokenizeRow = tokenizeRow;
  if (typeof module !== 'undefined' && module.exports) module.exports = { tokenizeRow };
})(typeof globalThis !== 'undefined' ? globalThis : window);
