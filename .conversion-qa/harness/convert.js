/* Drives the actual LuxPDF tool pages in headless Chromium to run conversions.
   Usage: node convert.js <tool-page.html> <input-file> <output-dir> [timeoutSec] */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '../..');

function serveStatic(port) {
  const mime = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon'
  };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(port, () => resolve(server)));
}

(async () => {
  const [page_, input, outDir, timeoutSec] = process.argv.slice(2);
  const timeout = (Number(timeoutSec) || 300) * 1000;
  fs.mkdirSync(outDir, { recursive: true });

  const port = 8765 + Math.floor(Math.random() * 1000);
  const server = await serveStatic(port);
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  page.on('console', msg => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') console.log(`[browser:${t}]`, msg.text().slice(0, 500));
  });
  page.on('pageerror', err => console.log('[pageerror]', String(err).slice(0, 800)));

  await page.goto(`http://localhost:${port}/${page_}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.pdfConverter, null, { timeout: 30000 });

  // Hook showResults so we can grab the raw result objects (UI uses onclick buttons, not anchors)
  await page.evaluate(() => {
    const c = window.pdfConverter;
    const orig = c.showResults.bind(c);
    c.showResults = (results) => { window.__lastResults = results; return orig(results); };
  });

  await page.setInputFiles('#file-input', input);
  await page.waitForTimeout(500);

  // Click the process button
  await page.click('#process-btn');

  // Wait for results to appear (download links) or an error notification
  const started = Date.now();
  let done = false;
  while (Date.now() - started < timeout) {
    done = await page.evaluate(() => Array.isArray(window.__lastResults) && window.__lastResults.length > 0);
    if (done) break;
    const failed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.notification, .toast, .notification-error, .error-message'))
        .map(n => n.textContent || '').join(' | '));
    if (/Failed to convert any|Processing failed/i.test(failed)) {
      console.error('CONVERSION FAILED:', failed);
      break;
    }
    await page.waitForTimeout(1000);
  }

  // Extract result blobs
  const results = await page.evaluate(async () => {
    const items = (window.__lastResults || []).filter(r => r && r.url);
    const out = [];
    for (const item of items) {
      const buf = await (await fetch(item.url)).arrayBuffer();
      out.push({ name: item.name, data: Array.from(new Uint8Array(buf)) });
    }
    return out;
  });

  if (!results.length) {
    console.error('No results produced');
    await page.screenshot({ path: path.join(outDir, 'failure.png'), fullPage: true });
    await browser.close();
    server.close();
    process.exit(1);
  }

  for (const r of results) {
    const file = path.join(outDir, r.name.replace(/[\/\\]/g, '_'));
    fs.writeFileSync(file, Buffer.from(r.data));
    console.log('WROTE', file, fs.statSync(file).size, 'bytes');
  }

  await browser.close();
  server.close();
})().catch(err => { console.error(err); process.exit(1); });
