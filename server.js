const express = require('express');
const { execFile, spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PIN = process.env.ACCESS_PIN || '';          // set this in your cloud dashboard
const MAX_JOBS = +process.env.MAX_JOBS || 1;
const TMP = path.join(os.tmpdir(), 'avd');
const EXTRA = (process.env.YTDLP_EXTRA ?? '--js-runtimes node').split(' ').filter(Boolean);
if (process.env.COOKIES_FILE) EXTRA.push('--cookies', process.env.COOKIES_FILE);
fs.mkdirSync(TMP, { recursive: true });

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- PIN protection (with simple brute-force lock) ----
const fails = new Map();
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
function auth(req, res, next) {
  if (!PIN) return next();
  const f = fails.get(req.ip) || { n: 0, t: 0 };
  if (f.n >= 8 && Date.now() - f.t < 600000) return res.status(429).json({ error: 'Too many wrong PINs. Try again in 10 minutes.' });
  if (crypto.timingSafeEqual(sha(req.get('x-pin') || req.query.pin || ''), sha(PIN))) { fails.delete(req.ip); return next(); }
  fails.set(req.ip, { n: f.n + 1, t: Date.now() });
  res.status(401).json({ error: 'Enter your access PIN.' });
}

const cleanUrl = u => { try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
const lastLine = s => (String(s).trim().split('\n').filter(l => /ERROR/.test(l)).pop() || String(s).trim().split('\n').pop() || 'Unknown error').replace(/^ERROR:\s*/, '').slice(0, 300);
const STD = [144, 240, 360, 480, 720, 1080];

// ---- 1. Fetch video info ----
app.post('/api/info', auth, (req, res) => {
  const url = cleanUrl(req.body.url);
  if (!url) return res.status(400).json({ error: 'That is not a valid link.' });
  execFile('yt-dlp', ['-J', '--no-playlist', '--no-warnings', ...EXTRA, '--', url], { maxBuffer: 64e6, timeout: 60000 }, (err, out, serr) => {
    if (err) return res.status(422).json({ error: lastLine(serr || err.message) });
    try {
      const d = JSON.parse(out), found = new Set();
      (d.formats || []).forEach(f => {
        if (!f.vcodec || f.vcodec === 'none') return;
        const h = Math.min(f.width || f.height || 0, f.height || 0);   // short side, so vertical videos work
        const b = [...STD].reverse().find(s => s <= h * 1.1);
        if (b) found.add(b);
      });
      res.json({
        title: d.title || 'Video', thumbnail: d.thumbnail || '', duration: d.duration || 0,
        uploader: d.uploader || d.channel || '', qualities: [...found].sort((a, b) => a - b),
        hasAudio: (d.formats || []).some(f => f.acodec && f.acodec !== 'none')
      });
    } catch { res.status(500).json({ error: 'Could not read video details.' }); }
  });
});

// ---- 2. Download + merge on the server (job based, avoids cloud timeouts) ----
const jobs = new Map();
app.post('/api/prepare', auth, (req, res) => {
  const url = cleanUrl(req.body.url);
  if (!url) return res.status(400).json({ error: 'Invalid link.' });
  if ([...jobs.values()].filter(j => j.state === 'working').length >= MAX_JOBS)
    return res.status(429).json({ error: 'Server is busy. Try again in a minute.' });
  const audio = req.body.type === 'audio', h = Math.min(Math.max(+req.body.height || 720, 144), 1080);
  const id = crypto.randomBytes(8).toString('hex');
  const safe = String(req.body.title || 'video').replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'video';
  const job = { state: 'working', pct: 0, msg: 'Starting…', t: Date.now() };
  jobs.set(id, job);

  const fmt = `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/bestvideo+bestaudio/best`;
  const args = ['--no-playlist', '--no-warnings', '--newline', ...EXTRA,
    ...(audio ? ['-x', '--audio-format', 'mp3', '--audio-quality', '0']
              : ['-f', fmt, '--merge-output-format', 'mp4', '--audio-multistreams']),
    '-o', path.join(TMP, id + '.%(ext)s'), '--', url];
  const p = spawn('yt-dlp', args);
  let log = '';
  const onData = d => {
    log += d; const m = String(d).match(/(\d+(?:\.\d+)?)%/g);
    if (m) job.pct = parseFloat(m[m.length - 1]);
    if (/Merging|ExtractAudio|Fixup/.test(d)) { job.msg = 'Merging with ffmpeg…'; job.pct = 100; }
    else if (m) job.msg = 'Downloading…';
  };
  p.stdout.on('data', onData); p.stderr.on('data', onData);
  p.on('close', code => {
    const f = fs.readdirSync(TMP).find(n => n.startsWith(id + '.') && !/\.(part|ytdl)$/.test(n));
    if (code === 0 && f) Object.assign(job, { state: 'done', file: path.join(TMP, f), name: `${safe}.${f.split('.').pop()}`, msg: 'Ready' });
    else Object.assign(job, { state: 'error', msg: lastLine(log) });
  });
  res.json({ id });
});

app.get('/api/status/:id', auth, (req, res) => {
  const j = jobs.get(req.params.id);
  j ? res.json({ state: j.state, pct: j.pct, msg: j.msg }) : res.status(404).json({ error: 'Job expired.' });
});
app.get('/api/file/:id', auth, (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.state !== 'done') return res.status(404).send('File not ready or expired.');
  res.download(j.file, j.name);
});

// ---- cleanup old files every 5 min ----
setInterval(() => {
  for (const [id, j] of jobs) if (Date.now() - j.t > 20 * 60000) { if (j.file) fs.unlink(j.file, () => {}); jobs.delete(id); }
  fs.readdir(TMP, (e, l) => (l || []).forEach(n => fs.stat(path.join(TMP, n), (e2, s) => s && Date.now() - s.mtimeMs > 40 * 60000 && fs.unlink(path.join(TMP, n), () => {}))));
}, 300000);

// ---- keep yt-dlp fresh: update at boot and every 12h ----
const update = () => execFile('yt-dlp', ['-U'], () => {});
update(); setInterval(update, 12 * 3600e3);

app.listen(PORT, () => console.log('All Video Downloader on :' + PORT + (PIN ? ' (PIN on)' : ' (WARNING: no ACCESS_PIN set)')));
