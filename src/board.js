/* Board model fed by colonist's WebSocket state messages.
 *
 * Coordinates follow colonist's own scheme (recovered from its client code):
 *   tile   (x, y)          axial hex coordinates
 *   corner (x, y, z)       z: 0 = North corner of tile (x,y), 1 = South corner
 *   edge   (x, y, z)       z: 0 = NorthWest, 1 = West, 2 = SouthWest edge of (x,y)
 * Every corner/edge on the map is "owned" by exactly one tile this way, so
 * the identity of a location is just its triple.
 *
 * Messages are merged tolerantly: the full state and later patches both use
 * dictionaries keyed by index, and a patch may only carry the changed fields. */
(function (root) {
  'use strict';
  const CT = root.ColonistTracker || (root.ColonistTracker = {});

  const TILE = { Desert: 0, Lumber: 1, Brick: 2, Wool: 3, Grain: 4, Ore: 5, Gold: 6, Fog: 7, Sea: 8 };
  const TILE_TO_RES = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 }; // tile type -> resource index
  // Port types use their own enum (not the tile enum): 1 is the generic 3:1 port.
  const PORT = { Generic: 1, Lumber: 2, Brick: 3, Wool: 4, Grain: 5, Ore: 6 };
  const PORT_TO_RES = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4 }; // port type -> resource index
  const BUILDING = { Settlement: 1, City: 2, DestroyedCity: 3 };
  const COLOR_NAMES = { 0: 'None', 1: 'Red', 2: 'Blue', 3: 'Orange', 4: 'Green', 5: 'Black', 6: 'Bronze', 7: 'Silver', 8: 'Gold', 9: 'White', 10: 'Purple', 11: 'MysticBlue', 12: 'Pink' };
  const COLOR_HEX = { 1: '#e27174', 2: '#223697', 3: '#e09742', 4: '#62b95a', 5: '#3e3e3e', 6: '#a0522d', 7: '#a8a9ad', 8: '#d4af37', 9: '#9e9e9e', 10: '#8e44ad', 11: '#2c7be5', 12: '#e87ea1' };
  const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  const MAX_DEPTH = 8;

  const N = 0, S = 1;           // corner z
  const NW = 0, W = 1, SW = 2;  // edge z
  const ck = (x, y, z) => `${x},${y},${z}`;
  const tk = (x, y) => `${x},${y}`;
  const parseKey = (k) => k.split(',').map(Number);

  // ---- geometry (mirrors colonist's HexFace / HexCorner / HexEdge) --------
  const Geo = {
    faceNeighbors: (x, y) => [[x + 1, y - 1], [x + 1, y], [x, y + 1], [x - 1, y + 1], [x - 1, y], [x, y - 1]],
    faceCorners: (x, y) => [[x, y, N], [x + 1, y - 1, S], [x, y + 1, N], [x, y, S], [x - 1, y + 1, N], [x, y - 1, S]],
    faceEdges: (x, y) => [[x + 1, y - 1, SW], [x + 1, y, W], [x, y + 1, NW], [x, y, SW], [x, y, W], [x, y, NW]],
    cornerFaces: (x, y, z) => (z === N ? [[x + 1, y - 1], [x, y], [x, y - 1]] : [[x, y], [x, y + 1], [x - 1, y + 1]]),
    cornerEdges: (x, y, z) => (z === N ? [[x + 1, y - 1, W], [x + 1, y - 1, SW], [x, y, NW]] : [[x, y + 1, NW], [x, y + 1, W], [x, y, SW]]),
    cornerAdjacent: (x, y, z) => (z === N ? [[x + 1, y - 2, S], [x + 1, y - 1, S], [x, y - 1, S]] : [[x, y + 1, N], [x - 1, y + 2, N], [x - 1, y + 1, N]]),
    edgeEnds: (x, y, z) => {
      if (z === NW) return [[x, y - 1, S], [x, y, N]];
      if (z === W) return [[x - 1, y + 1, N], [x, y - 1, S]];
      return [[x, y, S], [x - 1, y + 1, N]];
    },
  };

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array);
  const entries = (dict) => (Array.isArray(dict) ? dict.map((v, i) => [String(i), v]) : (isObj(dict) ? Object.entries(dict) : []));

  // Card enum values the server uses for development cards (10 = face down).
  const DEV_CARD_ENUM = { 11: 'knight', 12: 'vp', 13: 'monopoly', 14: 'roadBuilding', 15: 'yearOfPlenty' };
  const DEV_CARD_BACK = 10;

  class Board {
    constructor() { this.reset(); }

    reset() {
      this.tiles = new Map();        // "x,y" -> {x, y, type, number}
      this.tileByIndex = new Map();  // state index -> "x,y"
      this.corners = new Map();      // "x,y,z" -> {x, y, z, owner, building}
      this.cornerByIndex = new Map();
      this.edges = new Map();        // "x,y,z" -> {x, y, z, owner, type}
      this.edgeByIndex = new Map();
      this.ports = new Map();        // edge "x,y,z" -> {x, y, z, portType, res}
      this.portByIndex = new Map();
      this.colorNames = new Map();   // color enum -> username
      this.playerStates = new Map(); // color enum -> {discardLimit, ratios, vp}
      this.currentTurnColor = null;
      this.settings = { vpToWin: null, discardLimit: null };
      this.mySessionId = null;
      this.myColor = null;
      this.messages = 0;
      this.errors = 0;
      this.version = 0;
      this.lastError = null;
      this.devCards = new Map();     // colour -> card enums; real faces only for our own hand
      this.bankDevCards = null;
      this.shapes = new Map();       // "id:keys" -> {id, keys, count} for diagnostics
      this._cache = null;
    }

    get ready() { return this.tiles.size >= 7; }

    // ---- ingest ----------------------------------------------------------

    /** Feed one decoded frame (msgpack `data` or JSON handshake). Returns
     *  true when anything about the board/game changed. */
    applyMessage(data, id) {
      this.messages++;
      this._recordShape(data, id);
      const before = this.version;
      try { this._walk(data, 0); } catch (e) { this.errors++; this.lastError = String(e && e.message || e); }
      if (this.version !== before) this._cache = null;
      return this.version !== before;
    }

    /** Remember what kinds of messages we saw (keys only, never values) so a
     *  user can report why the board was not recognised. */
    _recordShape(data, id) {
      const shape = Board.describeShape(data);
      const key = `${id === undefined ? '?' : id}:${shape}`;
      const rec = this.shapes.get(key);
      if (rec) { rec.count++; return; }
      if (this.shapes.size >= 80) return;
      this.shapes.set(key, { id: id === undefined ? null : id, keys: shape, count: 1 });
    }

    static describeShape(v, depth = 0) {
      if (v === null || v === undefined) return String(v);
      if (Array.isArray(v)) return `[${v.length}${v.length && depth < 2 ? ' of ' + Board.describeShape(v[0], depth + 1) : ''}]`;
      if (v instanceof Uint8Array) return 'bytes';
      if (typeof v !== 'object') return typeof v;
      const keys = Object.keys(v);
      const shown = keys.slice(0, 14).map(k => (depth < 1 && v[k] && typeof v[k] === 'object' && !Array.isArray(v[k]) ? `${k}{${Object.keys(v[k]).slice(0, 8).join(',')}${Object.keys(v[k]).length > 8 ? ',…' : ''}}` : k));
      return `{${shown.join(',')}${keys.length > 14 ? ',…' : ''}}`;
    }

    _walk(node, depth) {
      if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const item of node) this._walk(item, depth + 1); return; }
      if (node instanceof Uint8Array) return;

      if ('tileHexStates' in node || 'tileCornerStates' in node || 'tileEdgeStates' in node || 'portEdgeStates' in node) this._mergeMap(node);
      if ('playerStates' in node && isObj(node.playerStates)) this._mergePlayers(node.playerStates);
      if (isObj(node.mechanicDevelopmentCardsState)) this._mergeDevCards(node.mechanicDevelopmentCardsState);
      if ('currentState' in node && isObj(node.currentState) && 'currentTurnPlayerColor' in node.currentState) {
        this._set('currentTurnColor', Number(node.currentState.currentTurnPlayerColor));
      }
      if (Array.isArray(node.sessions)) this._mergeSessions(node.sessions);
      if (Array.isArray(node.playerUserStates)) this._mergeSessions(node.playerUserStates);
      if (Number.isInteger(node.playerColor) && node.playerColor > 0 && ('playerUserStates' in node || 'gameState' in node || 'playOrder' in node)) this._set('myColor', node.playerColor);
      if (typeof node.userSessionId === 'string' && node.type === 'Connected' && !this.mySessionId) this._set('mySessionId', node.userSessionId);
      if (Number.isInteger(node.victoryPointsToWin) && node.victoryPointsToWin > 0 && node.victoryPointsToWin !== this.settings.vpToWin) {
        this.settings.vpToWin = node.victoryPointsToWin; this.version++;
      }
      if (Number.isInteger(node.cardDiscardLimit) && node.cardDiscardLimit > 0 && ('victoryPointsToWin' in node || 'sessions' in node || 'gameSetting' in node || 'maxPlayers' in node)
        && node.cardDiscardLimit !== this.settings.discardLimit) {
        this.settings.discardLimit = node.cardDiscardLimit; this.version++;
      }

      for (const key of Object.keys(node)) {
        if (key === 'tileHexStates' || key === 'tileCornerStates' || key === 'tileEdgeStates' || key === 'portEdgeStates' || key === 'playerStates' || key === 'sessions' || key === 'playerUserStates' || key === 'mechanicDevelopmentCardsState') continue;
        const v = node[key];
        if (v && typeof v === 'object') this._walk(v, depth + 1);
      }
    }

    _set(field, value) { if (this[field] !== value) { this[field] = value; this.version++; } }

    /** {bankDevelopmentCards: [...], players: {colour: {developmentCards: [...], developmentCardsUsed: [...]}}} */
    _mergeDevCards(st) {
      if (Array.isArray(st.bankDevelopmentCards)) this._set('bankDevCards', st.bankDevelopmentCards.length);
      if (!isObj(st.players)) return;
      for (const [color, ps] of Object.entries(st.players)) {
        if (!isObj(ps) || !Array.isArray(ps.developmentCards)) continue;
        const cards = ps.developmentCards.map(Number);
        const prev = this.devCards.get(Number(color));
        if (!prev || prev.length !== cards.length || prev.some((c, i) => c !== cards[i])) { this.devCards.set(Number(color), cards); this.version++; }
      }
    }

    /** Exact development cards of a player when the server shows their faces
     *  (only our own hand); null when unknown or face down. */
    knownDevCards(color) {
      const cards = this.devCards.get(color);
      if (!cards) return null;
      const out = { knight: 0, vp: 0, monopoly: 0, roadBuilding: 0, yearOfPlenty: 0, total: cards.length };
      for (const c of cards) {
        if (c === DEV_CARD_BACK || !(c in DEV_CARD_ENUM)) return null;
        out[DEV_CARD_ENUM[c]]++;
      }
      return out;
    }

    _mergeMap(map) {
      this._mergeIndexed(map.tileHexStates, this.tiles, this.tileByIndex, (rec) => tk(rec.x, rec.y), (rec, patch) => {
        if ('type' in patch) rec.type = Number(patch.type);
        if ('diceNumber' in patch) rec.number = Number(patch.diceNumber) || 0;
      });
      this._mergeIndexed(map.tileCornerStates, this.corners, this.cornerByIndex, (rec) => ck(rec.x, rec.y, rec.z), (rec, patch) => {
        if ('owner' in patch) rec.owner = patch.owner === null || patch.owner === undefined ? 0 : Number(patch.owner);
        if ('buildingType' in patch) rec.building = patch.buildingType === null || patch.buildingType === undefined ? 0 : Number(patch.buildingType);
        if ('restrictedStartingPlacement' in patch) rec.restricted = !!patch.restrictedStartingPlacement;
      });
      this._mergeIndexed(map.tileEdgeStates, this.edges, this.edgeByIndex, (rec) => ck(rec.x, rec.y, rec.z), (rec, patch) => {
        if ('owner' in patch) rec.owner = patch.owner === null || patch.owner === undefined ? 0 : Number(patch.owner);
        if ('type' in patch) rec.type = patch.type === null || patch.type === undefined ? 0 : Number(patch.type);
      });
      this._mergeIndexed(map.portEdgeStates, this.ports, this.portByIndex, (rec) => ck(rec.x, rec.y, rec.z), (rec, patch) => {
        if ('type' in patch) {
          rec.portType = patch.type === null || patch.type === undefined ? PORT.Generic : Number(patch.type);
          rec.res = rec.portType in PORT_TO_RES ? PORT_TO_RES[rec.portType] : null; // 2..6 = 2:1 for that resource, 1 = 3:1
        } else if (rec.portType === undefined) {
          rec.portType = PORT.Generic; // the type is optional in the schema: no type means the 3:1 port
          rec.res = null;
        }
      });
    }

    _mergeIndexed(dict, store, byIndex, keyOf, applyFields) {
      if (dict === undefined) return;
      for (const [index, patch] of entries(dict)) {
        if (!isObj(patch)) continue;
        let key = byIndex.get(index);
        if (key === undefined) {
          if (!Number.isFinite(Number(patch.x)) || !Number.isFinite(Number(patch.y))) continue;
          const rec = { x: Number(patch.x), y: Number(patch.y), z: 'z' in patch ? Number(patch.z) : undefined };
          key = keyOf(rec);
          if (!store.has(key)) store.set(key, Object.assign(rec, { owner: 0, building: 0, type: 0, number: 0 }));
          byIndex.set(index, key);
        }
        const rec = store.get(key);
        const snapshot = JSON.stringify(rec);
        applyFields(rec, patch);
        if (JSON.stringify(rec) !== snapshot) this.version++;
      }
    }

    _mergePlayers(states) {
      for (const [color, st] of entries(states)) {
        if (!isObj(st)) continue;
        const c = Number(color);
        const rec = this.playerStates.get(c) || { discardLimit: null, ratios: null, vp: null };
        let changed = !this.playerStates.has(c);
        if (Number.isInteger(st.cardDiscardLimit) && st.cardDiscardLimit !== rec.discardLimit) { rec.discardLimit = st.cardDiscardLimit; changed = true; }
        if (isObj(st.bankTradeRatiosState)) { rec.ratios = Object.assign({}, rec.ratios || {}, st.bankTradeRatiosState); changed = true; }
        if (isObj(st.victoryPointsState)) { rec.vp = Object.assign({}, rec.vp || {}, st.victoryPointsState); changed = true; }
        if (changed) { this.playerStates.set(c, rec); this.version++; }
      }
    }

    _mergeSessions(sessions) {
      for (const s of sessions) {
        if (!isObj(s) || typeof s.username !== 'string') continue;
        const color = Number('selectedColor' in s ? s.selectedColor : s.color);
        if (Number.isInteger(color) && color > 0 && this.colorNames.get(color) !== s.username) { this.colorNames.set(color, s.username); this.version++; }
        if (this.mySessionId && s.userSessionId === this.mySessionId && Number.isInteger(color) && color > 0) this._set('myColor', color);
      }
    }

    // ---- queries ---------------------------------------------------------

    nameOf(color) { return this.colorNames.get(color) || null; }
    /** Colour enum from a DOM attribute value: "1", "Red", "red" ... */
    static colorFromAttr(value) {
      if (value === null || value === undefined) return null;
      const s = String(value).trim();
      if (/^\d+$/.test(s)) { const n = Number(s); return n > 0 && n in COLOR_NAMES ? n : null; }
      for (const [k, n] of Object.entries(COLOR_NAMES)) if (n.toLowerCase() === s.toLowerCase()) return Number(k) || null;
      return null;
    }
    /** Nearest colonist colour to a CSS colour (from the log's name spans). */
    static colorFromCss(css) {
      if (!css) return null;
      let m = String(css).trim().match(/^#([0-9a-f]{6})$/i);
      let rgb = null;
      if (m) rgb = [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
      else if ((m = String(css).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/))) rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!rgb) return null;
      let best = null;
      for (const [k, hex] of Object.entries(COLOR_HEX)) {
        const ref = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
        const d = Math.hypot(rgb[0] - ref[0], rgb[1] - ref[1], rgb[2] - ref[2]);
        if (!best || d < best.d) best = { d, color: Number(k) };
      }
      return best && best.d <= 60 ? best.color : null;
    }
    colorOf(name) { for (const [c, n] of this.colorNames) if (n === name) return c; return null; }
    hexOf(color) { return COLOR_HEX[color] || '#888'; }

    tileAt(x, y) { return this.tiles.get(tk(x, y)) || null; }
    cornerAt(key) { return this.corners.get(key) || null; }

    /** Land tiles touching a corner, with their pips. */
    cornerTiles(key) {
      const [x, y, z] = parseKey(key);
      const out = [];
      for (const [fx, fy] of Geo.cornerFaces(x, y, z)) {
        const t = this.tileAt(fx, fy);
        if (!t || t.type === TILE.Sea || t.type === TILE.Fog) continue;
        const res = t.type in TILE_TO_RES ? TILE_TO_RES[t.type] : (t.type === TILE.Gold ? 'gold' : null);
        out.push({ x: fx, y: fy, type: t.type, res, number: t.number, pips: PIPS[t.number] || 0 });
      }
      return out;
    }

    portAt(key) {
      const [x, y, z] = parseKey(key);
      for (const [ex, ey, ez] of Geo.cornerEdges(x, y, z)) {
        const p = this.ports.get(ck(ex, ey, ez));
        if (p) return p;
      }
      return null;
    }

    /** Every corner that touches at least one land tile. */
    landCorners() {
      if (this._cache && this._cache.landCorners) return this._cache.landCorners;
      const set = new Set();
      for (const t of this.tiles.values()) {
        if (t.type === TILE.Sea || t.type === TILE.Fog) continue;
        for (const [cx, cy, cz] of Geo.faceCorners(t.x, t.y)) set.add(ck(cx, cy, cz));
      }
      this._cache = this._cache || {};
      this._cache.landCorners = Array.from(set);
      return this._cache.landCorners;
    }

    buildingAt(key) { const c = this.corners.get(key); return c && c.building ? c : null; }

    /** Distance rule + emptiness (+ colonist's starting-placement restriction). */
    isBuildable(key, opening = false) {
      const here = this.corners.get(key);
      if (here && here.building) return false;
      if (opening && here && here.restricted) return false;
      const [x, y, z] = parseKey(key);
      for (const [ax, ay, az] of Geo.cornerAdjacent(x, y, z)) if (this.buildingAt(ck(ax, ay, az))) return false;
      return this.cornerTiles(key).length > 0;
    }

    settlementsOf(color) {
      const out = [];
      for (const [key, c] of this.corners) if (c.owner === color && c.building) out.push(key);
      return out;
    }

    roadsOf(color) {
      const out = [];
      for (const [key, e] of this.edges) if (e.owner === color && e.type) out.push(key);
      return out;
    }

    buildingCounts(color) {
      let settlements = 0, cities = 0, roads = 0;
      for (const c of this.corners.values()) if (c.owner === color) { if (c.building === BUILDING.City) cities++; else if (c.building) settlements++; }
      for (const e of this.edges.values()) if (e.owner === color && e.type) roads++;
      return { settlements, cities, roads };
    }

    /** Corners reachable by building roads from `color`'s network.
     *  Returns Map(cornerKey -> roads needed). Existing network corners = 0. */
    reachable(color, maxRoads) {
      const dist = new Map();
      const queue = [];
      const seed = (key) => { if (!dist.has(key)) { dist.set(key, 0); queue.push(key); } };
      for (const key of this.settlementsOf(color)) seed(key);
      for (const ekey of this.roadsOf(color)) for (const [x, y, z] of Geo.edgeEnds(...parseKey(ekey))) seed(ck(x, y, z));
      while (queue.length) {
        const key = queue.shift();
        const d = dist.get(key);
        const here = this.buildingAt(key);
        if (here && here.owner !== color) continue; // cannot pass through an opponent's building
        if (d >= maxRoads) continue;
        const [x, y, z] = parseKey(key);
        for (const [ex, ey, ez] of Geo.cornerEdges(x, y, z)) {
          const edge = this.edges.get(ck(ex, ey, ez));
          if (edge && edge.owner && edge.owner !== color) continue; // opponent road blocks
          const cost = edge && edge.owner === color ? 0 : 1;
          for (const [nx, ny, nz] of Geo.edgeEnds(ex, ey, ez)) {
            const nkey = ck(nx, ny, nz);
            if (nkey === key) continue;
            if (!this.landCornerSet().has(nkey)) continue;
            const nd = d + cost;
            if (!dist.has(nkey) || dist.get(nkey) > nd) { dist.set(nkey, nd); queue.push(nkey); }
          }
        }
      }
      return dist;
    }

    landCornerSet() {
      if (this._cache && this._cache.landCornerSet) return this._cache.landCornerSet;
      const set = new Set(this.landCorners());
      this._cache.landCornerSet = set;
      return set;
    }

    /** Total pips per resource across the whole map (scarcity input). */
    mapPips() {
      const totals = [0, 0, 0, 0, 0];
      for (const t of this.tiles.values()) if (t.type in TILE_TO_RES) totals[TILE_TO_RES[t.type]] += PIPS[t.number] || 0;
      return totals;
    }

    /** Pips per resource a player collects from their buildings (city = x2). */
    productionOf(color) {
      const prod = [0, 0, 0, 0, 0];
      let gold = 0;
      const numbers = new Set();
      for (const key of this.settlementsOf(color)) {
        const c = this.corners.get(key);
        const mult = c.building === BUILDING.City ? 2 : 1;
        for (const t of this.cornerTiles(key)) {
          numbers.add(t.number);
          if (t.res === 'gold') gold += t.pips * mult;
          else if (t.res !== null) prod[t.res] += t.pips * mult;
        }
      }
      return { prod, gold, numbers };
    }

    summary() {
      return {
        ready: this.ready, tiles: this.tiles.size, corners: this.corners.size, edges: this.edges.size, ports: this.ports.size,
        players: Array.from(this.colorNames.entries()).map(([c, n]) => ({ color: c, name: n, hex: this.hexOf(c) })),
        myColor: this.myColor, myName: this.myColor ? this.nameOf(this.myColor) : null,
        myDevCards: this.myColor ? this.knownDevCards(this.myColor) : null, bankDevCards: this.bankDevCards,
        settings: Object.assign({}, this.settings), messages: this.messages, errors: this.errors, lastError: this.lastError,
        shapes: Array.from(this.shapes.values()),
        discardLimits: Array.from(this.playerStates.entries()).map(([c, s]) => ({ color: c, name: this.nameOf(c), discardLimit: s.discardLimit })),
      };
    }
  }

  Object.assign(CT, { Board, BoardGeo: Geo, TILE, TILE_TO_RES, PORT, PORT_TO_RES, BUILDING, PIPS, COLOR_NAMES, COLOR_HEX, cornerKey: ck, tileKey: tk });
  if (typeof module !== 'undefined' && module.exports) module.exports = { Board, Geo, TILE, TILE_TO_RES, PORT, PORT_TO_RES, BUILDING, PIPS, COLOR_NAMES, COLOR_HEX, ck, tk };
})(typeof globalThis !== 'undefined' ? globalThis : window);
