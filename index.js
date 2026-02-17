// index.js
const express = require('express');
const multer = require('multer');
const bodyParser = require('body-parser');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const app = express();
const STORAGE_DIR = path.join(__dirname, 'storage');
fs.ensureDirSync(STORAGE_DIR);

// ---------- CONFIG ----------
const SERVER_PASSWORD = process.env.SERVER_PASSWORD || 'ImageConnection_FOX'; // set via Render env var
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const UPLOAD_RATE_LIMIT = { windowMs: 60 * 1000, max: 10 }; // 10 uploads per minute per IP
const GET_RATE_LIMIT = { windowMs: 60 * 1000, max: 60 }; // 60 gets per minute per IP
const PASSWORD_MAX_FAILURES = 5;
const PASSWORD_LOCK_DURATION_MS = 60 * 60 * 1000; // lock for 1 hour after too many fails
// ----------------------------

// in-memory failed password tracker (note: resets on server restart)
const failedAttempts = new Map(); // ip -> {count, blockedUntil}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE }
});

app.use(bodyParser.json({ limit: '200mb' }));

// rate limiters
const uploadLimiter = rateLimit({ windowMs: UPLOAD_RATE_LIMIT.windowMs, max: UPLOAD_RATE_LIMIT.max });
const getLimiter = rateLimit({ windowMs: GET_RATE_LIMIT.windowMs, max: GET_RATE_LIMIT.max });

// ---------- helpers ----------
function sanitizeFileName(name) {
  // remove directory parts and unsafe chars
  let base = path.basename(name);
  base = base.replace(/\s+/g, '_');
  base = base.replace(/[^a-zA-Z0-9_\-\.]/g, '');
  if (!base) base = 'file';
  return base;
}

function requirePasswordForRequest(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;

  // check block
  const entry = failedAttempts.get(ip);
  if (entry && entry.blockedUntil && Date.now() < entry.blockedUntil) {
    return res.status(429).send('Too many failed password attempts. Try later.');
  }

  // password may be provided in header (preferred) or form field (for upload page)
  const provided = (req.headers['x-api-key'] || req.body.password || req.query.password || req.headers['authorization']) || '';

  if (!provided || provided !== SERVER_PASSWORD) {
    // increment fail count for IP and possibly block
    const info = failedAttempts.get(ip) || { count: 0 };
    info.count = (info.count || 0) + 1;
    if (info.count >= PASSWORD_MAX_FAILURES) {
      info.blockedUntil = Date.now() + PASSWORD_LOCK_DURATION_MS;
    }
    failedAttempts.set(ip, info);
    return res.status(403).send('Forbidden: invalid password.');
  }

  // on success reset attempts for IP
  if (failedAttempts.has(ip)) failedAttempts.delete(ip);
  next();
}

async function imageBufferToPixelJSON(buffer) {
  // returns { width, height, pixels: [{r,g,b,a},...] }
  const header8 = buffer.toString('hex', 0, 8);
  const isPNG = header8 === '89504e470d0a1a0a';
  const header4 = buffer.toString('hex', 0, 4);
  const isJPEG = header4.startsWith('ffd8ff');

  if (!isPNG && !isJPEG) {
    throw new Error('Unsupported file type (not PNG/JPEG)');
  }

  if (isPNG) {
    // sync read to get PNG object
    const png = PNG.sync.read(buffer);
    const width = png.width;
    const height = png.height;
    const pixels = [];
    for (let i = 0; i < png.data.length; i += 4) {
      pixels.push({
        r: png.data[i],
        g: png.data[i+1],
        b: png.data[i+2],
        a: png.data[i+3]
      });
    }
    return { width, height, pixels };
  } else {
    const raw = jpeg.decode(buffer, { useTArray: true });
    const width = raw.width;
    const height = raw.height;
    const pixels = [];
    for (let i = 0; i < raw.data.length; i += 4) {
      pixels.push({
        r: raw.data[i],
        g: raw.data[i+1],
        b: raw.data[i+2],
        a: raw.data[i+3]
      });
    }
    return { width, height, pixels };
  }
}

// ---------- Routes ----------

// Simple upload page (opens file picker)
app.get('/upload', (req, res) => {
  res.send(`
    <h2>Upload PNG or JPEG</h2>
    <form action="/upload" method="post" enctype="multipart/form-data">
      <input type="password" name="password" placeholder="Password" required />
      <br/><br/>
      <input type="file" name="image" accept=".png,.jpg,.jpeg" required />
      <br/><br/>
      <button type="submit">Upload</button>
    </form>
    <p>Note: Use the same password as server env var SERVER_PASSWORD or send it in header x-api-key for programmatic requests.</p>
  `);
});

