const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();

app.use(
  '/',
  createProxyMiddleware({
    target: 'https://neal.fun',
    changeOrigin: true,
    selfHandleResponse: false,
    pathRewrite: {
      '^/': '/', // keep the same path
    },
    onProxyReq(proxyReq, req, res) {
      // Remove compression headers so content isn't encoded (optional)
      proxyReq.removeHeader('accept-encoding');
    },
  })
);

app.listen(3000, () => {
  console.log('Full proxy server running on http://localhost:3000');
});
