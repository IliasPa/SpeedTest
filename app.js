/* ===========================================================
   Speed Test — adaptive, low-waste bandwidth measurement.

   The idea: speed is a *rate*, so you only need enough bytes to
   measure the rate confidently — not a fixed 100 MB blob. Each
   phase ramps up, watches the throughput settle, and aborts the
   moment consecutive samples agree. A slow line finishes after a
   couple of MB; a fast line spends a second or two and stops.
   =========================================================== */

'use strict';

const CF = 'https://speed.cloudflare.com';

/* __down refuses anything from 100,000,000 bytes upward with a 403 that
   carries no CORS headers, so the browser surfaces it as an opaque
   network failure rather than a status code. Stay well under the line. */
const MAX_DOWN_BYTES = 90 << 20;   // 94.4 MB

const CFG = {
  ping: { count: 10, warmup: 2, minSamples: 5, maxMs: 3500, timeoutMs: 3000 },

  down: {
    probeMs:    600,          // the probe is capped by time, not by size:
    probeBytes: 8 << 20,      // a fixed 1 MB costs a slow line seconds
    warmupMs:   700,          // ignored: TCP slow start / TLS ramp
    minMs:      1600,         // never trust a shorter sample
    maxMs:      7000,
    maxBytes:   120 << 20,    // hard ceiling on data spent
    fastMbps:   200,          // above this, shorten the window — see below
    chunkMs:    1500,         // aim each request at ~1.5 s of transfer
    stableCov:  0.05,         // stop when 10 samples vary < 5 %
    sampleMs:   100,
    windowMs:   700
  },

  up: {
    probeMs:    400,          // target duration; the size is derived from
    probeMin:   64 << 10,     // the download result, since a blind POST
    probeMax:   2 << 20,      // cannot be cut short once it is in flight
    warmupMs:   600,
    minMs:      1800,
    maxMs:      7000,
    maxBytes:   60 << 20,
    chunkMs:    500,          // short posts: the blind tail stays small
    stableCov:  0.06,
    sampleMs:   100,
    windowMs:   800
  }
};

/* Data Saver is an explicit "don't spend my allowance" from the user, so
   honour it: cap the test at roughly 20 MB and shorten the sampling
   windows to fit. On a fast line that is not enough bytes to see full
   speed, so the result reads low — a trade the user has already asked
   for. Only the flag counts; being on mobile data is not consent. */
const SAVE_DATA = !!(navigator.connection && navigator.connection.saveData);

if (SAVE_DATA) {
  // sampleMs also sets how often the byte ceiling is checked; at gigabit
  // a 100 ms gap overshoots it by more than the whole budget.
  Object.assign(CFG.down, { warmupMs: 250, minMs: 500, maxBytes: 11 << 20, sampleMs: 40 });
  Object.assign(CFG.up,   { warmupMs: 250, minMs: 600, maxBytes:  5 << 20, sampleMs: 40 });
}

/* ── Small helpers ───────────────────────────────────────── */

const now   = () => performance.now();
const $     = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const toMbps = bytesPerSec => (bytesPerSec * 8) / 1e6;

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Coefficient of variation — how much a set of samples disagrees. */
function cov(a) {
  if (a.length < 2) return Infinity;
  const mean = a.reduce((x, y) => x + y, 0) / a.length;
  if (mean <= 0) return Infinity;
  const varc = a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length;
  return Math.sqrt(varc) / mean;
}

function fmtSpeed(mbps) {
  if (!isFinite(mbps) || mbps <= 0) return '0';
  if (mbps >= 100) return mbps.toFixed(0);
  if (mbps >= 10)  return mbps.toFixed(1);
  return mbps.toFixed(2);
}

function fmtBytes(b) {
  if (b >= 1 << 30) return (b / (1 << 30)).toFixed(2) + ' GB';
  if (b >= 1 << 20) return (b / (1 << 20)).toFixed(1) + ' MB';
  return (b / 1024).toFixed(0) + ' KB';
}

function fmtDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return '—';
  if (sec < 1)     return 'under a second';
  if (sec < 60)    return Math.round(sec) + ' sec';
  if (sec < 3600)  {
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return s ? `${m} min ${s} sec` : `${m} min`;
  }
  if (sec < 86400) {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return m ? `${h} hr ${m} min` : `${h} hr`;
  }
  return (sec / 86400).toFixed(1) + ' days';
}

/* Ignore aborts — they are how we stop on purpose. */
const isAbort = e => e && (e.name === 'AbortError' || e.name === 'TimeoutError');

/**
 * Run n copies of a worker. Workers never reject — a genuine failure is
 * parked on `.error` for the controller loop to notice, so one dead
 * connection cannot surface as an unhandled rejection mid-test.
 */
function pool(n, fn) {
  const p = { error: null, done: null };
  p.done = Promise.all(
    Array.from({ length: n }, () => fn().catch(e => {
      if (!isAbort(e) && !p.error) p.error = e;
    }))
  );
  return p;
}

/* ===========================================================
   Throughput sampler
   Accumulates bytes and reports the rate over a sliding window,
   so slow-start does not drag the final number down.
   =========================================================== */

class Sampler {
  constructor() {
    this.bytes  = 0;
    this.marks  = [];   // { t, bytes } snapshots
    this.rates  = [];   // steady-state samples, bytes/sec
    this.startedAt = 0;
  }

  start() {
    this.startedAt = now();
    this.marks = [{ t: this.startedAt, bytes: 0 }];
  }

  add(n) { this.bytes += n; }

  /** Snapshot the counter; returns the rate over the trailing window. */
  tick(windowMs) {
    const t = now();
    this.marks.push({ t, bytes: this.bytes });

    // Drop marks older than the window (keep one for interpolation).
    while (this.marks.length > 2 && t - this.marks[1].t > windowMs) {
      this.marks.shift();
    }

    const first = this.marks[0];
    const dt = (t - first.t) / 1000;
    if (dt <= 0) return 0;
    return (this.bytes - first.bytes) / dt;
  }
}

/* ===========================================================
   Latency
   =========================================================== */

async function measureLatency(onSample) {
  const c = CFG.ping;
  const rtts = [];
  const started = now();

  for (let i = 0; i < c.count; i++) {
    const t0 = now();
    try {
      const res = await fetch(
        `${CF}/__down?bytes=0&r=${Math.random()}`,
        { cache: 'no-store', signal: AbortSignal.timeout(c.timeoutMs) }
      );
      await res.arrayBuffer();
    } catch (e) {
      if (isAbort(e)) continue;
      throw e;
    }
    const rtt = now() - t0;

    // The first couple of round trips pay for DNS/TLS — discard them.
    if (i >= c.warmup) {
      rtts.push(rtt);
      onSample(median(rtts));
    }

    // On a high-latency line the samples themselves cost seconds;
    // stop once there are enough of them to be meaningful.
    if (rtts.length >= c.minSamples && now() - started > c.maxMs) break;

    await sleep(20);
  }

  if (!rtts.length) throw new Error('No latency samples');

  // Jitter: mean absolute change between consecutive round trips.
  let jitter = 0;
  for (let i = 1; i < rtts.length; i++) jitter += Math.abs(rtts[i] - rtts[i - 1]);
  jitter = rtts.length > 1 ? jitter / (rtts.length - 1) : 0;

  return { ping: median(rtts), jitter, min: Math.min(...rtts) };
}

/* ===========================================================
   Download
   =========================================================== */

async function streamDown(bytes, signal, onChunk) {
  const want = Math.min(bytes, MAX_DOWN_BYTES);
  const res = await fetch(
    `${CF}/__down?bytes=${want}&r=${Math.random()}`,
    { cache: 'no-store', signal }
  );
  if (!res.ok) throw new Error('Download failed: HTTP ' + res.status);

  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(value.length);
  }
}

