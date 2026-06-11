# Getting Started with RateLatch-core

This guide walks you through cloning, configuring, and running the complete RateLimiter stack from scratch.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Docker Desktop | 24+ | [docker.com](https://docker.com) |
| Docker Compose | v2+ | Included with Docker Desktop |
| Git | Any | [git-scm.com](https://git-scm.com) |
| Node.js *(dashboard only)* | 20+ | [nodejs.org](https://nodejs.org) |

---

## 1. Clone the Repository

```bash
git clone https://github.com/yourusername/ratelatch-core.git
cd ratelatch-core
```

---

## 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```env
# REQUIRED — Change this to a long random secret
JWT_SECRET=your-super-secret-jwt-key-here

# PostgreSQL
POSTGRES_USER=rluser
POSTGRES_PASSWORD=changeme
POSTGRES_DB=ratelimiter

# Rate limit TTL for cached rules in the gateway (seconds)
RULE_CACHE_TTL_SEC=60

# How long tenant project keys are cached in Redis (seconds)
PROJECT_KEY_CACHE_TTL_SEC=300
```

> **Security Note:** Never commit your real `.env` to version control. The `.gitignore` already excludes it.

---

## 3. Start All Services

```bash
docker compose up -d
```

This starts 5 containers: PostgreSQL, Redis, Rate Limiter Gateway, Management API, and Nginx. First run may take 1–2 minutes to pull images.

Verify everything is healthy:

```bash
docker compose ps
```

All containers should show `Up` or `Up (healthy)`.

---

## 4. Run Database Migrations

```bash
docker compose exec management-api node src/migrate.js
```

Expected output:
```
[Migrate] Applying: 001_create_tenants.sql
[Migrate] Applying: 002_create_rate_rules.sql
[Migrate] Applying: 003_create_usage_logs.sql
[Migrate] All migrations applied successfully.
```

---

## 5. Register Your First Tenant

```bash
curl.exe -X POST http://localhost/manage/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"you@example.com\",\"upstreamUrl\":\"https://httpbin.org\",\"plan\":\"free\"}"
```

**Response:**
```json
{
  "tenantId": "abc123...",
  "projectKey": "rl_live_xxxxxxxxxxxxxxxxxx",
  "dashboardToken": "eyJhbGci..."
}
```

Save your `projectKey` — **it is shown only once** and cannot be recovered.

---

## 6. Create a Rate Limit Rule

Use the `dashboardToken` from registration to authenticate:

```bash
curl.exe -X POST http://localhost/manage/rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_DASHBOARD_TOKEN" \
  -d "{\"route\":\"/api/login\",\"keyBy\":\"ip\",\"maxReq\":5,\"windowMs\":60000,\"priority\":10}"
```

| Field | Description | Example |
|---|---|---|
| `route` | Path to rate limit. Supports `*` wildcard | `/api/login`, `/api/*`, `*` |
| `keyBy` | What to track per-identity | `ip`, `api_key`, `user_id` |
| `maxReq` | Max requests allowed | `100` |
| `windowMs` | Window size in milliseconds | `60000` (1 minute) |
| `priority` | Higher = evaluated first | `10` |

---

## 7. Send Traffic Through the Gateway

Any HTTP request through Nginx with your `X-Project-Key` header will be rate limited then forwarded to your upstream API:

```bash
# Windows PowerShell
curl.exe -X GET http://localhost/api/users `
  -H "X-Project-Key: rl_live_xxxxxxxxxxxxxxxxxx"

# Linux / macOS
curl -X GET http://localhost/api/users \
  -H "X-Project-Key: rl_live_xxxxxxxxxxxxxxxxxx"
```

**Response headers on allowed requests:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1718098800
```

**Response on rate-limited requests (429):**
```json
{
  "error": "Too Many Requests",
  "retryAfter": 45
}
```
With header: `Retry-After: 45`

---

## 8. Launch the Dashboard (Optional)

The frontend lives in a separate repo: **[RateLatch-dashboard](https://github.com/yourusername/ratelatch-dashboard)**

```bash
git clone https://github.com/yourusername/ratelatch-dashboard.git
cd ratelatch-dashboard
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with your `email` and `projectKey`.

---

## Running the Test Suite

```bash
# Smoke tests (requires bash — use Git Bash on Windows)
bash ./tests/manual.sh

# Load test (requires k6 CLI: https://k6.io/docs/get-started/installation)
k6 run tests/loadtest.js
```

---

## Stopping the Stack

```bash
docker compose down        # Stop containers, keep data volumes
docker compose down -v     # Stop containers AND delete all data (clean slate)
```

---

## Common Issues

| Problem | Cause | Fix |
|---|---|---|
| Port 80 already in use | Another process is on port 80 | Change `"80:80"` to `"8080:80"` in `docker-compose.yml` |
| Port 3000 conflict | Next.js dashboard and gateway conflict | Rate limiter port is internal-only; dashboard runs on host port 3000 |
| `database "rluser" does not exist` in logs | `pg_isready` default DB name | Harmless health check noise; data is in the `ratelimiter` database |
| `401 Unauthorized` on gateway | Missing or invalid `X-Project-Key` header | Verify you're sending the correct project key |
| Rules not taking effect | Redis cache TTL | Wait up to 60 seconds or restart the rate-limiter container |
