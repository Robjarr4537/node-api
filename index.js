const express = require('express');
const cron = require('node-cron');
const app = express();

app.use(express.json());

// Health check
app.get('/health', (req, res) => res.send('OK'));

// Posts (static demo data)
app.get('/posts', (req, res) => {
  res.json([
    { id: 1, title: 'First post' },
    { id: 2, title: 'Second post' }
  ]);
});

// Queue (simple status)
app.get('/queue', (req, res) => {
  res.json({ status: 'ready' });
});

// POST /queue -> forward payload to Sheets.best
app.post('/queue', async (req, res) => {
  const url = process.env.SHEETS_BEST_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;

  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_URL' });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-KEY': apiKey } : {})
      },
      body: JSON.stringify(req.body || {})
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Sheets.best error',
        status: response.status,
        data
      });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to queue', details: String(err) });
  }
});

// POST /add -> forward payload to Sheets.best
app.post('/add', async (req, res) => {
  const url = process.env.SHEETS_BEST_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;

  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_URL' });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-KEY': apiKey } : {})
      },
      body: JSON.stringify(req.body || {})
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Sheets.best error', status: response.status, data });
    }
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to add', details: String(err) });
  }
});

// GET /sources -> fetch all rows from Sheets.best
app.get('/sources', async (req, res) => {
  const url = process.env.SHEETS_BEST_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;

  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_URL' });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...(apiKey ? { 'X-API-KEY': apiKey } : {})
      }
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Sheets.best error', status: response.status, data });
    }
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch sources', details: String(err) });
  }
});

// Cron job: run every hour to check scheduled posts
cron.schedule('0 * * * *', async () => {
  console.log('Cron job running: checking sources');

  try {
    const url = process.env.SHEETS_BEST_URL;
    const apiKey = process.env.SHEETS_BEST_API_KEY;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...(apiKey ? { 'X-API-KEY': apiKey } : {})
      }
    });

    const data = await response.json();
    const scheduled = data.filter(row => row.status === 'scheduled');
    console.log('Scheduled posts:', scheduled);

    // TODO: add logic to publish or forward these rows
  } catch (err) {
    console.error('Cron job failed:', err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
