const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');
const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper: Check if yt-dlp is installed
async function checkYtDlp() {
  try {
    await execPromise('yt-dlp --version');
    return true;
  } catch {
    return false;
  }
}

// Helper: Get video info using yt-dlp
async function getVideoInfoWithYtDlp(url) {
  try {
    // Get JSON info from yt-dlp
    const { stdout } = await execPromise(`yt-dlp -j --no-warnings "${url}"`);
    const info = JSON.parse(stdout);
    
    const formats = [];
    
    // Extract video formats
    if (info.formats) {
      const videoFormats = info.formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none');
      const uniqueQualities = new Set();
      
      for (const format of videoFormats) {
        let quality = '';
        if (format.height) quality = `${format.height}p`;
        else if (format.tbr) quality = `${Math.round(format.tbr)}kbps`;
        else quality = 'Auto';
        
        if (!uniqueQualities.has(quality) && quality) {
          uniqueQualities.add(quality);
          formats.push({
            quality: quality,
            type: 'mp4',
            label: quality.includes('p') ? `${quality} Video + Audio` : quality,
            size: format.filesize ? `${Math.round(format.filesize / 1024 / 1024)} MB` : 'Unknown',
            format_id: format.format_id,
            available: true
          });
        }
      }
      
      // Add audio-only formats
      const audioFormats = info.formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
      const audioQualities = new Set();
      for (const format of audioFormats) {
        let quality = '';
        if (format.abr) quality = `${format.abr}kbps`;
        else quality = 'High Quality';
        
        if (!audioQualities.has(quality)) {
          audioQualities.add(quality);
          formats.push({
            quality: quality === 'High Quality' ? 'mp3' : quality,
            type: 'mp3',
            label: `Audio - ${quality}`,
            size: format.filesize ? `${Math.round(format.filesize / 1024 / 1024)} MB` : 'Unknown',
            format_id: format.format_id,
            available: true
          });
        }
      }
    }
    
    // Sort qualities (highest first)
    formats.sort((a, b) => {
      const aNum = parseInt(a.quality) || 0;
      const bNum = parseInt(b.quality) || 0;
      return bNum - aNum;
    });
    
    return {
      success: true,
      platform: info.extractor_key || 'unknown',
      title: info.title || 'Video',
      thumbnail: info.thumbnail || null,
      duration: info.duration || 0,
      author: info.uploader || 'Unknown',
      formats: formats.slice(0, 8) // Limit to 8 formats
    };
  } catch (error) {
    console.error('yt-dlp error:', error.message);
    return null;
  }
}

// Helper: Download with yt-dlp and stream
async function downloadWithYtDlp(url, formatId, res) {
  return new Promise((resolve, reject) => {
    const outputFile = path.join(__dirname, `temp_${Date.now()}.mp4`);
    
    let command = `yt-dlp -f ${formatId} -o "${outputFile}" "${url}"`;
    
    exec(command, async (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      
      // Stream the file to response
      const stat = fs.statSync(outputFile);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="video.mp4"`
      });
      
      const readStream = fs.createReadStream(outputFile);
      readStream.pipe(res);
      
      readStream.on('end', () => {
        fs.unlinkSync(outputFile); // Clean up temp file
        resolve();
      });
      
      readStream.on('error', reject);
    });
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    message: 'Save Media API with yt-dlp',
    timestamp: new Date().toISOString()
  });
});

// Get video information
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  console.log(`[INFO] Fetching: ${url}`);
  
  try {
    // Try yt-dlp first (works for 1000+ sites)
    const ytDlpResult = await getVideoInfoWithYtDlp(url);
    
    if (ytDlpResult && ytDlpResult.formats.length > 0) {
      console.log(`[SUCCESS] Found ${ytDlpResult.formats.length} formats for ${ytDlpResult.platform}`);
      return res.json(ytDlpResult);
    }
    
    // Fallback to ytdl-core for YouTube only
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      if (ytdl.validateURL(url)) {
        const info = await ytdl.getInfo(url);
        const formats = [];
        
        const qualityMap = [
          { quality: '1080p', itag: '137', label: 'Full HD' },
          { quality: '720p', itag: '22', label: 'HD' },
          { quality: '480p', itag: '18', label: 'SD' },
          { quality: '360p', itag: '134', label: '360p' },
          { quality: 'mp3', itag: '140', label: 'MP3 Audio' }
        ];
        
        for (const opt of qualityMap) {
          try {
            const format = ytdl.chooseFormat(info.formats, { quality: opt.itag });
            if (format) {
              formats.push({
                quality: opt.quality,
                type: opt.quality === 'mp3' ? 'mp3' : 'mp4',
                label: opt.label,
                size: format.contentLength ? `${Math.round(format.contentLength / 1024 / 1024)} MB` : 'Unknown',
                format_id: opt.itag,
                available: true
              });
            }
          } catch (e) {}
        }
        
        if (formats.length > 0) {
          return res.json({
            success: true,
            platform: 'youtube',
            title: info.videoDetails.title,
            thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1]?.url,
            duration: parseInt(info.videoDetails.lengthSeconds),
            author: info.videoDetails.author.name,
            formats: formats
          });
        }
      }
    }
    
    throw new Error('No video information could be retrieved');
    
  } catch (error) {
    console.error('[ERROR]', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch video information. Make sure the URL is correct and the video is accessible.' 
    });
  }
});

// Download endpoint
app.post('/api/download', async (req, res) => {
  const { url, quality, type, format_id } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }
  
  console.log(`[DOWNLOAD] ${quality} ${type} from ${url}`);
  
  try {
    // Try yt-dlp download if we have format_id
    if (format_id) {
      try {
        await downloadWithYtDlp(url, format_id, res);
        return;
      } catch (dlError) {
        console.log('yt-dlp download failed, trying fallback...');
      }
    }
    
    // Fallback: YouTube only with ytdl-core
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      let itag;
      if (type === 'mp3') itag = '140';
      else if (quality === '1080p') itag = '137';
      else if (quality === '720p') itag = '22';
      else if (quality === '480p') itag = '18';
      else itag = '18';
      
      const info = await ytdl.getInfo(url);
      const format = ytdl.chooseFormat(info.formats, { quality: itag });
      
      if (!format) {
        return res.status(404).json({ error: 'Quality not available' });
      }
      
      const filename = `${info.videoDetails.title.replace(/[^\w\s]/gi, '').substring(0, 50)}_${quality}.${type === 'mp3' ? 'mp3' : 'mp4'}`;
      
      res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.header('Content-Type', type === 'mp3' ? 'audio/mpeg' : 'video/mp4');
      
      ytdl(url, { format }).pipe(res);
      return;
    }
    
    throw new Error('Download method not available for this URL');
    
  } catch (error) {
    console.error('[DOWNLOAD ERROR]', error.message);
    res.status(500).json({ error: 'Download failed: ' + error.message });
  }
});

// Get supported platforms
app.get('/api/platforms', (req, res) => {
  res.json({
    success: true,
    platforms: ['YouTube', 'Instagram', 'TikTok', 'Twitter', 'Facebook', 'Vimeo', 'Reddit', 'Twitch', 'Dailymotion', 'and 1000+ more'],
    total: 1000
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ Save Media backend running on http://localhost:${PORT}\n`);
  console.log('⚠️  Note: For full 1000+ site support, install yt-dlp:\n');
  console.log('   macOS:   brew install yt-dlp');
  console.log('   Linux:   sudo apt install yt-dlp  or  pip install yt-dlp');
  console.log('   Windows: pip install yt-dlp\n');
});