async function measureDownload(onProgress) {
  const c = CFG.down;
  const sampler = new Sampler();

  /* ── Probe: a short look at the line, to size the real run ──
     Capped by time rather than by size. A fixed 1 MB is over in an
     instant on fibre but costs a slow line several seconds before the
     measurement has even started. Whatever arrives inside probeMs is
     enough to pick a stream count and a request size. */
  const probeCtl = new AbortController();
  sampler.start();
  const pStart = now();
  let half = null;

  try {
    await streamDown(c.probeBytes, probeCtl.signal, n => {
      sampler.add(n);
      const el = now() - pStart;

      // Note the halfway point, so the estimate can be taken from the
      // second half alone and skip most of the slow-start ramp.
      if (!half && el >= c.probeMs / 2) half = { t: el, bytes: sampler.bytes };
      if (el >= c.probeMs) probeCtl.abort();

      onProgress(toMbps(sampler.tick(c.windowMs)), sampler.bytes);
    });
  } catch (e) {
    if (!isAbort(e)) throw e;
  }

  const pEl = now() - pStart;
  const probeBps = half && pEl > half.t
    ? (sampler.bytes - half.bytes) / ((pEl - half.t) / 1000)
    : sampler.bytes / (pEl / 1000);

  /* ── Size the measurement from the probe ── */
  const est = toMbps(probeBps);
  const streams = est < 20 ? 2 : est < 150 ? 4 : 6;

  // A gigabit line moves 125 MB every second, so a window long enough to
  // be comfortable on DSL would cost a fifth of a gigabyte here. Fast
  // links are also the steadiest, so they need less time to be sure of.
  const fast     = est >= c.fastMbps;
  const warmupMs = fast ? 350 : c.warmupMs;
  const minMs    = fast ? 900 : c.minMs;
  const minRates = fast ? 5   : 10;

  // Per-request size: about chunkMs worth of data for one stream, with
  // headroom. Asking for too much is free — the transfer is aborted long
  // before it finishes — whereas asking for too little stalls the pipe
  // every time a request ends and a new one has to be opened.
  const chunk = Math.round(clamp(
    probeBps * 2 * (c.chunkMs / 1000),
    1 << 20,
    MAX_DOWN_BYTES
  ));

  /* ── Measure: parallel streams, abort as soon as it settles ── */
  const ctl = new AbortController();
  const meas = new Sampler();
  meas.start();

  const workers = pool(streams, async () => {
    while (!ctl.signal.aborted) {
      await streamDown(chunk, ctl.signal, n => meas.add(n));
    }
  });

  const spent = () => sampler.bytes + meas.bytes;
  const t0 = now();

  while (!ctl.signal.aborted) {
    await sleep(c.sampleMs);
    const elapsed = now() - t0;
    const rate = meas.tick(c.windowMs);

    onProgress(toMbps(rate), spent());

    if (elapsed > warmupMs && rate > 0) meas.rates.push(rate);

    const enough  = elapsed >= minMs && meas.rates.length >= minRates;
    const settled = enough && cov(meas.rates.slice(-minRates)) < c.stableCov;

    if (workers.error || settled || elapsed >= c.maxMs || spent() >= c.maxBytes) break;
  }

  ctl.abort();
  await workers.done;
  if (workers.error && !meas.rates.length) throw workers.error;

  const bps = meas.rates.length
    ? median(meas.rates)
    : meas.bytes / ((now() - meas.startedAt) / 1000);

  return { mbps: toMbps(bps), bytes: spent() };
}

/* ===========================================================
   Upload

   Chromium can stream a request body, which lets us watch the
   network pull bytes and measure upload exactly like download.
   Firefox and Safari cannot, so there we time whole completed
   POSTs and keep each one short, so the un-measured tail still
   in flight when we stop stays a small slice of the total.
   =========================================================== */

/* Does this browser support a ReadableStream request body?
   A browser that does not will stringify the stream into
   "[object ReadableStream]" and stamp a text/plain content type,
   and will never read the `duplex` option. */
