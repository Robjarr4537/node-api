// index.js
'use strict';

const express = require('express');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// ---- Required Environment Variables ----
const REQUIRED_ENV = [
  'SHEETS_BEST_API_KEY',
  'SHEETS_BEST_URL',           // sources
  'SHEETS_BEST_POSTS_URL',     // posts
  'SHEETS_BEST_QUEUE_URL',     // queue
  'SHEETS_BEST_LOGS_URL',      // logs
  'SHEETS_BEST_REVENUE_URL'    // revenue
];

function validateEnv() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k] || !String(process.env[k]).trim());
  if (missing.length) {
    const msg = `Missing required env vars: ${missing.join(', ')}`;
    console.error(msg);
    throw new Error(msg);
  }
}
validateEnv();

// ---- Fetch Polyfill ----
const ensureFetch = global.fetch
  ? global.fetch
  : ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

// ---- Utilities ----
async function jsonFetch(url, options = {}, { retries = 2, timeoutMs = 10000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

      const res = await ensureFetch(url, {
        ...options,
        signal: controller ? controller.signal : undefined
      });

      if (timer) clearTimeout(timer);

      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = text; }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText} -> ${typeof data === 'string' ? data : JSON.stringify(data)}`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function nowISO() { return new Date().toISOString(); }
function norm(s) { return (s || '').trim().toLowerCase(); }

// ---- Sheet Writers ----
async function writeLog(entry) {
  const url = process.env.SHEETS_BEST_LOGS_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  const payload = { timestamp: nowISO(), ...entry };
  try {
    await jsonFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify(payload)
    });
  } catch (err) { console.error('writeLog failed:', err); }
}

async function writeRevenue(entry) {
  const url = process.env.SHEETS_BEST_REVENUE_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  const payload = { timestamp: nowISO(), ...entry };
  try {
    await jsonFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify(payload)
    });
  } catch (err) { console.error('writeRevenue failed:', err); }
}

async function getSources() {
  return jsonFetch(process.env.SHEETS_BEST_URL, { headers: { 'X-API-KEY': process.env.SHEETS_BEST_API_KEY } });
}
async function getPosts() {
  return jsonFetch(process.env.SHEETS_BEST_POSTS_URL, { headers: { 'X-API-KEY': process.env.SHEETS_BEST_API_KEY } });
}
async function insertPost(row) {
  try {
    return await jsonFetch(process.env.SHEETS_BEST_POSTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.SHEETS_BEST_API_KEY },
      body: JSON.stringify(row)
    });
  } catch (err) { console.error('insertPost failed:', err); throw err; }
}
async function insertQueue(row) {
  try {
    return await jsonFetch(process.env.SHEETS_BEST_QUEUE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.SHEETS_BEST_API_KEY },
      body: JSON.stringify(row)
    });
  } catch (err) { console.error('insertQueue failed:', err); throw err; }
}
async function getQueue() {
  return jsonFetch(process.env.SHEETS_BEST_QUEUE_URL, { headers: { 'X-API-KEY': process.env.SHEETS_BEST_API_KEY } });
}
async function updateQueueRow(row) {
  const base = process.env.SHEETS_BEST_QUEUE_URL;
  const id = row.id || row.ID || row._id || '';
  const url = id ? `${base}/${id}` : base;
  try {
    return await jsonFetch(url, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': process.env.SHEETS_BEST_API_KEY },
      body: JSON.stringify(row)
    });
  } catch (err) { console.error('updateQueueRow failed:', err); throw err; }
}

// ---- RSS Parser ----
function parseRSS(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const items = [];
  const itemBlocks = xmlText.match(/<item[\s\S]*?<\/item>/gi) || [];
  const tag = (block, name) => {
    const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block);
    if (!m) return '';
    return m[1]
      .replace(/<!

\[CDATA

\[(.*?)\]

\]

>/gs, '$1').replace(/\s+/g, ' ').trim();
  };
  for (const b of itemBlocks) {
    items.push({ title: tag(b, 'title'), link: tag(b, 'link'), pubDate: tag(b, 'pubDate') });
  }
  return items.filter(i => i.title || i.link);
}
function existsPost(posts, title, link) {
  const t = norm(title), l = norm(link);
  return (Array.isArray(posts) ? posts : []).some(p =>
    norm(p.title) === t || norm(p.affilliate_url) === l || norm(p.body).includes(link || '')
  );
}

// ---- Anti-abuse caps ----
const CAPS = { maxItemsPerSource: 5, maxNewPostsTotal: 25, queueLeadMinutes: 30 };

// ---- Cron A ----
async function runCronA() {
  console.log(`[${nowISO()}] Cron A fired`);
  let created = 0, queued = 0;
  try {
    const sources = await getSources();
    const active = (Array.isArray(sources) ? sources : []).filter(s => String(s.active).toUpperCase() === 'TRUE');
    const posts = await getPosts();
    for (const src of active) {
      if (created >= CAPS.maxNewPostsTotal) break;
      const type = norm(src.type), label = src.label || 'source', url = src.url_or_key || src.url || '';
      if (!url || type !== 'feed') continue;
      const rssText = await ensureFetch(url).then(r => r.text()).catch(err => { console.error(`RSS fetch failed for ${label}:`, err); return ''; });
      const items = parseRSS(rssText).slice(0, CAPS.maxItemsPerSource);
      for (const item of items) {
        if (created >= CAPS.maxNewPostsTotal) break;
        if (existsPost(posts, item.title, item.link)) continue;
        const newPost = {
          created_at: nowISO(),
          source: label,
          title: item.title || '(untitled)',
          body: item.link ? `Source: ${item.link}` : '',
          media_url: '',
          status: 'pending',
          platform: 'twitter',
          affilliate_url: item.link || ''
        };
        try {
          await insertPost(newPost);
          posts.push(newPost);
          created++;
          const scheduleAt = new Date(Date.now() + CAPS.queueLeadMinutes * 60 * 1000).toISOString();
          await insertQueue({ schedule_at: scheduleAt, platform: 'twitter', post_id: '', status: 'pending', last_attempt: '' });
          queued++;
        } catch (err) { console.error('Post/Queue insert failed:', err); }
      }
    }
    await writeLog({ job: 'sources-poll', status: 'ok', details: `Created ${created}, queued ${queued}` });
    console.log(`[${nowISO()}] Cron A done: Created ${created}, queued ${queued}`);
  } catch (err) {
    console.error('Cron A failed:', err);
        await writeLog({ job: 'sources-poll', status: 'error', details: String(err) });
  }
}

// ---- Cron B ----
async function runCronB() {
  console.log(`[${nowISO()}] Cron B fired: checking queue`);
  try {
    const data = await getQueue();
    const now = new Date();
    const due = (Array.isArray(data) ? data : []).filter(row => {
      const st = (row.status || '').toLowerCase();
      const when = new Date(row.schedule_at);
      return (st === 'pending' || st === 'scheduled') && when <= now;
    });

    console.log(`[${nowISO()}] Queue due count: ${due.length}`);

    for (const row of due) {
      try {
        // PUBLISH PLACEHOLDER: integrate platform APIs here
        await updateQueueRow({ ...row, status: 'complete', last_attempt: nowISO() });

        await writeLog({
          job: 'publish',
          status: 'ok',
          details: `Published post_id=${row.post_id || '(unknown)'} to ${row.platform || '(unknown)'}`
        });

        await writeRevenue({
          post_id: row.post_id || '',
          platform: row.platform || '',
          affiliate_url: row.affilliate_url || '',
          clicks: 0,
          revenue: 0
        });
      } catch (err) {
        console.error('Publish flow failed:', err);
        await writeLog({
          job: 'publish',
          status: 'error',
          details: `Failed post_id=${row.post_id || '(unknown)'}: ${String(err)}`
        });
      }
    }

    await writeLog({ job: 'cron-check', status: 'ok', details: `Found ${due.length} scheduled posts` });
    console.log(`[${nowISO()}] Cron B done: processed ${due.length}`);
  } catch (err) {
    console.error('Cron B failed:', err);
    await writeLog({ job: 'cron-check', status: 'error', details: String(err) });
  }
}

// ---- Express Endpoints ----
app.get('/health', (_req, res) => res.send('OK'));
app.get('/sources', async (_req, res) => {
  try { res.json({ ok: true, data: await getSources() }); }
  catch (err) { console.error('/sources failed:', err); res.status(500).json({ error: String(err) }); }
});
app.get('/posts', async (_req, res) => {
  try { res.json(await getPosts()); }
  catch (err) { console.error('/posts failed:', err); res.status(500).json({ error: String(err) }); }
});
app.get('/queue', async (_req, res) => {
  try { res.json(await getQueue()); }
  catch (err) { console.error('/queue failed:', err); res.status(500).json({ error: String(err) }); }
});

// Manual triggers
app.post('/cron/a', async (_req, res) => {
  try { await runCronA(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});
app.post('/cron/b', async (_req, res) => {
  try { await runCronB(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

// ---- Schedule Cron Jobs ----
cron.schedule('5 * * * *', runCronA);  // HH:05
cron.schedule('0 * * * *', runCronB);  // HH:00

// ---- Startup ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
