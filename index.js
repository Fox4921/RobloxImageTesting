const express = require("express");
const app = express();
const multer = require('multer');
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

app.use(express.json());


// test example
app.get("/test", (req, res) => {
    res.json({
        message: "Server is working!"
    });
});

app.get('/upload', (req, res) => {
  res.send(`
    <h2>Upload PNG or JPEG</h2>
    <form action="/upload" method="post" enctype="multipart/form-data">
      <input type="file" name="image" accept=".png,.jpg,.jpeg" required />
      <button type="submit">Upload</button>
    </form>
  `);
});
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No file uploaded.");
    }

    const buffer = req.file.buffer;

    // Detect type
    const header8 = buffer.toString('hex', 0, 8);
    const isPNG = header8 === '89504e470d0a1a0a';
    const isJPEG = buffer.toString('hex', 0, 2) === 'ffd8';

    if (!isPNG && !isJPEG) {
      return res.status(400).send("Unsupported file type.");
    }

    let width, height, pixels = [];

    if (isPNG) {
      const png = PNG.sync.read(buffer);
      width = png.width;
      height = png.height;

      for (let i = 0; i < png.data.length; i += 4) {
        pixels.push({
          r: png.data[i],
          g: png.data[i+1],
          b: png.data[i+2],
          a: png.data[i+3]
        });
      }
    } else {
      const raw = jpeg.decode(buffer, { useTArray: true });
      width = raw.width;
      height = raw.height;

      for (let i = 0; i < raw.data.length; i += 4) {
        pixels.push({
          r: raw.data[i],
          g: raw.data[i+1],
          b: raw.data[i+2],
          a: raw.data[i+3]
        });
      }
    }

    const id = uuidv4();

    await fs.writeJson(`./storage/${id}.json`, {
      width,
      height,
      pixels
    });

    res.send(`
      <h3>Upload successful!</h3>
      <p>Image ID:</p>
      <code>${id}</code>
    `);

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error.");
  }
});

app.get('/image/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const filePath = `${STORAGE_DIR}/${id}.json`;

    if (!(await fs.pathExists(filePath))) {
      return res.status(404).send("Not found");
    }

    const data = await fs.readJson(filePath);

    res.json(data);

  } catch (err) {
    console.error(err);
    res.status(500).send("Fetch error");
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});