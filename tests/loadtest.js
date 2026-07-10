import http from 'k6/http';
import { check, sleep } from 'k6';

// ─── Configuration ──────────────────────────────────
// Set these before running:
//   export PROJECT_KEY=rl_live_yourkey
//   k6 run tests/loadtest.js

const BASE_URL = __ENV.BASE_URL || 'http://localhost';
const PROJECT_KEY = __ENV.PROJECT_KEY || 'rl_live_c7jntwrlgXfE8LYCk4I6yA';

export const options = {
  scenarios: {
    sustained_load: {
      executor: 'constant-vus',
      vus: 500,
      duration: '1m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<50', 'p(99)<100'],
    http_req_failed: ['rate<0.01'], // Less than 1% non-HTTP errors
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

// ─── Test Logic ─────────────────────────────────────

export default function () {
  const endpoints = ['/api/health'];
  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

  const res = http.get(`${BASE_URL}${endpoint}`, {
    headers: {
      'X-Project-Key': PROJECT_KEY,
    },
  });

  // Verify: response is either 200 (allowed) or 429 (rate limited)
  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'has X-RateLimit-Limit header': (r) =>
      r.headers['X-Ratelimit-Limit'] !== undefined,
    'has X-RateLimit-Remaining header': (r) =>
      r.headers['X-Ratelimit-Remaining'] !== undefined,
  });

  // Additional checks for 429 responses
  if (res.status === 429) {
    check(res, {
      '429 has Retry-After header': (r) =>
        r.headers['Retry-After'] !== undefined,
      '429 body has error message': (r) => {
        const body = JSON.parse(r.body);
        return body.error === 'Too Many Requests';
      },
    });
  }

  // Simulate realistic request pacing (20 req/s per VU = 50ms sleep)
  sleep(0.05);
}

export function handleSummary(data) {
  const totalReqs = data.metrics.http_reqs.values.count;
  const avgDuration = data.metrics.http_req_duration.values.avg.toFixed(1);
  const p95Duration = data.metrics.http_req_duration.values['p(95)'].toFixed(1);
  const p99Duration = data.metrics.http_req_duration.values['p(99)'].toFixed(1);

  console.log('\n═══════════════════════════════════════');
  console.log('  RateLimiter Load Test Summary');
  console.log('═══════════════════════════════════════');
  console.log(`  Total requests:  ${totalReqs}`);
  console.log(`  Avg latency:     ${avgDuration}ms`);
  console.log(`  p95 latency:     ${p95Duration}ms`);
  console.log(`  p99 latency:     ${p99Duration}ms`);
  console.log('═══════════════════════════════════════\n');

  return {};
}
