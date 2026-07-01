# Superhuman VA — Cloud Deployment on Oracle Cloud (ARM Free Tier)

## TL;DR

Your existing repo is already 90% cloud-ready. The pieces that need to change for an Oracle ARM A1 deployment with IP-only + self-signed:

1. **Provision a brand-new VCN + ARM A1 instance** in Oracle Cloud — fully isolated from your existing project. No resource sharing, no port collisions, no shared Security Lists.
2. **Add a Next.js Docker service** — currently `npm run dev` runs on the host; on the server we want everything in `docker compose`.
3. **Add a Caddy reverse-proxy service** — terminates self-signed TLS, routes `/`, `/pb/*`, `/ms/*` to the right backends.
4. **Generate a self-signed cert for the Oracle public IP** — one `openssl` command at setup time.
5. **Harden the host** — Security List (firewall), SSH key-only, fail2ban, automatic security updates.

Everything else (Mem0, Qdrant, PocketBase, FastEmbed) runs as-is. ARM Ampere A1 has 24 GB RAM and 4 OCPU — this stack uses < 2 GB at idle, so no memory tuning or swap is needed.

---

## 1. Architecture on Oracle

```
Internet
   │  tcp/443 (HTTPS, self-signed cert, Oracle Security List)
   ▼
┌──────────────────────────────────────────────────────┐
│  Oracle Linux / Ubuntu ARM64 instance (VM.Standard.A1)│
│                                                      │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐         │
│  │  Caddy   │──▶│ next-app │   │  24 GB   │         │
│  │  :443    │   │  :3000   │   │   RAM    │         │
│  │  :80     │   └──────────┘   │          │         │
│  └────┬─────┘                  │          │         │
│       │   ┌──────────────┐     │          │         │
│       ├──▶│  pocketbase  │     │          │         │
│       │   │    :8090     │     │          │         │
│       │   └──────────────┘     │          │         │
│       │   ┌──────────────┐     │          │         │
│       └──▶│memory-service│     │          │         │
│       │   │    :8000     │     │          │         │
│       │   └──────┬───────┘     │          │         │
│       │          │             │          │         │
│       │   ┌──────▼───────┐     │          │         │
│       │   │   qdrant     │     │          │         │
│       │   │  :6333/6334  │     │          │         │
│       │   └──────────────┘     │          │         │
│       │                        │          │         │
│  All on `va-net` bridge        │          │         │
│  Qdrant is NOT proxied to the │          │         │
│  public internet.              │          │         │
└───────────────────────────────┴──────────┴──────────┘
```

**URL map (on `https://<ORACLE_PUBLIC_IP>`):**

| Path | Service | Notes |
|---|---|---|
| `/` | `next-app:3000` | Chat UI (main entry) |
| `/pb/*` | `pocketbase:8090` | PB admin at `/pb/_/`, REST at `/pb/api/*` |
| `/ms/*` | `memory-service:8000` | Swagger at `/ms/docs`, OpenAPI at `/ms/openapi.json` |
| (none) | `qdrant:6333` | **Not exposed** — internal only |

Caddy is the only thing the public internet talks to. Port 80 is open only to redirect to 443.

---

## 2. Prerequisites (one-time, on the Oracle console)

The strategy is **full isolation**: the VA lives in its own VCN, subnet, Security List, and ARM instance. Nothing is shared with your existing project.

### 2.0 Check your free-tier ARM budget

Oracle's "always free" ARM A1 budget is **per tenancy, not per instance** — 4 OCPU + 24 GB RAM total across all ARM A1 instances in the compartment.

In the console: **Compute → Instances** → look at the **OCPU** and **Memory** columns of your existing instance. Subtract from 4 / 24 GB. Whatever's left is what the VA can use. This stack idles at ~1 GB RAM and 0.2 OCPU, so even if your existing project takes 2 OCPU + 8 GB, you have plenty of headroom.

If the existing project already maxes out 4 OCPU / 24 GB, you cannot run another ARM A1 — you'd have to fall back to the AMD micro free tier (1/8 OCPU + 1 GB), which is too tight for this stack. (Workarounds: move some workload off the existing project, or upgrade to a paid shape.)

### 2.1 Create a new VCN