const CAN_STREAM_UP = (() => {
  try {
    let duplexRead = false;
    const typed = new Request('https://example.com/', {
      method: 'POST',
      body: new ReadableStream(),
      get duplex() { duplexRead = true; return 'half'; }
    }).headers.has('Content-Type');
    return duplexRead && !typed;
  } catch {
    return false;
  }
})();

let seedBuf = null;

function seed() {
  if (!seedBuf) {
    seedBuf = new Uint8Array(4 << 20);
    for (let o = 0; o < seedBuf.length; o += 65536) {
      crypto.getRandomValues(seedBuf.subarray(o, o + 65536));
    }
  }
  return seedBuf;
}

function payload(size) {
  const buf = seed();
  const parts = [];
  let rem = size;
  while (rem > 0) {
    const n = Math.min(rem, buf.length);
    parts.push(n === buf.length ? buf : buf.subarray(0, n));
    rem -= n;
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

/** Blind POST of a fixed blob — resolves when the whole body is sent. */
async function postBlob(blob, signal) {
  const res = await fetch(`${CF}/__up`, {
    method: 'POST', body: blob, cache: 'no-store', signal
  });
  if (!res.ok) throw new Error('Upload failed: HTTP ' + res.status);
  await res.arrayBuffer();
}

/** Streamed POST — onChunk fires as the network pulls each piece. */
async function postStream(total, signal, onChunk) {
  const buf = seed();
  const piece = 64 << 10;
  let sent = 0;

  const body = new ReadableStream({
    pull(ctl) {
      if (sent >= total || signal.aborted) { ctl.close(); return; }
      const n = Math.min(piece, total - sent);
      ctl.enqueue(buf.subarray(0, n));
      sent += n;
      onChunk(n);
    }
  });

  const res = await fetch(`${CF}/__up`, {
    method: 'POST',
    body,
    duplex: 'half',
    cache: 'no-store',
    signal,
    headers: { 'content-type': 'application/octet-stream' }
  });
  if (!res.ok) throw new Error('Upload failed: HTTP ' + res.status);
  await res.arrayBuffer();
}

async function measureUpload(downBps, onProgress) {
  const c = CFG.up;

  /* ── Probe: one small POST to size the real run ──
     A POST cannot be cut short usefully — aborting it tells us nothing
     about how much got through — so instead of capping its duration we
     pick a size that should take about probeMs. Home lines upload at a
     fraction of what they download, so guess an eighth and let the
     measurement below correct it. */
  const probeBytes = Math.round(clamp(
    (downBps / 8) * (c.probeMs / 1000), c.probeMin, c.probeMax
  ));

  const probeCtl = new AbortController();
  const pStart = now();
  await postBlob(payload(probeBytes), probeCtl.signal);
  const probeBps = probeBytes / ((now() - pStart) / 1000);

  const est = toMbps(probeBps);
  const streams = est < 10 ? 2 : est < 100 ? 3 : 5;
  let spent = probeBytes;

  onProgress(est, spent);

  const perStream = probeBps / streams;

  /* ── Streaming path ──
     Chromium only allows a streamed body over HTTP/2 or /3 and errors
     outright when it cannot get one, so prove it works on a small POST
     before betting the measurement on it. */
  if (CAN_STREAM_UP) {
    try {
      const trial = new AbortController();
      await postStream(128 << 10, trial.signal, n => { spent += n; });
      return await streamedUpload(streams, perStream, spent, onProgress);
    } catch (e) {
      if (!isAbort(e)) console.warn('Streamed upload unavailable, timing whole posts instead:', e.message);
    }
  }

  return blindUpload(streams, perStream, spent, onProgress);
}

/** Rate sampled from the network pulling the body — same method as download. */
async function streamedUpload(streams, perStream, spent, onProgress) {
  const c = CFG.up;
  const ctl = new AbortController();
  const meas = new Sampler();
  meas.start();

  const size = Math.round(clamp(perStream * 4, 1 << 20, 64 << 20));

  const workers = pool(streams, async () => {
    while (!ctl.signal.aborted) {
      await postStream(size, ctl.signal, n => { meas.add(n); spent += n; });
    }
  });

  const t0 = now();
  while (!ctl.signal.aborted) {
    await sleep(c.sampleMs);
    const elapsed = now() - t0;
    const rate = meas.tick(c.windowMs);

    onProgress(toMbps(rate), spent);
    if (elapsed > c.warmupMs && rate > 0) meas.rates.push(rate);

    const enough  = elapsed >= c.minMs && meas.rates.length >= 10;
    const settled = enough && cov(meas.rates.slice(-10)) < c.stableCov;
    if (workers.error || settled || elapsed >= c.maxMs || spent >= c.maxBytes) break;
  }

  ctl.abort();
  await workers.done;
  if (workers.error && !meas.rates.length) throw workers.error;

  const bps = meas.rates.length
    ? median(meas.rates)
    : meas.bytes / ((now() - meas.startedAt) / 1000);
  return { mbps: toMbps(bps), bytes: spent };
}

/** Fallback: time whole POSTs, kept short so the in-flight tail is small. */
async function blindUpload(streams, perStream, spent, onProgress) {
  const c = CFG.up;
  const ctl = new AbortController();
  const chunk = Math.round(clamp(perStream * (c.chunkMs / 1000), 64 << 10, 8 << 20));

  // Warm every connection first so setup cost stays out of the numbers.
  await Promise.all(
    Array.from({ length: streams }, () => postBlob(payload(64 << 10), ctl.signal))
  );
  spent += streams * (64 << 10);

  const t0 = now();
  let done = 0, hits = 0, lastEnd = t0;

  const workers = pool(streams, async () => {
    while (!ctl.signal.aborted) {
      const blob = payload(chunk);
      await postBlob(blob, ctl.signal);
      done += blob.size;
      spent += blob.size;
      hits++;
      lastEnd = now();
      onProgress(toMbps(done / ((lastEnd - t0) / 1000)), spent);
    }
  });

  while (!ctl.signal.aborted) {
    await sleep(c.sampleMs);
    const elapsed = now() - t0;
    // Every stream must land several posts, or the bytes still in
    // flight would be a large share of what we are measuring.
    if (workers.error ||
        (elapsed >= c.minMs && hits >= streams * 3) ||
        elapsed >= c.maxMs || spent >= c.maxBytes) break;
  }

  ctl.abort();
  await workers.done;
  if (workers.error && !hits) throw workers.error;

  const secs = Math.max((lastEnd - t0) / 1000, 0.001);
  return { mbps: toMbps(done / secs), bytes: spent };
}

/* ===========================================================
   Where are we testing from?
   =========================================================== */

const COLOS = {
  ATH: 'Athens', SKG: 'Thessaloniki', MXP: 'Milan', FRA: 'Frankfurt',
  AMS: 'Amsterdam', LHR: 'London', CDG: 'Paris', MAD: 'Madrid',
  VIE: 'Vienna', WAW: 'Warsaw', ARN: 'Stockholm', OTP: 'Bucharest',
  SOF: 'Sofia', IST: 'Istanbul', ZRH: 'Zurich', BRU: 'Brussels',
  DUB: 'Dublin', LIS: 'Lisbon', PRG: 'Prague', BUD: 'Budapest',
  EWR: 'Newark', IAD: 'Ashburn', ORD: 'Chicago', DFW: 'Dallas',
  LAX: 'Los Angeles', SJC: 'San Jose', SEA: 'Seattle', MIA: 'Miami',
  YYZ: 'Toronto', GRU: 'São Paulo', NRT: 'Tokyo', SIN: 'Singapore',
  HKG: 'Hong Kong', SYD: 'Sydney', BOM: 'Mumbai', DXB: 'Dubai'
};

async function locate() {
  try {
    const res = await fetch(`${CF}/cdn-cgi/trace`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000)
    });
    const text = await res.text();
    const kv = Object.fromEntries(
      text.trim().split('\n').map(l => l.split('=').map(s => s.trim()))
    );
    return { ip: kv.ip, colo: kv.colo, loc: kv.loc };
  } catch {
    return null;
  }
}

