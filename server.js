// server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const compression = require('compression');
const apicache = require('apicache');
const http = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { Server } = require('socket.io');

const COOKIE_CLICKER_HOST = 'https://orteil.dashnet.org';
let totalCookies = 0;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// —————————————————————————————
// 1) GLOBAL MIDDLEWARES
// —————————————————————————————
app.use(compression());                       // gzip/brotli
const cache = apicache.options({ debug: false }).middleware;

// —————————————————————————————
// 2) STATIC MIRROR FOR ASSETS
//    (one‑time fetch via wget or similar)
// —————————————————————————————
app.use(
  '/cookieclicker',
  express.static(path.join(__dirname, 'static-cookie-clicker'), {
    maxAge: '1d', // browser caches for 24 h
  })
);

// —————————————————————————————
// 3) SOCKET.IO REAL‑TIME STATE
// —————————————————————————————
io.on('connection', socket => {
  socket.emit('sync', totalCookies);
  socket.on('click', () => {
    totalCookies++;
    io.emit('sync', totalCookies);
  });
});
app.use(
  '/socket.io',
  express.static(require.resolve('socket.io-client/dist/socket.io.js'))
);

// —————————————————————————————
// 4) PROXY + HTML INJECTION
//    ONLY for paths under /cookieclicker
// —————————————————————————————
const ccProxy = createProxyMiddleware({
  target: COOKIE_CLICKER_HOST,
  changeOrigin: true,
  selfHandleResponse: true,
  pathRewrite: { '^/cookieclicker': '/cookieclicker' },  
  onProxyRes(proxyRes, req, res) {
    const contentType = proxyRes.headers['content-type'] || '';
    // If not HTML, just pipe through
    if (!contentType.includes('text/html')) {
      return proxyRes.pipe(res);
    }

    // Buffer the HTML
    let body = '';
    proxyRes.on('data', chunk => (body += chunk));
    proxyRes.on('end', () => {
      // 1) Fix relative URLs
      body = body.replace(
        /<head(\s|>)/i,
        `<head$1<base href="${COOKIE_CLICKER_HOST}/cookieclicker/">`
      );

      // 2) Preload critical assets ASAP
      const preload = `
        <link rel="preload" href="/cookieclicker/cookieclicker.js" as="script">
        <link rel="preload" href="/cookieclicker/style.css" as="style">
      `;

      // 3) Inject your real‑time sync script
      const inject = `
        <script src="/socket.io/socket.io.js"></script>
        <script>
          const socket = io();
          socket.on('sync', c => {
            if (window.Game && typeof Game.UpdateCookieDisplay === 'function') {
              Game.cookies = c;
              Game.UpdateCookieDisplay();
            }
          });
          document.addEventListener('click', e => {
            if (e.target.id === 'bigCookie') {
              socket.emit('click');
            }
          });
        </script>
      `;

      // 4) Splice them in
      body = body.replace('</head>', preload + inject + '</head>');

      res.setHeader('Content-Type', 'text/html');
      res.send(body);
    });
  }
});

// Mount your proxy at “/cookieclicker” (after the static mirror)
// — static files win first, then hits the proxy if missing
app.use('/cookieclicker', cache('5 minutes'), ccProxy);

// —————————————————————————————
// 5) START THE SERVER
// —————————————————————————————
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🔗 Proxy live at http://localhost:${PORT}/cookieclicker`);
});
