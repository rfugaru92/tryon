require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const { testFlow } = require('./test');

const app = express();
const port = process.env.PORT || 3000;

// Serve static UI
app.use(express.static(path.join(__dirname, 'public')));

// Enable basic CORS so the Chrome extension can call the server
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Multer storage to memory, we'll write to files expected by testFlow
const upload = multer({ storage: multer.memoryStorage() });

// Endpoint expects fields 'in1' and 'in2'
app.post('/run', upload.fields([{ name: 'in1' }, { name: 'in2' }]), async (req, res) => {
  try {
    if (!req.files || !req.files.in1 || !req.files.in2) {
      return res.status(400).json({ error: 'Please upload both in1 and in2 images.' });
    }

  console.log('[run] Received files:', Object.keys(req.files).join(', '));
  console.log('[run] Sizes:', (req.files.in1[0].size || 0), (req.files.in2[0].size || 0));
  // Write files to disk where test.js expects them
  fs.writeFileSync(path.join(__dirname, 'in1.jpg'), req.files.in1[0].buffer);
  fs.writeFileSync(path.join(__dirname, 'in2.jpg'), req.files.in2[0].buffer);

    // Call the flow
    const result = await testFlow();

    res.json({ ok: true, result });
  } catch (err) {
    console.error('Error running flow:', err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// New endpoint: POST /runUrl { imageUrl }
// Fetches the remote image as in1, uses server-side predefined character as in2 (public/character.jpg)
app.post('/runUrl', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    const { imageUrl } = req.body || {};
    if (!imageUrl) return res.status(400).json({ ok: false, error: 'imageUrl is required in JSON body' });

  console.log('[runUrl] imageUrl:', imageUrl);

    // Fetch the remote image
    const resp = await fetch(imageUrl);
    if (!resp.ok) return res.status(400).json({ ok: false, error: `Failed to fetch image: ${resp.status}` });
    const buffer = Buffer.from(await resp.arrayBuffer());

    // Write as in1.jpg
  console.log('[runUrl] fetched bytes:', buffer.length);
  fs.writeFileSync(path.join(__dirname, 'in1.jpg'), buffer);

    // Check for predefined character image
    const charPath = path.join(__dirname, 'public', 'character.jpg');
    if (!fs.existsSync(charPath)) {
      return res.status(400).json({ ok: false, error: 'Predefined character image not found on server. Place your character image at public/character.jpg or use /setCharacter to upload one.' });
    }

    // Copy character.jpg to in2.jpg where testFlow expects it
    fs.copyFileSync(charPath, path.join(__dirname, 'in2.jpg'));

    // Call the flow
  console.log('[runUrl] calling testFlow()');
  const result = await testFlow();
    res.json({ ok: true, result });
  } catch (err) {
    console.error('Error in /runUrl:', err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// Endpoint to upload or replace the predefined character image used as in2
app.post('/setCharacter', upload.single('character'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Please upload a file field named "character"' });
  console.log('[setCharacter] size:', req.file.size);
  const savePath = path.join(__dirname, 'public', 'character.jpg');
  fs.writeFileSync(savePath, req.file.buffer);
  return res.json({ ok: true, message: 'Character image saved to public/character.jpg' });
  } catch (err) {
    console.error('Error in /setCharacter:', err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// New endpoint: POST /runBlob (multipart form-data with single file field 'in1')
// This accepts the clothing image as a file and uses server-side public/character.jpg as in2
app.post('/runBlob', upload.single('in1'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Please upload a file field named "in1"' });
  console.log('[runBlob] received in1 size:', req.file.size);
  // Save uploaded file to in1.jpg
  const in1Path = path.join(__dirname, 'in1.jpg');
  fs.writeFileSync(in1Path, req.file.buffer);

    // Ensure predefined character exists
    const charPath = path.join(__dirname, 'public', 'character.jpg');
    if (!fs.existsSync(charPath)) {
      return res.status(400).json({ ok: false, error: 'Predefined character image not found on server. Place your character image at public/character.jpg or use /setCharacter to upload one.' });
    }

    // Copy character to in2.jpg where testFlow expects it
    fs.copyFileSync(charPath, path.join(__dirname, 'in2.jpg'));

    // Call the flow
  console.log('[runBlob] calling testFlow()');
  const result = await testFlow();
  console.log('[runBlob] testFlow done');
  res.json({ ok: true, result });
  } catch (err) {
    console.error('Error in /runBlob:', err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.listen(port, () => {
  console.log(`UI server running at http://localhost:${port}`);
});
