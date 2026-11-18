# Privacy Policy — TrustTunnel Browser Client

Last updated: 2026-11-18

TrustTunnel Browser Client ("the add-on") is an open-source Firefox extension that connects the browser to a TrustTunnel VPN server chosen by the user.

## Data the add-on collects

None. The add-on has no analytics, telemetry, crash reporting or advertising, and its developer receives no data from it.

## Data stored on your device

- Server profiles you add: name, hostname, port, username, password, optional server certificate, SOCKS5 settings.
- Settings: routing mode, site lists, kill switch and WebRTC options.

This data is kept in the add-on's local storage inside your Firefox profile (`storage.local`). It is not synced and is deleted when you remove the server or uninstall the add-on.

## Data sent over the network

- **To your TrustTunnel server** (the one you configured): your username and password (HTTP Basic authentication) and the browser traffic you choose to route through the VPN. This server is operated by you or by whoever gave you the key, not by the add-on developer.
- **Connectivity check**: every 30 seconds while the VPN is on, a request to `https://www.gstatic.com/generate_204` sent through your server, to measure whether the tunnel works.
- **"Check IP" button**: only when you click it, a request to `https://api.ipify.org` to show your current external IP address.

No other requests are made by the add-on.

## Contact

Questions and issues: https://github.com/BorisGB2001/TrustTunnel-FireFox/issues
