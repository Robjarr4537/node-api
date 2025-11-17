// index.js
const express = require('express');
const cron = require('node-cron');
const app = express();

// Ensure fetch works on all Node versions
const ensureFetch = global.fetch
  ? global.fetch
  : ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

app.use(express.json());

// Utility: safe JSON fetch
async function jsonFetch(url, options = {}) {
  const res = await ensureFetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data === 'object' ? JSON.stringify(data) : String(data);
    throw new Error(`HTTP ${res.status} -> ${msg}`);
  }
  return data;
}

// Utility: log to logs tab (best-effort)
async function writeLog(entry) {
  const logsUrl = process.env.SHEETS_BEST_LOGS_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  if (!logsUrl) return;
  const payload = {
    timestamp: new Date().toISOString(),
    ...entry
  };
  try {
    await ensureFetch(logsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-KEY': apiKey } : {})
      },
      body: JSON.stringify(payload)
    });
  } catch (_) {
    // swallow
  }
}

// Health
app.get('/health', (req, res) => res.send('OK'));

// Posts
app.get('/posts', async (req, res) => {
  const url = process.env.SHEETS_BEST_POSTS_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_POSTS_URL' });
  try {
    const data = await jsonFetch(url, { headers: { ...(apiKey ? { 'X-API-KEY': apiKey } : {}) } });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch posts', details: String(err) });
  }
});

// Queue
app.get('/queue', async (req, res) => {
  const url = process.env.SHEETS_BEST_QUEUE_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_QUEUE_URL' });
  try {
    const data = await jsonFetch(url, { headers: { ...(apiKey ? { 'X-API-KEY': apiKey } : {}) } });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch queue', details: String(err) });
  }
});

app.post('/queue', async (req, res) => {
  const url = process.env.SHEETS_BEST_QUEUE_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_QUEUE_URL' });
  try {
    const data = await jsonFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-KEY': apiKey } : {})
      },
      body: JSON.stringify(req.body || {})
    });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add to queue', details: String(err) });
  }
});

// Sources
app.get('/sources', async (req, res) => {
  const url = process.env.SHEETS_BEST_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_URL' });
  try {
    const data = await jsonFetch(url, { headers: { ...(apiKey ? { 'X-API-KEY': apiKey } : {}) } });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch sources', details: String(err) });
  }
});

app.post('/add', async (req, res) => {
  const url = process.env.SHEETS_BEST_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_URL' });
  try {
    const data = await jsonFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-KEY': apiKey } : {})
      },
      body: JSON.stringify(req.body || {})
    });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add', details: String(err) });
  }
});

// Minimal RSS parser (title + link + pubDate) without extra deps
function parseRSS(xmlText) {
  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const getTag = (block, tag) => {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
    return m ? m[1].trim() : '';
  };
  const blocks = xmlText.match(itemRegex) || [];
  for (const block of blocks) {
    items.push({
      title: getTag(block, 'title'),
      link: getTag(block, 'link'),
      pubDate: getTag(block, 'pubDate')
    });
  }
  return items.filter(i => i.title || i.link);
}

// Helpers: Sheets I/O
async function getPosts() {
  const url = process.env.SHEETS_BEST_POSTS_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  return jsonFetch(url, { headers: { ...(apiKey ? { 'X-API-KEY': apiKey } : {}) } });
}

async function insertPost(row) {
  const url = process.env.SHEETS_BEST_POSTS_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  return jsonFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-KEY': apiKey } : {})
    },
    body: JSON.stringify(row)
  });
}

async function insertQueue(row) {
  const url = process.env.SHEETS_BEST_QUEUE_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  return jsonFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-KEY': apiKey } : {})
    },
    body: JSON.stringify(row)
  });
}

// Dedup check: avoid re-adding same link/title
function existsPost(posts, title, link) {
  const norm = (s) => (s || '').trim().toLowerCase();
  return posts.some(p => norm(p.title) === norm(title) || norm(p.affilliate_url) === norm(link) || norm(p.media_url) === norm(link));
}

