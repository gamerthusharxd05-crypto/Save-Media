const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Health check endpoint (VERIFY THIS WORKS FIRST)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Save Media backend is running on Render!',
    timestamp: new Date().toISOString()
  });
});

// Get video information
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  
  console.log('=== NEW REQUEST ===');
  console.log('URL received:', url);
  
  if (!url) {
    console.log('ERROR: No URL provided');
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // Check if it's a YouTube URL
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      console.log('ERROR: Not a YouTube URL');
      return res.status(400).json({ error: 'Only YouTube URLs are currently supported' });
    }
    
    // Validate YouTube URL
    if (!ytdl.validateURL(url)) {
      console.log('ERROR: Invalid YouTube URL');
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }
    
    console.log('Fetching YouTube video info...');
    const info = await ytdl.getInfo(url);
    console.log('Video title:', info.videoDetails.title);
    
    const formats = [];
    
    // Available quality options
    const qualityOptions = [
      { quality: '1080p', itag: '137', type: 'mp4', label: 'Full HD (1080p)', size: '~50 MB' },
      { quality: '720p', itag: '22', type: 'mp4', label: 'HD (720p)', size: '~30 MB' },
      { quality: '480p', itag: '18', type: 'mp4', label: 'SD (480p)', size: '~15 MB' },
      { quality: '360p', itag: '134', type: 'mp4', label: '360p', size: '~10 MB' },
      { quality: 'MP3', itag: '140', type: 'mp3', label: 'Audio Only', size: '~5 MB' }
    ];
    
    for (const opt of qualityOptions) {
      try {
        const format = ytdl.chooseFormat(info.formats, { quality: opt.itag });
        if (format && format.contentLength) {
          formats.push({
            quality: opt.quality,
            type: opt.type,
            label: opt.label,
            size: opt.size,
            available: true
          });
          console.log(`  ✅ Added ${opt.quality}`);
        }
      } catch (e) {
        console.log(`  ❌ ${opt.quality} not available`);
      }
    }
    
    // If no formats found, add fallbacks
    if (formats.length === 0) {
      console.log('No formats found, adding fallbacks');
      formats.push(
        { quality: '720p', type: 'mp4', label: 'HD (720p)', size: '~30 MB', available: true },
        { quality: 'MP3', type: 'mp3', label: 'Audio Only', size: '~5 MB', available: true }
      );
    }
    
    const response = {
      success: true,
      platform: 'youtube',
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1]?.url || info.videoDetails.thumbnails[0]?.url,
      duration: parseInt(info.videoDetails.lengthSeconds),
      author: info.videoDetails.author.name,
      formats: formats
    };
    
    console.log('Sending response with', formats.length, 'formats');
    res.json(response);
    
  } catch (error) {
    console.error('ERROR:', error.message);
    res.status(500).json({ error: 'Failed to fetch video: ' + error.message });
  }
});

// Download endpoint
app.post('/api/download', async (req, res) => {
  const { url, quality, type } = req.body;
  
  console.log('=== DOWNLOAD REQUEST ===');
  console.log('URL:', url);
  console.log('Quality:', quality);
  console.log('Type:', type);
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    if (!ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }
    
    // Map quality to itag
    let itag;
    if (type === 'mp3') {
      itag = '140';
    } else if (quality === '1080p') {
      itag = '137';
    } else if (quality === '720p') {
      itag = '22';
    } else if (quality === '480p') {
      itag = '18';
    } else {
      itag = '18';
    }
    
    console.log('Using itag:', itag);
    
    const info = await ytdl.getInfo(url);
    const format = ytdl.chooseFormat(info.formats, { quality: itag });
    
    if (!format) {
      console.log('Format not found');
      return res.status(404).json({ error: 'Quality not available for this video' });
    }
    
    const sanitizedTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '').substring(0, 50);
    const filename = `${sanitizedTitle}_${quality}.${type === 'mp3' ? 'mp3' : 'mp4'}`;
    
    console.log('Sending file:', filename);
    
    res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.header('Content-Type', type === 'mp3' ? 'audio/mpeg' : 'video/mp4');
    
    ytdl(url, { format }).pipe(res);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed: ' + error.message });
  }
});

// Serve frontend (your index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`✅ Save Media backend is RUNNING!`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
  console.log(`========================================`);
});