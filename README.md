# TrustTunnel Browser Client

A Firefox extension: browser-only VPN client for [TrustTunnel](https://github.com/TrustTunnel/TrustTunnel), the open-source VPN protocol by AdGuard. Only Firefox traffic goes through your TrustTunnel server; the rest of the system is untouched.

[Русская версия](README.ru.md)

A Chromium version lives in a separate repository: [TrustTunnel-Browser-Client](https://github.com/BorisGB2001/TrustTunnel-Browser-Client).

> This is an unofficial, community project. It is not affiliated with or endorsed by AdGuard.

## How it works

TrustTunnel is HTTP `CONNECT` over TLS with HTTP Basic authentication. Firefox can speak that natively as an **HTTPS proxy**, so the extension does not need any native helper. It routes requests with the [`proxy.onRequest`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy/onRequest) API to `{type: "https", host, port, proxyAuthorizationHeader: "Basic …"}`.

For setups a browser cannot handle (HTTP/3-only servers, anti-DPI, `client_random` rules), there is a second mode: Firefox uses the local SOCKS5 listener of the official [`trusttunnel_client`](https://github.com/TrustTunnel/TrustTunnelClient).

## Features

- Import `tt://?…` deep links (format v2), `trusttunnel_client.toml`, or `trusttunnel_endpoint --format toml` exports. You can also enter the server manually.
- Several servers, switchable from the toolbar popup.
- Split tunneling:
  - "everything except the list" or "only the listed sites";
  - domains (including subdomains), IPv4 addresses and CIDR ranges;
  - one-click "open this site directly / via VPN".
- Where the VPN works:
  - all tabs;
  - **only marked tabs** — switch in the popup, `Alt+Shift+T`, or "Open link in a VPN tab" in the link context menu. Tabs opened from a VPN tab inherit it (optional). The VPN stays on the tab whatever site it opens. Firefox **containers** can be set to always use the VPN;
  - **only private windows** (allow the add-on in private windows in `about:addons`).
- Toolbar icon menu (right click): VPN on/off, VPN in this tab, switch server. Hotkey `Alt+Shift+V` turns the VPN on/off.
- Kill switch: if the server is unreachable, nothing leaks around the VPN.
- WebRTC IP leak protection while the VPN is on.
- Connection health check every 30 s with latency.
- Exact Firefox error codes with explanations (certificate, auth, DNS, TLS…).
- Exports a self-signed server certificate from the key as `.pem` so you can import it into Firefox.
- English and Russian UI.

## Server requirements (direct mode)

1. **A domain name, not an IP.** The server checks SNI, so the hostname must be one from `hosts.toml` and must resolve to the server. Services like `sslip.io` work.
2. **A certificate Firefox trusts.**
   - Let's Encrypt works out of the box.
   - For a self-signed certificate, click **Certificate** next to the server in the extension settings. Then in Firefox open *Settings → Privacy & Security → View Certificates → Authorities → Import* and tick **Trust this CA to identify websites**.
   - Clicking "Accept the risk" on a warning page is not enough for proxies.
3. **HTTP/1.1 or HTTP/2 enabled.** `vpn.toml` must contain `[listen_protocols.http1]` or `[listen_protocols.http2]`, not only `quic`. The setup wizard enables all three by default.
4. **No `client_random_prefix` rules** in `rules.toml`. A browser cannot control its TLS ClientHello random.

## Install

**Temporary (for testing):** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and pick `extension/manifest.json`. It stays until Firefox restarts.

**Permanent:** release builds of Firefox only install signed add-ons. Either:

- sign it yourself as an unlisted add-on with your AMO API keys:
  ```bash
  npx web-ext@8 sign --source-dir extension --channel unlisted --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET"
  ```
  The signed `.xpi` appears in `web-ext-artifacts/`. Drag it into Firefox.
- or use Firefox Developer Edition / Nightly with `xpinstall.signatures.required = false` in `about:config` and install `dist/*.xpi`.

## SOCKS5 mode

Add a SOCKS listener to `trusttunnel_client.toml` and run the client:

```toml
[listener.socks]
address = "127.0.0.1:1080"
```

```bash
trusttunnel_client --config trusttunnel_client.toml
```

Then add a server in the extension with the **Via local trusttunnel_client (SOCKS5)** mode. If you import that TOML file, the SOCKS address is picked up automatically.

## Development

```
extension/          the WebExtension (Manifest V3, Firefox 140+)
  _locales/         en (default) and ru messages
  lib/config.js     tt:// deep link (QUIC varint TLV) and TOML parsers
  lib/rules.js      split-tunneling rules
  background.js     proxy routing, health check, auth fallback
scripts/
  build-xpi.sh      pack extension/ into dist/trusttunnel-firefox-<version>.xpi
  test-config.js    parser self-test (node)
  test-scope.js     VPN scope (tabs / private / containers) self-test (node)
  e2e-firefox.py    end-to-end test against a live server via Marionette
```

```bash
node scripts/test-config.js
node scripts/test-scope.js
python3 scripts/e2e-firefox.py --fake    # local fake server; close your regular Firefox first
npx web-ext@8 lint --source-dir extension
scripts/build-xpi.sh
python3 scripts/e2e-firefox.py key.txt   # close your regular Firefox first
```

## Privacy

The extension collects no data. Server credentials are stored only in your Firefox profile (`storage.local`) and sent only to your own server. The only third-party requests are:

- the connectivity check `https://www.gstatic.com/generate_204`, sent through your tunnel;
- the **Check IP** button, which queries `https://api.ipify.org`.

Full text: [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
