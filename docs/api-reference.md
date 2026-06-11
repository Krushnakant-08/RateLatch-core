# RateLatch-core — API Reference

All API requests go through **Nginx on port 80** (`http://localhost` in development). Nginx routes:

- `POST /manage/register` → Management API (public)
- `POST /manage/login` → Management API (public)
- `GET|POST|PUT|DELETE /manage/*` → Management API (requires Bearer token)
- `GET /manage/usage` → Management API (requires Bearer token)
- `/* (all other paths)` → Rate Limiter Gateway (requires `X-Project-Key` header)

---

## Authentication

Most management endpoints require a **Bearer token** (JWT) returned after registration or login.

```
Authorization: Bearer <dashboardToken>
```

Gateway endpoints require the **Project Key** header:

```
X-Project-Key: rl_live_xxxxxxxxxxxxxxxxxxxx
```

---

## Management API

Base URL: `http://localhost/manage`

---

### `POST /manage/register`

Register a new tenant and receive a project key.

**Request body:**

```json
{
  "email": "dev@company.com",
  "upstreamUrl": "https://api.yourcompany.com",
  "plan": "free"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | ✅ | Unique email for this tenant |
| `upstreamUrl` | string | ✅ | Your backend API URL (requests are proxied here) |
| `plan` | string | ✅ | `free`, `pro`, or `enterprise` |

**Response `201 Created`:**

```json
{
  "tenantId": "c6a2c2b3-e890-49a8-82cd-ebe8dd20db57",
  "projectKey": "rl_live_cyQ5MFMGPHRBER3I_PAj1Q",
  "dashboardToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

> ⚠️ **Save the `projectKey` immediately.** It is hashed in the database and cannot be recovered.

---

### `POST /manage/login`

Authenticate and receive a fresh dashboard token.

**Request body:**

```json
{
  "email": "dev@company.com",
  "projectKey": "rl_live_cyQ5MFMGPHRBER3I_PAj1Q"
}
```

**Response `200 OK`:**

```json
{
  "tenantId": "c6a2c2b3-e890-49a8-82cd-ebe8dd20db57",
  "dashboardToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### `GET /manage/rules`

List all rate limit rules for the authenticated tenant.

**Headers:** `Authorization: Bearer <token>`

**Response `200 OK`:**

```json
{
  "rules": [
    {
      "id": "f7d3...",
      "route": "/api/login",
      "key_by": "ip",
      "max_req": 5,
      "window_ms": 60000,
      "priority": 10,
      "created_at": "2025-06-11T07:35:00Z"
    },
    {
      "id": "a1b2...",
      "route": "*",
      "key_by": "ip",
      "max_req": 100,
      "window_ms": 60000,
      "priority": 0,
      "created_at": "2025-06-11T07:35:05Z"
    }
  ]
}
```

---

### `POST /manage/rules`

Create a new rate limit rule.

**Headers:** `Authorization: Bearer <token>`

**Request body:**

```json
{
  "route": "/api/login",
  "keyBy": "ip",
  "maxReq": 5,
  "windowMs": 60000,
  "priority": 10
}
```

| Field | Type | Description |
|---|---|---|
| `route` | string | Path pattern. Use `*` for catch-all, `/api/*` for prefix matching |
| `keyBy` | string | `ip` — client IP; `api_key` — `X-API-Key` header; `user_id` — `X-User-ID` header |
| `maxReq` | integer | Maximum requests allowed in the window |
| `windowMs` | integer | Window size in milliseconds (e.g. `60000` = 1 minute) |
| `priority` | integer | Rules with higher priority are evaluated first (default: `0`) |

**Response `201 Created`:**

```json
{
  "rule": {
    "id": "f7d3...",
    "route": "/api/login",
    "key_by": "ip",
    "max_req": 5,
    "window_ms": 60000,
    "priority": 10,
    "created_at": "2025-06-11T08:00:00Z"
  }
}
```

---

### `PUT /manage/rules/:ruleId`

Update an existing rule. All fields are optional.

**Headers:** `Authorization: Bearer <token>`

**Request body (partial update):**

```json
{
  "maxReq": 10,
  "windowMs": 30000
}
```

**Response `200 OK`:** Updated rule object (same shape as `POST /manage/rules`)

---

### `DELETE /manage/rules/:ruleId`

Delete a rate limit rule.

**Headers:** `Authorization: Bearer <token>`

**Response `200 OK`:**

```json
{
  "message": "Rule deleted"
}
```

---

### `GET /manage/usage`

Retrieve hourly usage statistics for the authenticated tenant.

**Headers:** `Authorization: Bearer <token>`

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `hours` | integer | `24` | How many hours of history to return |
| `from` | ISO 8601 | — | Start time (overrides `hours`) |
| `to` | ISO 8601 | — | End time |

**Example:**

```
GET /manage/usage?hours=48
```

**Response `200 OK`:**

```json
{
  "summary": {
    "totalAllowed": 15234,
    "totalBlocked": 412,
    "blockRate": "2.63%"
  },
  "hourly": [
    {
      "hour": "2025-06-11T06:00:00.000Z",
      "allowed": 843,
      "blocked": 17
    },
    {
      "hour": "2025-06-11T07:00:00.000Z",
      "allowed": 1021,
      "blocked": 34
    }
  ]
}
```

---

## Gateway (Rate Limiter)

Any path not starting with `/manage/` or `/admin/` is handled by the gateway.

### `ANY /*`

All HTTP methods and paths. The gateway:
1. Reads `X-Project-Key` to identify the tenant.
2. Evaluates matching rate limit rules (highest `priority` first).
3. If allowed: proxies the request to the tenant's `upstreamUrl` and streams the response back.
4. If blocked: returns `429` immediately without hitting upstream.

**Required header:**

```
X-Project-Key: rl_live_xxxxxxxxxxxxxxxxxxxx
```

**Optional headers (used when `keyBy` is `api_key` or `user_id`):**

```
X-API-Key: your-customer-api-key
X-User-ID: user-123
```

**Response headers on allowed requests:**

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1718098800
```

**Response on `429 Too Many Requests`:**

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
Content-Type: application/json

{
  "error": "Too Many Requests",
  "retryAfter": 42
}
```

**Response on `401 Unauthorized` (missing/invalid project key):**

```json
{
  "error": "Unauthorized"
}
```

---

## Rule Matching Logic

Rules are matched against the request path in **priority order** (highest `priority` integer first):

1. Exact match: `/api/login` matches only `/api/login`
2. Wildcard: `/api/*` matches `/api/users`, `/api/products`, etc.
3. Catch-all: `*` matches everything

The **first** matching rule is applied. If no rules match, the request falls through to the plan's default limits.

### Default Plan Limits

| Plan | Default Limit | Window |
|---|---|---|
| `free` | 100 req | 60 seconds |
| `pro` | 1,000 req | 60 seconds |
| `enterprise` | 10,000 req | 60 seconds |

---

## Error Reference

| Status | Code | Meaning |
|---|---|---|
| `400` | Bad Request | Missing or invalid request body fields |
| `401` | Unauthorized | Missing/invalid `Authorization` token or `X-Project-Key` |
| `404` | Not Found | Rule ID does not exist or does not belong to your tenant |
| `409` | Conflict | Email already registered |
| `422` | Unprocessable | Field values fail validation (e.g. `maxReq < 1`) |
| `429` | Too Many Requests | Rate limit exceeded |
| `502` | Bad Gateway | Upstream API returned an error or is unreachable |
| `504` | Gateway Timeout | Upstream API timed out |
