import { chromium } from 'playwright';

const maxTargets = 100;
const maxPageTimeMs = 25_000;

function targetsFromEnv() {
  const raw = process.env.MONITOR_TARGETS_JSON;
  if (!raw) return [];
  let values;
  try { values = JSON.parse(raw); } catch { throw new Error('MONITOR_TARGETS_JSON must be valid JSON'); }
  if (!Array.isArray(values) || values.length > maxTargets) throw new Error('Expected array of no more than 100 targets');
  return values.map((value, i) => {
    if (!value || typeof value !== 'object' || typeof value.url !== 'string') throw new Error('Invalid target at index ' + i);
    const url = new URL(value.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Only clean HTTPS URLs are accepted');
    if (!/^[a-z0-9.-]+$/i.test(url.hostname)) throw new Error('Invalid hostname');
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(url.hostname)) throw new Error('Private host rejected');
    const id = typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(value.id) ? value.id : String(i+1);
    return { id, url: url.href };
  });
}

const targets = targetsFromEnv();
if (!targets.length) {
  console.log(JSON.stringify({ status: 'not_configured', targets_checked: 0, counts_verified: 0 }));
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const target of targets) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: maxPageTimeMs });
      await page.waitForTimeout(3000);
      const frames = page.frames().length - 1;
      results.push({ id: target.id, status: response?.status() ?? null, embedded_frames: frames, verified_counts: null, result: 'diagnostic_only' });
    } catch (error) {
      // Do not leak page URLs from exception messages into public logs.
      results.push({ id: target.id, status: null, embedded_frames: 0, verified_counts: null, result: 'navigation_failed' });
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ checked_at: new Date().toISOString(), targets_checked: results.length, counts_verified: 0, results }, null, 2));
