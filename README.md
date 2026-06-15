# RateLatch-core

> **Multi-Tenant Rate Limiting as a Service** — Plug your API behind a battle-tested sliding window rate limiter in minutes, without touching a single line of your own code.

[![Node.js](https://img.shields.io/badge/Node.js-20-green?logo=node.js)](https://nodejs.org)
[![Redis](https://img.shields.io/badge/Redis-7-red?logo=redis)](https://redis.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue?logo=postgresql)](https://postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-blue?logo=docker)](https://docker.com)
[![Dashboard](https://img.shields.io/badge/Dashboard-RateLatch--dashboard-indigo)](https://github.com/Krushnakant-08/RateLatch-dashboard)
[![License](https://img.shields.io/badge/license-MIT-brightgreen)](./LICENSE)

---

## What is RateLatch?

**RateLatch** is a production-ready API gateway that enforces rate limits transparently in front of any HTTP backend. Teams register a tenant account, receive a project key, and point their traffic at the gateway — their backend code stays completely unchanged.

```
Your Client  →  [ RateLatch Gateway ]  →  Your API
                   ↕           ↕
                 Redis       PostgreSQL
                (limits)     (rules)
```

### Key Features

| Feature | Description |
|---|---|
| **Sliding Window** | Precise, fair rate limiting via Redis atomic Lua scripts |
| **Multi-Tenant** | Full isolation — one tenant's traffic never affects another |
| **Dynamic Rules** | Add/edit limits via REST API or dashboard without restarting |
| **Zero Code Change** | Drop it in front of any HTTP API — no SDK required |
| **Per-Route Rules** | Different limits for `/login` vs `/api/*` vs `*` catch-all |
| **Key-By Strategies** | Limit by IP address, API Key, or User ID |
| **Dashboard** | Real-time analytics and rule management via [RateLatch-dashboard](https://github.com/Krushnakant-08/RateLatch-dashboard) |
| **Docker Native** | Single `docker compose up` to run the entire stack |

---

## Architecture

```
                          ┌─────────────────────────────────────────────┐
                          │            Docker Network                   │
                          │                                             │
Client ──── port 80 ────► │  Nginx (Reverse Proxy)                      │
                          │     │                                        │
                          │     ├─ /manage/* ──► Management API :4000   │
                          │     │                    │                   │
                          │     │              PostgreSQL :5432          │
                          │     │              Redis :6379               │
                          │     │                                        │
                          │     └─ /* ──────► Rate Limiter Gateway :3000 │
                          │                      │           │           │
                          │                   Redis        PostgreSQL    │
                          │                  (atomic     (rules,        │
                          │                  windows)    tenants)       │
                          └─────────────────────────────────────────────┘
                                                │
                                                ▼
                                    Tenant's Upstream API
```

### Component Breakdown

- **Nginx** — Single entry point on port 80. Routes `/manage/*` to the Management API; all other traffic to the Gateway.
- **Rate Limiter Gateway** — Stateless Node.js service. Validates `X-Project-Key`, runs atomic Lua rate-limit check, proxies allowed requests upstream.
- **Management API** — REST API for tenant registration, JWT auth, rule CRUD, and usage stats.
- **Redis** — Stores sliding window ZSETs and tenant config cache (5-minute TTL). All rate limit checks are atomic.
- **PostgreSQL** — Source of truth for tenants, rate rules, and hourly usage logs.

---

## How the Sliding Window Works

Unlike a fixed window (which can allow 2× the limit at window edges), the sliding window evaluates the last `N` milliseconds from the current moment:

```
now - window_ms                    now
     │                              │
     └──────────── window ──────────┘
              [ req1, req2, req3 ]   ← count = 3

If count ≥ max_req → 429 Too Many Requests
If count < max_req → Allow & record timestamp
```

The entire check-and-record sequence runs as a **single atomic Lua script** in Redis, eliminating race conditions under high concurrency.

---

## Documentation

| Page | Description |
|---|---|
| **[Getting Started](./docs/getting-started.md)** | Clone, configure, and run the full stack |
| **[API Reference](./docs/api-reference.md)** | Complete REST API documentation |
| **[RateLatch-dashboard](https://github.com/Krushnakant-08/ratelatch-dashboard)** | Frontend dashboard repository |

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/yourusername/ratelatch-core.git
cd ratelatch-core

# 2. Configure
cp .env.example .env
# Set JWT_SECRET and any other values in .env

# 3. Start everything
docker compose up -d

# 4. Run migrations
docker compose exec management-api node src/migrate.js

# 5. Register your first tenant
curl -X POST http://localhost/manage/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","upstreamUrl":"https://yourapi.com","plan":"free"}'
```

See the full **[Getting Started guide →](./docs/getting-started.md)**

---

## Project Structure

```
ratelatch-core/
├── docs/
│   ├── getting-started.md      # Setup guide
│   └── api-reference.md        # Full API docs
├── management-api/             # Tenant management REST API
│   └── src/
│       ├── routes/             # auth.js, rules.js, usage.js
│       └── middleware/         # authenticate.js (JWT)
├── rate-limiter/               # Gateway service
│   └── src/
│       ├── lua/                # slidingWindow.lua (atomic check)
│       ├── tenantResolver.js   # X-Project-Key → tenant lookup
│       ├── ruleLoader.js       # Redis-cached rule matching
│       ├── usageTracker.js     # Async usage logging
│       └── forwarder.js        # Upstream proxy
├── migrations/                 # Ordered SQL migration files
├── nginx/
│   └── nginx.conf              # Reverse proxy routing
├── tests/
│   ├── manual.sh               # Smoke test suite (12 tests)
│   └── loadtest.js             # k6 load test (50 VUs)
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Related

- **[RateLatch-dashboard](https://github.com/Krushnakant-08/RateLatch-dashboard)** — Next.js frontend with real-time analytics and rule management

---

## License

MIT © 2025 RateLatch