// Cron A: hourly source polling -> create posts -> auto-queue
cron.schedule('5 * * * *', async () => {
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  const sourcesUrl = process.env.SHEETS_BEST_URL;
  if (!sourcesUrl) {
    await writeLog({ job: 'sources-poll', status: 'error', details: 'Missing SHEETS_BEST_URL' });
    return;
  }

  try {
    const sources = await jsonFetch(sourcesUrl, { headers: { ...(apiKey ? { 'X-API-KEY': apiKey } : {}) } });
    const activeSources = (Array.isArray(sources) ? sources : []).filter(s => String(s.active).toUpperCase() === 'TRUE');

    const posts = await getPosts();
    let created = 0, queued = 0;

    for (const src of activeSources) {
      const type = (src.type || '').toLowerCase();
      const label = src.label || 'source';
      const url = src.url_or_key;

      if (!url) continue;

      try {
        if (type === 'feed') {
          const rssText = await ensureFetch(url).then(r => r.text());
          const items = parseRSS(rssText).slice(0, 5); // cap to avoid spam
          for (const item of items) {
            if (existsPost(posts, item.title, item.link)) continue;
            const newPost = {
              created_at: new Date().toISOString(),
              source: label,
              title: item.title || '(untitled)',
              body: item.link ? `Source: ${item.link}` : '',
              media_url: '',
              status: 'draft',
              platform: 'twitter',
              affilliate_url: item.link || ''
            };
            await insertPost(newPost);
            posts.push(newPost);
            created++;

            // Auto-queue in 30 minutes
            const scheduleAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            await insertQueue({
              schedule_at: scheduleAt,
              platform: 'twitter',
              post_id: '', // sheet will fill id; publish uses row.post_id if present
              status: 'pending',
              last_attempt: ''
            });
            queued++;
          }
        } else if (type === 'api') {
          const json = await jsonFetch(url);
          const items = Array.isArray(json) ? json.slice(0, 5) : [];
          for (const item of items) {
            const title = item.title || item.name || '(untitled)';
            const link = item.url || item.link || '';
            if (existsPost(posts, title, link)) continue;
            const newPost = {
              created_at: new Date().toISOString(),
              source: label,
              title,
              body: item.description || '',
              media_url: item.image || '',
              status: 'draft',
              platform: 'twitter',
              affilliate_url: link
            };
            await insertPost(newPost);
            posts.push(newPost);
            created++;

            const scheduleAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            await insertQueue({
              schedule_at: scheduleAt,
              platform: 'twitter',
              post_id: '',
              status: 'pending',
              last_attempt: ''
            });
            queued++;
          }
        } else if (type === 'event') {
          // Treat as a static page: create a single evergreen draft if missing
          if (!existsPost(posts, label, url)) {
            const newPost = {
              created_at: new Date().toISOString(),
              source: label,
              title: label,
              body: `Event page: ${url}`,
              media_url: '',
              status: 'draft',
              platform: 'facebook',
              affilliate_url: url
            };
            await insertPost(newPost);
            posts.push(newPost);
            created++;
          }
        }
      } catch (err) {
        await writeLog({ job: 'sources-poll', status: 'error', details: `Source ${label}: ${String(err)}` });
      }
    }

    await writeLog({ job: 'sources-poll', status: 'ok', details: `Created ${created}, queued ${queued}` });
  } catch (err) {
    await writeLog({ job: 'sources-poll', status: 'error', details: String(err) });
  }
});

// Cron B: hourly publish due queue items
cron.schedule('0 * * * *', async () => {
  const now = new Date().toISOString();
  console.log(`[${now}] Cron publish: checking queue`);

  try {
    const url = process.env.SHEETS_BEST_QUEUE_URL;
    const apiKey = process.env.SHEETS_BEST_API_KEY;

    const response = await ensureFetch(url, {
      method: 'GET',
      headers: { ...(apiKey ? { 'X-API-KEY': apiKey } : {}) }
    });

    const data = await response.json();
    const nowDate = new Date();

    const due = (Array.isArray(data) ? data : []).filter(
      row => (row.status === 'pending' || row.status === 'scheduled') && new Date(row.schedule_at) <= nowDate
    );

    console.log(`Queue checked: ${due.length} due`);

    for (const row of due) {
      try {
        // Placeholder "publish": this is where you'd call platform APIs.
        // For now we mark complete and log.
        const updateUrl = `${process.env.SHEETS_BEST_QUEUE_URL}/${row.id || ''}`.replace(/\/$/, '');
        await ensureFetch(updateUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'X-API-KEY': apiKey } : {})
          },
          body: JSON.stringify({
            ...row,
            status: 'complete',
            last_attempt: new Date().toISOString()
          })
        });

        await writeLog({
          job: 'publish',
          status: 'ok',
          details: `Published post_id=${row.post_id || '(unknown)'} to ${row.platform || '(unknown)'}`
        });
      } catch (err) {
        await writeLog({
          job: 'publish',
          status: 'error',
          details: `Failed to publish post_id=${row.post_id || '(unknown)'}: ${String(err)}`
        });
      }
    }

    await writeLog({
      job: 'cron-check',
      status: 'ok',
      details: `Found ${due.length} scheduled posts`
    });
  } catch (err) {
    console.error('Cron job failed:', err);
    await writeLog({
      job: 'cron-check',
      status: 'error',
      details: String(err)
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
