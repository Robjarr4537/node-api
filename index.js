const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('API is running. Try /health');
});

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/posts', async (req, res) => {
  try {
    const response = await fetch('https://sheet.best/api/sheets/1Oc2lahvp_C3vo7oadayV5Pv5pyAg-GO0MV5ZrQ-YfOo/posts');
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
