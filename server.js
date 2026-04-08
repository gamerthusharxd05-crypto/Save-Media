const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve static files (index.html, style.css, script.js)

// ==================== API ENDPOINTS ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    message: 'Save Media API is running on Render!',
    timestamp: new Date().toISOString()
  });
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
      
      // Available qualities for YouTube
      const qualityOptions = [
        { quality: '1080p', type: 'mp4', itag: '137', label: 'Full HD 1080p', size: '~45 MB' },
        { quality: '720p', type: 'mp4', itag: '22', label: 'HD 720p', size: '~28 MB' },
        { quality: '480p', type: 'mp4', itag: '18', label: 'SD 480p', size: '~18 MB' },
        { quality: '360p', type: 'mp4', itag: '134', label: '360p', size: '~12 MB' },
        { quality: 'mp3', type: 'mp3', itag: '140', label: 'High Quality Audio', size: '~7 MB' }
      ];
      
      for (const opt of qualityOptions) {
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
        } catch (e) {
          // Format not available, skip silently
        }
      }
      
      res.json({
        success: true,
        platform: 'youtube',
        title: info.videoDetails.title,
        thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1]?.url || info.videoDetails.thumbnails[0]?.url,
        duration: parseInt(info.videoDetails.lengthSeconds),
        author: info.videoDetails.author.name,
        views: parseInt(info.videoDetails.viewCount),
        formats: formats
      });
    } 
    else {
      // For other platforms (Instagram, TikTok, etc.)
      res.json({
        success: true,
        platform: 'other',
        title: 'Video from ' + new URL(url).hostname,
        thumbnail: null,
        formats: [
          { quality: 'Best', type: 'mp4', label: 'Best Quality', size: 'Variable' },
          { quality: 'mp3', type: 'mp3', label: 'Audio Only', size: 'Variable' }
        ]
      });
    }
  } catch (error) {
    console.error('Info fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch video information. Please check the URL.' });
  }
});

// Download video endpoint - REAL DOWNLOADS!
app.post('/api/download', async (req, res) => {
  const { url, quality, type } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // YouTube download
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      if (!ytdl.validateURL(url)) {
        return res.status(400).json({ error: 'Invalid YouTube URL' });
      }
      
      // Map quality to itag
      let itag;
      if (type === 'mp3') {
        itag = '140'; // High quality audio
      } else {
        switch(quality) {
          case '1080p': itag = '137'; break;
          case '720p': itag = '22'; break;
          case '480p': itag = '18'; break;
          case '360p': itag = '134'; break;
          default: itag = '18';
        }
      }
      
      // Get video info for filename
      const info = await ytdl.getInfo(url);
      const format = ytdl.chooseFormat(info.formats, { quality: itag });
      
      if (!format) {
        return res.status(404).json({ error: 'Requested quality not available for this video' });
      }
      
      // Create safe filename
      let filename = info.videoDetails.title
        .replace(/[^\w\s]/gi, '')
        .substring(0, 50);
      filename = `${filename}_${quality}.${type === 'mp3' ? 'mp3' : 'mp4'}`;
      
      // Set headers for download
      res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.header('Content-Type', type === 'mp3' ? 'audio/mpeg' : 'video/mp4');
      
      // Stream the video - REAL DOWNLOAD!
      const stream = ytdl(url, { format });
      stream.pipe(res);
      
      stream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Download stream error' });
        }
      });
    } 
    else {
      // For other platforms - proxy download
      try {
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'stream',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 30000
        });
        
        const filename = url.split('/').pop() || 'video.mp4';
        res.header('Content-Disposition', `attachment; filename="${filename}"`);
        res.header('Content-Type', response.headers['content-type'] || 'video/mp4');
        response.data.pipe(res);
      } catch (error) {
        res.status(500).json({ error: 'Could not download from this URL' });
      }
    }
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed: ' + error.message });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     🚀 SAVE MEDIA BACKEND IS RUNNING ON RENDER!           ║
║                                                            ║
║     📍 PORT: ${PORT}                                         ║
║     📊 Status: Online                                      ║
║     🎯 REAL YouTube Downloads: WORKING!                   ║
║                                                            ║
║     📥 Endpoints:                                          ║
║     POST /api/info     - Get video info                   ║
║     POST /api/download - Download video/audio             ║
║     GET  /api/health   - Health check                     ║
╚════════════════════════════════════════════════════════════╝
  `);
});