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
- VPN only in marked tabs (popup switch, hotkey, "Open link in a VPN tab"), only in private windows, or containers that always use the VPN
- Routing by country: selected countries without VPN, or only selected countries via VPN
- Check IP: your address with the VPN and without it, optionally with country, provider and address type
- Toolbar icon menu: VPN on/off, VPN in this tab, switch server; hotkeys
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
- VPN только в отмеченных вкладках (переключатель, горячая клавиша, «Открыть ссылку во вкладке с VPN»), только в приватных окнах или в выбранных контейнерах
- Маршрутизация по странам: отмеченные страны без VPN или через VPN только отмеченные страны
- Проверка IP: адрес с VPN и без VPN, по желанию — страна, провайдер и тип адреса
- Меню значка: вкл/выкл VPN, VPN в этой вкладке, выбор сервера; горячие клавиши
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

## Release notes 1.2.0 (en-US)

Choose where the VPN works: all tabs, only tabs you mark (popup switch, Alt+Shift+T, "Open link in a VPN tab"; child tabs inherit), Firefox containers that always use the VPN, or only private windows. Toolbar icon menu with VPN on/off and server switch, hotkey Alt+Shift+V. Changing a server's login or password now takes effect immediately. Requires Firefox 140 or newer.

## Release notes 1.2.0 (ru)

Выбор, где работает VPN: во всех вкладках, только в отмеченных (переключатель в окне, Alt+Shift+T, «Открыть ссылку во вкладке с VPN»; дочерние вкладки наследуют), в выбранных контейнерах Firefox или только в приватных окнах. Меню значка: вкл/выкл VPN и выбор сервера, горячая клавиша Alt+Shift+V. Смена логина или пароля сервера теперь действует сразу. Нужен Firefox 140 или новее.

## Release notes 1.2.2 (en-US)

Routing by country: tick countries that should open without the VPN (or the only ones that should use it); site lists still win. Check IP now shows your address with the VPN and without it, optionally with country, provider and address type. Optional Statistics button. Tabs marked "VPN in this tab" keep the VPN after a browser restart and when reopened. The version is shown in Settings. Fixes: private-window warning in every mode, IDN entries in site lists, a hang on broken TOML, tab-less requests of VPN containers, safer handling of routing errors.

## Release notes 1.2.2 (ru)

Маршрутизация по странам: отметьте страны, которые открываются без VPN (или единственные, что идут через VPN); списки сайтов по-прежнему важнее. «Проверить IP» показывает адрес с VPN и без VPN, по желанию — страну, провайдера и тип адреса. Кнопка «Статистика». Вкладки с отметкой «VPN в этой вкладке» сохраняют VPN после перезапуска браузера и при восстановлении закрытой вкладки. Версия видна в настройках. Исправления: предупреждение о приватных окнах в любом режиме, кириллические домены в списках, зависание на повреждённом TOML, запросы без вкладки в VPN-контейнерах, надёжнее обработка ошибок маршрутизации.

## Notes to reviewer (en-US) — "Notes for Reviewers" field

This add-on is a client for TrustTunnel (https://github.com/TrustTunnel/TrustTunnel), an open-source VPN protocol by AdGuard. TrustTunnel is HTTP CONNECT over TLS with Basic auth, so the add-on uses `proxy.onRequest` to return `{type: "https", host, port, proxyAuthorizationHeader}` pointing to the user's own server.

Permissions:
- `proxy`, `<all_urls>` — route browser requests through the user's server.
- `webRequest`, `webRequestBlocking`, `webRequestAuthProvider` — answer a 407 proxy challenge with the saved credentials; read the network error code of our own health-check request.
- `privacy` — set `webRTCIPHandlingPolicy` while the VPN is on.
- `storage` — server list and settings, local only.
- `alarms` — the health check every 30 s.
- `tabs` — show the current site's route in the popup; track which tabs are marked "VPN in this tab" (per-tab badge, closed tabs are forgotten).
- `menus` — "Open link in a VPN tab" in the link context menu; toolbar icon menu (VPN on/off, VPN in this tab, server).
- `sessions` (new in 1.2.2, **optional**: requested from a button in Settings, next to an explanation) — only `sessions.setTabValue/getTabValue/removeTabValue` with one boolean key: the "VPN in this tab" mark must survive a browser restart and "Reopen closed tab", otherwise a restored tab would silently leave the VPN. The add-on does not read the list of closed tabs or windows.
- `contextualIdentities` — list the user's containers in Settings so they can choose containers that always use the VPN. Container data is not stored or sent anywhere except the chosen cookieStoreIds in storage.local.

No remote code, no minified or bundled code, no analytics. Network requests made by the add-on itself:
- `https://www.gstatic.com/generate_204` — connectivity check, sent through the user's tunnel.
- `https://api.ipify.org` — only when the user clicks "Check IP" (two requests: through the tunnel and direct).
- `https://proxycheck.io/v3/<ip>` — only after the user opts in from the popup (setting `ipInfo`, off by default): country, provider and type of the two addresses shown by "Check IP".
- `https://cdn.jsdelivr.net/npm/@ip-location-db/geo-whois-asn-country/geo-whois-asn-country-ipv4-num.csv` — only when the user presses "Update database": data only (CSV of IP ranges and country codes), parsed into typed arrays and kept in IndexedDB; no code is loaded.
- DNS over HTTPS (RFC 8484, `?dns=<query>`) to the service chosen in Settings — `https://cloudflare-dns.com/dns-query` (default), `https://dns.google/dns-query`, `https://unfiltered.adguard-dns.com/dns-query` or the user's own https URL — only while the user has routing by country on: the site's IPv4 address is looked up in the country database. The request is forced through the user's tunnel, never sent directly.
- `privacy.network.networkPredictionEnabled` is set to false while the VPN is on, so prefetch does not bypass the tunnel.

Testing requires a TrustTunnel server (installation: `curl -fsSL https://raw.githubusercontent.com/TrustTunnel/TrustTunnel/refs/heads/master/scripts/install.sh | sh -s -`, then `setup_wizard`). The tt:// and TOML parsers and the tab/private/container routing can be checked without a server: `node scripts/test-config.js`, `node scripts/test-scope.js` and `node scripts/test-geo.js` in the repository; `python3 scripts/e2e-firefox.py --fake` runs Firefox against a local fake TrustTunnel server.

## Images

Files in `amo/images/` (made by `python3 scripts/amo-screenshots.py`: real headless Firefox, local fake server, demo names only — no real hosts or credentials).

- **Add-on icon**: `icon-128.png` (128×128, from `extension/icons/icon-on.svg`).
- **Screenshots** (1280×800 PNG; images are shared by all locales, captions are translated):

| File | Caption (en-US) | Caption (ru) |
|---|---|---|
| `en-1-popup.png` | Toolbar popup: connected, VPN only in marked tabs, current site via VPN | Окно расширения: подключено, VPN только в отмеченных вкладках, текущий сайт через VPN |
| `en-2-servers.png` | Settings: servers and where the VPN works | Настройки: серверы и где работает VPN |
| `en-3-scope.png` | Marked tabs, containers, hotkeys and split tunneling lists | Отмеченные вкладки, контейнеры, горячие клавиши и списки сайтов |
| `en-4-add-server.png` | Add a server from a tt:// key or TOML config | Добавление сервера из ключа tt:// или TOML-конфига |

Do not show real server addresses, usernames or passwords in screenshots.