/* ===========================================================
   What your connection can actually do
   =========================================================== */

/* Requirements are the platforms' own published minimums, rounded up
   a little so a "yes" here means comfortably yes, not barely. */
const ACTIVITIES = [
  { icon: '📺', name: '4K / UHD streaming',        need: { down: 25 },            note: 'Netflix, YouTube, Disney+' },
  { icon: '🎬', name: '1080p HD streaming',        need: { down: 5 },             note: 'the usual "watch a film" case' },
  { icon: '🎵', name: 'Lossless music streaming',  need: { down: 2 },             note: 'Apple Music, Tidal, Qobuz' },
  { icon: '💬', name: 'HD video call, 1-on-1',     need: { down: 3, up: 3 },      note: 'Zoom, Meet, FaceTime, Teams' },
  { icon: '👥', name: 'Group video call in HD',    need: { down: 5, up: 4 },      note: 'a full meeting room of faces' },
  { icon: '💼', name: 'Working from home',         need: { down: 10, up: 5 },     note: 'VPN, cloud drives, screen share' },
  { icon: '🕹️', name: 'Online gaming',             need: { down: 3, ping: 80 },   note: 'ping matters far more than speed' },
  { icon: '☁️', name: 'Cloud gaming at 1080p60',   need: { down: 15, ping: 60 },  note: 'GeForce NOW, Xbox Cloud' },
  { icon: '🔴', name: 'Live streaming 1080p60',    need: { up: 6 },               note: 'Twitch, YouTube Live' },
  { icon: '📤', name: 'Cloud backup & big uploads',need: { up: 10 },              note: 'iCloud, Drive, Dropbox sync' }
];

