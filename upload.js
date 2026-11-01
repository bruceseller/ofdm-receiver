// Uploads of a page's transfers for offline analysis, to tools/upload_server.py through a tunnel: the microphone's
// audio (16-bit, 48 kHz) and the page's events, in pieces every few seconds as the run goes, so a phone that locks
// loses only the last piece. Both pages use it: the receiver (role rx) and the sender (tx).
//
// Settings: a checkbox that, ticked, shows the server's address and the token; kept in localStorage. A setup link
// from the server sets them: #upload=https://...trycloudflare.com&token=... (in the fragment, which the browser
// never sends to a server).
//
// Transfer ids: the time the run started and two random bytes, 6 bytes in all, as hex for the transmitter's start
// frames (which carry it over the air to the receiver) and as YYYYMMDD-HHMMSS-xxxx (UTC) to read and to name files.

const KEY = 'ofdm-upload';
const EPOCH = Date.UTC(2026, 0, 1) / 1000;   // ids count seconds from here: 4 bytes last until 2162
const PIECE_SECONDS = 5;
const MAX_QUEUED = 60;                       // pieces held while the server is unreachable (5 minutes), then dropped

/** A new transfer id: {hex, name}. */
export function newId() {
  const seconds = Math.floor(Date.now() / 1000) - EPOCH;
  const random = crypto.getRandomValues(new Uint8Array(2));
  const hex = seconds.toString(16).padStart(8, '0') + [...random].map(b => b.toString(16).padStart(2, '0')).join('');
  return { hex, name: idName(hex) };
}

/** An id's readable name, from its hex: YYYYMMDD-HHMMSS-xxxx. */
export function idName(hex) {
  const date = new Date((EPOCH + parseInt(hex.slice(0, 8), 16)) * 1000).toISOString();   // 2026-10-31T14:32:05.000Z
  return date.slice(0, 10).replaceAll('-', '') + '-' + date.slice(11, 19).replaceAll(':', '') + '-' + hex.slice(8, 12);
}

function load() {
  try {
    return { on: false, url: '', token: '', ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { on: false, url: '', token: '' };
  }
}

function save(settings) {
  localStorage.setItem(KEY, JSON.stringify(settings));
}

/** The settings, after any setup link in the address's fragment (which is then cleared from the address bar). */
export function settings() {
  const s = load();
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.has('upload') && hash.has('token')) {
    Object.assign(s, { on: true, url: hash.get('upload').replace(/\/+$/, ''), token: hash.get('token') });
    save(s);
    history.replaceState(null, '', location.pathname + location.search);
  }
  return s;
}

/**
 * The server's address from what was typed: a quick tunnel's name alone (porter-synthetic-selling-probe) becomes
 * https://porter-synthetic-selling-probe.trycloudflare.com; a host without a scheme gets https:// (http:// for this
 * machine); a full address is kept. Without a trailing slash.
 */
