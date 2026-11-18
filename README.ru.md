# TrustTunnel — клиент для браузера

Расширение Firefox: VPN-клиент для [TrustTunnel](https://github.com/TrustTunnel/TrustTunnel) — открытого VPN-протокола AdGuard — только для браузера. Через ваш сервер TrustTunnel идёт только трафик Firefox, остальная система не затрагивается.

[English version](README.md)

> Неофициальный проект сообщества, не связан с AdGuard.

## Как это работает

TrustTunnel — это HTTP `CONNECT` поверх TLS с Basic-авторизацией. Firefox умеет так подключаться сам, как к **HTTPS-прокси**, поэтому помощник на компьютере не нужен.

Для серверов, с которыми браузер не справится (только HTTP/3, anti-DPI, правила `client_random`), есть второй режим: Firefox работает через локальный SOCKS5 официального [`trusttunnel_client`](https://github.com/TrustTunnel/TrustTunnelClient).

## Требования к серверу (режим «напрямую»)

1. **Домен, а не IP.** Сервер проверяет SNI. Подходит и `sslip.io`.
2. **Сертификат, которому доверяет Firefox.**
   - С Let's Encrypt всё работает сразу.
   - Для самоподписанного нажмите **Сертификат** у сервера в настройках расширения. Затем в Firefox откройте *Настройки → Приватность и защита → Просмотр сертификатов → Центры сертификации → Импортировать* и отметьте **«Доверять при идентификации веб-сайтов»**.
3. **Включён HTTP/1.1 или HTTP/2.** В `vpn.toml` должна быть секция `[listen_protocols.http1]` или `[listen_protocols.http2]`.
4. **Нет правил `client_random_prefix`** в `rules.toml`.

## Установка

- **Временно:** откройте `about:debugging#/runtime/this-firefox`, нажмите «Загрузить временное дополнение» и выберите `extension/manifest.json`.
- **Насовсем:** подпишите расширение на AMO без публикации (`web-ext sign --channel unlisted`) или используйте Firefox Developer Edition с `xpinstall.signatures.required = false`.

Подробности — в [README.md](README.md).

## Лицензия

[MIT](LICENSE)
