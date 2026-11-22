#!/usr/bin/env python3
"""
AMO screenshots (1280x800 PNG) of the extension in a real headless Firefox.
Demo data only: the "connected" state comes from the local fake TrustTunnel server of
e2e-firefox.py, reached under a made-up name (ams.vpn.example.com -> 127.0.0.1 via
network.dns.localDomains), so no real hosts or credentials appear.

    python3 scripts/amo-screenshots.py [--lang en|ru] [--firefox <path to firefox binary>]

Close your regular Firefox first (or pass a copy of Firefox.app with --firefox).
Output: amo/images/<lang>-*.png
"""
import argparse
import base64
import importlib.util
import json
import os
import shutil
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("e2e", os.path.join(HERE, "e2e-firefox.py"))
e2e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e2e)

W, H = 1280, 800
DEMO_HOST = "ams.vpn.example.com"
TEXT = {
    "en": ("Browser-only VPN<br>for your TrustTunnel server",
           "VPN in every tab, only in tabs you mark, in chosen containers or only in private windows. "
           "The rest of the system is untouched."),
    "ru": ("VPN только для браузера<br>через ваш сервер TrustTunnel",
           "VPN во всех вкладках, только в отмеченных, в выбранных контейнерах или только в приватных окнах. "
           "Остальная система не затрагивается."),
}


def one_locale_copy(lang, work):
    """Extension copy with a single locale: Firefox picks the UI locale, not ours."""
    ext = os.path.join(work, "ext")
    shutil.copytree(e2e.EXT_DIR, ext)
    for loc in os.listdir(os.path.join(ext, "_locales")):
        if loc != lang:
            shutil.rmtree(os.path.join(ext, "_locales", loc))
    mf_path = os.path.join(ext, "manifest.json")
    mf = json.load(open(mf_path, encoding="utf-8"))
    mf["default_locale"] = lang
    json.dump(mf, open(mf_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return ext


def save_png(b64, path):
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))
    print(path)


