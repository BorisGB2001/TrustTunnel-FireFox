/* Routing rules: which hosts go through the tunnel. Shared by background and pages. */
"use strict";

const TTRules = (() => {
  /** Normalise one list entry: "https://Sub.Example.com/path" -> "sub.example.com". */
  function normalizeEntry(raw) {
    let s = String(raw || "").trim().toLowerCase();
    if (!s || s.startsWith("#")) return "";
    if (/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(s)) return s; // IPv4 CIDR
    s = s.replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "");
    s = s.replace(/^\*\./, "").replace(/^\./, "");
    if (/^\[.*\]$/.test(s)) s = s.slice(1, -1);
    else if (/^[^:]+:\d+$/.test(s)) s = s.replace(/:\d+$/, "");
    return s;
  }

  function parseList(text) {
    const seen = new Set();
    const out = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      const body = line.replace(/(^|\s)#.*$/, ""); // comments: whole line or after a space
      for (const word of body.split(/[\s,]+/)) {
        const e = normalizeEntry(word);
        if (e && !seen.has(e)) {
          seen.add(e);
          out.push(e);
        }
      }
    }
    return out;
  }

  function ipv4ToInt(ip) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
    if (!m) return null;
    const parts = m.slice(1).map(Number);
    if (parts.some((p) => p > 255)) return null;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  }

  function inCidr(ip, cidr) {
    const [net, bitsStr] = cidr.split("/");
    const bits = Number(bitsStr);
    const a = ipv4ToInt(ip);
    const b = ipv4ToInt(net);
    if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
    if (bits === 0) return true;
    const mask = (~0 << (32 - bits)) >>> 0;
    return (a & mask) >>> 0 === (b & mask) >>> 0;
  }

  const PRIVATE_V4 = ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10"];

  /** Hosts that must never go through the tunnel (loopback, LAN). */
  function isLocal(host) {
    if (!host) return true;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal")) return true;
    if (ipv4ToInt(host) !== null) return PRIVATE_V4.some((c) => inCidr(host, c));
    if (host.includes(":")) {
      const h = host.toLowerCase();
      return h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd");
    }
    return !host.includes("."); // single-label intranet names
  }

  /** Does host match an entry: exact domain, any subdomain, exact IP, or IPv4 CIDR. */
  function matches(host, entry) {
    if (!entry) return false;
    if (entry.includes("/")) return inCidr(host, entry);
    return host === entry || host.endsWith("." + entry);
  }

  function matchesList(host, list) {
    return Array.isArray(list) && list.some((e) => matches(host, e));
  }

  /**
   * Decide whether a host goes through the VPN.
   * settings.mode: "exclude" — everything except the exclude list;
   *                "include" — only hosts in the include list.
   */
  function shouldTunnel(host, settings) {
    host = String(host || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (settings.bypassLocal !== false && isLocal(host)) return false;
    if (settings.mode === "include") return matchesList(host, settings.includeList);
    return !matchesList(host, settings.excludeList);
  }

  /** Registrable-ish domain for "add this site": drops a leading "www.". */
  function siteOf(host) {
    return String(host || "").toLowerCase().replace(/^www\./, "");
  }

  return { normalizeEntry, parseList, isLocal, matches, matchesList, shouldTunnel, siteOf };
})();

if (typeof module !== "undefined") module.exports = TTRules;
