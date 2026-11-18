# AMO listing — TrustTunnel Browser Client

Copy these texts into the Developer Hub form (descriptions are Markdown) (addons.mozilla.org → Developer Hub → the add-on → Edit Product Page). The default locale is English (en-US); the Russian texts go in as a translation (“Manage Translations” → Русский).

## Basic info

| Field | Value |
|---|---|
| Name (en-US) | TrustTunnel Browser Client |
| Name (ru) | TrustTunnel — клиент для браузера |
| Add-on URL slug | `trusttunnel-browser-client` |
| Categories | **Privacy & Security** |
| License | MIT |
| Homepage | https://github.com/BorisGB2001/TrustTunnel-FireFox |
| Support site | https://github.com/BorisGB2001/TrustTunnel-FireFox/issues |
| Support email | (optional — leave empty or use a public address) |
| Privacy policy | paste `PRIVACY.md` (see below) |
| Experimental | no |
| Requires payment | no |

## Summary (en-US, ≤ 250 characters)

Browser-only VPN client for your own TrustTunnel (AdGuard) server. Import a tt:// key, route Firefox through your server as an HTTPS proxy, choose which sites go through the VPN. Unofficial, open source.

## Summary (ru)

VPN-клиент для вашего сервера TrustTunnel (AdGuard), только для браузера. Импортируйте ключ tt://, и Firefox пойдёт через ваш сервер как через HTTPS-прокси. Выбирайте, какие сайты идут через VPN. Неофициальный, открытый код.

## Description (en-US)

TrustTunnel Browser Client connects Firefox to your own TrustTunnel server — the open-source VPN protocol by AdGuard. Only browser traffic goes through the tunnel; the rest of your system is untouched, and nothing needs to be installed besides the extension.

**You need your own TrustTunnel server.** This add-on does not provide a VPN service.

**Features**

- Import a tt:// key, a trusttunnel_client.toml config or a server export — or enter the server manually
- Several servers, switchable from the toolbar
- Split tunneling: everything except a list, or only listed sites; domains, IPs and subnets; one click to send the current site directly or via VPN
- Kill switch: if the server is down, traffic does not bypass the VPN
- WebRTC IP leak protection while the VPN is on
- Connection check with latency and clear error messages
- Exports a self-signed server certificate so you can trust it in Firefox
- Optional mode via the local SOCKS5 listener of the official trusttunnel_client


**Server requirements**: a domain name (not a bare IP), a certificate Firefox trusts (Let's Encrypt, or an imported self-signed one), and HTTP/1.1 or HTTP/2 enabled on the server.

**Privacy**: no data collection. Your credentials stay in your Firefox profile and are sent only to your own server.

Open source (MIT): https://github.com/BorisGB2001/TrustTunnel-FireFox
This is an unofficial project, not affiliated with AdGuard.

## Description (ru)

TrustTunnel — клиент для браузера подключает Firefox к вашему собственному серверу TrustTunnel — открытому VPN-протоколу AdGuard. Через туннель идёт только трафик браузера, остальная система не затрагивается. Кроме расширения ничего устанавливать не нужно.

**Нужен свой сервер TrustTunnel.** Расширение не предоставляет VPN-сервис.

**Возможности**

- Импорт ключа tt://, конфига trusttunnel_client.toml или экспорта сервера, либо ручной ввод
- Несколько серверов с переключением с панели инструментов
- Раздельное туннелирование: всё, кроме списка, или только сайты из списка; домены, IP и подсети; текущий сайт — напрямую или через VPN одним нажатием
- Kill switch: если сервер недоступен, трафик не идёт в обход VPN
- Защита от утечки IP через WebRTC, пока VPN включён
- Проверка связи с задержкой и понятными сообщениями об ошибках
- Выгрузка самоподписанного сертификата сервера для импорта в Firefox
- Режим через локальный SOCKS5 официального trusttunnel_client


**Требования к серверу**: доменное имя (не голый IP), сертификат, которому доверяет Firefox (Let's Encrypt или импортированный самоподписанный), и включённый HTTP/1.1 или HTTP/2.

**Конфиденциальность**: данные не собираются. Логин и пароль хранятся в профиле Firefox и отправляются только на ваш сервер.

Открытый код (MIT): https://github.com/BorisGB2001/TrustTunnel-FireFox
Неофициальный проект, не связан с AdGuard.

## Release notes 1.1.1 (en-US)

First public release on addons.mozilla.org. English and Russian UI, tt:// and TOML import, split tunneling, kill switch, WebRTC protection, detailed connection errors.

## Notes to reviewer (en-US) — "Notes for Reviewers" field

This add-on is a client for TrustTunnel (https://github.com/TrustTunnel/TrustTunnel), an open-source VPN protocol by AdGuard. TrustTunnel is HTTP CONNECT over TLS with Basic auth, so the add-on uses `proxy.onRequest` to return `{type: "https", host, port, proxyAuthorizationHeader}` pointing to the user's own server.

Permissions:
- `proxy`, `<all_urls>` — route browser requests through the user's server.
- `webRequest`, `webRequestBlocking`, `webRequestAuthProvider` — answer a 407 proxy challenge with the saved credentials; read the network error code of our own health-check request.
- `privacy` — set `webRTCIPHandlingPolicy` while the VPN is on.
- `storage` — server list and settings, local only.
- `alarms` — the health check every 30 s.
- `tabs` — show the current site's route in the popup.

No remote code, no minified or bundled code, no analytics. Network requests made by the add-on itself:
- `https://www.gstatic.com/generate_204` — connectivity check, sent through the user's tunnel.
- `https://api.ipify.org` — only when the user clicks "Check IP".

Testing requires a TrustTunnel server (installation: `curl -fsSL https://raw.githubusercontent.com/TrustTunnel/TrustTunnel/refs/heads/master/scripts/install.sh | sh -s -`, then `setup_wizard`). The tt:// and TOML parsers can be checked without a server: `node scripts/test-config.js` in the repository.

## Screenshots (1280×800 recommended, PNG)

1. Popup — connected, current site "via VPN".
2. Settings — server list and "Add server" with a parsed tt:// key (hide the password and real hostname).
3. Settings — routing lists and protection options.

Do not show real server addresses, usernames or passwords in screenshots.