const TRANSFERS = [
  { name: 'A 25 MB app update',        bytes: 25e6,  dir: 'down' },
  { name: 'A 1 GB film',               bytes: 1e9,   dir: 'down' },
  { name: 'A 60 GB game',              bytes: 60e9,  dir: 'down' },
  { name: '200 photos to the cloud',   bytes: 800e6, dir: 'up',  note: '~800 MB' },
  { name: 'A 4 GB video to the cloud', bytes: 4e9,   dir: 'up' }
];

function grade(down, up, ping) {
  if (down < 3 || ping > 250)
    return ['Slow', 'Fine for email, messaging and reading. Video will struggle.'];
  if (down < 10)
    return ['Basic', 'One HD stream or one video call at a time — not both.'];
  if (down < 30)
    return ['Comfortable', 'HD everywhere, 4K on one screen, calls without drama.'];
  if (down < 100)
    return ['Fast', 'A busy household: several 4K streams, calls and downloads at once.'];
  if (down < 500)
    return ['Very fast', 'Effectively unlimited for everyday use. Big downloads land in minutes.'];
  return ['Blazing', 'Gigabit-class. Nothing you do day to day will be the bottleneck.'];
}

/* `up` is null while the upload phase is still running. Anything that
   depends on it is marked pending rather than guessed at. */
function reason(need, down, up, ping) {
  const missing = [];
  if (need.down && down < need.down)         missing.push(`${need.down} Mbps down`);
  if (need.up && up !== null && up < need.up) missing.push(`${need.up} Mbps up`);
  if (need.ping && ping > need.ping)         missing.push(`ping under ${need.ping} ms`);
  return missing.length ? 'needs ' + missing.join(' · ') : null;
}

