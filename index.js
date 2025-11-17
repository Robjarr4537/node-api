const express = require('express');
const cron = require('node-cron');
const app = express();

// Ensure fetch works on all Node versions
const ensureFetch = global.fetch
  ? global.fetch
  : ((...args) => import('node-fetch').then(({ default: f }) => f(...args)));

app.use(express.json());

// Health check
app.get('/health', (req, res) => res.send('OK'));

// GET /posts -> fetch all rows from Sheets.best posts tab
app.get('/posts', async (req, res) => {
  const url = process.env.SHEETS_BEST_POSTS_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_POSTS_URL' });

  try {
    console.log('[GET /posts] ->', url);
    const response = await ensureFetch(url, {
      method: 'GET',
      headers: { ...(apiKey ? { 'X-API-KEY': apiKey } : {}) }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: 'Sheets.best error', status: response.status, data });
    // Return raw array so curl shows rows directly
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch posts', details: String(err) });
  }
});

// GET /queue -> fetch all rows from Sheets.best queue tab
app.get('/queue', async (req, res) => {
  const url = process.env.SHEETS_BEST_QUEUE_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_QUEUE_URL' });

  try {
    console.log('[GET /queue] ->', url);
    const response = await ensureFetch(url, {
      method: 'GET',
      headers: { ...(apiKey ? { 'X-API-KEY': apiKey } : {}) }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: 'Sheets.best error', status: response.status, data });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch queue', details: String(err) });
  }
});

// POST /queue -> forward payload to Sheets.best queue tab
app.post('/queue', async (req, res) => {
  const url = process.env.SHEETS_BEST_QUEUE_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_QUEUE_URL' });

  try {
    console.log('[POST /queue] ->', url, 'body:', req.body);
    const response = await ensureFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-KEY': apiKey } : {})
      },
      body: JSON.stringify(req.body || {})
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: 'Sheets.best error', status: response.status, data });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add to queue', details: String(err) });
  }
});

// POST /add -> forward payload to Sheets.best sources tab
app.post('/add', async (req, res) => {
  const url = process.env.SHEETS_BEST_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_URL' });

  try {
    console.log('[POST /add] ->', url, 'body:', req.body);
    const response = await ensureFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-KEY': apiKey } : {})
      },
      body: JSON.stringify(req.body || {})
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: 'Sheets.best error', status: response.status, data });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add', details: String(err) });
  }
});

// GET /sources -> fetch all rows from Sheets.best sources tab
app.get('/sources', async (req, res) => {
  const url = process.env.SHEETS_BEST_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_URL' });

  try {
    console.log('[GET /sources] ->', url);
    const response = await ensureFetch(url, {
      method: 'GET',
      headers: { ...(apiKey ? { 'X-API-KEY': apiKey } : {}) }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: 'Sheets.best error', status: response.status, data });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch sources', details: String(err) });
  }
});

// GET /logs -> fetch all rows from Sheets.best logs tab
app.get('/logs', async (req, res) => {
  const url = process.env.SHEETS_BEST_LOGS_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;
  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_LOGS_URL' });

  try {
    console.log('[GET /logs] ->', url);
    const response = await ensureFetch(url, {
      method: 'GET',
      headers: { ...(apiKey ? { 'X-API-KEY': apiKey } : {}) }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: 'Sheets.best error', status: response.status, data });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch logs', details: String(err) });
  }
});

// Cron job: run every hour to check scheduled posts in queue
cron.schedule('0 * * * *', async () => {
  const now = new Date().toISOString();
  console.log(`[${now}] Cron job running: checking queue`);

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
      row => row.status === 'pending' && new Date(row.schedule_at) <= nowDate
    );

    console.log(`Queue checked: ${due.length} due`);
    const logsUrl = process.env.SHEETS_BEST_LOGS_URL;
    if (logsUrl) {
      const logEntry = { timestamp: now, job: 'cron-check', status: 'ok', details: `Found ${due.length} scheduled posts` };
      await ensureFetch(logsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-KEY': apiKey } : {})
        },
        body: JSON.stringify(logEntry)
      });
    }
  } catch (err) {
    console.error('Cron job failed:', err);
    const logsUrl = process.env.SHEETS_BEST_LOGS_URL;
    if (logsUrl) {
      const failEntry = { timestamp: new Date().toISOString(), job: 'cron-check', status: 'error', details: String(err) };
      await ensureFetch(logsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SHEETS_BEST_API_KEY ? { 'X-API-KEY': process.env.SHEETS_BEST_API_KEY } : {})
        },
        body: JSON.stringify(failEntry)
      });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
