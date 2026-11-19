/*
 * TrustTunnel Browser Client — background (event page).
 *
 * TrustTunnel is HTTP CONNECT over TLS with Basic auth, so Firefox talks to the
 * server itself as to an HTTPS proxy (proxy.onRequest -> type "https").
 * Alternative: the local SOCKS5 listener of the official trusttunnel_client.
 *
 * Routing of a request = scope (all tabs / marked tabs + containers / private
 * windows, lib/scope.js) AND site lists (lib/rules.js).
 */
"use strict";

const HEALTH_ALARM = "tt-health";
const HEALTH_URL = "https://www.gstatic.com/generate_204";
const IP_URL = "https://api.ipify.org/?format=json";
const IP_NONCE_RE = /[?&]tt-ip=([a-z0-9]+)/;

const DEFAULTS = {
  enabled: false,
  profileId: null,
  profiles: [], // [{id, kind:"direct"|"socks", name, hostname, port, username, password, socksHost, socksPort, ...}]
  mode: "exclude", // site lists: "exclude" | "include"
  excludeList: [],
  includeList: [],
  bypassLocal: true,
  killSwitch: true,
  webrtcProtect: true,
  scope: "all", // where the VPN works: "all" | "tabs" | "private"
  inheritOpener: true, // tabs opened from a VPN tab get VPN too
  tablessRoute: "direct", // requests without a tab in "tabs" scope: "direct" | "vpn"
  vpnContainers: [], // cookieStoreIds whose tabs always use the VPN in "tabs" scope
};

let settings = { ...DEFAULTS };
let rt = { status: "off", error: null, latency: null, checkedAt: null, since: null };
let healthNonce = null; // marks our own health-check request
let authFails = 0;

// Tabs marked "VPN in this tab". Kept in storage.session: survives a restart of the
// background page, not of the browser (tab ids change then anyway).
const vpnTabs = new Set();
// tabId -> Promise of the one-time "inherit VPN from the opener tab" check.
const openerChecks = new Map();
// nonce -> request context of a "Check IP" request made on behalf of a tab.
const ipChecks = new Map();

const ready = (async () => {
  const stored = await browser.storage.local.get(Object.keys(DEFAULTS));
  settings = { ...DEFAULTS, ...stored };
  try {
    const s = await browser.storage.session.get(["rt", "vpnTabs"]);
    if (s.rt) rt = { ...rt, ...s.rt };
    if (Array.isArray(s.vpnTabs)) {
      const open = new Set((await browser.tabs.query({})).map((tab) => tab.id));
      for (const id of s.vpnTabs) if (open.has(id)) vpnTabs.add(id);
    }
  } catch (_) {}
  updateBadge();
})();

// ------------------------------------------------------------------ state helpers

const currentProfile = () => settings.profiles.find((p) => p.id === settings.profileId) || null;

const scopeCtx = () => ({
  scope: settings.scope,
  vpnTabs,
  vpnContainers: settings.vpnContainers,
  tablessRoute: settings.tablessRoute,
});

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
  notifyPages();
}

function notifyPages() {
  browser.runtime.sendMessage({ type: "stateChanged" }).catch(() => {});
}

// ------------------------------------------------------------------ toolbar badge

function statusBadge() {
  if (!settings.enabled) return { text: "", color: "#9e9e9e", title: t("titleOff"), icon: "icons/icon-off.svg" };
  if (rt.status === "on") return { text: "ON", color: "#2e7d32", title: t("titleOn"), icon: "icons/icon-on.svg" };
  if (rt.status === "error")
    return { text: "!", color: "#c62828", title: t("titleError", rt.error || ""), icon: "icons/icon-err.svg" };
  return { text: "…", color: "#ef6c00", title: t("titleConnecting"), icon: "icons/icon-off.svg" };
}

const ignoreErr = (p) => p && p.catch && p.catch(() => {});

