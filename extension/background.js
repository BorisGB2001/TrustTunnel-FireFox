/*
 * TrustTunnel Browser Client — background (event page).
 *
 * TrustTunnel is HTTP CONNECT over TLS with Basic auth, so Firefox talks to the
 * server itself as to an HTTPS proxy (proxy.onRequest -> type "https").
 * Alternative: the local SOCKS5 listener of the official trusttunnel_client.
 */
"use strict";

const HEALTH_ALARM = "tt-health";
const HEALTH_URL = "https://www.gstatic.com/generate_204";

const DEFAULTS = {
  enabled: false,
  profileId: null,
  profiles: [], // [{id, kind:"direct"|"socks", name, hostname, port, username, password, socksHost, socksPort, ...}]
  mode: "exclude",
  excludeList: [],
  includeList: [],
  bypassLocal: true,
  killSwitch: true,
  webrtcProtect: true,
};

let settings = { ...DEFAULTS };
let rt = { status: "off", error: null, latency: null, checkedAt: null, since: null };
let healthNonce = null; // marks our own health-check request
let authFails = 0;

const ready = (async () => {
  const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
  settings = { ...DEFAULTS, ...stored };
  try {
    const s = await browser.storage.session.get("rt");
    if (s.rt) rt = { ...rt, ...s.rt };
  } catch (_) {}
  updateBadge();
})();

// ------------------------------------------------------------------ state helpers

const currentProfile = () => settings.profiles.find((p) => p.id === settings.profileId) || null;

async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await browser.storage.local.set(patch);
}

async function setRuntime(patch) {
  rt = { ...rt, ...patch };
  try {
    await browser.storage.session.set({ rt });
  } catch (_) {}
  updateBadge();
  browser.runtime.sendMessage({ type: "stateChanged" }).catch(() => {});
}

function updateBadge() {
  let text = "", color = "#9e9e9e", title = t("titleOff"), icon = "icons/icon-off.svg";
  if (settings.enabled) {
    if (rt.status === "on") {
      [text, color, title, icon] = ["ON", "#2e7d32", t("titleOn"), "icons/icon-on.svg"];
    } else if (rt.status === "connecting") {
      [text, color, title] = ["…", "#ef6c00", t("titleConnecting")];
    } else if (rt.status === "error") {
      [text, color, title, icon] = ["!", "#c62828", t("titleError", rt.error || ""), "icons/icon-err.svg"];
    }
  }
  browser.action.setBadgeText({ text });
  browser.action.setBadgeBackgroundColor({ color });
  browser.action.setTitle({ title });
  browser.action.setIcon({ path: icon });
}

async function applyWebRtc(on) {
  try {
    const setting = browser.privacy.network.webRTCIPHandlingPolicy;
    if (on && settings.webrtcProtect) await setting.set({ value: "disable_non_proxied_udp" });
    else await setting.clear({});
  } catch (e) {
    console.warn("WebRTC policy:", e);
  }
}

function basicAuth(user, pass) {
  const bytes = new TextEncoder().encode(user + ":" + pass);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "Basic " + btoa(bin);
}

// ------------------------------------------------------------------ proxy routing

const DIRECT = { type: "direct" };

function proxyFor(p) {
  if (p.kind === "socks") {
    return {
      type: "socks",
      host: p.socksHost || "127.0.0.1",
      port: Number(p.socksPort) || 1080,
      username: p.socksUser || undefined,
      password: p.socksPass || undefined,
      proxyDNS: true,
      failoverTimeout: 5,
    };
  }
  return {
    type: "https",
    host: p.hostname,
    port: Number(p.port) || 443,
    proxyAuthorizationHeader: basicAuth(p.username, p.password),
    failoverTimeout: 5,
  };
}

browser.proxy.onRequest.addListener(
  async (details) => {
    await ready;
    if (!settings.enabled) return DIRECT;
    const p = currentProfile();
    if (!p) return settings.killSwitch ? { type: "http", host: "127.0.0.1", port: 9 } : DIRECT;
    // Our own health probe always goes through the tunnel and never fails over.
    if (healthNonce && details.url.includes("tt-health=" + healthNonce)) return proxyFor(p);
    let host;
    try {
      host = new URL(details.url).hostname;
    } catch (_) {
      return DIRECT;
    }
    // The VPN server itself is always reached directly (e.g. opening it to check the certificate).
    if (p.kind !== "socks" && host === p.hostname) return DIRECT;
    if (!TTRules.shouldTunnel(host, settings)) return DIRECT;
    // Kill switch on: only the tunnel, the request fails if it is down.
    // Kill switch off: Firefox falls back to a direct connection.
    return settings.killSwitch ? proxyFor(p) : [proxyFor(p), DIRECT];
  },
  { urls: ["<all_urls>"] }
);

browser.proxy.onError.addListener((err) => console.warn("proxy error:", err && err.message));

