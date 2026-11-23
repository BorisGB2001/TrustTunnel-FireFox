"use strict";

const $ = (id) => document.getElementById(id);
let state = null;
let editingId = null; // null = new profile
let parsed = null; // extra fields from the last parsed key (addresses, certificate, ...)

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ------------------------------------------------------------------ profile list

function renderProfiles() {
  const root = $("profiles");
  root.textContent = "";
  if (!state.profiles.length) {
    root.append(el("div", "empty", t("optNoServers")));
    $("editBox").open = true;
    return;
  }
  for (const p of state.profiles) {
    const row = el("div", "profile" + (p.id === state.settings.profileId ? " active" : ""));

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "profile";
    radio.checked = p.id === state.settings.profileId;
    radio.title = t("optUseServer");
    radio.addEventListener("change", () => selectProfile(p.id));

    const info = el("div");
    const name = el("div", "name", p.name);
    name.append(el("span", "badge", p.kind === "socks" ? "SOCKS5" : "HTTPS"));
    const meta =
      p.kind === "socks"
        ? [t("metaViaClient"), p.socksHost + ":" + p.socksPort]
        : [p.hostname + ":" + p.port, t("metaUser", p.username), p.hasCert ? t("metaOwnCert") : ""];
    info.append(name, el("div", "meta", meta.filter(Boolean).join(" · ")));

    const btns = el("div", "btns");
    const edit = el("button", "", t("btnEdit"));
    edit.type = "button";
    edit.addEventListener("click", () => startEdit(p));
    btns.append(edit);
    if (p.hasCert) {
      const cert = el("button", "", t("btnCert"));
      cert.type = "button";
      cert.title = t("btnCertTitle");
      cert.addEventListener("click", () => downloadCert(p));
      btns.append(cert);
    }
    const del = el("button", "danger", t("btnDelete"));
    del.type = "button";
    del.addEventListener("click", () => deleteProfile(p));
    btns.append(del);

    row.append(radio, info, btns);
    root.append(row);
  }
}

async function selectProfile(id) {
  try {
    state = await api("setSettings", { patch: { profileId: id } });
    renderProfiles();
    if (state.settings.enabled && state.runtime.status === "error") Toast.error(state.runtime.error);
    else Toast.ok(t(state.settings.enabled ? "toastServerSelectedChecked" : "toastServerSelected"));
  } catch (e) {
    Toast.error(e.message);
  }
}

async function deleteProfile(p) {
  if (!confirm(t("confirmDelete", p.name))) return;
  try {
    await api("deleteProfile", { id: p.id });
    state = await api("getState");
    if (editingId === p.id) resetForm();
    renderProfiles();
    Toast.ok(t("toastServerDeleted"));
  } catch (e) {
    Toast.error(e.message);
  }
}

async function downloadCert(p) {
  try {
    const { pem, hostname } = await api("getCertificate", { id: p.id });
    if (!pem) throw new Error(t("errNoCert"));
    const url = URL.createObjectURL(new Blob([pem + "\n"], { type: "application/x-pem-file" }));
    const a = el("a");
    a.href = url;
    a.download = (hostname || "trusttunnel") + ".pem";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    Toast.ok(t("toastCertSaved"));
  } catch (e) {
    Toast.error(e.message);
  }
}

// ------------------------------------------------------------------ add / edit form

function kind() {
  return document.querySelector('input[name="kind"]:checked').value;
}

function syncKind() {
  const k = kind();
  for (const n of document.querySelectorAll(".k-direct")) n.hidden = k !== "direct";
  for (const n of document.querySelectorAll(".k-socks")) n.hidden = k !== "socks";
}
for (const r of document.querySelectorAll('input[name="kind"]')) r.addEventListener("change", syncKind);

function setKind(k) {
  for (const r of document.querySelectorAll('input[name="kind"]')) r.checked = r.value === k;
  syncKind();
}

function showWarnings(list) {
  const box = $("warnings");
  box.textContent = "";
  box.hidden = !list || !list.length;
  if (box.hidden) return;
  box.append(el("b", "", t("warningsTitle")));
  const ul = el("ul");
  for (const w of list) ul.append(el("li", "", w));
  box.append(ul);
}

