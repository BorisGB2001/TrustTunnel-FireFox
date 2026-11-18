#!/usr/bin/env python3
"""
End-to-end test of the extension against a live TrustTunnel server.

Starts Firefox (headless, throw-away profile) with Marionette, installs the
extension temporarily, imports the key via the settings page, turns the VPN on
and compares the external IP. The key is read from a file and never stored.

Close your regular Firefox first: a second instance may hang on macOS.

    python3 scripts/e2e-firefox.py <file with tt:// key> [--firefox PATH]
"""
import argparse
import base64
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT_DIR = os.path.join(PROJECT, "extension")
PORT = 28281


class Marionette:
    def __init__(self, port):
        for _ in range(100):
            try:
                self.s = socket.create_connection(("127.0.0.1", port), timeout=60)
                break
            except OSError:
                time.sleep(0.3)
        else:
            raise SystemExit("Marionette did not start (is another Firefox running?)")
        self.buf = b""
        self.id = 0
        self._read()  # greeting

    def _read(self):
        while b":" not in self.buf:
            self.buf += self.s.recv(65536)
        n, rest = self.buf.split(b":", 1)
        n = int(n)
        while len(rest) < n:
            rest += self.s.recv(65536)
        self.buf = rest[n:]
        return json.loads(rest[:n])

    def cmd(self, name, params=None):
        self.id += 1
        data = json.dumps([0, self.id, name, params or {}]).encode()
        self.s.sendall(str(len(data)).encode() + b":" + data)
        while True:
            msg = self._read()
            if msg[0] == 1 and msg[1] == self.id:
                if msg[2]:
                    raise RuntimeError("%s: %s" % (name, msg[2].get("message")))
                return msg[3]

    def js(self, script, *args, async_=False):
        name = "WebDriver:ExecuteAsyncScript" if async_ else "WebDriver:ExecuteScript"
        r = self.cmd(name, {"script": script, "args": list(args), "scriptTimeout": 60000})
        return r.get("value") if isinstance(r, dict) else r