In the console, **Networking → Virtual Cloud Networks → Start VCN Wizard → Create VCN with Internet Connectivity**:

| Setting | Value |
|---|---|
| Name | `va-vcn` (or anything distinct from the existing one) |
| IPv4 CIDR block | `10.1.0.0/16` (or any `/16` that doesn't collide with your existing VCN's `10.0.0.0/16`) |
| IPv6 | Disabled (not needed) |
| Public subnet CIDR | `10.1.0.0/24` |
| Private subnet CIDR | Skip — not needed for this MVP |
| DNS resolution | Use Oracle's default DNS |

The wizard auto-creates:
- An Internet Gateway
- A route table for the public subnet
- A default Security List (we'll customize it in 2.3)

> **Note:** VCNs in the same tenancy are not peered by default. Your new VCN and the existing VCN have **zero network connectivity** between them. That's exactly what we want.

### 2.2 Provision a new ARM instance

**Compute → Instances → Create instance**:

| Setting | Value |
|---|---|
| Name | `va-instance` |
| Compartment | Same as the VCN (default root) |
| Placement | Any availability domain |
| Image | Oracle Linux 8/9 aarch64 (or **Oracle Linux 9 arm64** if listed) — avoid x86 images; the `python:3.11-slim` and `node:20-alpine` Docker images are multi-arch, but starting on aarch64 avoids surprises. |
| Shape | `VM.Standard.A1.Flex` |
| OCPU | Whatever the budget in 2.0 allows (start with 2, leave room to grow) |
| RAM | 12 GB (or remaining budget) |
| Boot volume | 100 GB (default 47 GB is fine, but 100 GB leaves headroom for Qdrant snapshots) |
| Networking | Attach the **new VCN's** public subnet from 2.1 |
| Public IP | **Assign a new ephemeral public IPv4** — note this address. It is different from the existing project's IP. |
| SSH key | Upload your public key (or generate a new keypair) |

Click **Create**. Provisioning takes ~2 minutes.

> **Why a new instance instead of putting the VA on the existing one?**
> - The existing instance has a fixed size and may already be at 4 OCPU / 24 GB.
> - A separate instance gives the VA its own Security List — you only open 22/80/443 to your IP and nothing else; the existing project's ports stay untouched.
> - Different public IP — you can take the VA down without affecting the other project.
> - Different failure domain — one instance dying doesn't take both projects offline.

### 2.3 Open the Security List for the new VCN

The wizard created a default Security List attached to the new public subnet. Find it: **Networking → Virtual Cloud Networks → `va-vcn` → Subnets → public subnet → Default Security List for va-vcn → Add Ingress Rules**:

| Protocol | Port | Source | Purpose |
|---|---|---|---|
| TCP | 22 | your static IP / CIDR | SSH (lock down to your IP) |
| TCP | 80 | `0.0.0.0/0` | Caddy → 443 redirect |
| TCP | 443 | `0.0.0.0/0` | Caddy TLS termination |

Do **not** open 8090, 8000, 6333, or 3000 at the Security List level. Those stay bound to the Docker bridge network only.

Egress is open by default (Oracle's default Security List allows all egress) — leave it as-is so the instance can reach DeepSeek's API and Docker Hub.

### 2.4 SSH in and patch

```bash
ssh -i ~/.ssh/oracle_key opc@<NEW_VA_PUBLIC_IP>
sudo dnf update -y     # Oracle Linux
# OR: sudo apt update && sudo apt upgrade -y   # Ubuntu
```

(Optional) Confirm the architecture is aarch64 and that you can't see the other project:

```bash
uname -m               # → aarch64
ip addr                # → 10.1.x.x — different range from the other VCN
```

If `ip addr` shows the old VCN's range, you're on the wrong instance.

---

## 3. Hardening the host

Run as `root` (or with `sudo`) once.

### 3.1 OS-level firewall (belt and suspenders with the Security List)

```bash
# Oracle Linux
sudo firewall-cmd --permanent --zone=public --add-service=ssh
sudo firewall-cmd --permanent --zone=public --add-service=http
sudo firewall-cmd --permanent --zone=public --add-service=https
sudo firewall-cmd --reload

# Ubuntu (if ufw is your choice)
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 3.2 fail2ban

```bash
sudo dnf install -y fail2ban   # or apt install fail2ban
sudo systemctl enable --now fail2ban
```

The default jail blocks SSH brute force — good enough for MVP.

### 3.3 Automatic security updates (Oracle Linux)

```bash
sudo dnf install -y dnf-automatic
sudo systemctl enable --now dnf-automatic.timer
```

For Ubuntu: `unattended-upgrades` is on by default.

---

## 4. Install Docker

```bash
# Oracle Linux 8/9
sudo dnf install -y dnf-utils
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add your user to the docker group
sudo usermod -aG docker $USER
newgrp docker

# Enable and start
sudo systemctl enable --now docker
docker --version
docker compose version
```

Verify ARM is detected:
```bash
uname -m    # → aarch64
```

---

## 5. Clone the repo and add the missing pieces

```bash
cd ~
git clone <your-repo-url> superhuman-va
cd superhuman-va
cp .env.example .env
```

### 5.1 Fill in the env

Edit `.env`:
- `DEEPSEEK_API_KEY=sk-...`  ← real key
- `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD` ← pick something strong
- `USER_ID=local-user`
- Everything else: defaults are fine.

The `CORS_ORIGINS` line in the root `.env` is irrelevant for the new layout (Caddy terminates; everything is on the same origin). But update `CORS_ORIGINS` in the memory-service's env anyway — point it at the actual public origin:
```env
CORS_ORIGINS=https://<ORACLE_PUBLIC_IP>
```
(Or just `*` for the MVP; you're on self-signed, no one else is hitting this.)

### 5.2 Add a Dockerfile to `next-app/`

The Next.js app currently runs via `npm run dev` on the host. For the cloud, we want it containerized.

**New file:** [`next-app/Dockerfile`](file:///workspace/superhuman-va/next-app/Dockerfile)

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
```

### 5.3 Enable standalone output

**Edit** [`next-app/next.config.mjs`](file:///workspace/superhuman-va/next-app/next.config.mjs):

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",       // ← add this line
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
```

### 5.4 Add a Caddy service + Caddyfile

**New file:** [`caddy/Caddyfile`](file:///workspace/superhuman-va/caddy/Caddyfile)

```caddyfile
{
    # Don't try ACME — we're IP-only with a static cert.
    auto_https off
    admin off
}

# HTTP → HTTPS redirect
:80 {
    redir https://{host}{uri} permanent
}

# HTTPS termination with self-signed cert
:443 {
    tls /etc/caddy/cert.pem /etc/caddy/key.pem

    # PocketBase admin UI + REST API under /pb/*
    @pb path /pb /pb/*
    handle @pb {
        uri strip_prefix /pb
        reverse_proxy pocketbase:8090
    }

    # Memory-service Swagger + OpenAPI under /ms/*
    @ms path /ms /ms/*
    handle @ms {
        uri strip_prefix /ms
        reverse_proxy memory-service:8000
    }

    # Health endpoint (handy for external uptime checks)
    @health path /healthz
    handle @health {
        respond "ok\n" 200
    }

    # Default: chat UI
    handle {
        reverse_proxy next-app:3000
    }

    # Friendly error if a backend is down
    handle_errors {
        respond "{err.status_code} {err.status_text}\n" {err.status_code}
    }
}
```

### 5.5 Update `docker-compose.yml` to add the new services

**Edit** [`docker-compose.yml`](file:///workspace/superhuman-va/docker-compose.yml). Add these two services to the existing file:

```yaml
  next-app:
    build:
      context: ./next-app
      dockerfile: Dockerfile
    container_name: va-next-app
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
      - DEEPSEEK_BASE_URL=${DEEPSEEK_BASE_URL:-https://api.deepseek.com}
      - DEEPSEEK_MODEL=${DEEPSEEK_MODEL:-deepseek-chat}
      - USER_ID=${USER_ID:-local-user}
      - MEMORY_SERVICE_URL=http://memory-service:8000
      - NEXT_PUBLIC_PB_URL=http://pocketbase:8090
      - PB_ADMIN_EMAIL=${PB_ADMIN_EMAIL}
      - PB_ADMIN_PASSWORD=${PB_ADMIN_PASSWORD}
      - NEXT_PUBLIC_APP_URL=https://${ORACLE_IP}
    expose:
      - "3000"
    depends_on:
      memory-service:
        condition: service_healthy
      pocketbase:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "-O-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - va-net

  caddy:
    image: caddy:2.8-alpine
    container_name: va-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy/cert.pem:/etc/caddy/cert.pem:ro
      - ./caddy/key.pem:/etc/caddy/key.pem:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - next-app
      - pocketbase
      - memory-service
    networks:
      - va-net
```

Also add `caddy_data` and `caddy_config` to the `volumes:` block at the bottom.

### 5.6 Strip the host-port mappings from internal services

Now that Caddy is the public face, the PocketBase / Qdrant / memory-service containers should not publish ports to the host. Change:

- `pocketbase`: `ports: - "${PB_PORT:-8090}:8090"` → `expose: - "8090"`
- `qdrant`: drop the `ports:` block (or keep `expose:` if you want them on the internal network)
- `memory-service`: `ports: - "${MEMORY_PORT:-8000}:8000"` → `expose: - "8000"`

If you ever need to debug from the host, you can use `docker compose exec` instead of a published port.

### 5.7 Generate the self-signed cert

```bash
mkdir -p caddy
openssl req -x509 -newkey rsa:4096 \
  -keyout caddy/key.pem \
  -out caddy/cert.pem \
  -days 365 -nodes \
  -subj "/CN=<ORACLE_PUBLIC_IP>" \
  -addext "subjectAltName=IP:<ORACLE_PUBLIC_IP>"
chmod 600 caddy/key.pem caddy/cert.pem
```

This gives you a cert valid for 365 days for the IP. Browsers will show a warning — users click "Advanced → Proceed" once per session. The connection is still TLS-encrypted.

(For longer validity, regenerate before expiry. For a real domain, swap in a Let's Encrypt cert — see "Going further" at the end.)

### 5.8 Pass the public IP into the env

Add to `.env`:
```env
ORACLE_IP=<paste the public IPv4 here>
```
This is used by `docker-compose.yml` to set `NEXT_PUBLIC_APP_URL`.

---

## 6. Bring it up

```bash
cd ~/superhuman-va
docker compose build next-app memory-service
docker compose up -d
docker compose ps
```

Wait for `next-app`, `memory-service`, `pocketbase`, and `qdrant` to report healthy. Then bootstrap PocketBase (you'll need the admin superuser first — see below):

```bash
# Step 1: open the admin UI once to create the superuser
#   https://<ORACLE_IP>/pb/_/
#   (create with the same PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD as in .env)

# Step 2: run the bootstrap script inside the memory-service container
docker compose exec memory-service python scripts/pb_bootstrap.py
```

If `pb_bootstrap.py` fails with "no admin found", you skipped step 1. The script will print that and exit 1 — that's intentional, it means PB is fresh.

---

## 7. Verify end-to-end

```bash
# Public endpoints
curl -kI https://<ORACLE_IP>/                          # → 200 (Next.js)
curl -kI https://<ORACLE_IP>/pb/_/                     # → 200 (PB admin)
curl -k  https://<ORACLE_IP>/ms/docs | head            # → FastAPI Swagger HTML
curl -k  https://<ORACLE_IP>/healthz                   # → "ok"

# Internal-only endpoints (should NOT be reachable from the public internet)
curl http://<ORACLE_IP>:8090/                          # should time out / refused (no host port)
curl http://<ORACLE_IP>:6333/                          # ditto
curl http://<ORACLE_IP>:8000/                          # ditto

# Functional smoke
curl -k -X POST https://<ORACLE_IP>/api/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"local-user","message":"remember: my favorite color is green"}'
# → SSE stream
```

Then in a browser:
1. Open `https://<ORACLE_IP>/` — accept the cert warning.
2. Type: "remember: my favorite color is green" → "OK, I'll remember that."
3. New message: "what's my favorite color?" → "Green."
4. Open `https://<ORACLE_IP>/pb/_/` → log in → confirm `messages` collection has the new rows.
5. Open `https://<ORACLE_IP>/ms/docs` → confirm the Swagger UI loads.

---

## 8. Backups (so you don't lose memory on disaster)

Three pieces of state, all on named volumes:

| Volume | What's in it | Backup command |
|---|---|---|
| `superhuman-va_pb_data` | PocketBase DB + uploads | `docker run --rm -v superhuman-va_pb_data:/src -v $(pwd)/backups:/dst alpine tar czf /dst/pb-$(date +%F).tar.gz -C /src .` |
| `superhuman-va_qdrant_storage` | All vectors (memories + documents) | Same recipe, swap volume name |
| `superhuman-va_hf_cache` | Embedding model | Optional — Docker image already has it |

Schedule a daily cron to dump to `/opt/va-backups/` and copy off-host with `rclone` to S3 / Backblaze / rsync.net.

**Smoke-test restore** once on a fresh VM before you trust it.

---

## 9. Updating the deployment

```bash
cd ~/superhuman-va
git pull

# Code change in memory-service or next-app:
docker compose build memory-service next-app
docker compose up -d

# Bump a prebuilt image (Qdrant, PocketBase, Caddy):
docker compose pull
docker compose up -d

# Watch logs
docker compose logs -f --tail=200
```

Zero-downtime restarts are *not* guaranteed with this single-host setup — there will be a few seconds of 502s from Caddy while a container restarts. Acceptable for an MVP.

---

## 10. Cost & limits reminder

| Resource | Free? | Notes |
|---|---|---|
| ARM A1 instance | ✅ Always free | 4 OCPU + 24 GB |
| 100 GB boot volume | ✅ Always free | Up to 200 GB total across all volumes per tenant |
| 10 TB outbound / month | ✅ Always free | After that, Oracle charges for egress |
| Ephemeral public IP | ✅ Free while attached | Reassigning loses the IP; consider a reserved IP if you want it sticky |
| DeepSeek API | ❌ Pay-as-you-go | ~$0.14/M input tokens for `deepseek-chat` |
| PocketBase image | ✅ Free | |
| Qdrant image | ✅ Free | |

For a single-user MVP, DeepSeek cost will be the only ongoing expense (a few dollars/month at low usage). Monitor with DeepSeek's dashboard.

---

## 11. What this plan does NOT include (deferred to follow-ups)

These are all one-shot follow-ups that don't block the deploy:

- **Let's Encrypt via DNS-01 challenge** — once you get a domain, Caddy can switch to automatic LE certs. Just change `tls /etc/caddy/...` to `tls <email>` in the Caddyfile.
- **Cloudflare Tunnel** — alternative to the Security List port-open. Hides the Oracle IP entirely. ~10 lines of `cloudflared` config.
- **Off-site automated backups** — `rclone` cron to S3/B2. ~20 lines.
- **Multi-user with PocketBase auth** — only relevant if you flip the single-user scope. Will need auth wiring in the Next.js app.
- **Vertical scaling** — the same compose file works on a 32 GB or 64 GB shape; just resize the OCI instance.
- **HA / multi-region** — not on the table for an MVP.

---

## 12. Rollback / tear-down

If something goes sideways:

```bash
# Stop everything
cd ~/superhuman-va
docker compose down

# Start it back up
docker compose up -d

# Full reset (deletes all data — destructive)
docker compose down -v
```

The `-v` flag wipes the named volumes including PB and Qdrant data. Don't run it casually.

---

## File-by-file deliverable summary

| Action | File |
|---|---|
| **Create** | `next-app/Dockerfile` |
| **Edit** | `next-app/next.config.mjs` (add `output: "standalone"`) |
| **Create** | `caddy/Caddyfile` |
| **Create** | `caddy/cert.pem` + `caddy/key.pem` (via `openssl`) |
| **Edit** | `docker-compose.yml` (add `next-app` + `caddy` services, strip host-port mappings from internal services) |
| **Edit** | `.env` (add `ORACLE_IP=...`) |
| **No change** | `memory-service/`, all of `next-app/app/`, all `next-app/components/`, `next-app/lib/` |

Total: 2 new files (next-app/Dockerfile, caddy/Caddyfile + certs), 2 small edits (next.config.mjs, docker-compose.yml), 1 env addition.

Achievable in ~30 minutes once the Oracle instance is up.