function fillFields(p) {
  $("fName").value = p.name || "";
  $("fHost").value = p.hostname || "";
  $("fPort").value = p.port || 443;
  $("fUser").value = p.username || "";
  $("fPass").value = p.password || "";
  $("fSHost").value = p.socksHost || "127.0.0.1";
  $("fSPort").value = p.socksPort || 1080;
  $("fSUser").value = p.socksUser || "";
  $("fSPass").value = p.socksPass || "";
  setKind(p.kind || "direct");
}

function resetForm() {
  editingId = null;
  parsed = null;
  fillFields({});
  $("impText").value = "";
  showWarnings(null);
  $("editTitle").textContent = t("optAddServer");
  $("cancelBtn").hidden = true;
  $("passHint").hidden = true;
}

function startEdit(p) {
  resetForm();
  editingId = p.id;
  fillFields(p);
  $("editTitle").textContent = t("optEditServer", p.name);
  $("cancelBtn").hidden = false;
  $("passHint").hidden = false;
  $("editBox").open = true;
  $("editBox").scrollIntoView({ behavior: "smooth", block: "start" });
}

function parseKey() {
  const text = $("impText").value.trim();
  if (!text) {
    Toast.error(t("errPasteKey"));
    return false;
  }
  try {
    const p = TTConfig.parseAny(text, $("fName").value.trim());
    parsed = p;
    fillFields(p);
    showWarnings(p.warnings);
    // If the config has a SOCKS listener and needs features the browser lacks, suggest SOCKS mode.
    if (p.socksPort && (p.certificate || p.upstream === "http3")) setKind("socks");
    return true;
  } catch (e) {
    Toast.error(e.message);
    return false;
  }
}

$("parseBtn").addEventListener("click", () => {
  if (parseKey()) Toast.ok(t("toastFieldsFilled"));
});

$("impFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 256 * 1024) {
    Toast.error(t("errFileTooBig"));
    return;
  }
  $("impText").value = await file.text();
  if (parseKey()) Toast.ok(t("toastFileRead"));
});

$("cancelBtn").addEventListener("click", resetForm);

$("saveProfileBtn").addEventListener("click", async () => {
  // A pasted key that was not parsed yet: parse it first.
  if (!parsed && !editingId && $("impText").value.trim() && !$("fHost").value.trim()) {
    if (!parseKey()) return;
  }
  const profile = {
    id: editingId || undefined,
    kind: kind(),
    name: $("fName").value.trim(),
    hostname: $("fHost").value.trim(),
    port: Number($("fPort").value),
    username: $("fUser").value,
    password: $("fPass").value,
    socksHost: $("fSHost").value.trim(),
    socksPort: Number($("fSPort").value),
    socksUser: $("fSUser").value,
    socksPass: $("fSPass").value,
  };
  if (parsed) {
    profile.addresses = parsed.addresses;
    profile.sni = parsed.sni;
    profile.certificate = parsed.certificate;
    profile.upstream = parsed.upstream;
  }
  $("saveProfileBtn").disabled = true;
  try {
    const res = await api("saveProfile", { profile });
    state = await api("getState");
    renderProfiles();
    const wasCert = parsed && parsed.certificate && profile.kind === "direct";
    resetForm();
    $("editBox").open = false;
    if (state.settings.enabled && state.settings.profileId === res.profile.id && state.runtime.status === "error")
      Toast.error(t("toastSavedButFailed", state.runtime.error));
    else Toast.ok(t("toastServerSaved", res.profile.name));
    if (wasCert) Toast.ok(t("toastImportCert"));
  } catch (e) {
    Toast.error(e.message);
  } finally {
    $("saveProfileBtn").disabled = false;
  }
});

// ------------------------------------------------------------------ settings form

// ------------------------------------------------------------------ VPN scope

function selectedScope() {
  return document.querySelector('input[name="scope"]:checked')?.value || "all";
}

function syncScope() {
  const scope = selectedScope();
  $("tabsOpts").hidden = scope !== "tabs";
}
for (const r of document.querySelectorAll('input[name="scope"]')) r.addEventListener("change", syncScope);

