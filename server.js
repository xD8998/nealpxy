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

// Proxy rotation setup
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

// 1️⃣ Puppeteer‑rendered route (Cloudflare bypass + full UI support)
app.get('/infinite-craft', async (req, res, next) => {
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    // Spoof a realistic desktop viewport for proper layout
    await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://google.com/'
    });

    // Wait for all network activity to finish
    await page.goto('https://neal.fun/infinite-craft/', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    let html = await page.content();
    await browser.close();

    // Inject <base> so relative URLs resolve correctly
    html = html.replace(
      /<head(\s|>)/i,
      `<head$1<base href="https://neal.fun/">`
    );

    // Remove any embedded Content-Security-Policy meta tags
    html = html.replace(
      /<meta http-equiv="Content-Security-Policy"[^>]*>/gi,
      ''
    );

    // Strip Cloudflare's iframe injector script at the bottom
    html = html.replace(
      /<script>\(function\(\)\{[\s\S]*?<\/iframe>\s*<\/script>/i,
      ''
    );

    return res.send(html);

  } catch (err) {
    console.error('Puppeteer route error:', err.message);
    if (browser) {
      await browser.close().catch(() => {});
    }
    return next();  // fallback to reverse proxy
  }
});

// 2️⃣ Standard reverse-proxy for all other assets and routes
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
      // Remove restrictions so CSS/JS/images execute via your domain
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['content-security-policy-report-only'];
      delete proxyRes.headers['x-frame-options'];
    }
  })
);

app.listen(3000, () => {
  console.log('Proxy + Puppeteer (networkidle2, viewport & <base> injected) running on http://localhost:3000');
});