function updateBadge() {
  let b = statusBadge();
  // Limited scope + connected: the global icon stays grey, VPN tabs get their own badge.
  if (settings.scope !== "all" && settings.enabled && rt.status === "on")
    b = { text: "", color: "#2e7d32", title: t(settings.scope === "private" ? "titleOnPrivate" : "titleOnTabs"), icon: "icons/icon-off.svg" };
  ignoreErr(browser.action.setBadgeText({ text: b.text }));
  ignoreErr(browser.action.setBadgeBackgroundColor({ color: b.color }));
  ignoreErr(browser.action.setTitle({ title: b.title }));
  ignoreErr(browser.action.setIcon({ path: b.icon }));
  refreshTabBadges();
}

function tabInScope(tab) {
  return TTScope.inScope({ tabId: tab.id, incognito: tab.incognito, cookieStoreId: tab.cookieStoreId }, scopeCtx());
}

function applyTabBadge(tab) {
  if (!tab || typeof tab.id !== "number" || tab.id < 0) return;
  const tabId = tab.id;
  if (settings.scope === "all" || !settings.enabled || !tabInScope(tab)) {
    // Back to the global badge.
    ignoreErr(browser.action.setBadgeText({ tabId, text: null }));
    ignoreErr(browser.action.setBadgeBackgroundColor({ tabId, color: null }));
    ignoreErr(browser.action.setTitle({ tabId, title: null }));
    ignoreErr(browser.action.setIcon({ tabId }));
    return;
  }
  const b = statusBadge();
  const on = rt.status === "on";
  ignoreErr(browser.action.setBadgeText({ tabId, text: on ? "VPN" : b.text }));
  ignoreErr(browser.action.setBadgeBackgroundColor({ tabId, color: b.color }));
  ignoreErr(browser.action.setTitle({ tabId, title: on ? t("titleTabVpn") : b.title }));
  ignoreErr(browser.action.setIcon({ tabId, path: b.icon }));
}

async function refreshTabBadges() {
  let tabs = [];
  try {
    tabs = await browser.tabs.query({});
  } catch (_) {}
  for (const tab of tabs) applyTabBadge(tab);
}

// ------------------------------------------------------------------ VPN tabs

async function persistVpnTabs() {
  try {
    await browser.storage.session.set({ vpnTabs: [...vpnTabs] });
  } catch (_) {}
}

async function setTabVpn(tabId, value) {
  if (typeof tabId !== "number" || tabId < 0) throw new Error(t("errNoTab"));
  if (value) vpnTabs.add(tabId);
  else vpnTabs.delete(tabId);
  openerChecks.set(tabId, Promise.resolve());
  await persistVpnTabs();
  try {
    applyTabBadge(await browser.tabs.get(tabId));
  } catch (_) {}
  // Marking a tab means "I want the VPN here": turn it on if it is off.
  if (value && !settings.enabled) await setEnabled(true);
  else notifyPages();
}

/** First request of a tab we have not seen: inherit VPN from its opener tab. */
function inheritFromOpener(tabId) {
  if (typeof tabId !== "number" || tabId < 0 || vpnTabs.has(tabId)) return null;
  if (!settings.inheritOpener) return null;
  let check = openerChecks.get(tabId);
  if (!check) {
    check = (async () => {
      try {
        const tab = await browser.tabs.get(tabId);
        if (tab.openerTabId != null && vpnTabs.has(tab.openerTabId)) {
          vpnTabs.add(tabId);
          await persistVpnTabs();
          applyTabBadge(tab);
        }
      } catch (_) {}
    })();
    openerChecks.set(tabId, check);
  }
  return check;
}

browser.tabs.onCreated.addListener(async (tab) => {
  await ready;
  if (settings.scope === "tabs") await inheritFromOpener(tab.id);
  applyTabBadge(tab);
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  openerChecks.delete(tabId);
  if (vpnTabs.delete(tabId)) await persistVpnTabs();
});

browser.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (!("status" in change) && !("url" in change)) return;
  await ready;
  applyTabBadge(tab);
});

/** Open a link in a new tab that uses the VPN from its very first request. */
async function openVpnTab(url, opener) {
  const tab = await browser.tabs.create({
    url: "about:blank",
    active: true,
    windowId: opener ? opener.windowId : undefined,
    index: opener ? opener.index + 1 : undefined,
    openerTabId: opener ? opener.id : undefined,
  });
  await setTabVpn(tab.id, true);
  await browser.tabs.update(tab.id, { url });
}

