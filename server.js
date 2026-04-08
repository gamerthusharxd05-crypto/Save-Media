const express = require('express');
const cors = require('cors');
const ytdl = require('@distube/ytdl-core');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Save Media backend is running!',
    timestamp: new Date().toISOString()
  });
});

// Get video information
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  
  console.log('=== NEW REQUEST ===');
  console.log('URL:', url);
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // Check if it's a YouTube URL
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      return res.status(400).json({ error: 'Only YouTube URLs are currently supported' });
    }
    
    console.log('Fetching video info...');
    
    // Get video info with agent (bypasses some blocks)
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      }
    });
    
    console.log('Video title:', info.videoDetails.title);
    
    const formats = [];
    
    // Get available formats from the video
    const videoFormats = info.formats.filter(f => f.hasVideo && f.hasAudio);
    const audioFormats = info.formats.filter(f => f.hasAudio && !f.hasVideo);
    
    // Add video formats (highest quality first)
    const qualities = ['1080', '720', '480', '360', '240'];
    for (const quality of qualities) {
      const format = videoFormats.find(f => f.qualityLabel && f.qualityLabel.includes(quality));
      if (format) {
        formats.push({
          quality: `${quality}p`,
          type: 'mp4',
          label: `${quality}p Video + Audio`,
          size: format.contentLength ? `${Math.round(format.contentLength / 1024 / 1024)} MB` : '~30 MB',
          itag: format.itag,
          available: true
        });
      }
    }
    
    // Add audio format
    if (audioFormats.length > 0) {
      const bestAudio = audioFormats[0];
      formats.push({
        quality: 'MP3',
        type: 'mp3',
        label: 'Audio Only (MP3)',
        size: bestAudio.contentLength ? `${Math.round(bestAudio.contentLength / 1024 / 1024)} MB` : '~5 MB',
        itag: bestAudio.itag,
        available: true
      });
    }
    
    // Fallback if no formats found
    if (formats.length === 0) {
      formats.push(
        { quality: '720p', type: 'mp4', label: 'HD (720p)', size: '~30 MB', itag: '22', available: true },
        { quality: 'MP3', type: 'mp3', label: 'Audio Only', size: '~5 MB', itag: '140', available: true }
      );
    }
    
    const response = {
      success: true,
      platform: 'youtube',
      title: info.videoDetails.title,
      thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1]?.url || info.videoDetails.thumbnails[0]?.url,
      duration: parseInt(info.videoDetails.lengthSeconds),
      author: info.videoDetails.author.name,
      formats: formats.slice(0, 5)
    };
    
    console.log('Sending', formats.length, 'formats');
    res.json(response);
    
  } catch (error) {
    console.error('ERROR:', error.message);
    
    // Provide helpful error messages
    if (error.message.includes('410')) {
      res.status(500).json({ error: 'YouTube is blocking this request. Try a different video or try again later.' });
    } else if (error.message.includes('private')) {
      res.status(500).json({ error: 'This video is private or unavailable.' });
    } else if (error.message.includes('age')) {
      res.status(500).json({ error: 'This video is age-restricted and cannot be downloaded.' });
    } else {
      res.status(500).json({ error: 'Failed to fetch video: ' + error.message });
    }
  }
});

// Download endpoint
app.post('/api/download', async (req, res) => {
  const { url, quality, type, itag } = req.body;
  
  console.log('=== DOWNLOAD REQUEST ===');
  console.log('URL:', url);
  console.log('Quality:', quality);
  console.log('ITAG:', itag);
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // Get video info
    const info = await ytdl.getInfo(url, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      }
    });
    
    // Use the provided itag or find the right format
    let format;
    if (itag) {
      format = info.formats.find(f => f.itag == itag);
    } else {
      // Fallback: find by quality
      if (type === 'mp3') {
        format = info.formats.find(f => f.hasAudio && !f.hasVideo);
      } else {
        const targetQuality = quality.replace('p', '');
        format = info.formats.find(f => f.qualityLabel && f.qualityLabel.includes(targetQuality) && f.hasVideo && f.hasAudio);
      }
    }
    
    if (!format) {
      // Try to get any video+audio format
      format = info.formats.find(f => f.hasVideo && f.hasAudio);
      if (!format) {
        return res.status(404).json({ error: 'No downloadable format found for this video' });
      }
    }
    
    const sanitizedTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '').substring(0, 50);
    const filename = `${sanitizedTitle}_${quality}.${type === 'mp3' ? 'mp3' : 'mp4'}`;
    
    console.log('Sending file:', filename);
    
    res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.header('Content-Type', type === 'mp3' ? 'audio/mpeg' : 'video/mp4');
    
    // Create download stream
    const stream = ytdl(url, { 
      format: format,
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        }
      }
    });
    
    stream.pipe(res);
    
    stream.on('error', (err) => {
      console.error('Stream error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed: ' + err.message });
      }
    });
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed: ' + error.message });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`✅ Save Media backend is RUNNING!`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Health: http://localhost:${PORT}/api/health`);
  console.log(`========================================`);
});