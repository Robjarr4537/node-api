const express = require('express');
const app = express();

// Parse JSON bodies for POST requests
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

// Queue (simple status to verify new route)
app.get('/queue', (req, res) => {
  res.json({ status: 'ready' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