// ------------------------------------------------------------------ WebRTC

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
const BLACKHOLE = { type: "http", host: "127.0.0.1", port: 9 }; // kill switch without a server

// Firefox reuses open proxy connections; a key derived from the profile makes a
// changed server, login or password take effect at once instead of riding on old
// connections. A short FNV-1a hash, so the password itself is not exposed.
function isolationKey(p) {
  const src = [p.id, p.kind, p.hostname, p.port, p.username, p.password,
    p.socksHost, p.socksPort, p.socksUser, p.socksPass].join("\u0000");
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return "tt-" + h.toString(36);
}

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
      connectionIsolationKey: isolationKey(p),
    };
  }
  return {
    type: "https",
    host: p.hostname,
    port: Number(p.port) || 443,
    proxyAuthorizationHeader: basicAuth(p.username, p.password),
    failoverTimeout: 5,
    connectionIsolationKey: isolationKey(p),
  };
}

browser.proxy.onRequest.addListener(
  async (details) => {
    await ready;
    if (!settings.enabled) return DIRECT;
    const p = currentProfile();
    // Our own health probe always goes through the tunnel and never fails over.
    if (p && healthNonce && details.url.includes("tt-health=" + healthNonce)) return proxyFor(p);

    // "Check IP" from the popup is routed as if it came from that tab.
    let req = details;
    const ip = IP_NONCE_RE.exec(details.url);
    if (ip && ipChecks.has(ip[1])) req = { ...details, ...ipChecks.get(ip[1]) };
    else if (settings.scope === "tabs") await inheritFromOpener(details.tabId);
    if (!TTScope.inScope(req, scopeCtx())) return DIRECT;

    if (!p) return settings.killSwitch ? BLACKHOLE : DIRECT;
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
  rebuildMenus();
}

// ------------------------------------------------------------------ menus

let menusBuilding = Promise.resolve();

/** Link context menu + toolbar icon menu (VPN on/off, VPN in this tab, server). */
function rebuildMenus() {
  menusBuilding = menusBuilding.then(async () => {
    try {
      await browser.menus.removeAll();
      const tabsScope = settings.scope === "tabs";
      browser.menus.create({ id: "open-vpn-tab", title: t("menuOpenLinkVpn"), contexts: ["link"], visible: tabsScope });
      browser.menus.create({ id: "toggle-vpn", type: "checkbox", title: t("menuVpnOn"), contexts: ["action"], checked: settings.enabled });
      browser.menus.create({ id: "tab-vpn", type: "checkbox", title: t("menuTabVpn"), contexts: ["action"], visible: tabsScope });
      if (settings.profiles.length) {
        browser.menus.create({ id: "servers", title: t("menuServer"), contexts: ["action"] });
        for (const p of settings.profiles)
          browser.menus.create({
            id: "srv:" + p.id,
            parentId: "servers",
            type: "radio",
            title: p.name,
            contexts: ["action"],
            checked: p.id === settings.profileId,
          });
      }
    } catch (e) {
      console.warn("menus:", e);
    }
  });
  return menusBuilding;
}

browser.menus.onShown.addListener(async (info, tab) => {
  if (!info.contexts.includes("action") || !tab) return;
  await ready;
  await Promise.all([
    browser.menus.update("tab-vpn", { checked: vpnTabs.has(tab.id) }).catch(() => {}),
    browser.menus.update("toggle-vpn", { checked: settings.enabled }).catch(() => {}),
  ]);
  browser.menus.refresh();
});

browser.menus.onClicked.addListener(async (info, tab) => {
  await ready;
  try {
    if (info.menuItemId === "open-vpn-tab" && info.linkUrl) await openVpnTab(info.linkUrl, tab);
    else if (info.menuItemId === "toggle-vpn") await setEnabled(!settings.enabled);
    else if (info.menuItemId === "tab-vpn" && tab) await setTabVpn(tab.id, !vpnTabs.has(tab.id));
    else if (typeof info.menuItemId === "string" && info.menuItemId.startsWith("srv:"))
      await handlers.setSettings({ patch: { profileId: info.menuItemId.slice(4) } });
  } catch (e) {
    console.warn("menu action:", e);
  }
});

// ------------------------------------------------------------------ hotkeys

browser.commands.onCommand.addListener(async (command) => {
  await ready;
  try {
    if (command === "toggle-vpn") await setEnabled(!settings.enabled);
    else if (command === "toggle-tab-vpn" && settings.scope === "tabs") {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab) await setTabVpn(tab.id, !vpnTabs.has(tab.id));
    }
  } catch (e) {
    console.warn("command:", e);
  }
});

