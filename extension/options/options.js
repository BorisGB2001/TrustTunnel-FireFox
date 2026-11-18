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

function fillSettings() {
  const s = state.settings;
  for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === s.mode;
  $("excludeList").value = s.excludeList.join("\n");
  $("includeList").value = s.includeList.join("\n");
  for (const k of ["bypassLocal", "killSwitch", "webrtcProtect"]) $(k).checked = !!s[k];
}

$("saveBtn").addEventListener("click", async () => {
  const patch = {
    mode: document.querySelector('input[name="mode"]:checked')?.value || "exclude",
    excludeList: TTRules.parseList($("excludeList").value),
    includeList: TTRules.parseList($("includeList").value),
  };
  for (const k of ["bypassLocal", "killSwitch", "webrtcProtect"]) patch[k] = $(k).checked;
  try {
    state = await api("setSettings", { patch });
    fillSettings();
    Toast.ok(t("toastSaved"));
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
  } catch (e) {
    Toast.error(e.message);
  }
})();
