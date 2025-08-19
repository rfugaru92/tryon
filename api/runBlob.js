'use strict';

const { runFlowWithBuffers } = require('../test');

// Vercel serverless function: accepts multipart form-data (field 'in1'), uses bundled public/character.jpg as in2

// Utility to parse multipart without external deps (simple boundary split; good enough for single small file)
function parseMultipart(req, contentType) {
  const m = /boundary=(.*)$/i.exec(contentType || '');
  if (!m) throw new Error('Missing multipart boundary');
  const boundary = '--' + m[1];
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const parts = buf.toString('binary').split(boundary).slice(1, -1);
      let fileBuffer = null;
      for (const p of parts) {
        const idx = p.indexOf('\r\n\r\n');
        if (idx === -1) continue;
        const header = p.slice(0, idx);
        const bodyBinary = p.slice(idx + 4);
        // strip trailing CRLF
        const body = bodyBinary.endsWith('\r\n') ? bodyBinary.slice(0, -2) : bodyBinary;
        if (/name="in1"/i.test(header)) {
          // Convert binary string back to Buffer
          fileBuffer = Buffer.from(body, 'binary');
          break;
        }
      }
      if (!fileBuffer) return reject(new Error('Missing field in1'));
      resolve({ in1: fileBuffer });
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  // CORS for extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const ct = req.headers['content-type'] || '';
    if (!ct.startsWith('multipart/form-data')) {
      res.status(400).json({ ok: false, error: 'Content-Type must be multipart/form-data' });
      return;
    }
    const { in1 } = await parseMultipart(req, ct);

    // Load character image from public folder (bundled at build time)
    const fs = require('fs');
    const path = require('path');
    const charPath = path.join(process.cwd(), 'public', 'character.jpg');
    if (!fs.existsSync(charPath)) {
      res.status(400).json({ ok: false, error: 'character.jpg missing in public/. Upload one in your deployment.' });
      return;
    }
    const in2 = fs.readFileSync(charPath);

    const result = await runFlowWithBuffers(in1, in2);
    res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error('[api/runBlob] error', err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
};
