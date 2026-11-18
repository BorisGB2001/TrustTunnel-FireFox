#!/usr/bin/env node
// Self-test for the tt:// and TOML parsers in extension/lib/config.js.
// Run: node scripts/test-config.js
"use strict";
const path = require("path");
const assert = require("assert");
// The parser uses the global t() from lib/i18n.js; emulate it with the English messages.
const EN = require(path.join(__dirname, "../extension/_locales/en/messages.json"));
global.t = (key, ...subs) => (EN[key] ? EN[key].message.replace(/\$(\d)/g, (_, n) => String(subs[n - 1])) : key);
const TTConfig = require(path.join(__dirname, "../extension/lib/config.js"));

// --- encoder per DEEP_LINK.md v2 (only for tests)
function varint(v) {
  if (v <= 0x3f) return [v];
  if (v <= 0x3fff) return [0x40 | (v >> 8), v & 0xff];
  return [0x80 | (v >>> 24), (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}
const enc = (s) => [...Buffer.from(s, "utf8")];
function tlv(tag, bytes) {
  return [...varint(tag), ...varint(bytes.length), ...bytes];
}
function link(entries) {
  const b = Buffer.from(entries.flat());
  return "tt://?" + b.toString("base64url");
}

// 1. Minimal link (the sample in deeplink/README.md has a wrong length byte, so build our own).
let p = TTConfig.parseAny(
  link([tlv(0x01, enc("vpn.example.com")), tlv(0x02, enc("1.2.3.4:443")), tlv(0x05, enc("alice")), tlv(0x06, enc("secret123"))])
);
assert.strictEqual(p.hostname, "vpn.example.com");
assert.strictEqual(p.port, 443);
assert.strictEqual(p.username, "alice");
assert.strictEqual(p.password, "secret123");

// 2. Full link: unicode, two addresses, DER cert, http3, dns list, unknown tag.
const fakeDer = [0x30, 0x82, 0x01, 0x00, ...new Array(256).fill(7)];
const dns = [...varint(14), ...enc("tls://1.1.1.1"), ...varint(7), ...enc("8.8.8.8")];
p = TTConfig.parseAny(
  link([
    tlv(0x00, varint(2)),
    tlv(0x01, enc("vpn.example.com")),
    tlv(0x02, enc("203.0.113.10:8443")),
    tlv(0x02, enc("[2001:db8::1]:8443")),
    tlv(0x05, enc("алиса")),
    tlv(0x06, enc('p@ss"word')),
    tlv(0x08, [...fakeDer, ...fakeDer]),
    tlv(0x09, [2]),
    tlv(0x0c, enc("Тест NL")),
    tlv(0x0d, dns),
    tlv(0x3f, [1, 2, 3]),
    tlv(0x10, [0]),
  ])
);
assert.strictEqual(p.name, "Тест NL");
assert.strictEqual(p.port, 8443);
assert.strictEqual(p.username, "алиса");
assert.strictEqual(p.password, 'p@ss"word');
assert.strictEqual(p.upstream, "http3");
assert.strictEqual((p.certificate.match(/BEGIN CERTIFICATE/g) || []).length, 2);
assert.ok(p.warnings.length >= 2);

// 3. trusttunnel_client.toml with [endpoint] and [listener.socks].
p = TTConfig.parseAny(`
loglevel = "info"
exclusions = [
  "example.org", # comment
  "10.0.0.0/8",
]
[endpoint]
hostname = "vpn.example.com"
addresses = ["192.168.1.100:443"]
username = 'myuser'
password = "my\\"pass"
certificate = """
-----BEGIN CERTIFICATE-----
MIIB
-----END CERTIFICATE-----
"""
[listener.socks]
address = "127.0.0.1:1088"
`);
assert.strictEqual(p.username, "myuser");
assert.strictEqual(p.password, 'my"pass');
assert.ok(p.certificate.startsWith("-----BEGIN"));
assert.strictEqual(p.socksPort, 1088);

// 4. Endpoint export (top-level keys).
p = TTConfig.parseAny('hostname = "a.example.net"\naddresses = ["1.2.3.4:443"]\nusername = "u"\npassword = "p"\nname = "X"');
assert.strictEqual(p.hostname, "a.example.net");
assert.strictEqual(p.name, "X");

// 5. Errors.
assert.throws(() => TTConfig.parseAny("tt://?!!!"));
assert.throws(() => TTConfig.parseAny('hostname = "x.example"'), /username\/password/);

console.log("OK: all parser checks passed");
