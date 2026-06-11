const { createProxyMiddleware } = require('http-proxy-middleware');

const UPSTREAM_TIMEOUT = parseInt(process.env.UPSTREAM_TIMEOUT_MS, 10) || 10000;

/**
 * Forward an allowed request to the tenant's upstream URL.
 *
 * @param {import('express').Request} req  - Express request (must have req.tenant with upstream_url)
 * @param {import('express').Response} res
 */
function forwardRequest(req, res) {
  const upstreamUrl = req.tenant.upstream_url;

  const proxy = createProxyMiddleware({
    target: upstreamUrl,
    changeOrigin: true,
    timeout: UPSTREAM_TIMEOUT,
    proxyTimeout: UPSTREAM_TIMEOUT,
    // Don't follow redirects — let the client handle them
    followRedirects: false,
    // Remove gateway-specific headers before forwarding
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.removeHeader('x-project-key');
        proxyReq.removeHeader('x-api-key');
      },
      error: (err, _req, res) => {
        console.error(`[Forwarder] Proxy error to ${upstreamUrl}:`, err.message);
        if (!res.headersSent) {
          res.status(502).json({
            error: 'Bad Gateway',
            message: 'Failed to reach upstream service',
          });
        }
      },
    },
  });

  proxy(req, res, (err) => {
    if (err) {
      console.error('[Forwarder] Middleware error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Bad Gateway',
          message: 'Failed to reach upstream service',
        });
      }
    }
  });
}

module.exports = { forwardRequest };
