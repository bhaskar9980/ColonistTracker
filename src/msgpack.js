/* Minimal MessagePack decoder (spec-complete for decoding, no encoder).
 * Loaded in the page's MAIN world alongside inject.js and also used by the
 * test-suite. Exposes a single namespaced global so the page's own globals
 * stay untouched; inject.js picks it up and removes it. */
(function (root) {
  'use strict';

  function decode(input) {
    const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const textDecoder = new TextDecoder();
    let pos = 0;

    const str = (n) => { const s = textDecoder.decode(u8.subarray(pos, pos + n)); pos += n; return s; };
    const bin = (n) => { const b = u8.slice(pos, pos + n); pos += n; return b; };
    const ext = (n) => {
      const type = view.getInt8(pos); pos += 1;
      const data = u8.slice(pos, pos + n); pos += n;
      if (type === -1) return timestamp(data);
      return { $ext: type, data };
    };
    const timestamp = (data) => {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (data.length === 4) return new Date(dv.getUint32(0) * 1000);
      if (data.length === 8) {
        const hi = dv.getUint32(0);
        const lo = dv.getUint32(4);
        const nsec = hi >>> 2;
        const sec = (hi & 0x3) * 2 ** 32 + lo;
        return new Date(sec * 1000 + nsec / 1e6);
      }
      if (data.length === 12) {
        const nsec = dv.getUint32(0);
        const sec = Number(dv.getBigInt64(4));
        return new Date(sec * 1000 + nsec / 1e6);
      }
      return { $ext: -1, data };
    };
    const arr = (n) => { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = read(); return a; };
    const map = (n) => {
      const o = {};
      for (let i = 0; i < n; i++) {
        const k = read();
        o[typeof k === 'string' ? k : String(k)] = read();
      }
      return o;
    };

    function read() {
      const b = u8[pos++];
      if (b <= 0x7f) return b;
      if (b >= 0xe0) return b - 0x100;
      if (b <= 0x8f) return map(b & 0x0f);
      if (b <= 0x9f) return arr(b & 0x0f);
      if (b <= 0xbf) return str(b & 0x1f);
      switch (b) {
        case 0xc0: return null;
        case 0xc2: return false;
        case 0xc3: return true;
        case 0xc4: return bin(u8[pos++]);
        case 0xc5: { const n = view.getUint16(pos); pos += 2; return bin(n); }
        case 0xc6: { const n = view.getUint32(pos); pos += 4; return bin(n); }
        case 0xc7: return ext(u8[pos++]);
        case 0xc8: { const n = view.getUint16(pos); pos += 2; return ext(n); }
        case 0xc9: { const n = view.getUint32(pos); pos += 4; return ext(n); }
        case 0xca: { const v = view.getFloat32(pos); pos += 4; return v; }
        case 0xcb: { const v = view.getFloat64(pos); pos += 8; return v; }
        case 0xcc: return u8[pos++];
        case 0xcd: { const v = view.getUint16(pos); pos += 2; return v; }
        case 0xce: { const v = view.getUint32(pos); pos += 4; return v; }
        case 0xcf: { const v = view.getBigUint64(pos); pos += 8; return Number(v); }
        case 0xd0: { const v = view.getInt8(pos); pos += 1; return v; }
        case 0xd1: { const v = view.getInt16(pos); pos += 2; return v; }
        case 0xd2: { const v = view.getInt32(pos); pos += 4; return v; }
        case 0xd3: { const v = view.getBigInt64(pos); pos += 8; return Number(v); }
        case 0xd4: return ext(1);
        case 0xd5: return ext(2);
        case 0xd6: return ext(4);
        case 0xd7: return ext(8);
        case 0xd8: return ext(16);
        case 0xd9: return str(u8[pos++]);
        case 0xda: { const n = view.getUint16(pos); pos += 2; return str(n); }
        case 0xdb: { const n = view.getUint32(pos); pos += 4; return str(n); }
        case 0xdc: { const n = view.getUint16(pos); pos += 2; return arr(n); }
        case 0xdd: { const n = view.getUint32(pos); pos += 4; return arr(n); }
        case 0xde: { const n = view.getUint16(pos); pos += 2; return map(n); }
        case 0xdf: { const n = view.getUint32(pos); pos += 4; return map(n); }
        default: throw new Error('msgpack: unexpected byte 0x' + b.toString(16) + ' at ' + (pos - 1));
      }
    }

    return read();
  }

  root.__colonistTrackerMsgpack = { decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = { decode };
})(typeof globalThis !== 'undefined' ? globalThis : window);
