// test-sources.js
async function testSources() {
  const url = 'https://node-api-n3yd.onrender.com/sources'; // your deployed API
  try {
    const res = await fetch(url); // built-in fetch in Node 18+
    const data = await res.json();
    console.log('Response from /sources:');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to fetch /sources:', err);
  }
}

testSources();
