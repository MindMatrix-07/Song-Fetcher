const deemix = require('deemix');
const { Deezer } = require('deezer-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = async function handler(req, res) {
  // CORS setup
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { arl, track_url, bitrate } = req.query;

  if (!arl || !track_url) {
    return res.status(400).json({ error: "Missing arl or track_url query params" });
  }

  // Deemix Bitrate mappings
  // 1: 128kbps, 3: 320kbps, 9: FLAC
  const bitrateVal = parseInt(bitrate) || 3; 

  const dz = new Deezer();
  try {
    let loggedIn = await dz.login_via_arl(arl);
    if (!loggedIn) {
      return res.status(401).json({ error: "Invalid ARL" });
    }
  } catch(e) {
    return res.status(401).json({ error: "Deezer login failed: " + e.message });
  }

  try {
    // We use os.tmpdir() which resolves to /tmp on Vercel
    const tmpDir = os.tmpdir();
    
    // Generate download object
    let dlObj = await deemix.generateDownloadObject(dz, track_url, bitrateVal);
    
    let settings = deemix.settings.DEFAULTS;
    settings.downloadLocation = tmpDir;
    // We want a predictable filename
    settings.tracknameTemplate = "%id%";
    settings.albumTracknameTemplate = "%id%";
    settings.createM3U8File = false;
    settings.createAdminFolder = false;
    settings.saveArtwork = false;    // Save time and tmp space
    settings.saveLyrics = false;
    settings.overwriteFile = true;
    settings.fallbackBitrate = true;
    settings.tags = { ...settings.tags, saveArtworkArtist: false };

    // Set up downloader
    let downloader = new deemix.downloader.Downloader(dz, dlObj, settings);
    
    // Download Wrapper actually performs the fetching
    // downloader.downloadObject contains the info
    // Usually it's setupQueue or just iterate through dlObj
    
    // Actually, downloader has downloadObject. Let's just download the single track.
    // If it's a Single object:
    if (dlObj.__type__ === 'Single') {
        const trackItem = dlObj.single;
        let result = await downloader.downloadWrapper(trackItem);
        if (result && result.error) {
            throw new Error(result.error.message || "Download error");
        }
        
        let filePath = result.path;
        
        if (!filePath || !fs.existsSync(filePath)) {
           // fallback logic to find easiest recent file in tmpDir
           let files = fs.readdirSync(tmpDir);
           let matched = files.find(f => f.includes(String(trackItem.trackAPI.id)));
           if (matched) {
               filePath = path.join(tmpDir, matched);
           } else {
               throw new Error("File output missing: " + (filePath || trackItem.trackAPI.id));
           }
        }
        
        const ext = path.extname(filePath).toLowerCase();
        const stat = fs.statSync(filePath);
        res.writeHead(200, {
            'Content-Type': ext === '.flac' ? 'audio/flac' : 'audio/mpeg',
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename="${trackItem.trackAPI.id}${ext}"`
        });

        const readStream = fs.createReadStream(filePath);
        readStream.pipe(res);
        readStream.on('end', () => {
           // Clean up the temp file after sending
           fs.unlinkSync(filePath);
        });
        
    } else {
        return res.status(400).json({ error: "Only single track URLs are supported at this time" });
    }
    
  } catch (err) {
    console.error("Error processing download:", err);
    return res.status(500).json({ error: err.message || "Failed to download track" });
  }
}