def shoot(firefox, lang, out):
    work = tempfile.mkdtemp(prefix="tt-amo-")
    srv = e2e.FakeTrustTunnel(work, user="alice", password="demo-password", hostname=DEMO_HOST)
    r = e2e.Run(firefox, ext_dir=one_locale_copy(lang, work),
                prefs={"network.dns.localDomains": DEMO_HOST, "intl.locale.requested": lang})
    m = r.m
    try:
        r.trust_cert(srv.der_b64())
        for name, host in (("Amsterdam", DEMO_HOST), ("Frankfurt", "fra.vpn.example.com")):
            r.call("saveProfile", profile={"kind": "direct", "name": name, "hostname": host,
                                           "port": srv.port, "username": "alice", "password": "demo-password"})
        st = r.call("getState")
        ams = next(p for p in st["profiles"] if p["name"] == "Amsterdam")
        r.call("setSettings", patch={
            "profileId": ams["id"], "scope": "tabs",
            "excludeList": ["mybank.example", "intranet.example.com", "192.168.0.0/16"],
            "includeList": ["youtube.com", "googlevideo.com", "instagram.com"],
        })
        st = r.call("setEnabled", value=True)
        print(lang, "status:", st["runtime"]["status"], st["runtime"].get("error") or "")

        # A site tab marked "VPN in this tab"; the popup reads the active tab.
        site = r.open_tab("https://example.com/", active=True)
        r.call("setTabVpn", tabId=site, value=True)
        time.sleep(1.5)

        # 1. Popup on a branded background. The popup page is loaded in a background tab,
        #    so the active tab (example.com) is what it describes.
        handles_before = set(m.cmd("WebDriver:GetWindowHandles"))
        r.ext("await browser.tabs.create({url: browser.runtime.getURL('popup/popup.html'), active: false});")
        time.sleep(1)
        popup = (set(m.cmd("WebDriver:GetWindowHandles")) - handles_before).pop()
        m.cmd("WebDriver:SwitchToWindow", {"handle": popup, "focus": False})
        m.cmd("WebDriver:SetWindowRect", {"width": 1600, "height": 1200})
        time.sleep(1.5)
        # A background tab does not run CSS transitions: switch them off so the toggles show
        # their real state; show the usual port 443 instead of the fake server's random one.
        m.js("""const st = document.createElement('style');
                st.textContent = '*,*::before{transition:none !important}';
                document.head.append(st);
                const t = document.getElementById('toggle'); t.checked = !t.checked; t.checked = !t.checked;
                const sub = document.getElementById('statusSub');
                sub.textContent = sub.textContent.replace(/:\\d+$/, ':443');""")
        time.sleep(0.5)
        popup_png = el_shot(m, "body")
        dark = m.js("return matchMedia('(prefers-color-scheme: dark)').matches")

        hero, sub = TEXT[lang]
        m.cmd("WebDriver:Navigate", {"url": "about:blank"})
        m.js("""document.open(); document.write(arguments[0]); document.close();""", f"""<!doctype html><meta charset="utf-8">
<style>
 html,body{{margin:0}}
 body{{width:{W}px;height:{H}px;display:flex;align-items:center;gap:72px;padding:0 96px;box-sizing:border-box;
      font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:linear-gradient(135deg,#0f3d2a,#1f8a4c);color:#fff}}
 h1{{font-size:46px;line-height:1.15;margin:0 0 20px;font-weight:700}}
 p{{font-size:22px;line-height:1.45;margin:0;color:#d6f2e2;max-width:560px}}
 .shot{{flex:none;border-radius:14px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.45);background:{'#1e1f22' if dark else '#fff'}}}
 .shot img{{display:block;width:368px}}
</style>
<div><h1>{hero}</h1><p>{sub}</p></div>
<div class="shot"><img src="data:image/png;base64,{popup_png}"></div>""")
        time.sleep(0.8)
        save_png(el_shot(m, "body"), os.path.join(out, f"{lang}-1-popup.png"))

        # 2. Settings: servers.
        m.cmd("WebDriver:Navigate", {"url": r.base + "options/options.html"})
        time.sleep(1.2)
        # Fixed 1280x800 page: the headless window size is unreliable, so the root element
        # gets the exact size and is the scroll container; the shot is taken of it.
        m.js("""const st = document.createElement('style');
                st.textContent = 'html{width:%dpx;height:%dpx;overflow:hidden}';
                document.head.append(st);
                // the fake server's random port -> the usual 443 (demo data)
                const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                for (let n; (n = w.nextNode());)
                  n.nodeValue = n.nodeValue.replace(/(vpn\\.example\\.com):\\d+/g, '$1:443');""" % (W, H))
        time.sleep(0.4)
        save_png(el_shot(m, "html"), os.path.join(out, f"{lang}-2-servers.png"))

        # 3. Settings: where the VPN works (scope, containers, inheritance).
        m.js("""const h = [...document.querySelectorAll('h2')].find(x => x.dataset.i18n === 'optScope');
                // the shot is of the page top, so hide what is above this card instead of scrolling
                const sec = h && h.closest('section');
                for (let e = sec && sec.previousElementSibling; e; e = e.previousElementSibling) { e.hidden = true; e.dataset.shotHidden = '1'; }
                if (sec) sec.style.marginTop = '24px';""")
        time.sleep(0.6)
        save_png(el_shot(m, "html"), os.path.join(out, f"{lang}-3-scope.png"))

        # 4. Settings: add a server (import form open; the servers card is at the top).
        m.js("""document.querySelectorAll('[data-shot-hidden]').forEach(e => { e.hidden = false; });
                const d = document.getElementById('editBox');
                if (d) d.open = true;""")
        time.sleep(0.6)
        save_png(el_shot(m, "html"), os.path.join(out, f"{lang}-4-add-server.png"))
    finally:
        r.close()
        shutil.rmtree(work, ignore_errors=True)


def el_shot(m, css):
    """PNG (base64) of one element, independent of the window size."""
    el = m.cmd("WebDriver:FindElement", {"using": "css selector", "value": css})
    el = el.get("value", el)
    v = m.cmd("WebDriver:TakeScreenshot", {"id": list(el.values())[0], "full": False, "hash": False})
    return v.get("value") if isinstance(v, dict) else v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", choices=["en", "ru"], action="append")
    ap.add_argument("--firefox", default="/Applications/Firefox.app/Contents/MacOS/firefox")
    a = ap.parse_args()
    out = os.path.join(e2e.PROJECT, "amo", "images")
    os.makedirs(out, exist_ok=True)
    for lang in a.lang or ["en"]:
        shoot(a.firefox, lang, out)


if __name__ == "__main__":
    main()