function renderResults(down, up, ping, jitter) {
  const waiting = up === null;

  /* Activities */
  const acts = $('acts');
  acts.innerHTML = '';
  for (const a of ACTIVITIES) {
    const missing = reason(a.need, down, up, ping);

    // Only pending if upload is the one thing left that could fail it.
    const pending = waiting && !!a.need.up && !missing;
    const ok = !missing && !pending;

    const li = document.createElement('li');
    li.innerHTML = `
      <span class="mark ${pending ? 'wait' : ok ? 'yes' : 'no'}">${pending ? '·' : ok ? '✓' : '✕'}</span>
      <span class="body">
        <span class="name${ok || pending ? '' : ' off'}">${a.icon} ${a.name}</span>
        <span class="note">${pending ? 'checking upload…' : ok ? a.note : missing}</span>
      </span>`;
    acts.appendChild(li);
  }

  /* Transfer times */
  const times = $('times');
  times.innerHTML = '';
  for (const t of TRANSFERS) {
    const pending = waiting && t.dir === 'up';
    const mbps = t.dir === 'down' ? down : up;
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="mark">${t.dir === 'down' ? '↓' : '↑'}</span>
      <span class="body">
        <span class="name">${t.name}</span>
        ${t.note ? `<span class="note">${t.note}</span>` : ''}
      </span>
      <span class="amount${pending ? ' dim' : ''}">${
        pending ? '…' : fmtDuration((t.bytes * 8) / (mbps * 1e6))
      }</span>`;
    times.appendChild(li);
  }

  /* Simultaneous use */
  const sim = $('sim');
  sim.innerHTML = '';
  const rows = [
    ['📺', '4K streams',     Math.floor(down / 25),                        false],
    ['🎬', '1080p streams',  Math.floor(down / 5),                         false],
    ['💬', 'HD video calls', waiting ? 0 : Math.floor(Math.min(down / 3, up / 3)), waiting]
  ];
  for (const [icon, label, n, pending] of rows) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="mark">${icon}</span>
      <span class="body"><span class="name">${label}</span></span>
      <span class="amount${pending || !n ? ' dim' : ''}">${
        pending ? '…' : n < 1 ? 'not really' : n >= 20 ? '20+' : n
      }</span>`;
    sim.appendChild(li);
  }

  // The grade reads download and ping only, so it is final either way.
  const [g, note] = grade(down, up, ping);
  $('grade').textContent = g;
  $('gradeNote').textContent = note;

  for (const id of ['verdict', 'canDo', 'timings', 'household']) $(id).hidden = false;
}

/* ===========================================================
   UI wiring
   =========================================================== */

const ARC = 424.12;                       // length of the 270° gauge arc
const LO = 0.5, HI = 1000;                // gauge range in Mbps (log scale)
const SPAN = Math.log10(HI / LO);

const ui = {
  arc:   $('gaugeArc'),
  value: $('value'),
  unit:  $('unit'),
  phase: $('phase'),
  go:    $('go')
};

function setGauge(mbps) {
  const p = clamp(Math.log10(Math.max(mbps, LO) / LO) / SPAN, 0, 1);
  ui.arc.style.strokeDashoffset = String(ARC * (1 - p));
}

function show(mbps, kind) {
  ui.value.textContent = fmtSpeed(mbps);
  ui.unit.textContent = 'Mbps';
  ui.arc.classList.toggle('up', kind === 'up');
  setGauge(mbps);
}

function showPing(ms) {
  ui.value.textContent = Math.round(ms);
  ui.unit.textContent = 'ms ping';
  setGauge(0);
}

function phase(text) { ui.phase.textContent = text; }

