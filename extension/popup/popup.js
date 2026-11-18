"use strict";

const $ = (id) => document.getElementById(id);
let state = null;
let currentHost = null;

const STATUS = {
  off: ["statusOff", ""],
  connecting: ["statusConnecting", "connecting"],
  on: ["statusOn", "on"],
  error: ["statusError", "error"],
};

function current() {
  return state.profiles.find((p) => p.id === state.settings.profileId) || null;
}

function render() {
  const { settings, runtime } = state;
  $("toggle").checked = settings.enabled;
  const key = settings.enabled ? runtime.status : "off";
  const [label, cls] = STATUS[key] || STATUS.off;
  $("statusText").textContent = t(label);
  $("dot").className = "dot " + cls;
  const p = current();
  let sub = "";
  if (key === "error") sub = runtime.error || "";
  else if (key === "on" && p)
    sub = t("popupOnlyFirefox", p.kind === "socks" ? "SOCKS5 " + p.socksHost + ":" + p.socksPort : p.hostname + ":" + p.port);
  else if (!state.profiles.length) sub = t("popupAddServer");
  $("statusSub").textContent = sub;

  const sel = $("profile");
  sel.textContent = "";
  if (!state.profiles.length) {
    sel.append(new Option(t("popupNoServers"), ""));
    sel.disabled = true;
  } else {
    sel.disabled = false;
    if (!settings.profileId) sel.append(new Option(t("popupChoose"), ""));
    for (const pr of state.profiles)
      sel.append(new Option(pr.name + (pr.kind === "socks" ? " · SOCKS5" : " · " + pr.hostname), pr.id));
    sel.value = settings.profileId || "";
  }
  $("mode").value = settings.mode;

  $("stats").hidden = key !== "on";
  $("lat").textContent = runtime.latency != null ? t("ms", runtime.latency) : "—";
  $("chk").textContent = fmtAgo(runtime.checkedAt);
  $("since").textContent = fmtSince(runtime.since);
  renderSite();
}

function renderSite() {
  if (!currentHost || !state) return;
  const { settings } = state;
  const local = TTRules.isLocal(currentHost);
  const tunneled = TTRules.shouldTunnel(currentHost, settings);
  $("siteBox").hidden = false;
  $("siteHost").textContent = currentHost;
  $("siteHost").title = currentHost;
  const route = $("siteRoute");
  route.textContent = t(!settings.enabled ? "routeVpnOff" : tunneled ? "routeVpn" : "routeDirect");
  route.className = "pill" + (settings.enabled && tunneled ? " vpn" : "");

  const btn = $("siteBtn");
  const site = TTRules.siteOf(currentHost);
  btn.disabled = local;
  if (local) {
    btn.textContent = t("siteLocal");
    btn.dataset.action = "";
  } else if (settings.mode === "include") {
    const inList = TTRules.matchesList(currentHost, settings.includeList);
    btn.textContent = t(inList ? "siteIncludeRemove" : "siteIncludeAdd", site);
    btn.dataset.action = inList ? "include:remove" : "include:add";
  } else {
    const inList = TTRules.matchesList(currentHost, settings.excludeList);
    btn.textContent = t(inList ? "siteExcludeRemove" : "siteExcludeAdd", site);
    btn.dataset.action = inList ? "exclude:remove" : "exclude:add";
  }
}

async function refresh() {
  state = await api("getState");
  render();
}

$("toggle").addEventListener("change", async (e) => {
  const value = e.target.checked;
  try {
    state = await api("setEnabled", { value });
    render();
    if (value && state.runtime.status === "on") Toast.ok(t("toastVpnOn"));
    else if (value && state.runtime.status === "error") Toast.error(state.runtime.error);
    else if (!value) Toast.ok(t("toastVpnOff"));
  } catch (err) {
    Toast.error(err.message);
    refresh();
  }
});

$("profile").addEventListener("change", async (e) => {
  try {
    state = await api("setSettings", { patch: { profileId: e.target.value || null } });
    render();
    if (state.settings.enabled && state.runtime.status === "error") Toast.error(state.runtime.error);
    else Toast.ok(t("toastServerSelected"));
  } catch (err) {
    Toast.error(err.message);
  }
});

$("mode").addEventListener("change", async (e) => {
  try {
    state = await api("setSettings", { patch: { mode: e.target.value } });
    render();
    Toast.ok(t("toastModeSaved"));
  } catch (err) {
    Toast.error(err.message);
  }
});

$("siteBtn").addEventListener("click", async (e) => {
  const [list, op] = (e.target.dataset.action || "").split(":");
  if (!list) return;
  try {
    await api("editList", { list, host: TTRules.siteOf(currentHost), add: op === "add" });
    await refresh();
    Toast.ok(t("toastListUpdated"));
  } catch (err) {
    Toast.error(err.message);
  }
});

$("ipBtn").addEventListener("click", async (e) => {
  e.target.disabled = true;
  try {
    const { ip, viaVpn } = await api("checkIp");
    Toast.ok(t(viaVpn ? "toastIpVpn" : "toastIpDirect", ip));
  } catch (err) {
    Toast.error(t("toastIpFailed", err.message));
  } finally {
    e.target.disabled = false;
  }
});

$("optBtn").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "stateChanged") refresh();
});

(async () => {
  applyI18n();
  try {
    await refresh();
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^(https?|wss?):/.test(tab.url)) {
      currentHost = new URL(tab.url).hostname;
      renderSite();
    }
    if (state.settings.enabled) {
      state = await api("refresh");
      render();
    }
  } catch (e) {
    Toast.error(e.message);
  }
})();