// Fallback for 407: if the server ignores the preset header, answer the challenge.
browser.webRequest.onAuthRequired.addListener(
  async (details) => {
    await ready;
    const p = currentProfile();
    if (!details.isProxy || !settings.enabled || !p) return {};
    const sameHost = p.kind === "socks" || (details.challenger && details.challenger.host === p.hostname);
    if (!sameHost) return {};
    if (p.kind === "socks" || ++authFails > 3) {
      await setRuntime({ status: "error", error: t("errAuth407") });
      return { cancel: true };
    }
    return { authCredentials: { username: p.username, password: p.password } };
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

// ------------------------------------------------------------------ health check

// Firefox's own error code for the last health request (fetch only says "NetworkError").
let healthErrorCode = null;
browser.webRequest.onErrorOccurred.addListener(
  (d) => {
    if (healthNonce && d.url.includes("tt-health=" + healthNonce)) healthErrorCode = d.error;
  },
  { urls: [HEALTH_URL + "*"] }
);

const ERROR_HINTS = [
  [/SEC_ERROR_UNKNOWN_ISSUER|SELF_SIGNED|UNTRUSTED_ISSUER|CA_CERT_INVALID|SEC_ERROR_BAD_SIGNATURE/,
    "hintCert"],
  [/BAD_CERT_DOMAIN/, "hintCertDomain"],
  [/EXPIRED/, "hintCertExpired"],
  [/PROXY_AUTHENTICATION_FAILED|407/, "hintAuth"],
  [/UNKNOWN_PROXY_HOST|UNKNOWN_HOST/, "hintDns"],
  [/PROXY_CONNECTION_REFUSED|CONNECTION_REFUSED/, "hintRefused"],
  [/TIMEOUT|TIMED_OUT/, "hintTimeout"],
  [/NET_RESET|NET_INTERRUPT|SSL_ERROR|NS_ERROR_NET_PARTIAL_TRANSFER/,
    "hintTlsReset"],
  [/PROXY_BAD_GATEWAY|PROXY_GATEWAY_TIMEOUT|PROXY_FORBIDDEN/, "hintBadGateway"],
];

function explain(e, code) {
  const msg = e && e.message ? e.message : String(e);
  if (e && e.name === "AbortError") return t("errTimeout");
  const p = currentProfile();
  if (p && p.kind === "socks" && (!code || /CONNECTION_REFUSED|NetworkError/.test(code + msg)))
    return t("errSocks", (p.socksHost || "127.0.0.1") + ":" + (p.socksPort || 1080));
  if (code) {
    const hit = ERROR_HINTS.find(([re]) => re.test(code));
    return (hit ? t(hit[1]) : t("errConnectGeneric")) + " [" + code + "]";
  }
  if (/NetworkError/i.test(msg))
    return t("errNetwork");
  return msg;
}

async function healthCheck({ quiet = false } = {}) {
  if (!settings.enabled) return;
  const p = currentProfile();
  if (!p) {
    await setRuntime({ status: "error", error: t("errNoServer") });
    return;
  }
  if (!quiet && rt.status !== "on") await setRuntime({ status: "connecting", error: null });
  healthNonce = Math.random().toString(36).slice(2);
  healthErrorCode = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  const t0 = performance.now();
  try {
    const r = await fetch(HEALTH_URL + "?tt-health=" + healthNonce, {
      cache: "no-store",
      credentials: "omit",
      signal: ctrl.signal,
    });
    if (r.status >= 500) throw new Error(t("errHealthHttp", r.status));
    authFails = 0;
    await setRuntime({
      status: "on",
      error: null,
      latency: Math.round(performance.now() - t0),
      checkedAt: Math.floor(Date.now() / 1000),
      since: rt.status === "on" && rt.since ? rt.since : Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    if (rt.status === "error" && /407/.test(rt.error || "")) return; // keep the auth message
    // onErrorOccurred may fire just after fetch rejects.
    if (!healthErrorCode) await new Promise((r) => setTimeout(r, 300));
    console.warn("health check failed:", healthErrorCode, e);
    await setRuntime({ status: "error", error: explain(e, healthErrorCode), latency: null, since: null });
  } finally {
    clearTimeout(timer);
    healthNonce = null;
  }
}

async function setEnabled(value) {
  await saveSettings({ enabled: !!value });
  authFails = 0;
  if (value) {
    browser.alarms.create(HEALTH_ALARM, { periodInMinutes: 0.5 });
    await applyWebRtc(true);
    await healthCheck();
  } else {
    browser.alarms.clear(HEALTH_ALARM);
    await applyWebRtc(false);
    await setRuntime({ status: "off", error: null, latency: null, checkedAt: null, since: null });
  }
}

// ------------------------------------------------------------------ lifecycle

async function resume() {
  await ready;
  if (!settings.enabled) return;
  browser.alarms.create(HEALTH_ALARM, { periodInMinutes: 0.5 });
  await applyWebRtc(true);
  await healthCheck();
}

browser.runtime.onStartup.addListener(resume);
browser.runtime.onInstalled.addListener(async (details) => {
  await resume();
  if (details.reason === "install") browser.runtime.openOptionsPage();
});
browser.alarms.onAlarm.addListener(async (a) => {
  await ready;
  if (a.name === HEALTH_ALARM) await healthCheck({ quiet: true });
});

// ------------------------------------------------------------------ messages from popup/options

function publicProfile(p) {
  const { password, socksPass, ...rest } = p;
  return { ...rest, hasPassword: !!password, hasCert: !!p.certificate, certificate: undefined };
}

async function getState() {
  const { profiles, ...s } = settings;
  return { settings: s, profiles: profiles.map(publicProfile), runtime: rt };
}

function cleanProfile(input, old = {}) {
  const kind = input.kind === "socks" ? "socks" : "direct";
  const p = { ...old, ...input, kind };
  p.name = String(p.name || "").trim() || p.hostname || "TrustTunnel";
  p.hostname = String(p.hostname || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "");
  p.port = Number(p.port) || 443;
  p.username = String(p.username || "");
  // An empty password field in the form means "keep the stored one".
  p.password = input.password ? String(input.password) : old.password || "";
  p.socksHost = String(p.socksHost || "127.0.0.1").trim();
  p.socksPort = Number(p.socksPort) || 1080;
  p.socksUser = String(p.socksUser || "");
  p.socksPass = input.socksPass ? String(input.socksPass) : old.socksPass || "";
  if (kind === "direct") {
    if (!p.hostname) throw new Error(t("errHostRequired"));
    if (!p.username || !p.password) throw new Error(t("errCredsRequired"));
  }
  for (const port of [p.port, p.socksPort])
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(t("errPort"));
  delete p.hasPassword;
  delete p.hasCert;
  return p;
}

async function saveProfile({ profile }) {
  const list = [...settings.profiles];
  const idx = profile.id ? list.findIndex((x) => x.id === profile.id) : -1;
  const p = cleanProfile(profile, idx >= 0 ? list[idx] : {});
  if (idx >= 0) list[idx] = p;
  else {
    p.id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    list.push(p);
  }
  const patch = { profiles: list };
  if (!settings.profileId) patch.profileId = p.id;
  await saveSettings(patch);
  if (settings.enabled && settings.profileId === p.id) await healthCheck();
  return { profile: publicProfile(p) };
}

async function deleteProfile({ id }) {
  const list = settings.profiles.filter((p) => p.id !== id);
  const patch = { profiles: list };
  if (settings.profileId === id) patch.profileId = list[0] ? list[0].id : null;
  await saveSettings(patch);
  if (settings.enabled) await (patch.profileId ? healthCheck() : setEnabled(false));
  return {};
}

async function checkIp() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch("https://api.ipify.org?format=json", { cache: "no-store", signal: ctrl.signal });
    const j = await r.json();
    return { ip: j.ip, viaVpn: settings.enabled && TTRules.shouldTunnel("api.ipify.org", settings) };
  } finally {
    clearTimeout(timer);
  }
}

const handlers = {
  getState,
  async setEnabled({ value }) {
    await setEnabled(value);
    return getState();
  },
  async setSettings({ patch }) {
    const allowed = ["profileId", "mode", "excludeList", "includeList", "bypassLocal", "killSwitch", "webrtcProtect"];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if ("excludeList" in clean) clean.excludeList = TTRules.parseList(clean.excludeList.join("\n"));
    if ("includeList" in clean) clean.includeList = TTRules.parseList(clean.includeList.join("\n"));
    if ("mode" in clean && !["exclude", "include"].includes(clean.mode)) clean.mode = "exclude";
    if ("profileId" in clean && clean.profileId && !settings.profiles.some((p) => p.id === clean.profileId))
      throw new Error(t("errNoSuchServer"));
    const changedServer = "profileId" in clean && clean.profileId !== settings.profileId;
    await saveSettings(clean);
    if ("webrtcProtect" in clean && settings.enabled) await applyWebRtc(true);
    if (changedServer && settings.enabled) {
      authFails = 0;
      await setRuntime({ status: "connecting", error: null, since: null });
      await healthCheck();
    }
    return getState();
  },
  async parseConfig({ text, name }) {
    return { profile: TTConfig.parseAny(text, name) };
  },
  saveProfile,
  deleteProfile,
  async getCertificate({ id }) {
    const p = settings.profiles.find((x) => x.id === id);
    return { pem: (p && p.certificate) || "", hostname: p && p.hostname };
  },
  async editList({ list, host, add }) {
    const key = list === "include" ? "includeList" : "excludeList";
    const entry = TTRules.normalizeEntry(host);
    if (!entry) throw new Error(t("errEmptyDomain"));
    const cur = settings[key].filter((e) => e !== entry);
    if (add) cur.push(entry);
    await saveSettings({ [key]: cur });
    return {};
  },
  async refresh() {
    await healthCheck();
    return getState();
  },
  checkIp,
};

browser.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== browser.runtime.id || !msg || !handlers[msg.type]) return undefined;
  return ready
    .then(() => handlers[msg.type](msg))
    .then(
      (data) => ({ ok: true, data }),
      (e) => ({ ok: false, error: e && e.message ? e.message : String(e) })
    );
});
