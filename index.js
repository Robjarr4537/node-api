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

// GET /logs -> fetch all rows from Sheets.best logs tab
app.get('/logs', async (req, res) => {
  const url = process.env.SHEETS_BEST_LOGS_URL;
  const apiKey = process.env.SHEETS_BEST_API_KEY;

  if (!url) return res.status(500).json({ error: 'Missing SHEETS_BEST_LOGS_URL' });

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
    return res.status(500).json({ error: 'Failed to fetch logs', details: String(err) });
  }
});

// Cron job: run every hour to check scheduled posts
cron.schedule('0 * * * *', async () => {
  const now = new Date().toISOString();
  console.log(`[${now}] Cron job running: checking sources`);

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
    const nowDate = new Date();

    // Filter scheduled posts that are due
    const due = data.filter(row =>
      row.status === 'scheduled' && new Date(row.created_at) <= nowDate
    );

    if (due.length > 0) {
      console.log(`Found ${due.length} scheduled posts ready:`);
      due.forEach(row => console.log(`- ${row.id} | ${row.title}`));
    } else {
      console.log('No scheduled posts ready at this time.');
    }

    // Pipe log into logs sheet
    const logsUrl = process.env.SHEETS_BEST_LOGS_URL;
    if (logsUrl) {
      const logEntry = {
        timestamp: now,
        job: 'cron-check',
        status: 'ok',
        details: `Found ${due.length} scheduled posts`
      };

      await fetch(logsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-KEY': apiKey } : {})
        },
        body: JSON.stringify(logEntry)
      });
    }

    // TODO: add logic to publish or forward these rows
  } catch (err) {
    console.error('Cron job failed:', err);

    // Log failure into logs sheet if configured
    const logsUrl = process.env.SHEETS_BEST_LOGS_URL;
    if (logsUrl) {
      const failEntry = {
        timestamp: new Date().toISOString(),
        job: 'cron-check',
        status: 'error',
        details: String(err)
      };

      await fetch(logsUrl, {
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
