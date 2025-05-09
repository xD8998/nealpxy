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
// 0) Helpers & Cache Setup
// —————————————————————————————
const cache = apicache.middleware;

// —————————————————————————————
// 1) Compression (gzip/brotli)
// —————————————————————————————
app.use(compression());

// —————————————————————————————
// 2) Serve local static assets mirror
//    (requires you to mirror with something like
//     `wget -r -np -k https://orteil.dashnet.org/cookieclicker/ -P ./static-cookie-clicker`)
// —————————————————————————————
app.use(
  '/cookieclicker/',
  express.static(path.join(__dirname, 'static-cookie-clicker'), {
    maxAge: '1d', // browser cache for 1 day
  })
);

// —————————————————————————————
// 3) Cache static asset routes in-memory
// —————————————————————————————
app.use('/cookieclicker/*.js', cache('12 hours'));
app.use('/cookieclicker/*.css', cache('12 hours'));
app.use('/cookieclicker/*.png', cache('12 hours'));
app.use('/cookieclicker/*.jpg', cache('12 hours'));

// —————————————————————————————
// 4) Optional: cache HTML for a few minutes
// —————————————————————————————
app.use('/cookieclicker/', cache('5 minutes'));

// —————————————————————————————
// 5) Real‑time state via Socket.IO
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
// 6) Proxy & HTML injection (no mount path with colons!)
// —————————————————————————————
app.use(
  createProxyMiddleware({
    target: COOKIE_CLICKER_HOST,
    changeOrigin: true,
    selfHandleResponse: true,
    onProxyRes: (proxyRes, req, res) => {
      // If it’s not the main game HTML, just pipe unchanged
      if (!req.url.startsWith('/cookieclicker/')) {
        return proxyRes.pipe(res);
      }

      let body = '';
      proxyRes.on('data', chunk => (body += chunk));
      proxyRes.on('end', () => {
        // 1) Fix relative paths
        body = body.replace(
          /<head(\s|>)/i,
          `<head$1<base href="${COOKIE_CLICKER_HOST}/cookieclicker/">`
        );

        // 2) Preload the big bundles ASAP
        const preload = `
          <link rel="preload" href="/cookieclicker/cookieclicker.js" as="script">
          <link rel="preload" href="/cookieclicker/style.css" as="style">
        `;

        // 3) Inject Socket.IO + sync logic
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

        // 4) Splice it in
        body = body.replace('</head>', preload + inject + '</head>');

        res.setHeader('Content-Type', 'text/html');
        res.send(body);
      });
    },
  })
);

// —————————————————————————————
// 7) Start server
// —————————————————————————————
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🔗 Cookie Clicker proxy listening on http://localhost:${PORT}`);
});