async function renderContainers() {
  const root = $("containers");
  root.textContent = "";
  let list = null;
  try {
    list = await browser.contextualIdentities.query({});
  } catch (_) {}
  if (!Array.isArray(list)) {
    root.append(el("div", "muted small", t("containersOff")));
    return;
  }
  if (!list.length) {
    root.append(el("div", "muted small", t("containersNone")));
    return;
  }
  const chosen = new Set(state.settings.vpnContainers || []);
  for (const c of list) {
    const label = el("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "container-box";
    box.value = c.cookieStoreId;
    box.checked = chosen.has(c.cookieStoreId);
    const dot = el("span", "cdot");
    dot.style.background = c.colorCode || "#888";
    label.append(box, dot, el("span", "", c.name));
    root.append(label);
  }
}

async function renderPrivateStatus() {
  const box = $("privStatus");
  let allowed = false;
  try {
    allowed = await browser.extension.isAllowedIncognitoAccess();
  } catch (_) {}
  box.textContent = "";
  box.append(el("span", allowed ? "ok-text" : "err-text", t(allowed ? "privAllowed" : "privNotAllowed")));
}

// "sessions" is asked for here, with the reason next to the button, not at install time.
const SESSIONS = { permissions: ["sessions"] };

async function renderRemember() {
  let has = false;
  try {
    has = await browser.permissions.contains(SESSIONS);
  } catch (_) {}
  const box = $("rememberStatus");
  box.textContent = "";
  box.append(el("span", has ? "ok-text" : "err-text", t(has ? "rememberOn" : "rememberOff")));
  $("rememberBtn").hidden = has;
}

$("rememberBtn").addEventListener("click", async () => {
  try {
    // Must be the first await of the click handler: Firefox wants a user action.
    const ok = await browser.permissions.request(SESSIONS);
    await renderRemember();
    if (ok) Toast.ok(t("toastRememberOn"));
    else Toast.error(t("toastRememberDenied"));
  } catch (e) {
    Toast.error(e.message);
  }
});

// ------------------------------------------------------------------ countries (GEO)

const geoSel = new Set();
const uiLang = browser.i18n.getUILanguage();
const COUNTRIES = TTGeo.CODES.map((code) => ({ code, name: TTGeo.nameOf(code, uiLang) })).sort((a, b) =>
  a.name.localeCompare(b.name, uiLang)
);

function selectedGeoMode() {
  return document.querySelector('input[name="geoMode"]:checked')?.value || "off";
}

function syncGeo() {
  $("geoOpts").hidden = selectedGeoMode() === "off";
  $("geoDnsUrlBox").hidden = $("geoDns").value !== "custom";
}
$("geoDns").addEventListener("change", syncGeo);
for (const r of document.querySelectorAll('input[name="geoMode"]')) r.addEventListener("change", syncGeo);

function renderGeoList() {
  const q = $("geoSearch").value.trim().toLowerCase();
  const onlySel = $("geoOnlySel").checked;
  const root = $("geoList");
  root.textContent = "";
  for (const c of COUNTRIES) {
    if (onlySel && !geoSel.has(c.code)) continue;
    if (q && !c.name.toLowerCase().includes(q) && c.code.toLowerCase() !== q) continue;
    const label = el("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = geoSel.has(c.code);
    box.addEventListener("change", () => {
      if (box.checked) geoSel.add(c.code);
      else geoSel.delete(c.code);
      renderGeoCount();
    });
    label.append(box, el("span", "", c.name), el("span", "code", c.code));
    root.append(label);
  }
  if (!root.childElementCount) root.append(el("div", "muted small", t("geoNothing")));
  renderGeoCount();
}

function renderGeoCount() {
  const names = COUNTRIES.filter((c) => geoSel.has(c.code)).map((c) => c.name);
  $("geoCount").textContent = names.length ? t("geoSelected", names.length, names.join(", ")) : t("geoNoneSelected");
}

function renderGeoDb() {
  const meta = state.settings.geoMeta;
  const box = $("geoDbStatus");
  box.textContent = "";
  box.append(
    meta
      ? el("span", "ok-text", t("geoDbOk", meta.count.toLocaleString(uiLang), new Date(meta.updatedAt * 1000).toLocaleDateString(uiLang)))
      : el("span", "err-text", t("geoDbMissing"))
  );
}

$("geoSearch").addEventListener("input", renderGeoList);
$("geoOnlySel").addEventListener("change", renderGeoList);
$("geoClear").addEventListener("click", () => {
  geoSel.clear();
  renderGeoList();
});

async function updateGeoDb() {
  const btn = $("geoUpdateBtn");
  btn.disabled = true;
  btn.textContent = t("geoUpdating");
  try {
    state = await api("geoUpdate");
    renderGeoDb();
    Toast.ok(t("toastGeoUpdated", state.settings.geoMeta.count.toLocaleString(uiLang)));
  } catch (e) {
    Toast.error(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t("geoUpdate");
  }
}
$("geoUpdateBtn").addEventListener("click", updateGeoDb);

async function renderHotkeys() {
  let cmds = [];
  try {
    cmds = await browser.commands.getAll();
  } catch (_) {}
  const parts = cmds.filter((c) => c.shortcut).map((c) => c.shortcut + " — " + c.description);
  $("hotkeys").textContent = (parts.length ? t("hotkeysList", parts.join("; ")) + " " : "") + t("hotkeysHint");
}

function fillSettings() {
  const s = state.settings;
  for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === s.mode;
  for (const r of document.querySelectorAll('input[name="scope"]')) r.checked = r.value === (s.scope || "all");
  $("inheritOpener").checked = s.inheritOpener !== false;
  $("tablessRoute").value = s.tablessRoute === "vpn" ? "vpn" : "direct";
  syncScope();
  $("excludeList").value = s.excludeList.join("\n");
  $("includeList").value = s.includeList.join("\n");
  for (const k of ["bypassLocal", "killSwitch", "webrtcProtect"]) $(k).checked = !!s[k];
  for (const r of document.querySelectorAll('input[name="geoMode"]')) r.checked = r.value === (s.geoMode || "off");
  geoSel.clear();
  for (const c of s.geoCountries || []) geoSel.add(c);
  $("geoDns").value = s.geoDns === "custom" || TTDoh.SERVICES[s.geoDns] ? s.geoDns : TTDoh.DEFAULT;
  $("geoDnsUrl").value = s.geoDnsUrl || "";
  syncGeo();
  renderGeoList();
  renderGeoDb();
  $("statsUrl").value = s.statsUrl || "";
  $("version").textContent = state.version ? "v" + state.version : "";
}

$("saveBtn").addEventListener("click", async () => {
  const patch = {
    mode: document.querySelector('input[name="mode"]:checked')?.value || "exclude",
    excludeList: TTRules.parseList($("excludeList").value),
    includeList: TTRules.parseList($("includeList").value),
  };
  for (const k of ["bypassLocal", "killSwitch", "webrtcProtect"]) patch[k] = $(k).checked;
  patch.scope = selectedScope();
  patch.inheritOpener = $("inheritOpener").checked;
  patch.tablessRoute = $("tablessRoute").value;
  const boxes = [...document.querySelectorAll(".container-box")];
  if (boxes.length) patch.vpnContainers = boxes.filter((b) => b.checked).map((b) => b.value);
  patch.geoMode = selectedGeoMode();
  patch.geoCountries = [...geoSel];
  patch.geoDns = $("geoDns").value;
  patch.geoDnsUrl = $("geoDnsUrl").value.trim();
  patch.statsUrl = $("statsUrl").value.trim();
  try {
    state = await api("setSettings", { patch });
    fillSettings();
    Toast.ok(t("toastSaved"));
    // Countries need the database: fetch it the first time they are switched on.
    if (state.settings.geoMode !== "off" && !state.settings.geoMeta) await updateGeoDb();
  } catch (e) {
    Toast.error(e.message);
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "stateChanged")
    api("getState").then((s) => {
      state = s;
      renderProfiles();
    });
});

(async () => {
  applyI18n();
  try {
    syncKind();
    state = await api("getState");
    fillSettings();
    renderProfiles();
    await Promise.all([renderContainers(), renderPrivateStatus(), renderHotkeys(), renderRemember()]);
  } catch (e) {
    Toast.error(e.message);
  }
})();