# Runs inside moz-extension://…/options/options.html: talks to background like the UI does.
CALL = """
const [type, args, done] = [arguments[0], arguments[1], arguments[arguments.length - 1]];
browser.runtime.sendMessage(Object.assign({type}, args)).then(done, e => done({ok:false, error:String(e)}));
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keyfile")
    ap.add_argument("--firefox", default="/Applications/Firefox.app/Contents/MacOS/firefox")
    a = ap.parse_args()
    key = open(a.keyfile, encoding="utf-8").read().strip()

    direct_ip = urllib.request.urlopen("https://api.ipify.org", timeout=15).read().decode()
    print("Direct IP:", direct_ip)

    prof = tempfile.mkdtemp(prefix="tt-e2e-")
    with open(os.path.join(prof, "user.js"), "w") as f:
        f.write('user_pref("marionette.port", %d);\n' % PORT)
        f.write('user_pref("browser.shell.checkDefaultBrowser", false);\n')
        f.write('user_pref("datareporting.policy.dataSubmissionEnabled", false);\n')
        f.write('user_pref("app.update.disabledForTesting", true);\n')
    ff = subprocess.Popen(
        [a.firefox, "-marionette", "-headless", "-no-remote", "-profile", prof],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    ok = True
    try:
        m = Marionette(PORT)
        m.cmd("WebDriver:NewSession", {"capabilities": {}})
        addon = m.cmd("Addon:Install", {"path": EXT_DIR, "temporary": True})
        addon_id = addon.get("value") if isinstance(addon, dict) else addon
        print("Extension installed:", addon_id)

        m.cmd("Marionette:SetContext", {"value": "chrome"})
        uuids = json.loads(m.js("return Services.prefs.getStringPref('extensions.webextensions.uuids')"))
        base = "moz-extension://%s/" % uuids[addon_id]
        m.cmd("Marionette:SetContext", {"value": "content"})
        m.cmd("WebDriver:Navigate", {"url": base + "options/options.html"})

        def call(t, **kw):
            r = m.js(CALL, t, kw, async_=True)
            if not r or not r.get("ok"):
                raise RuntimeError("%s: %s" % (t, r and r.get("error")))
            return r["data"]

        def check(cond, label):
            nonlocal ok
            ok = ok and bool(cond)
            print(("  ✓ " if cond else "  ✗ ") + label)

        # 1. Parse the key with the same parser the UI uses, save the server.
        prof_data = m.js("return TTConfig.parseAny(arguments[0])", key)
        print("Key:", prof_data["name"], prof_data["hostname"], prof_data["port"], "warnings:", len(prof_data["warnings"]))
        call("saveProfile", profile=prof_data)

        # 2. Without trusting the self-signed certificate the tunnel must report an error.
        st = call("setEnabled", value=True)
        print("Without trusting the certificate:", st["runtime"]["status"], "-", st["runtime"]["error"])
        if prof_data.get("certificate"):
            check(st["runtime"]["status"] == "error", "untrusted certificate -> error, not a leak")

            # 3. Trust the certificate (what the user does via Settings → Certificates → Import).
            der_b64 = "".join(re.findall(r"^[A-Za-z0-9+/=]+$", prof_data["certificate"].split("-----END")[0], re.M))
            m.cmd("Marionette:SetContext", {"value": "chrome"})
            m.js(
                'Cc["@mozilla.org/security/x509certdb;1"].getService(Ci.nsIX509CertDB).addCertFromBase64(arguments[0], "C,,");',
                der_b64,
            )
            m.cmd("Marionette:SetContext", {"value": "content"})
            print("Server certificate trusted (temporary profile)")

        st = call("refresh")
        rt = st["runtime"]
        print("Status:", rt["status"], "latency", rt.get("latency"), "ms", rt.get("error") or "")
        check(rt["status"] == "on", "tunnel is up")

        ipinfo = call("checkIp")
        print("checkIp:", ipinfo)
        check(ipinfo["ip"] != direct_ip and ipinfo["viaVpn"], "extension IP differs from direct IP")

        # 4. Regular browsing in a tab goes through the tunnel.
        m.cmd("WebDriver:Navigate", {"url": "https://api.ipify.org/"})
        tab_ip = m.js("return document.body.innerText.trim()")
        print("IP in a tab:", tab_ip)
        check(tab_ip == ipinfo["ip"], "tab goes through the VPN")

        # 5. Split tunnelling: excluded site goes direct.
        m.cmd("WebDriver:Navigate", {"url": base + "options/options.html"})
        call("setSettings", patch={"excludeList": ["api.ipify.org"]})
        m.cmd("WebDriver:Navigate", {"url": "https://api.ipify.org/?x=1"})
        ex_ip = m.js("return document.body.innerText.trim()")
        print("IP for an excluded site:", ex_ip)
        check(ex_ip == direct_ip, "excluded site goes direct")

        # 6. Wrong password -> error state (no silent bypass with kill switch on).
        m.cmd("WebDriver:Navigate", {"url": base + "options/options.html"})
        call("setSettings", patch={"excludeList": []})
        st = call("getState")
        pid = st["settings"]["profileId"]
        call("saveProfile", profile={"id": pid, "kind": "direct", "name": prof_data["name"],
                                     "hostname": prof_data["hostname"], "port": prof_data["port"],
                                     "username": prof_data["username"], "password": "definitely-wrong"})
        st = call("refresh")
        print("Wrong password:", st["runtime"]["status"], "-", st["runtime"]["error"])
        check(st["runtime"]["status"] == "error", "wrong password -> error")
        m.cmd("WebDriver:Navigate", {"url": "https://api.ipify.org/?x=2"})
        leak = m.js("return document.body ? document.body.innerText.trim() : ''")
        check(direct_ip not in leak, "kill switch: direct IP does not leak on error")
    finally:
        ff.terminate()
        try:
            ff.wait(10)
        except subprocess.TimeoutExpired:
            ff.kill()
        shutil.rmtree(prof, ignore_errors=True)
    print("RESULT:", "all checks passed" if ok else "some checks FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
