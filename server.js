const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const puppeteer = require('puppeteer');

const app = express();

// 1️⃣ Puppeteer route to fully render Cloudflare‑protected pages
app.get('/infinite-craft', async (req, res, next) => {
  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    // Spoof headers to look like a real browser
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://google.com/',
    });

    await page.goto('https://neal.fun/infinite-craft/', { waitUntil: 'networkidle0' });
    const html = await page.content();
    await browser.close();
    return res.send(html);
  } catch (err) {
    console.error('Puppeteer error:', err);
    // Fallback to proxy if Puppeteer fails
    return next();
  }
});

// 2️⃣ Standard reverse‑proxy for all other assets & routes, with header spoofing
app.use(
  '/',
  createProxyMiddleware({
    target: 'https://neal.fun',
    changeOrigin: true,
    selfHandleResponse: false,
    pathRewrite: { '^/': '/' },
    onProxyReq(proxyReq, req, res) {
      // Remove compression so we can read/manipulate if needed
      proxyReq.removeHeader('accept-encoding');
      // Spoof browser headers
      proxyReq.setHeader(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36'
      );
      proxyReq.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9');
      proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
      proxyReq.setHeader('Referer', 'https://google.com/');
    },
  })
);

app.listen(3000, () => {
  console.log('Proxy + Puppeteer fallback running on http://localhost:3000');
});
