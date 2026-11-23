# Privacy Policy — TrustTunnel Browser Client

Last updated: 2026-11-23

TrustTunnel Browser Client ("the add-on") is an open-source Firefox extension that connects the browser to a TrustTunnel VPN server chosen by the user.

## Data the add-on collects

None. The add-on has no analytics, telemetry, crash reporting or advertising, and its developer receives no data from it.

## Data stored on your device

- Server profiles you add: name, hostname, port, username, password, optional server certificate, SOCKS5 settings.
- Settings: routing mode, site lists, where the VPN works (all tabs / marked tabs / private windows), the containers and countries you chose, the address of your statistics page, kill switch and WebRTC options.
- The country database (IP ranges with country codes), if you downloaded it: kept in the add-on's IndexedDB.
- The "VPN in this tab" mark: stored with the tab itself in Firefox's session data, so a tab restored after a restart or with "Reopen closed tab" keeps its VPN. This happens only after you allow it in Settings (Firefox's optional "Access recently closed tabs" permission); without it the mark lasts until the browser closes. The add-on never reads your closed tabs or history. The mark is deleted when you switch the mark off or when Firefox forgets the closed tab.

This data is kept in the add-on's local storage inside your Firefox profile (`storage.local`). It is not synced and is deleted when you remove the server or uninstall the add-on.

## Data sent over the network

- **To your TrustTunnel server** (the one you configured): your username and password (HTTP Basic authentication) and the browser traffic you choose to route through the VPN. This server is operated by you or by whoever gave you the key, not by the add-on developer.
- **Connectivity check**: every 30 seconds while the VPN is on, a request to `https://www.gstatic.com/generate_204` sent through your server, to measure whether the tunnel works.
- **"Check IP" button**: only when you click it, two requests to `https://api.ipify.org` — one through your server and one directly — to show your address with the VPN and without it.
- **IP details (off by default)**: if you click "Show country, provider and address type" in the popup, each "Check IP" also sends those two IP addresses to `https://proxycheck.io`, which returns the country, the provider and whether the address looks like a VPN, hosting or home connection. Nothing else is sent. proxycheck.io is a third-party service with its own privacy policy.
- **Countries (off by default)**: when you press "Update database", the add-on downloads a public list of IP ranges by country from `https://cdn.jsdelivr.net` (ip-location-db). While routing by country is on, the add-on asks for the address of each site you open to learn its country: a DNS-over-HTTPS request to the DNS service you chose in Settings — Cloudflare (`cloudflare-dns.com`, the default), Google (`dns.google`), AdGuard DNS (`unfiltered.adguard-dns.com`) or your own server. The request is sent through your VPN server, so your internet provider does not see those names and the DNS service sees them coming from your server's address.
- **"Statistics" button**: opens, in a new tab, the address you typed in Settings. The add-on itself sends nothing there.

No other requests are made by the add-on.

## Contact

Questions and issues: https://github.com/BorisGB2001/TrustTunnel-FireFox/issues
