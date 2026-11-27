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
      for (let attempt = 0; attempt < 15; attempt++) {
        const ready = await Promise.all(page.frames().filter(frame => frame !== page.mainFrame()).map(frame => frame.locator('canvas').count().catch(() => 0)));
        if (ready.some(count => count > 0)) { await page.waitForTimeout(2000); break; }
        await page.waitForTimeout(1000);
      }
      const selector = 'div[role="button"][aria-label][tabindex]';
      const snapshot = async () => {
        const candidates = [];
        for (const frame of page.frames()) {
          if (frame === page.mainFrame()) continue;
          try {
            const counts = await frame.evaluate(selector => {
              if (!document.querySelector('canvas')) return null;
              const nodes = [...document.querySelectorAll(selector)];
              if (!nodes.length) return null;
              const sold = nodes.filter(el => el.getAttribute('aria-disabled') === 'true').length;
              const free = nodes.filter(el => [null, 'false'].includes(el.getAttribute('aria-disabled')) && !el.hasAttribute('disabled') && el.textContent.trim().length > 0).length;
              const labels = nodes.map(el => el.getAttribute('aria-label')?.trim() ?? '');
              return { total: nodes.length, free, sold, unknown: nodes.length - free - sold, unique_labels: new Set(labels).size, empty_labels: labels.filter(label => !label).length };
            }, selector);
            if (counts) candidates.push(counts);
          } catch { return null; }
        }
        return candidates.length === 1 ? candidates[0] : null;
      };
      const first = await snapshot();
      await page.waitForTimeout(2000);
      const second = await snapshot();
      const stable = first !== null && JSON.stringify(first) === JSON.stringify(second);
      const valid = response?.ok() && stable && second.unknown === 0 && second.empty_labels === 0 && second.unique_labels === second.total;
      results.push({ id: target.id, status: response?.status() ?? null, stable, candidate_counts: valid ? second : null, verified_counts: null, result: valid ? 'candidate_counts_ready' : 'unverified_structure' });
    } catch (error) {
      // Do not leak page URLs from exception messages into public logs.
      results.push({ id: target.id, status: null, embedded_frames: 0, verified_counts: null, result: 'navigation_failed' });
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ checked_at: new Date().toISOString(), targets_checked: results.length, counts_verified: 0, results }, null, 2));
