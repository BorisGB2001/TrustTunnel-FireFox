#!/usr/bin/env python3
"""
End-to-end tests of the extension in a real Firefox (headless, throw-away profile,
driven over Marionette).

  --fake            local fake TrustTunnel server (HTTPS proxy with Basic auth and a
                    self-signed certificate) that logs every CONNECT. Checks the
                    "only marked tabs" scope: marked tab via VPN, neighbour tab
                    direct, child tab inherits, closing a tab clears its mark,
                    excluded site in a VPN tab goes direct, wrong password -> error.
  <keyfile>         live server from a tt:// key: IP changes through the tunnel,
                    excluded site goes direct, kill switch on wrong password.
                    The key is read from the file and never stored.

Close your regular Firefox first: a second instance may hang on macOS.

    python3 scripts/e2e-firefox.py --fake
    python3 scripts/e2e-firefox.py <file with tt:// key>
"""
import argparse
import base64
import json
import os
import re
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT_DIR = os.path.join(PROJECT, "extension")
MARIONETTE_PORT = 28281


# ---------------------------------------------------------------- Marionette client

class Marionette:
    def __init__(self, port):
        for _ in range(100):
            try:
                self.s = socket.create_connection(("127.0.0.1", port), timeout=90)
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
# Runs any extension API code in the options page (has the extension's permissions).
EXT = """
const [code, args, done] = [arguments[0], arguments[1], arguments[arguments.length - 1]];
(async () => (new Function("args", "return (async () => {" + code + "})()"))(args))()
  .then(v => done({ok:true, v}), e => done({ok:false, error:String(e)}));
"""


# ---------------------------------------------------------------- fake TrustTunnel server

