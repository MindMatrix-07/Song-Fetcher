const { Deezer } = require('deezer-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const dz = new Deezer();
  const q = req.query.q || '';
  const arl = req.query.arl || '';
  const limit = parseInt(req.query.limit) || 10;

  if (!q) {
    return res.status(400).json({ success: false, error: "q parameter is required" });
  }

  try {
    if (arl) {
        await dz.login_via_arl(arl).catch(() => {});
    }

    // fallback to dz.api searching
    // Deezer JS uses `dz.api.search(q, limit)`
    // Actually Deezer JS uses unauthenticated api if arl fails or not present.
    // Let's use direct gateway / API request logic similar to python Search proxy
    
    // Deemix/Deezer-js does not expose simple search out of the box nicely.
    // Let's just proxy the API call exactly as the python bridge did:
    // Use native Node fetch available in Vercel environments (Node 18+)
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}&output=json`;
    
    const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
    };
    if (arl) {
        headers["Cookie"] = `arl=${arl.trim()}`;
    }

    const response = await fetch(url, { headers });
    const data = await response.json();

    if (data.error || !data.data) {
        return res.json({ success: true, data: [], source: "none", total: 0 });
    }

    const formatted = data.data.map(t => ({
        id: t.id,
        title: t.title || "",
        duration: t.duration || 0,
        link: t.link || `https://www.deezer.com/track/${t.id}`,
        artist: { name: (t.artist || {}).name || "" },
        album: {
            title: (t.album || {}).title || "",
            cover_small: (t.album || {}).cover_small || ""
        },
        _source: "deezer"
    }));

    return res.json({ success: true, data: formatted, source: "deezer", total: formatted.length });

  } catch (err) {
    console.error("Search error:", err);
    return res.json({ success: true, data: [], source: "none", total: 0 });
  }
}
