const express = require("express");
const app = express();

app.use(express.json());


// Example endpoint
app.get("/test", (req, res) => {
    res.json({
        message: "Server is working!"
    });
});
// Example image endpoint
app.get("/getImage", (req, res) => {
    const examplePixelData = "ENCODED_PIXEL_DATA_HERE";
    res.json({ image: examplePixelData });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});