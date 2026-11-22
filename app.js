const $ = s => document.querySelector(s);
const store = { get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
                set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
let pin = store.get('avd_pin'), video = null, busy = false;

async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-pin': pin }, body: body && JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) $('#pinCard').hidden = false;
  if (!r.ok) throw new Error(d.error || 'Something went wrong.');
  $('#pinCard').hidden = true;
  return d;
}
const say = (el, msg, err) => { $(el).textContent = msg; $(el).classList.toggle('err', !!err); };
const dur = s => s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '';

async function go() {
  const url = $('#url').value.trim();
  if (!url) return say('#status', 'Paste a link first.', true);
  $('#go').disabled = true; $('#result').hidden = true; say('#status', 'Fetching video details…');
  try {
    video = await api('/api/info', { url });
    video.url = url;
    $('#thumb').src = video.thumbnail; $('#title').textContent = video.title;
    $('#meta').textContent = [video.uploader, dur(video.duration)].filter(Boolean).join(' • ');
    $('#quals').replaceChildren(...video.qualities.map(q => {
      const b = document.createElement('button');
      b.className = 'btn'; b.textContent = q + 'p'; b.onclick = () => start('video', q); return b;
    }));
    $('#audio').hidden = !video.hasAudio;
    $('#bar').hidden = true; say('#prog', video.qualities.length ? 'Choose a quality to download.' : 'No video qualities found. Try audio only.');
    $('#result').hidden = false; say('#status', '');
  } catch (e) { say('#status', e.message, true); }
  $('#go').disabled = false;
}

async function start(type, height) {
  if (busy) return; busy = true;
  document.querySelectorAll('#result .btn').forEach(b => b.disabled = true);
  $('#bar').hidden = false; $('#fill').style.transform = 'scaleX(0)'; say('#prog', 'Starting on the server…');
  try {
    const { id } = await api('/api/prepare', { url: video.url, type, height, title: video.title });
    for (;;) {
      await new Promise(r => setTimeout(r, 1000));
      const s = await api('/api/status/' + id);
      $('#fill').style.transform = `scaleX(${(s.pct || 0) / 100})`;
      if (s.state === 'error') throw new Error(s.msg);
      if (s.state === 'done') {
        say('#prog', 'Done. Your download is starting.');
        const a = document.createElement('a'); a.href = `/api/file/${id}?pin=${encodeURIComponent(pin)}`; a.click(); break;
      }
      say('#prog', `${s.msg} ${s.state === 'working' && s.msg === 'Downloading…' ? Math.round(s.pct) + '%' : ''}`);
    }
  } catch (e) { say('#prog', e.message, true); }
  busy = false; document.querySelectorAll('#result .btn').forEach(b => b.disabled = false);
}

$('#go').onclick = go;
$('#url').onkeydown = e => e.key === 'Enter' && go();
$('#audio').onclick = () => start('audio');
$('#paste').onclick = async () => {
  try { $('#url').value = (await navigator.clipboard.readText()).trim(); go(); }
  catch { $('#url').focus(); say('#status', 'Clipboard blocked. Long-press the field and paste.', true); }
};
$('#savePin').onclick = () => { pin = $('#pin').value.trim(); store.set('avd_pin', pin); go(); };
