/* Token list -> game event. Pure (no DOM), so it runs in Node tests.
 *
 * Keyword matching only looks at 'text' tokens, never at player names or image
 * alts, so a player called "rolled" or "stole" cannot confuse the parser. */
(function (root) {
  'use strict';
  const CT = root.ColonistTracker || (root.ColonistTracker = {});
  const { RESOURCE_ALIASES } = CT;

  const IGNORED = /has disconnected|has reconnected|left the game|will take over|bot is selecting|friendly robber|no player to steal|learn how to play|list of commands/;

  function plainText(tokens) {
    return tokens.filter(t => t.t === 'text').map(t => t.v).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function resourceIndex(alt) {
    if (!alt) return null;
    const key = alt.toLowerCase().trim();
    if (key in RESOURCE_ALIASES) return RESOURCE_ALIASES[key];
    // e.g. "card_lumber", "lumber card"
    for (const alias of Object.keys(RESOURCE_ALIASES)) {
      if (new RegExp('(^|[^a-z])' + alias + '([^a-z]|$)').test(key)) return RESOURCE_ALIASES[alias];
    }
    return null;
  }

  function countResources(tokens) {
    const counts = [0, 0, 0, 0, 0];
    for (const tok of tokens) {
      if (tok.t !== 'img') continue;
      const idx = resourceIndex(tok.v);
      if (idx !== null) counts[idx]++;
    }
    return counts;
  }

  function firstResource(tokens) {
    for (const tok of tokens) {
      if (tok.t !== 'img') continue;
      const idx = resourceIndex(tok.v);
      if (idx !== null) return idx;
    }
    return null;
  }

  function hasImg(tokens, pattern) {
    return tokens.some(t => t.t === 'img' && pattern.test(t.v.toLowerCase()));
  }

  function findText(tokens, pattern, from = 0) {
    for (let i = from; i < tokens.length; i++) {
      if (tokens[i].t === 'text' && pattern.test(tokens[i].v.toLowerCase())) return i;
    }
    return -1;
  }

  function total(counts) { return counts.reduce((a, b) => a + b, 0); }

  function describe(tokens) {
    return tokens.map(t => (t.t === 'img' ? '[' + t.v + ']' : t.v)).join(' ').replace(/\s+/g, ' ').trim();
  }

  function devCardFrom(tokens, plain) {
    const alt = (tokens.filter(t => t.t === 'img').map(t => t.v).join(' ') + ' ' + plain).toLowerCase();
    if (/knight/.test(alt)) return 'knight';
    if (/year of plenty/.test(alt)) return 'yearOfPlenty';
    if (/road building/.test(alt)) return 'roadBuilding';
    if (/monopoly/.test(alt)) return 'monopoly';
    return null;
  }

  function parseDice(tokens) {
    const dice = [];
    for (const tok of tokens) {
      if (tok.t !== 'img') continue;
      const m = tok.v.toLowerCase().match(/^dice_(\d+)$/);
      if (m) dice.push(parseInt(m[1], 10));
    }
    return dice;
  }

  function parseSteal(tokens, plain, names, base) {
    const mono = plain.match(/stole (\d+)/);
    if (mono) {
      return Object.assign(base, {
        type: 'monopoly', res: firstResource(tokens), count: parseInt(mono[1], 10), victim: names[1] || null,
      });
    }
    const res = firstResource(tokens);
    if (/you stole/.test(plain)) {
      return Object.assign(base, { type: 'steal', thief: null, victim: names[0] || null, res, youAreThief: true });
    }
    if (/from you/.test(plain)) {
      return Object.assign(base, { type: 'steal', thief: names[0] || null, victim: null, res, youAreVictim: true });
    }
    if (names.length >= 2) {
      return Object.assign(base, { type: 'steal', thief: names[0], victim: names[1], res });
    }
    return null;
  }

  function parseTrade(tokens, names, base) {
    const gotAt = findText(tokens, /and got/);
    if (gotAt < 0) return null;
    const fromAt = findText(tokens, /\bfrom\b/, gotAt);
    const gave = countResources(tokens.slice(0, gotAt));
    const got = countResources(tokens.slice(gotAt, fromAt < 0 ? tokens.length : fromAt));
    if (total(gave) === 0 && total(got) === 0) return null;
    return Object.assign(base, { type: 'trade', partner: names[1], gave, got });
  }

  function parseBankTrade(tokens, base) {
    const tookAt = findText(tokens, /and took/);
    if (tookAt < 0) return null;
    const gave = countResources(tokens.slice(0, tookAt));
    const got = countResources(tokens.slice(tookAt));
    if (total(gave) === 0 && total(got) === 0) return null;
    return Object.assign(base, { type: 'bankTrade', gave, got });
  }

  function parseOffer(tokens, names, base) {
    const forAt = findText(tokens, /\bfor\b/);
    const offered = countResources(forAt < 0 ? tokens : tokens.slice(0, forAt));
    const wanted = forAt < 0 ? [0, 0, 0, 0, 0] : countResources(tokens.slice(forAt));
    if (total(offered) === 0) return null;
    return Object.assign(base, { type: 'offer', offered, wanted, target: names[1] || null });
  }

  function parseBlocked(tokens, base) {
    let num = null;
    let res = null;
    for (const tok of tokens) {
      if (tok.t !== 'img') continue;
      const alt = tok.v.toLowerCase();
      const m = alt.match(/^prob_(\d+)$/);
      if (m) num = parseInt(m[1], 10);
      const tile = alt.match(/^(\w+) tile$/);
      if (tile) res = resourceIndex(tile[1]);
    }
    return Object.assign(base, { type: 'blocked', num, res });
  }

  /** Parse one tokenized row into an event, or null when the row is noise. */
  function parseRow(row) {
    if (!row || row.separator) return null;
    const tokens = row.tokens || [];
    const plain = plainText(tokens);
    const nameTokens = tokens.filter(t => t.t === 'name');
    const names = nameTokens.map(t => t.v);
    const player = names[0] || null;
    const base = { index: row.index, player, color: nameTokens[0] ? nameTokens[0].color : '', text: describe(tokens) };

    if (!plain && !tokens.some(t => t.t === 'img')) return null;
    if (IGNORED.test(plain)) return null;
    if (/blocked by the robber/.test(plain)) return parseBlocked(tokens, base);

    // Real steal lines always carry a card image (face or back); chat lines don't.
    if (/\bstole\b/.test(plain)) return tokens.some(t => t.t === 'img') ? parseSteal(tokens, plain, names, base) : null;
    if (!player) return null;

    if (/placed a\b/.test(plain)) {
      if (hasImg(tokens, /settlement/)) return Object.assign(base, { type: 'placeSettlement' });
      if (hasImg(tokens, /road/)) return Object.assign(base, { type: 'placeRoad' });
      return null;
    }
    if (/received starting resources/.test(plain)) {
      return Object.assign(base, { type: 'gain', source: 'start', res: countResources(tokens) });
    }
    if (/\brolled\b/.test(plain)) {
      const dice = parseDice(tokens);
      if (dice.length === 2) return Object.assign(base, { type: 'roll', dice, sum: dice[0] + dice[1] });
      return null;
    }
    if (/\bgave bank\b/.test(plain) && /and took/.test(plain)) return parseBankTrade(tokens, base);
    if (/\bgave\b/.test(plain) && /and got/.test(plain) && names.length >= 2) return parseTrade(tokens, names, base);
    if (/took from bank/.test(plain)) {
      const res = countResources(tokens);
      return total(res) ? Object.assign(base, { type: 'gain', source: 'yearOfPlenty', res }) : null;
    }
    if (/\bgot\b/.test(plain)) {
      const res = countResources(tokens);
      return total(res) ? Object.assign(base, { type: 'gain', source: 'roll', res }) : null;
    }
    if (/\bbought\b/.test(plain) && hasImg(tokens, /development/)) return Object.assign(base, { type: 'buyDev' });
    if (/built a\b/.test(plain)) {
      if (hasImg(tokens, /settlement/)) return Object.assign(base, { type: 'build', what: 'settlement' });
      if (hasImg(tokens, /city/)) return Object.assign(base, { type: 'build', what: 'city' });
      if (hasImg(tokens, /road/)) return Object.assign(base, { type: 'build', what: 'road' });
      return null;
    }
    if (/\bused\b/.test(plain) && hasImg(tokens, /knight|year of plenty|road building|monopoly/)) {
      const card = devCardFrom(tokens, plain);
      return card ? Object.assign(base, { type: 'useDev', card }) : null;
    }
    if (/\bdiscarded\b/.test(plain)) {
      const res = countResources(tokens);
      return total(res) ? Object.assign(base, { type: 'discard', res }) : null;
    }
    if (/wants to give/.test(plain) || /proposed counter offer/.test(plain)) return parseOffer(tokens, names, base);
    if (/moved robber/.test(plain)) return Object.assign(base, { type: 'moveRobber' });
    if (/longest road|largest army|longest trade route/.test(plain) || hasImg(tokens, /longest road|largest army/)) {
      const award = /largest army/.test(plain) || hasImg(tokens, /largest army/) ? 'largestArmy' : 'longestRoad';
      // "Longest Road passed from Ahab to Beth (+2 VPs)": first name is the old holder
      if (/passed from/.test(plain) && names.length >= 2) {
        const to = nameTokens[1];
        return Object.assign(base, { type: 'award', award, player: to.v, color: to.color || null, from: names[0] });
      }
      if (/\breceived\b/.test(plain) && player) return Object.assign(base, { type: 'award', award });
      if (/\blost\b/.test(plain) && player) return Object.assign(base, { type: 'award', award, lost: true });
    }
    if (/won the game/.test(plain)) return Object.assign(base, { type: 'gameOver' });

    return Object.assign(base, { type: 'unknown' });
  }

  Object.assign(CT, { parseRow, countResources, resourceIndex, plainText });
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseRow, countResources, resourceIndex, plainText };
})(typeof globalThis !== 'undefined' ? globalThis : window);
