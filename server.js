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

const proxies = process.env.PROXY_LIST?.split(',').map(p => p.trim()) || [];
let idx = 0;
function nextProxy() {
  return proxies.length ? proxies[idx++ % proxies.length] : null;
}

const captchaSolver = new Solver(process.env.CAPTCHA_API_KEY || '');

async function launchBrowser() {
  const proxyURL = nextProxy();
  if (proxyURL) puppeteerExtra.use(ProxyPlugin({ proxy: proxyURL }));

  return puppeteerExtra.launch({
    executablePath: puppeteer.executablePath(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
}

const app = express();

// 1️⃣ Headless-rendered route (Cloudflare bypass)
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

    // Optional: hook in captchaSolver here if you need Turnstile solving

    await page.goto('https://neal.fun/infinite-craft/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    const html = await page.content();
    await browser.close();
    return res.send(html);

  } catch (err) {
    console.error('Puppeteer route error:', err.message);
    if (browser) await browser.close().catch(() => {});
    return next(); // fallback to proxy
  }
});

// 2️⃣ Standard reverse-proxy for all other assets
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
    }
  })
);

app.listen(3000, () => {
  console.log('Proxy + Puppeteer (60 s timeout) live on http://localhost:3000');
});
