/*
 * Parsers for TrustTunnel client configs:
 *  - deep link  tt://?<base64url TLV>  (DEEP_LINK.md, version 2)
 *  - TOML: trusttunnel_client.toml ([endpoint] table) or endpoint export
 *    (`trusttunnel_endpoint ... --format toml`, keys at top level).
 * Result is a normalised profile object (see toProfile()).
 */
"use strict";

const TTConfig = (() => {
  const utf8 = new TextDecoder("utf-8", { fatal: false });

  // ---------------------------------------------------------------- deep link

  function b64urlToBytes(s) {
    s = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    let bin;
    try {
      bin = atob(s);
    } catch (_) {
      throw new Error(t("errLinkBase64"));
    }
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  /** QUIC (RFC 9000) variable-length integer. Returns [value, nextOffset]. */
  function readVarint(b, o) {
    if (o >= b.length) throw new Error(t("errLinkTruncated"));
    const len = 1 << (b[o] >> 6);
    if (o + len > b.length) throw new Error(t("errLinkTruncated"));
    let v = b[o] & 0x3f;
    for (let i = 1; i < len; i++) v = v * 256 + b[o + i];
    return [v, o + len];
  }

  /** Split concatenated DER certificates and wrap each one in PEM. */
  function derToPem(der) {
    const out = [];
    let o = 0;
    while (o < der.length) {
      if (der[o] !== 0x30) break;
      let len = der[o + 1];
      let hdr = 2;
      if (len & 0x80) {
        const n = len & 0x7f;
        len = 0;
        for (let i = 0; i < n; i++) len = len * 256 + der[o + 2 + i];
        hdr = 2 + n;
      }
      const chunk = der.subarray(o, o + hdr + len);
      let bin = "";
      for (const x of chunk) bin += String.fromCharCode(x);
      const b64 = btoa(bin).replace(/.{64}/g, "$&\n");
      out.push("-----BEGIN CERTIFICATE-----\n" + b64.replace(/\n$/, "") + "\n-----END CERTIFICATE-----");
      o += hdr + len;
    }
    return out.join("\n");
  }

  const PROTO = { 1: "http2", 2: "http3" };

  function parseDeepLink(text) {
    const m = /^tt:\/\/\??(.+)$/i.exec(text.trim());
    if (!m) throw new Error(t("errNotLink"));
    const b = b64urlToBytes(m[1]);
    const r = { addresses: [], dns_upstreams: [] };
    let o = 0;
    while (o < b.length) {
      let tag, len;
      [tag, o] = readVarint(b, o);
      [len, o] = readVarint(b, o);
      if (o + len > b.length) throw new Error(t("errLinkTruncated"));
      const v = b.subarray(o, o + len);
      o += len;
      const str = () => utf8.decode(v);
      const bool = () => v.length > 0 && v[0] !== 0;
      switch (tag) {
        case 0x00: r.version = readVarint(v, 0)[0]; break;
        case 0x01: r.hostname = str(); break;
        case 0x02: r.addresses.push(str()); break;
        case 0x03: r.custom_sni = str(); break;
        case 0x04: r.has_ipv6 = bool(); break;
        case 0x05: r.username = str(); break;
        case 0x06: r.password = str(); break;
        case 0x07: r.skip_verification = bool(); break;
        case 0x08: r.certificate = derToPem(v); break;
        case 0x09: r.upstream_protocol = PROTO[v[0]] || String(v[0]); break;
        case 0x0a: r.anti_dpi = bool(); break;
        case 0x0b: r.client_random_prefix = str(); break;
        case 0x0c: r.name = str(); break;
        case 0x0d: {
          let p = 0;
          while (p < v.length) {
            let l;
            [l, p] = readVarint(v, p);
            r.dns_upstreams.push(utf8.decode(v.subarray(p, p + l)));
            p += l;
          }
          break;
        }
        case 0x0e: r.subscription_url = str(); break;
        case 0x0f: r.client_random_auth_key = str(); break;
        default: break; // unknown tags must be ignored
      }
    }
    return r;
  }

  // ---------------------------------------------------------------- TOML (subset)

  function unescapeBasic(s) {
    return s.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_, e) => {
      if (e[0] === "u" || e[0] === "U") return String.fromCodePoint(parseInt(e.slice(1), 16));
      return { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\" }[e] ?? e;
    });
  }

  /**
   * Minimal TOML reader: [tables], key = string|'literal'|"""multi"""|'''multi'''|
   * bool|number|[arrays of those]. Enough for TrustTunnel client configs.
   */
  function parseToml(text) {
    const root = {};
    let cur = root;
    let i = 0;
    const n = text.length;

    const skipWs = () => {
      while (i < n && (text[i] === " " || text[i] === "\t")) i++;
    };
    const skipWsNl = () => {
      for (;;) {
        while (i < n && /[ \t\r\n,]/.test(text[i])) i++;
        if (text[i] === "#") while (i < n && text[i] !== "\n") i++;
        else break;
      }
    };

    function value() {
      skipWs();
      if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
        const q = text.substr(i, 3);
        i += 3;
        if (text[i] === "\r") i++;
        if (text[i] === "\n") i++;
        const end = text.indexOf(q, i);
        if (end < 0) throw new Error(t("errTomlMultiline"));
        const raw = text.slice(i, end);
        i = end + 3;
        return q === '"""' ? unescapeBasic(raw.replace(/\\\r?\n\s*/g, "")) : raw;
      }
      if (text[i] === '"') {
        let j = ++i;
        while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
        const raw = text.slice(i, j);
        i = j + 1;
        return unescapeBasic(raw);
      }
      if (text[i] === "'") {
        const end = text.indexOf("'", i + 1);
        const raw = text.slice(i + 1, end);
        i = end + 1;
        return raw;
      }
      if (text[i] === "[") {
        i++;
        const arr = [];
        for (;;) {
          skipWsNl();
          if (text[i] === "]") {
            i++;
            return arr;
          }
          if (i >= n) throw new Error(t("errTomlArray"));
          arr.push(value());
        }
      }
      const m = /^[^\s,\]#]+/.exec(text.slice(i));
      if (!m) throw new Error(t("errTomlValue"));
      i += m[0].length;
      if (m[0] === "true") return true;
      if (m[0] === "false") return false;
      const num = Number(m[0].replace(/_/g, ""));
      return Number.isNaN(num) ? m[0] : num;
    }

    while (i < n) {
      skipWsNl();
      if (i >= n) break;
      if (text[i] === "[") {
        const end = text.indexOf("]", i);
        const arrTable = text[i + 1] === "[";
        const name = text.slice(i + (arrTable ? 2 : 1), end).trim();
        i = end + (arrTable ? 2 : 1);
        cur = root;
        const parts = name.split(".").map((p) => p.trim().replace(/^"|"$/g, ""));
        parts.forEach((p, idx) => {
          if (arrTable && idx === parts.length - 1) {
            (cur[p] = cur[p] || []).push({});
            cur = cur[p][cur[p].length - 1];
          } else {
            cur = cur[p] = cur[p] || {};
          }
        });
        continue;
      }
      const km = /^("[^"]*"|'[^']*'|[A-Za-z0-9_.-]+)\s*=/.exec(text.slice(i));
      if (!km) throw new Error(t("errTomlUnexpected", text.slice(i, i + 20).split("\n")[0]));
      i += km[0].length;
      const key = km[1].replace(/^["']|["']$/g, "");
      cur[key] = value();
    }
    return root;
  }

  // ---------------------------------------------------------------- normalise

  function splitHostPort(addr) {
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(String(addr || "").trim());
    return m ? { host: m[1], port: Number(m[2]) } : { host: String(addr || "").trim(), port: null };
  }

  /** Raw config fields -> profile stored by the extension. */
  function toProfile(raw, nameHint) {
    let hostname = String(raw.hostname || "").trim();
    // "sni|remote_id" syntax of the CLI client: SNI first, cert name second.
    if (hostname.includes("|")) hostname = hostname.split("|")[1].trim() || hostname.split("|")[0].trim();
    const addresses = (raw.addresses || []).map(String);
    const first = addresses.length ? splitHostPort(addresses[0]) : { host: "", port: null };
    if (!hostname && raw.subscription_url) {
      throw new Error(t("errSubscriptionOnly"));
    }
    if (!hostname) throw new Error(t("errNoHostname"));
    if (!raw.username || !raw.password) throw new Error(t("errNoCreds"));

    const warnings = [];
    const sni = raw.custom_sni ? String(raw.custom_sni) : "";
    if (sni && sni !== hostname) warnings.push(t("warnSni", sni));
    if (raw.client_random_prefix || raw.client_random || raw.client_random_auth_key)
      warnings.push(t("warnClientRandom"));
    if (raw.certificate) warnings.push(t("warnCert"));
    if (raw.skip_verification) warnings.push(t("warnSkipVerify"));
    if (raw.upstream_protocol === "http3") warnings.push(t("warnHttp3"));
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":"))
      warnings.push(t("warnIpHost"));

    return {
      kind: "direct",
      name: String(raw.name || nameHint || hostname),
      hostname,
      port: first.port || 443,
      username: String(raw.username),
      password: String(raw.password),
      addresses,
      sni,
      certificate: raw.certificate ? String(raw.certificate) : "",
      upstream: raw.upstream_protocol ? String(raw.upstream_protocol) : "",
      warnings,
    };
  }

  /** Accepts tt:// link or TOML text. */
  function parseAny(text, nameHint) {
    text = String(text || "").trim();
    if (!text) throw new Error(t("errEmptyConfig"));
    if (/^tt:\/\//i.test(text)) return toProfile(parseDeepLink(text), nameHint);
    const toml = parseToml(text);
    const ep = toml.endpoint && typeof toml.endpoint === "object" ? toml.endpoint : toml;
    const p = toProfile(ep, nameHint);
    const socks = toml.listener && toml.listener.socks;
    if (socks && socks.address) {
      p.warnings.push(t("warnSocksListener", socks.address));
      const sp = splitHostPort(socks.address);
      p.socksHost = sp.host === "0.0.0.0" ? "127.0.0.1" : sp.host;
      p.socksPort = sp.port || 1080;
      p.socksUser = socks.username ? String(socks.username) : "";
      p.socksPass = socks.password ? String(socks.password) : "";
    }
    return p;
  }

  return { parseDeepLink, parseToml, parseAny, toProfile, splitHostPort };
})();

if (typeof module !== "undefined") module.exports = TTConfig;
