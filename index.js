const express = require("express");
const app = express();

app.use(express.json());


// Example endpoint
app.get("/test", (req, res) => {
    res.json({
        message: "Server is working!"
    });
});


app.post('/upload', async (req, res) => {
  try {
    if (!req.body || !req.body.image) {
      return res.status(400).send("No image data");
    }

    const id = uuidv4(); // unique ID
    const filePath = `${STORAGE_DIR}/${id}.json`;

    // Save the raw base64 string
    await fs.writeJson(filePath, {
      image: req.body.image
    });

    res.json({
      success: true,
      id: id
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Upload error");
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