async function run() {
  ui.go.disabled = true;
  ui.go.textContent = 'Testing…';
  for (const id of ['tilesHead', 'tiles', 'explain', 'verdict', 'canDo', 'timings', 'household']) {
    $(id).hidden = true;
  }
  closeExplain();
  $('meta').textContent = '';
  $('usage').textContent = '';

  const started = now();
  let totalBytes = 0;

  try {
    /* Location, in the background — never blocks the test. */
    const where = locate();

    phase('Measuring latency…');
    const lat = await measureLatency(showPing);
    $('rPing').textContent   = Math.round(lat.ping);
    $('rJitter').textContent = Math.round(lat.jitter);

    phase('Measuring download…');
    ui.arc.classList.remove('up');
    const dl = await measureDownload((mbps, bytes) => {
      show(mbps, 'down');
      totalBytes = bytes;
      phase(`Measuring download… ${fmtBytes(bytes)} used`);
    });
    $('rDown').textContent = fmtSpeed(dl.mbps);
    $('tilesHead').hidden = false;
    $('tiles').hidden = false;

    // Show everything download and ping already settle, and leave only
    // the upload-dependent rows pending. Six of the ten activities, both
    // download timings and the grade are final at this point.
    renderResults(dl.mbps, null, lat.ping, lat.jitter);

    phase('Measuring upload…');
    $('rUp').textContent = '…';
    const ulStart = totalBytes;
    const ul = await measureUpload(dl.mbps * 1e6 / 8, (mbps, bytes) => {
      show(mbps, 'up');
      totalBytes = ulStart + bytes;
      phase(`Measuring upload… ${fmtBytes(totalBytes)} used`);
    });
    $('rUp').textContent = fmtSpeed(ul.mbps);

    show(dl.mbps, 'down');
    phase('Done');

    renderResults(dl.mbps, ul.mbps, lat.ping, lat.jitter);

    const w = await where;
    if (w) {
      const city = COLOS[w.colo];
      $('meta').textContent =
        `Tested against ${city ? city + ' (' + w.colo + ')' : w.colo} · your IP ${w.ip}`;
    }

    const secs = (now() - started) / 1000;
    $('usage').textContent =
      `${fmtBytes(totalBytes)} of data in ${secs.toFixed(1)} s` + (SAVE_DATA
        ? ' — Data Saver is on, so the test stopped early. On a fast line that reads low.'
        : ' — a typical speed test spends 5–20× that.');

  } catch (err) {
    console.error(err);
    phase('');
    ui.value.textContent = '—';
    ui.unit.textContent = 'error';
    $('meta').textContent =
      'Could not reach the test server. Check your connection, or disable a VPN / content blocker and try again.';
  } finally {
    ui.go.disabled = false;
    ui.go.textContent = 'Test again';
  }
}

ui.go.addEventListener('click', run);

/* ── Explanations ────────────────────────────────────────── */

const EXPLAIN = {
  down: ['Download',
    'How fast data reaches you. It decides what video quality you can ' +
    'stream and how quickly pages and files load — the number most people ' +
    'mean by "internet speed".'],

  up: ['Upload',
    'How fast data leaves your device: video calls, sending files to cloud ' +
    'storage, live streaming. Home connections are usually far slower ' +
    'upward than downward, and that is normal.'],

  ping: ['Ping',
    'How long one message takes to reach the server and come back, in ' +
    'milliseconds. Low ping is what makes a connection feel instant. Gaming ' +
    'and calls care about this far more than about speed.'],

  jitter: ['Jitter',
    'How much the ping varies from one message to the next. Steady is good — ' +
    'high jitter is what makes a call stutter or a game jump, even when the ' +
    'ping and speed both look fine.']
};

const explainBtns = [...document.querySelectorAll('[data-explain]')];
let openKey = null;

/* Declared, not assigned, so run() can call it from higher up the file. */
function closeExplain() {
  for (const b of explainBtns) b.setAttribute('aria-expanded', 'false');
  $('explain').hidden = true;
  openKey = null;
}

for (const btn of explainBtns) {
  btn.addEventListener('click', () => {
    const key = btn.dataset.explain;
    const closing = openKey === key;

    closeExplain();
    if (closing) return;

    const [title, body] = EXPLAIN[key];
    $('explainTitle').textContent = title;
    $('explainBody').textContent = body;
    $('explain').hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openKey = key;
  });
}

/* Each card explains itself, in place. */
for (const btn of document.querySelectorAll('[data-note]')) {
  btn.addEventListener('click', () => {
    const note = $('note-' + btn.dataset.note);
    const opening = note.hidden;
    note.hidden = !opening;
    btn.setAttribute('aria-expanded', String(opening));
  });
}
