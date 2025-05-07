/* eslint-disable no-console */
require('dotenv').config();

const express = require('express');
const http = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { Server } = require('socket.io');

const COOKIE_CLICKER_HOST = 'https://orteil.dashnet.org';
let totalCookies = 0;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// —————————————————————————————
// 1) Real‑time state via Socket.IO
// —————————————————————————————
io.on('connection', socket => {
  // send current count on join
  socket.emit('sync', totalCookies);

  // when someone clicks the big cookie…
  socket.on('click', () => {
    totalCookies++;
    // broadcast new count to everyone
    io.emit('sync', totalCookies);
  });
});

// serve the socket.io client library
app.use('/socket.io', express.static(
  require.resolve('socket.io-client/dist/socket.io.js')
));

// —————————————————————————————
// 2) Proxy & HTML injection
// —————————————————————————————
app.use('/', createProxyMiddleware({
  target: COOKIE_CLICKER_HOST,
  changeOrigin: true,
  selfHandleResponse: true,      // so we can transform the HTML
  onProxyRes: async (proxyRes, req, res) => {
    // only transform the main game page
    if (!req.url.startsWith('/cookieclicker/')) {
      // pipe everything else (assets, JS, CSS) unmodified
      proxyRes.pipe(res);
      return;
    }

    // buffer the HTML
    let body = '';
    proxyRes.on('data', chunk => body += chunk);
    proxyRes.on('end', () => {
      // inject Socket.IO + sync script just before </head>
      const inject = `
        <script src="/socket.io/socket.io.js"></script>
        <script>
          const socket = io();
          // update our local Game.cookies whenever the server broadcasts
          socket.on('sync', c => {
            if (window.Game && typeof Game.UpdateCookieDisplay === 'function') {
              Game.cookies = c;
              Game.UpdateCookieDisplay();
            }
          });
          // intercept clicks on the big cookie
          document.addEventListener('click', e => {
            if (e.target.id === 'bigCookie') {
              socket.emit('click');
            }
          });
        </script>
      `;

      // make sure relative paths still work
      body = body.replace(
        /<head(\s|>)/i,
        `<head$1<base href="${COOKIE_CLICKER_HOST}/cookieclicker/">`
      );

      // inject our script
      body = body.replace('</head>', inject + '</head>');

      res.setHeader('content-type', 'text/html');
      res.send(body);
    });
  }
}));

// start everything
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🔗 Live Cookie Clicker proxy running on http://localhost:${PORT}`);
});
