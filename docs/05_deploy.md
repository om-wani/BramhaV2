# BramhaV2 — Deploy Runbook

Target: Ubuntu 22.04 LTS VPS, Caddy v2, managed Postgres with pgvector.

## Prerequisites

- Ubuntu 22.04 VPS (2 vCPU, 4 GB RAM minimum)
- Managed Postgres with pgvector: [Neon](https://neon.tech) or [Supabase](https://supabase.com)
- Domain with DNS A record pointing to VPS IP (TTL propagated)
- SSH access as a user with `sudo`

---

## 1. Server setup

### Install Node 20 + pnpm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
npm install -g pnpm@9
```

### Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### Create app user

```bash
sudo useradd -m -s /bin/bash bramha
sudo mkdir -p /home/bramha/app /home/bramha/uploads
sudo chown -R bramha:bramha /home/bramha/app /home/bramha/uploads
```

Install nvm for the app user so the systemd unit can find Node:

```bash
sudo -u bramha bash -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash'
sudo -u bramha bash -c 'source ~/.bashrc && nvm install 20 && nvm alias default 20'
```

---

## 2. Clone + build

```bash
sudo -u bramha git clone <repo-url> /home/bramha/app
sudo -u bramha bash -c 'cd /home/bramha/app && pnpm install'
sudo -u bramha bash -c 'cd /home/bramha/app && pnpm build'
```

> `pnpm build` runs `turbo build` across all packages. Expect 3–5 min on a fresh VPS.

---

## 3. Environment files

### `/home/bramha/app/.env.server`

```env
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
APP_ORIGIN=https://your-domain.com
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
PORT_SERVER=3001
UPLOADS_DIR=/home/bramha/uploads
NODE_ENV=production
SESSION_SECRET=<random 64-char hex>
```

Generate `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### `/home/bramha/app/.env.web`

```env
NEXT_PUBLIC_API_URL=https://your-domain.com/backend
NODE_ENV=production
PORT_WEB=3000
BACKEND_ORIGIN=http://localhost:3001
```

Set file permissions:

```bash
sudo chmod 600 /home/bramha/app/.env.server /home/bramha/app/.env.web
sudo chown bramha:bramha /home/bramha/app/.env.server /home/bramha/app/.env.web
```

---

## 4. Database: enable pgvector + run migrations

On Neon or Supabase, run once in the SQL console:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then apply migrations:

```bash
sudo -u bramha bash -c 'cd /home/bramha/app && DATABASE_URL="postgresql://..." pnpm db:migrate'
```

---

## 5. Run env check

```bash
sudo -u bramha bash -c 'cd /home/bramha/app && pnpm check-env:strict'
```

All vars must show **OK** before proceeding. Fix any MISSING entries.

---

## 6. Systemd units

```bash
sudo cp /home/bramha/app/deploy/bramha-server.service /etc/systemd/system/
sudo cp /home/bramha/app/deploy/bramha-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bramha-server bramha-web
sudo systemctl start bramha-server bramha-web
```

Check status:

```bash
sudo systemctl status bramha-server bramha-web
sudo journalctl -u bramha-server -n 50 --no-pager
sudo journalctl -u bramha-web -n 50 --no-pager
```

---

## 7. Caddy config

```bash
sudo cp /home/bramha/app/deploy/Caddyfile /etc/caddy/Caddyfile
# Replace your-domain.com with your actual domain
sudo nano /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy provisions a TLS certificate automatically via ACME. Port 80 and 443 must be open in the VPS firewall:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp
sudo ufw enable
```

---

## 8. Seed demo data

```bash
sudo -u bramha bash -c 'cd /home/bramha/app && DATABASE_URL="postgresql://..." pnpm seed:demo'
```

---

## 9. Verify

```bash
# Health check
curl https://your-domain.com/backend/health
# Expected: {"status":"ok"}
```

- Open `https://your-domain.com` in browser → landing page loads
- Log in with `demo@northwind.com` / `Northwind2025!`
- Navigate to Q3 Strategy project → council room loads, agents respond

---

## Updating

```bash
sudo -u bramha bash -c 'cd /home/bramha/app && git pull && pnpm install && pnpm build'
sudo systemctl restart bramha-server bramha-web
```

Check logs after restart:

```bash
sudo journalctl -u bramha-server -f
```

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `502 Bad Gateway` | `systemctl status bramha-server` — process crashed? Check `journalctl -u bramha-server -n 100` |
| `curl /backend/health` hangs | Server not listening on 3001; check `PORT_SERVER` in `.env.server` |
| WebSocket disconnects | Caddy passes `Upgrade` header automatically; if behind another proxy, ensure it does too |
| pgvector missing | Run `CREATE EXTENSION IF NOT EXISTS vector;` in the managed DB console |
| `pnpm check-env:strict` fails | Missing env var in `.env.server` or `.env.web`; add and restart |
| Caddy TLS cert fails | Ensure DNS A record points to VPS IP and ports 80/443 are open |
