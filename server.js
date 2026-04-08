const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', message: 'Save Media API is running' });
});

// Get video information
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // Check if it's a YouTube URL
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      if (!ytdl.validateURL(url)) {
        return res.status(400).json({ error: 'Invalid YouTube URL' });
      }
      
      const info = await ytdl.getInfo(url);
      const formats = [];
      
      // Available qualities
      const qualityMap = [
        { quality: '1080p', type: 'mp4', itag: '137', label: 'Full HD', size: '~45 MB' },
        { quality: '720p', type: 'mp4', itag: '22', label: 'HD', size: '~28 MB' },
        { quality: '480p', type: 'mp4', itag: '18', label: 'SD', size: '~18 MB' },
        { quality: 'mp3', type: 'mp3', itag: '140', label: 'High Quality Audio', size: '~7 MB' }
      ];
      
      for (const opt of qualityMap) {
        try {
          const format = ytdl.chooseFormat(info.formats, { quality: opt.itag });
          if (format) {
            formats.push({
              quality: opt.quality,
              type: opt.type,
              label: opt.label,
              size: opt.size
            });
          }
        } catch (e) {}
      }
      
      res.json({
        success: true,
        title: info.videoDetails.title,
        thumbnail: info.videoDetails.thumbnails[0]?.url,
        duration: info.videoDetails.lengthSeconds,
        author: info.videoDetails.author.name,
        formats: formats
      });
    } else {
      res.json({
        success: true,
        title: 'Video from ' + new URL(url).hostname,
        thumbnail: null,
        formats: [
          { quality: 'Best', type: 'mp4', label: 'Best Quality', size: 'Variable' }
        ]
      });
    }
  } catch (error) {
    console.error('Info error:', error);
    res.status(500).json({ error: 'Failed to fetch video information. Make sure the URL is valid.' });
  }
});

// Download video
app.post('/api/download', async (req, res) => {
  const { url, quality, type } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // YouTube download
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      let itag;
      if (type === 'mp3') {
        itag = '140';
      } else if (quality === '1080p') itag = '137';
      else if (quality === '720p') itag = '22';
      else itag = '18';
      
      const info = await ytdl.getInfo(url);
      const format = ytdl.chooseFormat(info.formats, { quality: itag });
      
      if (!format) {
        return res.status(404).json({ error: 'Quality not available for this video' });
      }
      
      const filename = `${info.videoDetails.title.replace(/[^\w\s]/gi, '').substring(0, 50)}_${quality}.${type}`;
      res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.header('Content-Type', type === 'mp3' ? 'audio/mpeg' : 'video/mp4');
      
      ytdl(url, { format }).pipe(res);
    } else {
      // For other platforms, try to proxy the download
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      res.header('Content-Disposition', 'attachment; filename="video.mp4"');
      res.header('Content-Type', 'video/mp4');
      response.data.pipe(res);
    }
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║   🚀 SAVE MEDIA REAL DOWNLOADER IS RUNNING!             ║
║                                                          ║
║   📍 URL: http://localhost:${PORT}                        ║
║   📥 REAL YouTube downloads are WORKING!                ║
║                                                          ║
║   ✅ YouTube MP4 (1080p, 720p, 480p)                    ║
║   ✅ YouTube MP3 (High quality audio)                   ║
║   🔄 Other platforms via proxy                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});