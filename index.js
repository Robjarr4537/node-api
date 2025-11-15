const express = require('express');
const app = express();

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

// Posts endpoint
app.get('/posts', (req, res) => {
  res.json([
    { id: 1, title: 'First post' },
    { id: 2, title: 'Second post' }
  ]);
});

// Use PORT from environment (Render sets this)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
