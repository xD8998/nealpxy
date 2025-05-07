/* eslint-disable no-console */
require('dotenv').config();

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const puppeteer = require('puppeteer');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const ProxyPlugin = require('puppeteer-extra-plugin-proxy');
const { Solver } = require('2captcha-ts');

puppeteerExtra.use(StealthPlugin());

// Proxy rotation
const proxies = process.env.PROXY_LIST?.split(',').map(x => x.trim()) || [];
let idx = 0;
function nextProxy() {
  return proxies.length ? proxies[idx++ % proxies.length] : null;
}

async function launchBrowser() {
  const browserOpts = {
    executablePath: puppeteer.executablePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };

  const proxyURL = nextProxy();
  if (proxyURL) {
    puppeteerExtra.use(ProxyPlugin({ proxy: proxyURL }));
  }

  return puppeteerExtra.launch(browserOpts);
}

const app = express();

// 1️⃣ Puppeteer‑fetched HTML (Cloudflare bypass)
app.get('/infinite-craft', async (req, res, next) => {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://google.com/'
    });

    await page.goto('https://neal.fun/infinite-craft/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    let html = await page.content();
    await browser.close();

    // Remove any embedded Content-Security-Policy <meta> tags
    html = html.replace(
      /<meta http-equiv="Content-Security-Policy"[^>]*>/gi,
      ''
    );

    // Send the cleaned HTML
    return res.send(html);

  } catch (err) {
    console.error('Puppeteer route error:', err.message);
    if (browser) await browser.close().catch(() => {});
    return next(); // fallback to proxy
  }
});

// 2️⃣ Full reverse‑proxy for all other assets & routes
app.use(
  '/',
  createProxyMiddleware({
    target: 'https://neal.fun',
    changeOrigin: true,
    selfHandleResponse: false,
    pathRewrite: { '^/': '/' },
    onProxyReq(proxyReq) {
      proxyReq.removeHeader('accept-encoding');
      proxyReq.setHeader(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
      );
      proxyReq.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9');
      proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
      proxyReq.setHeader('Referer', 'https://google.com/');
    },
    onProxyRes(proxyRes) {
      // Remove CSP headers so the browser will load proxied scripts/CSS/images
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['content-security-policy-report-only'];
    }
  })
);

app.listen(3000, () => {
  console.log('Proxy + Puppeteer (stripping CSP) live on http://localhost:3000');
});
