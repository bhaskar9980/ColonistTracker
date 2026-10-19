'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decode } = require('../src/msgpack.js');

// A tiny encoder, only for producing test vectors.
function encode(v) {
  const out = [];
  const u16 = (n) => out.push((n >> 8) & 0xff, n & 0xff);
  const u32 = (n) => out.push((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  const write = (x) => {
    if (x === null) return out.push(0xc0);
    if (x === true) return out.push(0xc3);
    if (x === false) return out.push(0xc2);
    if (typeof x === 'number') {
      if (Number.isInteger(x)) {
        if (x >= 0 && x <= 0x7f) return out.push(x);
        if (x < 0 && x >= -32) return out.push(x & 0xff);
        if (x >= 0 && x <= 0xff) return out.push(0xcc, x);
        if (x >= 0 && x <= 0xffff) { out.push(0xcd); return u16(x); }
        if (x >= 0 && x <= 0xffffffff) { out.push(0xce); return u32(x); }
        if (x < 0 && x >= -128) return out.push(0xd0, x & 0xff);
        if (x < 0 && x >= -32768) { out.push(0xd1); return u16(x & 0xffff); }
        out.push(0xd2); return u32(x >>> 0);
      }
      const b = new Uint8Array(new Float64Array([x]).buffer);
      out.push(0xcb); for (let i = 7; i >= 0; i--) out.push(b[i]); return undefined;
    }
    if (typeof x === 'string') {
      const bytes = Array.from(new TextEncoder().encode(x));
      if (bytes.length <= 31) out.push(0xa0 | bytes.length);
      else if (bytes.length <= 0xff) out.push(0xd9, bytes.length);
      else { out.push(0xda); u16(bytes.length); }
      return out.push(...bytes);
    }
    if (x instanceof Uint8Array) { out.push(0xc4, x.length); return out.push(...x); }
    if (Array.isArray(x)) {
      if (x.length <= 15) out.push(0x90 | x.length); else { out.push(0xdc); u16(x.length); }
      for (const item of x) write(item);
      return undefined;
    }
    const keys = Object.keys(x);
    if (keys.length <= 15) out.push(0x80 | keys.length); else { out.push(0xde); u16(keys.length); }
    for (const k of keys) { write(k); write(x[k]); }
    return undefined;
  };
  write(v);
  return new Uint8Array(out);
}

test('round-trips scalars, strings, arrays and maps', () => {
  const value = {
    id: 91,
    data: {
      small: 5, neg: -3, byte: 200, short: 40000, big: 3000000000, negShort: -1000, negInt: -100000,
      pi: 3.25, ok: true, no: false, nothing: null,
      str: 'hello', long: 'x'.repeat(40), unicode: 'héllo → 🎲',
      list: [1, 2, 3, [4, 5]], nested: { a: { b: { c: [{ d: 1 }] } } },
      sixteenPlus: Array.from({ length: 20 }, (_, i) => i),
      bytes: new Uint8Array([1, 2, 3]),
    },
  };
  const decoded = decode(encode(value));
  assert.equal(decoded.id, 91);
  assert.equal(decoded.data.small, 5);
  assert.equal(decoded.data.neg, -3);
  assert.equal(decoded.data.byte, 200);
  assert.equal(decoded.data.short, 40000);
  assert.equal(decoded.data.big, 3000000000);
  assert.equal(decoded.data.negShort, -1000);
  assert.equal(decoded.data.negInt, -100000);
  assert.equal(decoded.data.pi, 3.25);
  assert.equal(decoded.data.ok, true);
  assert.equal(decoded.data.no, false);
  assert.equal(decoded.data.nothing, null);
  assert.equal(decoded.data.str, 'hello');
  assert.equal(decoded.data.long, 'x'.repeat(40));
  assert.equal(decoded.data.unicode, 'héllo → 🎲');
  assert.deepEqual(decoded.data.list, [1, 2, 3, [4, 5]]);
  assert.deepEqual(decoded.data.nested, { a: { b: { c: [{ d: 1 }] } } });
  assert.equal(decoded.data.sixteenPlus.length, 20);
  assert.deepEqual(Array.from(decoded.data.bytes), [1, 2, 3]);
});

test('integer map keys become string keys (like colonist index dictionaries)', () => {
  // fixmap with int keys: {0: {x:1}, 7: {x:2}}
  const bytes = new Uint8Array([0x82, 0x00, 0x81, 0xa1, 0x78, 0x01, 0x07, 0x81, 0xa1, 0x78, 0x02]);
  assert.deepEqual(decode(bytes), { 0: { x: 1 }, 7: { x: 2 } });
});

test('ext types: timestamp and unknown', () => {
  // fixext4 timestamp (-1) = 1_600_000_000 seconds
  const ts = decode(new Uint8Array([0xd6, 0xff, 0x5f, 0x5e, 0x10, 0x00]));
  assert.ok(ts instanceof Date);
  assert.equal(ts.getTime(), 1600000000 * 1000);
  const ext = decode(new Uint8Array([0xd4, 0x05, 0x2a]));
  assert.equal(ext.$ext, 5);
  assert.deepEqual(Array.from(ext.data), [0x2a]);
});

test('accepts ArrayBuffer input and rejects garbage', () => {
  const buf = encode({ a: 1 }).buffer;
  assert.deepEqual(decode(buf), { a: 1 });
  assert.throws(() => decode(new Uint8Array([0xc1])), /unexpected byte/);
});
