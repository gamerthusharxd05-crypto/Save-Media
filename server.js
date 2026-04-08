const express = require("express");
const cors = require("cors");
const ytdlp = require("yt-dlp-exec");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Backend running" });
});

// FETCH VIDEO INFO (WORKS FOR MANY SITES)
app.post("/api/info", async (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json({ error: "URL required" });

  try {
    const info = await ytdlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
    });

    const formats = info.formats
      .filter(f => f.url && (f.ext === "mp4" || f.ext === "m4a"))
      .slice(0, 10)
      .map(f => ({
        quality: f.format_note || f.height + "p",
        ext: f.ext,
        url: f.url
      }));

    res.json({
      success: true,
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      formats
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch video" });
  }
});

// DOWNLOAD (STREAM)
app.get("/api/download", async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).send("URL required");

  try {
    const streamUrl = await ytdlp(url, {
      getUrl: true,
      format: "best"
    });

    res.redirect(streamUrl);

  } catch (err) {
    res.status(500).send("Download failed");
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});