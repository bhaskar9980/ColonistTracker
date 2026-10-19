/* Placement advisor. Scores settlement spots on the captured board with a
 * transparent, additive model so every suggestion can say why:
 *   production   pips of the touching tiles, weighted up for scarce resources
 *   variety      distinct resources at the spot
 *   fit          what the spot adds to what you already collect
 *   port         a 2:1 port for something you produce (or a 3:1 port)
 *   room         how many free neighbouring spots remain (opening only)
 *   cost         roads you still need to build to get there (expansion only) */
(function (root) {
  'use strict';
  const CT = root.ColonistTracker || (root.ColonistTracker = {});
  const { RESOURCE_LABELS, RESOURCES } = CT;
  const Geo = CT.BoardGeo;
  const ck = CT.cornerKey;

  const WEIGHTS = { variety: 0.8, newResource: 1.0, pair: 1.0, duplicateNumber: 0.6, port2: 0.8, port3: 0.8, room: 0.3, robber: 0.5, road: 1.6 };
  const SCARCITY_MIN = 0.75;
  const SCARCITY_MAX = 1.5;

  const label = (res) => (res === 'gold' ? 'Gold' : RESOURCE_LABELS[RESOURCES[res]]);

  function scarcityFactors(board) {
    const pips = board.mapPips();
    const present = pips.filter(p => p > 0);
    const avg = present.length ? present.reduce((a, b) => a + b, 0) / present.length : 0;
    return pips.map(p => (p > 0 && avg > 0 ? Math.min(SCARCITY_MAX, Math.max(SCARCITY_MIN, avg / p)) : 1));
  }

  function describe(tiles, port) {
    const parts = tiles.slice().sort((a, b) => b.pips - a.pips).map(t => `${label(t.res)} ${t.number || '–'}`);
    let text = parts.join(', ') || 'no producing tiles';
    if (port) text += port.res !== null && port.res !== undefined ? ` + ${label(port.res)} port` : ' + 3:1 port';
    return text;
  }

  function scoreCorner(board, key, ctx) {
    const tiles = board.cornerTiles(key).filter(t => t.res !== null);
    const port = board.portAt(key);
    const pips = tiles.reduce((a, t) => a + t.pips, 0);
    const why = [];

    let production = 0;
    for (const t of tiles) production += t.pips * (t.res === 'gold' ? 1.1 : ctx.scarcity[t.res]);
    if (pips >= 12) why.push(`${pips} pips, excellent production`);
    else if (pips >= 9) why.push(`${pips} pips, solid production`);
    else if (pips > 0) why.push(`${pips} pips`);

    const distinct = new Set(tiles.map(t => t.res));
    const variety = WEIGHTS.variety * Math.max(0, distinct.size - 1);
    if (distinct.size >= 3) why.push(`${distinct.size} different resources`);

    // fit with current production
    let fit = 0;
    const added = [0, 0, 0, 0, 0];
    for (const t of tiles) if (t.res !== 'gold') added[t.res] += t.pips;
    const newRes = [];
    for (let r = 0; r < 5; r++) if (added[r] > 0 && ctx.prod[r] === 0) { fit += WEIGHTS.newResource; newRes.push(label(r)); }
    if (newRes.length) why.push(`adds ${newRes.join(' and ')}, which you lack`);
    const after = ctx.prod.map((p, r) => p + added[r]);
    const hadWB = ctx.prod[0] >= 3 && ctx.prod[1] >= 3;
    const hadOW = ctx.prod[4] >= 3 && ctx.prod[3] >= 3;
    if (!hadWB && after[0] >= 3 && after[1] >= 3 && (added[0] || added[1])) { fit += WEIGHTS.pair; why.push('completes a Wood + Brick engine'); }
    if (!hadOW && after[4] >= 3 && after[3] >= 3 && (added[4] || added[3])) { fit += WEIGHTS.pair; why.push('completes an Ore + Wheat engine'); }
    let dupes = 0;
    for (const t of tiles) if (ctx.numbers.has(t.number)) dupes++;
    if (dupes) { fit -= WEIGHTS.duplicateNumber * dupes; why.push(`${dupes} number${dupes > 1 ? 's' : ''} you already collect on`); }
    for (const t of tiles) if (t.res === 'gold') { fit += 0.8; why.push('Gold: pick any resource'); break; }

    let portScore = 0;
    if (port) {
      if (port.res !== null && port.res !== undefined) {
        const supply = after[port.res];
        portScore = WEIGHTS.port2 + Math.min(2.2, 0.25 * supply);
        why.push(supply >= 4 ? `${label(port.res)} port with ${label(port.res)} income to feed it` : `${label(port.res)} port`);
      } else { portScore = WEIGHTS.port3; why.push('3:1 port'); }
    }

    let room = 0;
    if (ctx.phase === 'opening') {
      const [x, y, z] = key.split(',').map(Number);
      let free = 0;
      for (const [ax, ay, az] of Geo.cornerAdjacent(x, y, z)) {
        const k = ck(ax, ay, az);
        if (board.landCornerSet().has(k) && !board.buildingAt(k)) free++;
      }
      room = WEIGHTS.room * free;
      if (free <= 1) why.push('little room to expand from here');
    }

    let robber = 0;
    const top = tiles.reduce((m, t) => Math.max(m, t.pips), 0);
    if (pips > 0 && top >= 5 && top / pips >= 0.6) { robber = WEIGHTS.robber; why.push('depends heavily on one 6/8 tile (robber magnet)'); }

    const roads = ctx.roads !== undefined ? ctx.roads.get(key) || 0 : 0;
    const cost = WEIGHTS.road * roads;
    if (ctx.phase === 'expand') why.push(roads === 0 ? 'you can build here now' : `${roads} road${roads > 1 ? 's' : ''} away`);

    const score = production + variety + fit + portScore + room - robber - cost;
    return { key, score, pips, roads, tiles, port, text: describe(tiles, port), why, parts: { production, variety, fit, port: portScore, room, robber, cost } };
  }

  function strategy(board, color) {
    const { prod, gold } = board.productionOf(color);
    const missing = [];
    for (let r = 0; r < 5; r++) if (prod[r] === 0) missing.push(RESOURCE_LABELS[RESOURCES[r]]);
    const wb = prod[0] + prod[1];
    const ow = prod[4] + prod[3];
    let lean = 'balanced';
    let text = 'Your income is balanced. Build settlements first, then upgrade your best spots to cities.';
    if (ow >= wb * 1.25 && ow >= 6) { lean = 'ore-wheat'; text = 'You lean Ore + Wheat: aim for cities and development cards; a Sheep source or port helps buy cards.'; }
    else if (wb >= ow * 1.25 && wb >= 6) { lean = 'wood-brick'; text = 'You lean Wood + Brick: expand fast with roads and settlements and contest Longest Road.'; }
    if (missing.length && missing.length < 5) text += ` You produce no ${missing.join(' or ')}; trade for it or target a tile or port that gives it.`;
    return { lean, text, prod, gold, missing };
  }

  /** Main entry. `color` is the player's colonist colour enum. */
  function advise(board, color, options) {
    const opts = Object.assign({ top: 5, maxRoads: 3 }, options || {});
    if (!board || !board.ready || !color) return { phase: 'none', suggestions: [], strategy: null, reason: !board || !board.ready ? 'board not captured yet' : 'your colour is unknown' };
    const counts = board.buildingCounts(color);
    const phase = counts.settlements + counts.cities < 2 ? 'opening' : 'expand';
    const { prod, numbers } = board.productionOf(color);
    const ctx = { phase, prod, numbers, scarcity: scarcityFactors(board) };

    let candidates;
    if (phase === 'opening') {
      candidates = board.landCorners().filter(k => board.isBuildable(k, true));
    } else {
      ctx.roads = board.reachable(color, opts.maxRoads);
      candidates = Array.from(ctx.roads.keys()).filter(k => board.isBuildable(k));
    }
    const scored = candidates.map(k => scoreCorner(board, k, ctx)).filter(s => s.pips > 0).sort((a, b) => b.score - a.score);
    return { phase, suggestions: scored.slice(0, opts.top), considered: scored.length, strategy: strategy(board, color), counts };
  }

  Object.assign(CT, { advise, scoreCorner, describeCorner: describe, adviseStrategy: strategy });
  if (typeof module !== 'undefined' && module.exports) module.exports = { advise, scoreCorner, describe, strategy };
})(typeof globalThis !== 'undefined' ? globalThis : window);
