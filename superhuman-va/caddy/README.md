# TLS certs (self-signed)

This directory must contain two files before `docker compose up`:

- `cert.pem` — self-signed X.509 certificate
- `key.pem`  — matching private key (mode 600)

## Generate them on the Oracle instance

Replace `<ORACLE_PUBLIC_IP>` with the new instance's public IPv4 (the one assigned in section 2.2 of the deployment plan):

```bash
cd ~/superhuman-va/caddy
openssl req -x509 -newkey rsa:4096 \
  -keyout key.pem \
  -out cert.pem \
  -days 365 -nodes \
  -subj "/CN=<ORACLE_PUBLIC_IP>" \
  -addext "subjectAltName=IP:<ORACLE_PUBLIC_IP>"
chmod 600 key.pem cert.pem
```

Then `docker compose up -d`.

Browsers will show a warning ("Your connection is not private") on first
visit. Click **Advanced → Proceed to <ip> (unsafe)** — the connection
is still TLS-encrypted; only the trust chain is self-signed.

## Rotating / upgrading later

- **Renew before 365 days expire** by re-running the openssl command.
- **Switch to Let's Encrypt** by getting a real domain, pointing an A
  record at `<ORACLE_PUBLIC_IP>`, and changing the Caddyfile:
  ```caddyfile
  :443 {
      tls your-email@example.com   # ← replace tls /etc/caddy/...
      ...
  }
  ```
  Caddy will auto-issue and renew the cert.