// ------------------------------------------------------------------ lifecycle

async function resume() {
  await ready;
  rebuildMenus();
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
  return { settings: s, profiles: profiles.map(publicProfile), runtime: rt, vpnTabs: [...vpnTabs] };
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
  rebuildMenus();
  if (settings.enabled && settings.profileId === p.id) await healthCheck();
  return { profile: publicProfile(p) };
}

async function deleteProfile({ id }) {
  const list = settings.profiles.filter((p) => p.id !== id);
  const patch = { profiles: list };
  if (settings.profileId === id) patch.profileId = list[0] ? list[0].id : null;
  await saveSettings(patch);
  rebuildMenus();
  if (settings.enabled) await (patch.profileId ? healthCheck() : setEnabled(false));
  return {};
}

/**
 * External IP as seen by a tab: the request is routed with that tab's context.
 * tab: {tabId, incognito, cookieStoreId} of the popup's active tab (optional).
 */
async function checkIp({ tab } = {}) {
  const nonce = Math.random().toString(36).slice(2);
  const ctx = tab ? { tabId: tab.tabId, incognito: !!tab.incognito, cookieStoreId: tab.cookieStoreId } : { tabId: -1 };
  ipChecks.set(nonce, ctx);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(IP_URL + "&tt-ip=" + nonce, { cache: "no-store", credentials: "omit", signal: ctrl.signal });
    const j = await r.json();
    const viaVpn =
      settings.enabled && TTScope.inScope(ctx, scopeCtx()) && TTRules.shouldTunnel("api.ipify.org", settings);
    return { ip: j.ip, viaVpn };
  } finally {
    clearTimeout(timer);
    ipChecks.delete(nonce);
  }
}

const handlers = {
  getState,
  async setEnabled({ value }) {
    await setEnabled(value);
    return getState();
  },
  async setSettings({ patch }) {
    const allowed = [
      "profileId", "mode", "excludeList", "includeList", "bypassLocal", "killSwitch", "webrtcProtect",
      "scope", "inheritOpener", "tablessRoute", "vpnContainers",
    ];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if ("excludeList" in clean) clean.excludeList = TTRules.parseList(clean.excludeList.join("\n"));
    if ("includeList" in clean) clean.includeList = TTRules.parseList(clean.includeList.join("\n"));
    if ("mode" in clean && !["exclude", "include"].includes(clean.mode)) clean.mode = "exclude";
    if ("scope" in clean && !TTScope.SCOPES.includes(clean.scope)) clean.scope = "all";
    if ("tablessRoute" in clean) clean.tablessRoute = clean.tablessRoute === "vpn" ? "vpn" : "direct";
    if ("inheritOpener" in clean) clean.inheritOpener = !!clean.inheritOpener;
    if ("vpnContainers" in clean)
      clean.vpnContainers = Array.isArray(clean.vpnContainers) ? clean.vpnContainers.filter((x) => typeof x === "string") : [];
    if ("profileId" in clean && clean.profileId && !settings.profiles.some((p) => p.id === clean.profileId))
      throw new Error(t("errNoSuchServer"));
    const changedServer = "profileId" in clean && clean.profileId !== settings.profileId;
    await saveSettings(clean);
    if ("webrtcProtect" in clean && settings.enabled) await applyWebRtc(true);
    if (["scope", "vpnContainers", "profileId"].some((k) => k in clean)) rebuildMenus();
    updateBadge();
    if (changedServer && settings.enabled) {
      authFails = 0;
      await setRuntime({ status: "connecting", error: null, since: null });
      await healthCheck();
    } else notifyPages();
    return getState();
  },
  async setTabVpn({ tabId, value }) {
    await setTabVpn(tabId, !!value);
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