export function serverAddress(typed) {
  let a = typed.trim().replace(/\/+$/, '');
  if (!a || /^[a-z]+:\/\//i.test(a)) return a;
  if (!/[.:]/.test(a) && a !== 'localhost') a += '.trycloudflare.com';
  return (/^(localhost|127\.0\.0\.1)(:|$)/.test(a) ? 'http://' : 'https://') + a;
}

/** Draws the settings into `container`: the checkbox, and when ticked, the address, token and a test. */
export function settingsUi(container) {
  const s = settings();
  container.innerHTML = `
    <label class="upload-on"><input type="checkbox"> Upload runs for analysis</label>
    <div class="upload-config">
      <label>server <input type="text" inputmode="url" placeholder="tunnel name, or address" autocomplete="off"
        autocapitalize="off" spellcheck="false"></label>
      <label>token <input type="password" inputmode="numeric" autocomplete="off"></label>
      <button type="button">test</button> <span class="upload-status"></span>
    </div>`;
  const [on, url, token] = container.querySelectorAll('input');
  const config = container.querySelector('.upload-config');
  const status = container.querySelector('.upload-status');
  on.checked = s.on;
  url.value = s.url;
  token.value = s.token;
  config.hidden = !s.on;
  const update = () => {
    url.value = serverAddress(url.value);
    save({ on: on.checked, url: url.value, token: token.value.trim() });
    config.hidden = !on.checked;
  };
  on.onchange = url.onchange = token.onchange = update;
  container.querySelector('button').onclick = async () => {
    update();
    status.textContent = 'checking…';
    try {
      const response = await request(load(), 'GET', '/api/ping');
      status.textContent = response.ok ? 'ok' : `refused (${response.status})`;
    } catch (err) {
      status.textContent = `unreachable (${err.message})`;
    }
  };
  if (!document.getElementById('upload-style')) {
    document.head.insertAdjacentHTML('beforeend', `<style id="upload-style">
      .upload-on { display: inline-flex; gap: 6px; align-items: center; margin-top: 6px; cursor: pointer; }
      .upload-config { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin-top: 4px; }
      .upload-config[hidden] { display: none; }
      .upload-config input { font: inherit; width: 15em; max-width: 100%; color: var(--ink); background: var(--panel);
        border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; }
      .upload-config button { font: inherit; color: var(--accent); background: none; border: 0; padding: 0; cursor: pointer;
        text-decoration: underline; }
    </style>`);
  }
}

function request(s, method, path, body, type) {
  return fetch(s.url + path, {
    method,
    headers: { Authorization: `Bearer ${s.token}`, ...(type ? { 'Content-Type': type } : {}) },
    body,
  });
}

/**
 * One run's upload: `role` rx or tx, under the transfer id `id` ({hex, name}), with `meta` (the layout and the
 * like). Null if uploads are off. audio() and events() collect; every PIECE_SECONDS what has been collected goes up
 * as a piece, sent in order and retried, each saying where its audio starts so a lost one leaves a gap of silence,
 * not a shift. end() sends the rest and closes the run.
 */
export function startUpload(role, id, meta, onStatus = () => {}) {
  const s = load();
  if (!s.on || !s.url || !s.token) return null;
  const base = `/api/${role}/${id.name}`;
  const queue = [];
  let samples = [], sampleCount = 0, at = 0, events = [], seq = 0, sent = 0, dropped = 0, busy = false, ended = false;
  let lastError = '';

  const report = () => onStatus(`upload ${id.name}: ${sent} sent` + (queue.length ? `, ${queue.length} waiting` : '') +
    (dropped ? `, ${dropped} dropped` : '') + (lastError ? ` (${lastError})` : ''));

  function piece() {
    if (sampleCount) {
      const pcm = new Int16Array(sampleCount);
      let i = 0;
      for (const block of samples) {
        for (let k = 0; k < block.length; k++) pcm[i++] = Math.round(Math.max(-1, Math.min(1, block[k])) * 32767);
      }
      queue.push({ path: `${base}/audio?seq=${seq++}&at=${at}`, body: pcm.buffer, type: 'application/octet-stream' });
      at += sampleCount;
      samples = [];
      sampleCount = 0;
    }
    if (events.length) {
      queue.push({ path: `${base}/events?seq=${seq++}`, body: JSON.stringify(events), type: 'application/json' });
      events = [];
    }
    while (queue.length > MAX_QUEUED) {
      queue.shift();
      dropped++;
    }
    pump();
  }

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      try {
        const response = await request(s, 'POST', queue[0].path, queue[0].body, queue[0].type);
        if (!response.ok) throw new Error(`refused (${response.status})`);
        queue.shift();
        sent++;
        lastError = '';
      } catch (err) {
        lastError = err.message;
        report();
        await new Promise(done => setTimeout(done, 3000));
        if (ended && queue.length) {   // after the run, give up on a server that stays away
          dropped += queue.length;
          queue.length = 0;
        }
      }
      report();
    }
    busy = false;
  }

  const timer = setInterval(piece, PIECE_SECONDS * 1000);
  queue.push({ path: `${base}/start`, body: JSON.stringify({ ...meta, role, id: id.name, idHex: id.hex,
    startedAt: new Date().toISOString(), sampleRate: 48000, page: location.href.split('#')[0], userAgent: navigator.userAgent }),
    type: 'application/json' });
  pump();
  report();

  return {
    /** The microphone's samples (-1 to 1, 48 kHz); the caller must not reuse the array. */
    audio(block) {
      samples.push(block);
      sampleCount += block.length;
    },
    /** Events from the worker (big fields such as burst audio left out by the caller). */
    events(list) {
      const now = Date.now();
      for (const e of list) events.push({ ...e, wall: now });
    },
    end() {
      if (ended) return;
      ended = true;
      clearInterval(timer);
      piece();
      queue.push({ path: `${base}/end`, body: '{}', type: 'application/json' });
      pump();
    },
  };
}