class FakeTrustTunnel:
    """HTTPS proxy: TLS + HTTP/1.1 CONNECT with Basic auth, 407 on bad credentials."""

    def __init__(self, workdir, user="tester", password="secret-pass", hostname="localhost"):
        self.user, self.password = user, password
        self.log = []  # CONNECT targets (host) that were accepted
        self.rejected = 0
        # Firefox rejects a CA certificate used as the server certificate
        # (MOZILLA_PKIX_ERROR_CA_CERT_USED_AS_END_ENTITY), so make a throwaway test CA
        # and a localhost certificate signed by it; the test trusts only the CA.
        self.cert = os.path.join(workdir, "fake-ca.pem")
        ca_key = os.path.join(workdir, "fake-ca-key.pem")
        leaf = os.path.join(workdir, "fake-cert.pem")
        key = os.path.join(workdir, "fake-key.pem")
        csr = os.path.join(workdir, "fake.csr")
        ext = os.path.join(workdir, "fake.ext")
        with open(ext, "w") as f:
            f.write("subjectAltName=DNS:%s\n" % hostname)
            f.write("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n"
                    "extendedKeyUsage=serverAuth\n")
        ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"]
        for cmd in (
            ["openssl", "req", "-x509", *ec, "-keyout", ca_key, "-out", self.cert, "-days", "2",
             "-subj", "/CN=TrustTunnel e2e test CA", "-addext", "basicConstraints=critical,CA:TRUE",
             "-addext", "keyUsage=critical,keyCertSign"],
            ["openssl", "req", *ec, "-keyout", key, "-out", csr, "-subj", "/CN=" + hostname],
            ["openssl", "x509", "-req", "-in", csr, "-CA", self.cert, "-CAkey", ca_key, "-CAcreateserial",
             "-out", leaf, "-days", "2", "-extfile", ext],
        ):
            subprocess.run(cmd, check=True, capture_output=True)
        self.ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.ctx.load_cert_chain(leaf, key)
        self.ctx.set_alpn_protocols(["http/1.1"])
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(64)
        self.port = self.sock.getsockname()[1]
        self.expected = "Basic " + base64.b64encode(("%s:%s" % (user, password)).encode()).decode()
        threading.Thread(target=self._accept, daemon=True).start()

    def der_b64(self):
        pem = open(self.cert).read()
        return "".join(l for l in pem.splitlines() if l and not l.startswith("-----"))

    def _accept(self):
        while True:
            try:
                c, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(c,), daemon=True).start()

    def _handle(self, raw):
        try:
            c = self.ctx.wrap_socket(raw, server_side=True)
        except (ssl.SSLError, OSError):
            raw.close()
            return
        try:
            while True:
                head = b""
                while b"\r\n\r\n" not in head:
                    chunk = c.recv(4096)
                    if not chunk:
                        return
                    head += chunk
                lines = head.split(b"\r\n\r\n", 1)[0].decode("latin-1").split("\r\n")
                method, target = lines[0].split(" ")[:2]
                hdrs = {l.split(":", 1)[0].strip().lower(): l.split(":", 1)[1].strip() for l in lines[1:] if ":" in l}
                if method != "CONNECT":
                    c.sendall(b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n")
                    return
                if hdrs.get("proxy-authorization") != self.expected:
                    self.rejected += 1
                    c.sendall(b'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="tt"\r\n'
                              b"Content-Length: 0\r\n\r\n")
                    continue  # keep-alive: the client may retry with credentials
                host, port = target.rsplit(":", 1)
                try:
                    up = socket.create_connection((host, int(port)), timeout=15)
                except OSError:
                    c.sendall(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                    return
                self.log.append(host)
                c.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
                self._pipe(c, up)
                return
        except (OSError, ValueError, IndexError):
            pass
        finally:
            try:
                c.close()
            except OSError:
                pass

    @staticmethod
    def _pipe(a, b):
        def copy(src, dst):
            try:
                while True:
                    d = src.recv(65536)
                    if not d:
                        break
                    dst.sendall(d)
            except OSError:
                pass
            for s in (src, dst):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
        t = threading.Thread(target=copy, args=(b, a), daemon=True)
        t.start()
        copy(a, b)
        t.join(5)

    def seen(self, host):
        return host in self.log


# ---------------------------------------------------------------- harness

class Run:
    def __init__(self, firefox, ext_dir=EXT_DIR, prefs=None):
        self.ok = True
        self.prof = tempfile.mkdtemp(prefix="tt-e2e-")
        with open(os.path.join(self.prof, "user.js"), "w") as f:
            f.write('user_pref("marionette.port", %d);\n' % MARIONETTE_PORT)
            f.write('user_pref("browser.shell.checkDefaultBrowser", false);\n')
            f.write('user_pref("datareporting.policy.dataSubmissionEnabled", false);\n')
            f.write('user_pref("app.update.disabledForTesting", true);\n')
            f.write('user_pref("browser.startup.homepage_override.mstone", "ignore");\n')
            f.write('user_pref("network.dns.disablePrefetch", true);\n')
            f.write('user_pref("network.prefetch-next", false);\n')
            f.write('user_pref("network.http.speculative-parallel-limit", 0);\n')
            for k, v in (prefs or {}).items():
                f.write("user_pref(%s, %s);\n" % (json.dumps(k), json.dumps(v)))
        self.ff = subprocess.Popen(
            [firefox, "-marionette", "-headless", "-no-remote", "--remote-allow-system-access", "-profile", self.prof],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            # Firefox 150+: chrome-context access needs this variable, the flag alone is not enough.
            env=dict(os.environ, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS="1"),
        )
        try:
            self.m = Marionette(MARIONETTE_PORT)
            self.m.cmd("WebDriver:NewSession", {"capabilities": {"timeouts": {"script": 90000}}})
        except Exception:
            self.ff.kill()  # do not leave a headless Firefox holding the Marionette port
            raise
        addon = self.m.cmd("Addon:Install", {"path": ext_dir, "temporary": True})
        self.addon_id = addon.get("value") if isinstance(addon, dict) else addon
        print("Extension installed:", self.addon_id)
        self.m.cmd("Marionette:SetContext", {"value": "chrome"})
        uuids = json.loads(self.m.js("return Services.prefs.getStringPref('extensions.webextensions.uuids')"))
        self.base = "moz-extension://%s/" % uuids[self.addon_id]
        self.m.cmd("Marionette:SetContext", {"value": "content"})
        self.options()

    def options(self):
        self.m.cmd("WebDriver:Navigate", {"url": self.base + "options/options.html"})

    def call(self, t, **kw):
        r = self.m.js(CALL, t, kw, async_=True)
        if not r or not r.get("ok"):
            raise RuntimeError("%s: %s" % (t, r and r.get("error")))
        return r["data"]

    def ext(self, code, **args):
        r = self.m.js(EXT, code, args, async_=True)
        if not r or not r.get("ok"):
            raise RuntimeError("ext: %s" % (r and r.get("error")))
        return r.get("v")

    def trust_cert(self, der_b64):
        self.m.cmd("Marionette:SetContext", {"value": "chrome"})
        self.m.js('Cc["@mozilla.org/security/x509certdb;1"].getService(Ci.nsIX509CertDB).addCertFromBase64(arguments[0], "C,,");', der_b64)
        self.m.cmd("Marionette:SetContext", {"value": "content"})

    def open_tab(self, url, **opts):
        """Create a tab via the extension API and wait until it has loaded. Returns its id."""
        return self.ext(
            """
            const tab = await browser.tabs.create(Object.assign({url: args.url, active: false}, args.opts));
            for (let i = 0; i < 150; i++) {
              const t = await browser.tabs.get(tab.id);
              if (t.status === "complete" && (args.url === "about:blank" || t.url !== "about:blank")) break;
              await new Promise(r => setTimeout(r, 100));
            }
            return tab.id;""",
            url=url, opts=opts,
        )

    def check(self, cond, label):
        self.ok = self.ok and bool(cond)
        print(("  ✓ " if cond else "  ✗ ") + label)

    def close(self):
        self.ff.terminate()
        try:
            self.ff.wait(10)
        except subprocess.TimeoutExpired:
            self.ff.kill()
        shutil.rmtree(self.prof, ignore_errors=True)


# ---------------------------------------------------------------- fake-server scenario

def run_fake(firefox):
    work = tempfile.mkdtemp(prefix="tt-fake-")
    srv = FakeTrustTunnel(work)
    print("Fake TrustTunnel server on localhost:%d" % srv.port)
    r = Run(firefox)
    try:
        r.trust_cert(srv.der_b64())
        r.call("saveProfile", profile={"kind": "direct", "name": "fake", "hostname": "localhost", "port": srv.port,
                                       "username": srv.user, "password": srv.password})
        r.call("setSettings", patch={"scope": "tabs", "excludeList": ["example.edu"]})
        st = r.call("setEnabled", value=True)
        print("Status:", st["runtime"]["status"], st["runtime"].get("error") or "")
        r.check(st["runtime"]["status"] == "on", "tunnel is up (health check through the fake server)")

        # Marked tab: mark it before navigating, like "Open link in a VPN tab" does.
        a = r.open_tab("about:blank")
        r.call("setTabVpn", tabId=a, value=True)
        r.ext("await browser.tabs.update(args.id, {url: 'https://example.com/'});"
              "for (let i=0;i<150;i++){const t=await browser.tabs.get(args.id); if(t.status==='complete'&&t.url.startsWith('https://example.com'))break; await new Promise(r=>setTimeout(r,100));}", id=a)
        r.check(srv.seen("example.com"), "marked tab goes through the VPN (example.com)")

        b = r.open_tab("https://example.org/")
        r.check(not srv.seen("example.org"), "neighbour tab goes direct (example.org)")

        child = r.open_tab("https://example.net/", openerTabId=a)
        st = r.call("getState")
        r.check(srv.seen("example.net"), "child tab of a VPN tab goes through the VPN (example.net)")
        r.check(child in st["vpnTabs"], "child tab is marked")

        # Site list still applies inside a VPN tab.
        r.ext("await browser.tabs.update(args.id, {url: 'https://example.edu/'}); await new Promise(r=>setTimeout(r,3000));", id=a)
        r.check(not srv.seen("example.edu"), "excluded site in a VPN tab goes direct (example.edu)")

        # The mark stays on the tab when it navigates elsewhere.
        r.ext("await browser.tabs.update(args.id, {url: 'https://www.iana.org/'}); await new Promise(r=>setTimeout(r,4000));", id=a)
        r.check(srv.seen("www.iana.org"), "VPN stays on the tab after navigating to another site")

        # Closing clears the mark.
        r.ext("await browser.tabs.remove(args.id); await new Promise(r=>setTimeout(r,500));", id=a)
        st = r.call("getState")
        r.check(a not in st["vpnTabs"], "closing a tab removes it from the VPN list")

        # IP check from the popup is routed as that tab.
        r.check(r.call("checkIp", tab={"tabId": b}, host="example.org")["tabVia"] == "direct", "Check IP for a direct tab reports direct")

        # Check IP: one request through the server, one forced direct (not seen by the server).
        before = srv.log.count("api.ipify.org")
        ipr = r.call("checkIp", tab={"tabId": b}, host="example.org")
        print("checkIp:", {k: (v and (v.get("ip") or v.get("error"))) if isinstance(v, dict) else v for k, v in ipr.items()})
        r.check(ipr["vpn"] and ipr["vpn"].get("ip") and ipr["direct"].get("ip"), "Check IP returns the address with VPN and without it")
        # The earlier check may have left a tunnel to ipify open, so a new CONNECT is optional;
        # what matters: the VPN request used the server at least once, the direct one never did.
        r.check(srv.log.count("api.ipify.org") >= 1 and srv.log.count("api.ipify.org") - before <= 1,
                "the VPN request went through the server, the direct one did not")
        r.check(ipr["ipInfo"] is False and "info" not in ipr["direct"], "no IP details are requested unless enabled")

        # Countries: download the database, then send one country direct and the rest via VPN.
        st = r.call("geoUpdate")
        meta = st["settings"]["geoMeta"]
        print("Country database:", meta and meta["count"], "ranges")
        r.check(meta and meta["count"] > 50000, "country database downloaded")
        r.call("setSettings", patch={"scope": "all", "excludeList": [], "geoMode": "direct", "geoCountries": []})
        found = {}
        for h in ("ya.ru", "www.rki.de", "www.jaist.ac.jp", "www.iana.org", "www.uio.no"):
            c = r.call("routeInfo", host=h)["country"]
            print("  country of", h, "=", c)
            if c and c not in found.values():
                found[h] = c
        hosts = list(found)
        r.check(srv.seen("cloudflare-dns.com"), "site names are resolved through the VPN (DNS over HTTPS via the server)")
        # The DNS service is a setting: Google, then a custom URL (AdGuard's public server).
        r.call("setSettings", patch={"geoDns": "google"})
        cg = r.call("routeInfo", host="www.kth.se")["country"]
        r.check(cg and srv.seen("dns.google"), "Google DNS is used through the VPN (www.kth.se = %s)" % cg)
        r.call("setSettings", patch={"geoDns": "custom", "geoDnsUrl": "https://unfiltered.adguard-dns.com/dns-query"})
        ca = r.call("routeInfo", host="www.kth.se")["country"]
        r.check(ca == cg and srv.seen("unfiltered.adguard-dns.com"), "a custom DNS-over-HTTPS server is used through the VPN")
        try:
            r.call("setSettings", patch={"geoDns": "custom", "geoDnsUrl": "http://dns.example/dns-query"})
            r.check(False, "a custom DNS address without https is rejected")
        except RuntimeError:
            r.check(True, "a custom DNS address without https is rejected")
        r.call("setSettings", patch={"geoDns": "cloudflare", "geoDnsUrl": ""})
        if len(hosts) < 2:
            r.check(False, "need two test sites in different countries (DNS failed?)")
        else:
            ha, hb = hosts[0], hosts[1]
            r.call("setSettings", patch={"geoCountries": [found[ha]]})
            na, nb = srv.log.count(ha), srv.log.count(hb)
            ta = r.open_tab("https://%s/" % ha)
            tb = r.open_tab("https://%s/" % hb)
            time.sleep(1)
            r.check(srv.log.count(ha) == na, "site in a selected country goes direct (%s, %s)" % (ha, found[ha]))
            r.check(srv.log.count(hb) > nb, "site in another country goes via VPN (%s, %s)" % (hb, found[hb]))
            r.call("setSettings", patch={"geoMode": "vpn"})
            ri_a, ri_b = r.call("routeInfo", host=ha), r.call("routeInfo", host=hb)
            r.check(ri_a["tunneled"] and not ri_b["tunneled"], "\"only selected countries via VPN\" flips the routes")
            r.call("setSettings", patch={"geoMode": "direct", "excludeList": [hb]})
            r.check(not r.call("routeInfo", host=hb)["tunneled"], "exclusion list beats the country")
            r.ext("await browser.tabs.remove(args.ids);", ids=[ta, tb])
        r.call("setSettings", patch={"geoMode": "off", "excludeList": [], "scope": "tabs"})
        st = r.call("setSettings", patch={"statsUrl": "https://panel.example.com/portal"})
        r.check(st["settings"]["statsUrl"] == "https://panel.example.com/portal" and st["version"], "statistics URL saved, version reported")
        try:
            r.call("setSettings", patch={"statsUrl": "javascript:alert(1)"})
            r.check(False, "bad statistics URL is rejected")
        except RuntimeError:
            r.check(True, "bad statistics URL is rejected")

        # "sessions" is optional (asked for in Settings): grant it the way that click would.
        r.m.cmd("Marionette:SetContext", {"value": "chrome"})
        granted = r.m.js("""const done = arguments[arguments.length - 1];
                  const { ExtensionPermissions } = ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");
                  const ext = WebExtensionPolicy.getByID(arguments[0]).extension;
                  ExtensionPermissions.add(arguments[0], { permissions: ["sessions"], origins: [] }, ext)
                    .then(() => done(true), e => done(String(e)));""", r.addon_id, async_=True)
        r.m.cmd("Marionette:SetContext", {"value": "content"})
        r.options()
        time.sleep(1)
        r.check(granted is True and r.ext("return await browser.permissions.contains({permissions: ['sessions']});"),
                "optional \"sessions\" permission granted")
        # A mark lives in the tab's own session data: it comes back with a restored tab...
        t1 = r.open_tab("https://example.com/")
        r.call("setTabVpn", tabId=t1, value=True)
        r.ext("await browser.tabs.remove(args.id);", id=t1)
        time.sleep(1)
        t2 = r.ext("""
            const s = await browser.sessions.restore();
            const id = s.tab.id;
            for (let i = 0; i < 100; i++) {
              if ((await browser.tabs.get(id)).status === "complete") break;
              await new Promise(r => setTimeout(r, 100));
            }
            return id;""")
        time.sleep(1)
        r.check(t2 != t1 and t2 in r.call("getState")["vpnTabs"], "\"undo close tab\" brings the VPN mark back")
        n = srv.log.count("www.uio.no")
        r.ext("""await browser.tabs.update(args.id, {url: "https://www.uio.no/"});
                 for (let i = 0; i < 150; i++) {
                   const t = await browser.tabs.get(args.id);
                   if (t.status === "complete" && t.url.includes("uio.no")) break;
                   await new Promise(r => setTimeout(r, 100));
                 }""", id=t2)
        r.check(srv.log.count("www.uio.no") > n, "the restored tab goes through the VPN")

        # ...and survives a restart: reloading the add-on wipes storage.session, like a
        # browser restart does, so the mark can only come from the tab itself.
        t3 = r.open_tab("https://example.org/")  # an unmarked neighbour
        r.m.cmd("Marionette:SetContext", {"value": "chrome"})
        r.m.js("""const done = arguments[arguments.length - 1];
                  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
                  AddonManager.getAddonByID(arguments[0]).then(a => a.reload()).then(() => done(true), e => done(String(e)));""",
               r.addon_id, async_=True)
        r.m.cmd("Marionette:SetContext", {"value": "content"})
        time.sleep(2)
        r.m.cmd("WebDriver:SwitchToWindow", {"handle": r.m.cmd("WebDriver:GetWindowHandles")[0], "focus": False})
        r.options()
        time.sleep(1)
        marks = r.call("getState")["vpnTabs"]
        r.check(t2 in marks and t3 not in marks, "after a restart the marked tab is still a VPN tab, the neighbour is not")
        r.call("refresh")
        n = srv.log.count("www.rki.de")
        r.ext("""await browser.tabs.update(args.id, {url: "https://www.rki.de/"});
                 for (let i = 0; i < 150; i++) {
                   const t = await browser.tabs.get(args.id);
                   if (t.status === "complete" && t.url.includes("rki.de")) break;
                   await new Promise(r => setTimeout(r, 100));
                 }""", id=t2)
        r.check(srv.log.count("www.rki.de") > n, "after a restart the marked tab still goes through the VPN")

        # Wrong password -> error, VPN tab does not leak.
        pid = r.call("getState")["settings"]["profileId"]
        r.call("saveProfile", profile={"id": pid, "kind": "direct", "name": "fake", "hostname": "localhost",
                                       "port": srv.port, "username": srv.user, "password": "wrong"})
        st = r.call("refresh")
        print("Wrong password:", st["runtime"]["status"], "-", st["runtime"].get("error"))
        r.check(st["runtime"]["status"] == "error" and srv.rejected > 0, "wrong password -> error (407)")
    finally:
        r.close()
        shutil.rmtree(work, ignore_errors=True)
    return r.ok


# ---------------------------------------------------------------- live-server scenario

def run_live(firefox, keyfile):
    key = open(keyfile, encoding="utf-8").read().strip()
    direct_ip = urllib.request.urlopen("https://api.ipify.org", timeout=15).read().decode()
    print("Direct IP:", direct_ip)
    r = Run(firefox)
    try:
        prof = r.m.js("return TTConfig.parseAny(arguments[0])", key)
        print("Key:", prof["name"], prof["hostname"], prof["port"], "warnings:", len(prof["warnings"]))
        r.call("saveProfile", profile=prof)
        st = r.call("setEnabled", value=True)
        print("Without trusting the certificate:", st["runtime"]["status"], "-", st["runtime"]["error"])
        if prof.get("certificate"):
            r.check(st["runtime"]["status"] == "error", "untrusted certificate -> error, not a leak")
            der = "".join(re.findall(r"^[A-Za-z0-9+/=]+$", prof["certificate"].split("-----END")[0], re.M))
            r.trust_cert(der)
        st = r.call("refresh")
        rt = st["runtime"]
        print("Status:", rt["status"], "latency", rt.get("latency"), "ms", rt.get("error") or "")
        r.check(rt["status"] == "on", "tunnel is up")
        ipinfo = r.call("checkIp")
        print("checkIp:", ipinfo)
        r.check(ipinfo["vpn"]["ip"] != direct_ip and ipinfo["direct"]["ip"] == direct_ip and ipinfo["tabVia"] == "vpn",
                "Check IP: VPN address differs, direct address is the real one")
        r.m.cmd("WebDriver:Navigate", {"url": "https://api.ipify.org/"})
        tab_ip = r.m.js("return document.body.innerText.trim()")
        r.check(tab_ip == ipinfo["vpn"]["ip"], "tab goes through the VPN")
        r.options()
        r.call("setSettings", patch={"excludeList": ["api.ipify.org"]})
        r.m.cmd("WebDriver:Navigate", {"url": "https://api.ipify.org/?x=1"})
        r.check(r.m.js("return document.body.innerText.trim()") == direct_ip, "excluded site goes direct")
        r.options()
        r.call("setSettings", patch={"excludeList": []})
        pid = r.call("getState")["settings"]["profileId"]
        r.call("saveProfile", profile={"id": pid, "kind": "direct", "name": prof["name"], "hostname": prof["hostname"],
                                       "port": prof["port"], "username": prof["username"], "password": "definitely-wrong"})
        st = r.call("refresh")
        r.check(st["runtime"]["status"] == "error", "wrong password -> error")
        r.m.cmd("WebDriver:Navigate", {"url": "https://api.ipify.org/?x=2"})
        leak = r.m.js("return document.body ? document.body.innerText.trim() : ''")
        r.check(direct_ip not in leak, "kill switch: direct IP does not leak on error")
    finally:
        r.close()
    return r.ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keyfile", nargs="?")
    ap.add_argument("--fake", action="store_true", help="use a local fake TrustTunnel server")
    ap.add_argument("--firefox", default="/Applications/Firefox.app/Contents/MacOS/firefox")
    a = ap.parse_args()
    if not a.fake and not a.keyfile:
        ap.error("give --fake or a key file")
    ok = run_fake(a.firefox) if a.fake else run_live(a.firefox, a.keyfile)
    print("RESULT:", "all checks passed" if ok else "some checks FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