// upload via the browser form (multipart)
app.post('/upload', uploadLimiter, upload.single('image'), async (req, res) => {
  try {
    // enforce password for this route too (check req.body.password since form)
    // reuse requirePasswordForRequest logic manually (since it expects req.body)
    const fakeNext = (err) => {
      if (err) throw err;
    };
    await new Promise((resolve, reject) => {
      // call middleware function manually
      requirePasswordForRequest(req, res, (err) => { if (err) reject(err); else resolve(); });
    });

    if (!req.file) return res.status(400).send('No file uploaded.');

    // convert and save pixel JSON
    const buffer = req.file.buffer;
    // const result = await imageBufferToPixelJSON(buffer);

    // use original filename, sanitized, and prefix with timestamp to avoid collisions
    const originalName = req.file.originalname || 'upload';
    const safeName = sanitizeFileName(originalName);
    const fileName = `${Date.now()}_${safeName}.json`;
    const filePath = path.join(STORAGE_DIR, fileName);

    //await fs.writeJson(filePath, {
    //  filename: fileName,
    //  original: originalName,
    //  uploadedAt: new Date().toISOString(),
    //  width: result.width,
    //  height: result.height,
    //  pixels: result.pixels
    //});
    const base64Image = buffer.toString('base64');
    await fs.writeJson(filePath, {
     filename: fileName,
     original: originalName,
     uploadedAt: new Date().toISOString(),
     imageBase64: base64Image
    });

    res.send(`<h3>Upload successful!</h3><p>File saved as: <code>${fileName}</code></p>`);

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).send('Server Error: ' + (err.message || 'unknown'));
  }
});

// upload via JSON (for Roblox HttpService or other programmatic clients)
// expects { imageBase64: "....", name: "optional_name" } and password header or body field
app.post('/uploadJson', uploadLimiter, async (req, res) => {
  try {
    // require password in header or body
    await new Promise((resolve, reject) => {
      requirePasswordForRequest(req, res, (err) => { if (err) reject(err); else resolve(); });
    });

    if (!req.body || (!req.body.imageBase64 && !req.body.image)) {
      return res.status(400).json({ error: 'Missing imageBase64 field' });
    }

    const b64 = req.body.imageBase64 || req.body.image;
    const buffer = Buffer.from(b64, 'base64');
    const result = await imageBufferToPixelJSON(buffer);

    const providedName = req.body.name || 'upload';
    const safeName = sanitizeFileName(providedName);
    const fileName = `${Date.now()}_${safeName}.json`;
    const filePath = path.join(STORAGE_DIR, fileName);

    await fs.writeJson(filePath, {
      filename: fileName,
      original: providedName,
      uploadedAt: new Date().toISOString(),
      width: result.width,
      height: result.height,
      pixels: result.pixels
    });

    res.json({ success: true, filename: fileName });

  } catch (err) {
    console.error('uploadJson error:', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

// get pixel JSON by filename (name must exactly match stored filename)
app.get('/getImage/:name', getLimiter, async (req, res) => {
  try {
    // password required in header x-api-key or ?password=...
    await new Promise((resolve, reject) => {
      requirePasswordForRequest(req, res, (err) => { if (err) reject(err); else resolve(); });
    });

    const rawName = req.params.name;
    const safeName = path.basename(rawName); // prevent path traversal
    const filePath = path.join(STORAGE_DIR, safeName);
    if (!await fs.pathExists(filePath)) return res.status(404).send('Not found');
    const data = await fs.readJson(filePath);
    res.json(data);
  } catch (err) {
    console.error('/getImage error:', err);
    res.status(500).send('Server error');
  }
});

// list stored images (returns array of filenames + metadata summary)
app.get('/list', getLimiter, async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      requirePasswordForRequest(req, res, (err) => { if (err) reject(err); else resolve(); });
    });

    const files = await fs.readdir(STORAGE_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const results = [];
    for (const f of jsonFiles) {
      try {
        const meta = await fs.readJson(path.join(STORAGE_DIR, f));
        results.push({
          filename: meta.filename || f,
          original: meta.original || null,
          uploadedAt: meta.uploadedAt || null,
          width: meta.width || null,
          height: meta.height || null
        });
      } catch (e) {
        // skip if can't read
      }
    }
    res.json(results);
  } catch (err) {
    console.error('/list error:', err);
    res.status(500).send('Server error');
  }
});

// health
app.get('/health', (req, res) => res.json({ ok: true }));

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});