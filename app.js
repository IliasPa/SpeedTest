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

/* A fetch inside a Worker fails outright above roughly 8 MB in Chromium
   — measured: 8 MB fine, 16 MB "Failed to fetch". Workers therefore ask
   for smaller pieces and simply ask more often; with several of them
   running the gaps overlap and throughput stays smooth. */
const WORKER_CHUNK_MAX = 8 << 20;

const CFG = {
  ping: { count: 10, warmup: 2, minSamples: 5, maxMs: 3500, timeoutMs: 3000 },

  down: {
    probeMs:    600,          // the probe is capped by time, not by size:
    probeBytes: 8 << 20,      // a fixed 1 MB costs a slow line seconds
    warmupMs:   700,          // ignored: TCP slow start / TLS ramp
    minMs:      1600,         // never trust a shorter sample
    maxMs:      12000,        // runaway guard, not a measurement limit
    maxBytes:   400 << 20,    // ditto: convergence normally stops long before
    fastMbps:   200,          // above this, shorten the window — see below
    chunkMs:    1500,         // aim each request at ~1.5 s of transfer
    settleTol:  0.035,        // stop when the running median moves < 3.5 %
    settleFor:  6,            //   for this many consecutive ticks
    sampleMs:   100,
    windowMs:   700
  },

  up: {
    probeMs:    400,          // target duration; the size is derived from
    probeMin:   64 << 10,     // the download result, since a blind POST
    probeMax:   2 << 20,      // cannot be cut short once it is in flight
    warmupMs:   600,
    minMs:      1800,
    maxMs:      12000,
    maxBytes:   200 << 20,
    chunkMs:    500,          // short posts: the blind tail stays small
    settleTol:  0.045,
    settleFor:  6,
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

/** Value below which p of the samples fall (p from 0 to 1). */
function percentile(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[clamp(Math.round((s.length - 1) * p), 0, s.length - 1)];
}

/**
 * How far the throughput samples disagreed, as a fraction of the middle
 * one. Quartiles rather than the full spread, so a single hiccup does
 * not decide the answer on its own.
 */
function dispersion(a) {
  if (a.length < 4) return 0;
  const mid = percentile(a, 0.5);
  return mid > 0 ? (percentile(a, 0.75) - percentile(a, 0.25)) / mid : 0;
}

/**
 * Watches the running answer instead of the raw samples.
 *
 * The old test asked whether the last ten samples agreed with each
 * other, which on a jittery line is never true — so it measured until
 * the ceiling every single time. What actually matters is whether taking
 * more samples still moves the median. Once the answer stops changing,
 * more data buys nothing, however much the line bounces underneath.
 */
class Convergence {
  constructor(tol, need) {
    this.tol  = tol;    // fractional move that still counts as settled
    this.need = need;   // consecutive settled ticks required
    this.last = 0;
    this.runs = 0;
  }

  /** Feed the current best estimate; true once it has stopped moving. */
  push(estimate) {
    if (!(estimate > 0)) return false;

    if (this.last > 0 && Math.abs(estimate - this.last) / this.last < this.tol) {
      this.runs++;
    } else {
      this.runs = 0;
    }

    this.last = estimate;
    return this.runs >= this.need;
  }
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
  if (sec < 1)  return t('dur.sub1');
  if (sec < 60) return t('dur.sec', { n: Math.round(sec) });
  if (sec < 3600) {
    const m = Math.floor(sec / 60), r = Math.round(sec % 60);
    return r ? t('dur.minSec', { m, s: r }) : t('dur.min', { n: m });
  }
  if (sec < 86400) {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return m ? t('dur.hrMin', { h, m }) : t('dur.hr', { n: h });
  }
  return t('dur.days', { n: (sec / 86400).toFixed(1) });
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
   What the server's own TCP stack saw

   Cloudflare returns kernel socket statistics on every response in a
   Server-Timing header, and the counters accumulate over the life of
   the connection. After a real transfer that yields the number of
   segments it sent and how many it had to send again — a direct read
   on packet loss, for no extra bytes at all.
   =========================================================== */

/* Chromium may spread a transfer over several connections, and each one
   counts only its own packets. The header names the connection it came
   from, so keep the high-water mark per connection and add them up —
   otherwise whichever connection we happened to ask last decides the
   answer, and a fresh one reports almost nothing. */
const tcpConns = new Map();     // cid -> { sent, retrans, minRtt }
let peakServerRate = 0;         // best single-connection rate the server saw

function noteTcpRaw(raw) {
  if (!raw) return;

  const m = /cfL4;desc="\?([^"]+)"/.exec(raw);
  if (!m) return;

  const f = Object.fromEntries(m[1].split('&').map(p => p.split('=')));
  const cid  = f.cid || 'unknown';
  const sent = +f.sent || 0;

  // delivery_rate is the sending kernel's own estimate of the rate it
  // achieved, in bytes/sec. It is measured on the server, so it is not
  // subject to anything this browser is or is not fast enough to do.
  const rate = +f.delivery_rate || 0;
  if (rate > peakServerRate) peakServerRate = rate;

  // Counters only ever grow on a given connection, so the largest
  // reading is the most complete one.
  const prev = tcpConns.get(cid);
  if (!prev || sent > prev.sent) {
    tcpConns.set(cid, {
      sent,
      retrans: +f.retrans || 0,
      minRtt:  (+f.min_rtt || 0) / 1000     // µs → ms
    });
  }
}

function noteTcp(res) { noteTcpRaw(res.headers.get('server-timing')); }

function tcpTotals() {
  let sent = 0, retrans = 0, minRtt = Infinity;
  for (const c of tcpConns.values()) {
    sent    += c.sent;
    retrans += c.retrans;
    if (c.minRtt > 0) minRtt = Math.min(minRtt, c.minRtt);
  }
  return { sent, retrans, minRtt: isFinite(minRtt) ? minRtt : 0, conns: tcpConns.size };
}

function resetTcp() { tcpConns.clear(); peakServerRate = 0; }

/** Loss as a percentage of packets sent, or null if too little moved. */
function lossPercent() {
  const t = tcpTotals();
  if (t.sent < 200) return null;
  return (t.retrans / t.sent) * 100;
}

/**
 * Did the browser, rather than the line, decide the answer?
 *
 * peakServerRate is what a *single* connection's kernel says it achieved.
 * If one connection alone out-ran everything this page managed to
 * measure across all of them, the number below is a floor, not a
 * ceiling — the line has more to give than a browser tab can take.
 */
function browserLimited(measuredMbps) {
  const serverMbps = toMbps(peakServerRate);
  if (!(serverMbps > 0) || !(measuredMbps > 0)) return null;
  return serverMbps > measuredMbps * 1.3 ? serverMbps : null;
}

/**
 * Harvest the counters after a transfer. The stats ride on response
 * headers, so they describe the connection as it stood *before* that
 * response's own body — totals for a transfer only surface on a later
 * request. Chromium may also spread work across more than one
 * connection, so ask a few times and keep the busiest.
 */
async function sampleTcp(signal) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${CF}/__down?bytes=0&r=${Math.random()}`,
                              { cache: 'no-store', signal });
      noteTcp(res);
      await res.arrayBuffer();
    } catch {
      return;
    }
  }
}

/* ===========================================================
   Latency
   =========================================================== */

/**
 * Ping continuously while something else saturates the line. The gap
 * between this and the idle ping is bufferbloat: the delay your calls
 * and games suffer whenever the connection is busy.
 */
function pingUnderLoad(signal) {
  const rtts = [];

  (async () => {
    while (!signal.aborted) {
      const t0 = now();
      try {
        const res = await fetch(`${CF}/__down?bytes=0&r=${Math.random()}`,
                                { cache: 'no-store', signal });
        noteTcp(res);
        await res.arrayBuffer();
        rtts.push(now() - t0);
      } catch {
        return;                       // aborted, or the line gave up
      }
      await sleep(250);
    }
  })();

  return rtts;
}

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
  noteTcp(res);

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

  /* ── Measure: parallel streams, stop as soon as it settles ── */
  const ctl = new AbortController();
  const meas = new Sampler();
  meas.start();

  // Ping alongside the transfer: the line is saturated now, which is
  // exactly when latency matters and exactly when nobody measures it.
  const loaded = pingUnderLoad(ctl.signal);

  // Off the main thread when possible, so the reading loop stops
  // competing with the page for the very cycles it is timing.
  const useWorkers = await canUseWorkers();

  const driver = useWorkers
    ? workerDriver(streams, chunk, n => meas.add(n))
    : (() => {
        const d = pool(streams, async () => {
          while (!ctl.signal.aborted) {
            await streamDown(chunk, ctl.signal, n => meas.add(n));
          }
        });
        return { get error() { return d.error; }, done: d.done, stop: () => ctl.abort() };
      })();

  const spent = () => sampler.bytes + meas.bytes;
  const settle = new Convergence(c.settleTol, c.settleFor);
  const t0 = now();

  for (;;) {
    await sleep(c.sampleMs);
    const elapsed = now() - t0;
    const rate = meas.tick(c.windowMs);

    onProgress(toMbps(rate), spent());

    let settled = false;
    if (elapsed > warmupMs && rate > 0) {
      meas.rates.push(rate);
      settled = settle.push(median(meas.rates)) &&
                elapsed >= minMs && meas.rates.length >= minRates;
    }

    if (driver.error || settled || elapsed >= c.maxMs || spent() >= c.maxBytes) break;
  }

  driver.stop();
  ctl.abort();                       // stops the loaded-latency pings too
  if (driver.done) await driver.done;

  // Workers died before telling us anything: fall back to the main
  // thread and measure again rather than failing the whole test.
  if (driver.error && !meas.rates.length) {
    if (useWorkers) {
      workersUsable = false;
      return measureDownload(onProgress);
    }
    throw driver.error;
  }


  // Now that the streams are done, read what the server's stack recorded.
  await sampleTcp();

  const bps = meas.rates.length
    ? median(meas.rates)
    : meas.bytes / ((now() - meas.startedAt) / 1000);

  return {
    mbps:   toMbps(bps),
    bytes:  spent(),
    lo:     toMbps(percentile(meas.rates, 0.1)),
    hi:     toMbps(percentile(meas.rates, 0.9)),
    spread: dispersion(meas.rates),
    samples: meas.rates.length,
    loaded: median(loaded)
  };
}


/* ===========================================================
   Download drivers

   Reading a stream costs main-thread time: every chunk is a JS callback,
   and TLS decryption lands on the same thread as the page. Below a few
   hundred Mbps that is free, because the line is the bottleneck. Past
   it the browser becomes the bottleneck and the test measures itself
   instead of the connection.

   So the work moves off the main thread — one worker per stream, each
   fetching and draining independently, reporting only totals. Falls
   back to the main thread wherever workers cannot be created.
   =========================================================== */

const DOWN_WORKER_SRC = `
self.onmessage = async (e) => {
  const base = e.data.base, bytes = e.data.bytes;
  let pending = 0, misses = 0;

  const flush = () => { if (pending) { self.postMessage({ n: pending }); pending = 0; } };
  const timer = setInterval(flush, 100);

  // A dropped request is not the end of the measurement: other streams
  // are still running, and the line often recovers immediately. Only
  // give up after several consecutive failures.
  for (;;) {
    try {
      const res = await fetch(base + '?bytes=' + bytes + '&r=' + Math.random(),
                              { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const st = res.headers.get('server-timing');
      if (st) self.postMessage({ st: st });

      const rd = res.body.getReader();
      for (;;) {
        const r = await rd.read();
        if (r.done) break;
        pending += r.value.length;
      }
      misses = 0;
    } catch (err) {
      if (++misses >= 3) {
        clearInterval(timer);
        flush();
        self.postMessage({ error: String((err && err.message) || err) });
        return;
      }
      await new Promise(r => setTimeout(r, 150));
    }
  }
};
`;
/** One worker per stream. Stopping is a terminate, which kills the
    transfer instantly — the same "stop the moment we know" behaviour
    the AbortController gives on the main thread. */
function workerDriver(streams, chunk, onBytes) {
  const blobUrl = URL.createObjectURL(
    new Blob([DOWN_WORKER_SRC], { type: 'text/javascript' })
  );

  const driver = { error: null, stop: null, workers: [], dead: 0 };

  for (let i = 0; i < streams; i++) {
    const w = new Worker(blobUrl);
    w.onmessage = ev => {
      const d = ev.data;
      if (d.n) onBytes(d.n);
      else if (d.st) noteTcpRaw(d.st);
      // One stream giving up is survivable; all of them is not.
      else if (d.error && ++driver.dead >= streams) driver.error = new Error(d.error);
    };
    w.onerror = () => {
      if (++driver.dead >= streams) driver.error = new Error('workers failed');
    };
    w.postMessage({ base: `${CF}/__down`, bytes: Math.min(chunk, WORKER_CHUNK_MAX) });
    driver.workers.push(w);
  }

  driver.stop = () => {
    for (const w of driver.workers) w.terminate();
    URL.revokeObjectURL(blobUrl);
  };

  return driver;
}

/** Are workers usable at all? Blob-URL workers are blocked by some
    content policies, so prove one starts before relying on them. */
let workersUsable = null;

async function canUseWorkers() {
  if (workersUsable !== null) return workersUsable;

  workersUsable = await new Promise(resolve => {
    if (typeof Worker === 'undefined') return resolve(false);
    let url;
    try {
      url = URL.createObjectURL(
        new Blob(['self.onmessage=()=>self.postMessage(1)'], { type: 'text/javascript' })
      );
      const w = new Worker(url);
      const done = ok => { try { w.terminate(); URL.revokeObjectURL(url); } catch {} resolve(ok); };
      const timer = setTimeout(() => done(false), 1500);
      w.onmessage = () => { clearTimeout(timer); done(true); };
      w.onerror   = () => { clearTimeout(timer); done(false); };
      w.postMessage(0);
    } catch {
      if (url) URL.revokeObjectURL(url);
      resolve(false);
    }
  });

  return workersUsable;
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
  const loaded = pingUnderLoad(ctl.signal);

  const workers = pool(streams, async () => {
    while (!ctl.signal.aborted) {
      await postStream(size, ctl.signal, n => { meas.add(n); spent += n; });
    }
  });

  const settle = new Convergence(c.settleTol, c.settleFor);
  const t0 = now();

  while (!ctl.signal.aborted) {
    await sleep(c.sampleMs);
    const elapsed = now() - t0;
    const rate = meas.tick(c.windowMs);

    onProgress(toMbps(rate), spent);

    let settled = false;
    if (elapsed > c.warmupMs && rate > 0) {
      meas.rates.push(rate);
      settled = settle.push(median(meas.rates)) &&
                elapsed >= c.minMs && meas.rates.length >= 10;
    }

    if (workers.error || settled || elapsed >= c.maxMs || spent >= c.maxBytes) break;
  }

  ctl.abort();
  await workers.done;
  if (workers.error && !meas.rates.length) throw workers.error;

  const bps = meas.rates.length
    ? median(meas.rates)
    : meas.bytes / ((now() - meas.startedAt) / 1000);

  return {
    mbps:   toMbps(bps),
    bytes:  spent,
    lo:     toMbps(percentile(meas.rates, 0.1)),
    hi:     toMbps(percentile(meas.rates, 0.9)),
    spread: dispersion(meas.rates),
    loaded: median(loaded)
  };
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

  const loaded = pingUnderLoad(ctl.signal);

  // Bytes are only credited when a POST finishes, so the rate is read
  // over a long window — otherwise the range would describe the size of
  // the chunks rather than the steadiness of the line.
  const meas = new Sampler();
  meas.start();

  const workers = pool(streams, async () => {
    while (!ctl.signal.aborted) {
      const blob = payload(chunk);
      await postBlob(blob, ctl.signal);
      done += blob.size;
      spent += blob.size;
      meas.add(blob.size);
      hits++;
      lastEnd = now();
      onProgress(toMbps(done / ((lastEnd - t0) / 1000)), spent);
    }
  });

  while (!ctl.signal.aborted) {
    await sleep(c.sampleMs);
    const elapsed = now() - t0;
    const rate = meas.tick(1200);
    if (elapsed > c.warmupMs && rate > 0) meas.rates.push(rate);

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
  return {
    mbps:   toMbps(done / secs),
    bytes:  spent,
    lo:     toMbps(percentile(meas.rates, 0.1)),
    hi:     toMbps(percentile(meas.rates, 0.9)),
    spread: dispersion(meas.rates),
    loaded: median(loaded)
  };
}


/* ===========================================================
   Sharing

   A link carries the numbers in its own fragment, so nothing is
   uploaded and no server keeps a record. That also means a shared
   result is only as honest as whoever sent it — anyone can edit the
   link — so a shared view says so plainly rather than pretending to
   be a measurement.
   =========================================================== */

let lastResult = null;

function shareLink(r) {
  const p = new URLSearchParams();
  p.set('d', r.down.toFixed(2));
  p.set('u', r.up.toFixed(2));
  p.set('p', String(Math.round(r.ping)));
  p.set('j', String(Math.round(r.jitter)));
  if (r.loaded) p.set('l', String(Math.round(r.loaded)));
  if (r.loss != null) p.set('x', r.loss.toFixed(2));
  p.set('t', String(Math.round(r.t / 1000)));
  return `${location.origin}${location.pathname}#${p}`;
}

function readShared() {
  if (!location.hash || location.hash.length < 4) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  const num = k => (p.has(k) ? Number(p.get(k)) : null);

  const down = num('d'), up = num('u'), ping = num('p');
  if (!(down > 0) || !(up >= 0) || !(ping >= 0)) return null;

  return {
    down, up, ping,
    jitter: num('j') ?? 0,
    loaded: num('l'),
    loss:   num('x'),
    t:      (num('t') || 0) * 1000
  };
}

/** Draws the result as an image worth posting. */
function drawCard(r) {
  const W = 1200, H = 630, s = 2;
  const cv = document.createElement('canvas');
  cv.width = W * s; cv.height = H * s;
  const g = cv.getContext('2d');
  g.scale(s, s);

  const css = getComputedStyle(document.documentElement);
  const pick = (n, f) => (css.getPropertyValue(n) || f).trim();

  g.fillStyle = '#0d1017'; g.fillRect(0, 0, W, H);
  g.fillStyle = pick('--accent', '#ffd233');

  const F = w => `${w} 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

  g.font = '700 34px' + F(700).slice(3);
  g.fillText('⚡ Speed Test', 72, 96);

  const v = verdict(r.down, r.up, r.ping, r.loaded ? r.loaded - r.ping : null, r.loss);
  g.fillStyle = '#e8ecf4';
  g.font = '650 46px' + F(650).slice(3);
  g.fillText(v.headline, 72, 176);

  const cols = [
    ['DOWNLOAD', fmtSpeed(r.down), 'Mbps'],
    ['UPLOAD',   fmtSpeed(r.up),   'Mbps'],
    ['PING',     String(Math.round(r.ping)), 'ms']
  ];
  if (r.loaded) cols.push(['PING WHEN BUSY', String(Math.round(r.loaded)), 'ms']);

  const w = (W - 144) / cols.length;
  cols.forEach(([label, value, unit], i) => {
    const x = 72 + i * w;
    g.fillStyle = '#8b95a8';
    g.font = '600 20px' + F(600).slice(3);
    g.fillText(label, x, 300);
    g.fillStyle = '#e8ecf4';
    g.font = '700 84px' + F(700).slice(3);
    g.fillText(value, x, 386);
    const vw = g.measureText(value).width;
    g.fillStyle = '#8b95a8';
    g.font = '500 26px' + F(500).slice(3);
    g.fillText(unit, x + vw + 12, 386);
  });

  g.fillStyle = '#8b95a8';
  g.font = '400 24px' + F(400).slice(3);
  const note = v.note.length > 96 ? v.note.slice(0, 93) + '…' : v.note;
  g.fillText(note, 72, 470);

  g.fillStyle = pick('--accent', '#ffd233');
  g.font = '600 24px' + F(600).slice(3);
  g.fillText('iliaspa.github.io/SpeedTest', 72, 556);

  return cv;
}

function showShareRow(r) {
  lastResult = r;
  $('share').hidden = false;
}

function flash(msg) {
  const el = $('shareMsg');
  el.textContent = msg;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.textContent = ''; }, 2600);
}

/** Render a result that arrived in a link rather than being measured. */
function renderShared(r) {
  $('rDown').textContent   = fmtSpeed(r.down);
  $('rUp').textContent     = fmtSpeed(r.up);
  $('rPing').textContent   = String(Math.round(r.ping));
  $('rJitter').textContent = String(Math.round(r.jitter));

  const rise = r.loaded ? r.loaded - r.ping : null;
  const quality = { ping: r.ping, rise, loaded: r.loaded, loss: r.loss,
                    spread: null, floorMbps: null, packets: null };
  const when = r.t ? new Date(r.t).toLocaleString(LANG) : '?';

  lastRender = { down: r.down, up: r.up, ping: r.ping, jitter: r.jitter,
                 rise, loss: r.loss, quality, dl: null, ul: null,
                 justRan: false, shared: true, when };

  renderResults(r.down, r.up, r.ping, r.jitter, rise, r.loss);
  renderQuality(quality);

  show(r.down, 'down');
  phase(t('btn.shared'));

  $('sharedBanner').textContent = t('share.banner', { when });
  $('sharedBanner').hidden = false;
  showShareRow(r);
}

/* ===========================================================
   History

   A single reading means very little — the same line here measured
   46 Mbps and 1212 Mbps a day apart. Kept on this device only, in
   localStorage: nothing is uploaded and there is no account.
   =========================================================== */

const HISTORY_KEY = 'speedtest.history.v1';
const HISTORY_MAX = 20;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(r => r && typeof r.down === 'number') : [];
  } catch {
    return [];                       // private mode, or storage disabled
  }
}

function saveRun(entry) {
  try {
    const list = loadHistory();
    list.push(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-HISTORY_MAX)));
  } catch {
    /* not being able to remember is not a reason to fail the test */
  }
}

function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
}

function fmtAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 90)    return t('ago.now');
  if (s < 3600)  return t('ago.min', { n: Math.round(s / 60) });
  if (s < 86400) return t('ago.hr',  { n: Math.round(s / 3600) });
  const d = Math.round(s / 86400);
  return d === 1 ? t('ago.yesterday') : t('ago.days', { n: d });
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
  { icon: '📺', k: 'act.4k',     need: { down: 25 } },
  { icon: '🎬', k: 'act.hd',     need: { down: 5 } },
  { icon: '🎵', k: 'act.music',  need: { down: 2 } },
  { icon: '💬', k: 'act.call',   need: { down: 3, up: 3, rise: 250 } },
  { icon: '👥', k: 'act.group',  need: { down: 5, up: 4, rise: 200 } },
  { icon: '💼', k: 'act.work',   need: { down: 10, up: 5 } },
  { icon: '🕹️', k: 'act.game',   need: { down: 3, ping: 80, rise: 150 } },
  { icon: '☁️', k: 'act.cloud',  need: { down: 15, ping: 60, rise: 100 } },
  { icon: '🔴', k: 'act.live',   need: { up: 6, loss: 1 } },
  { icon: '📤', k: 'act.backup', need: { up: 10 } }
];

const TRANSFERS = [
  { k: 'file.app',    bytes: 25e6,  dir: 'down' },
  { k: 'file.film',   bytes: 1e9,   dir: 'down' },
  { k: 'file.game',   bytes: 60e9,  dir: 'down' },
  { k: 'file.photos', bytes: 800e6, dir: 'up', note: true },
  { k: 'file.video',  bytes: 4e9,   dir: 'up' }
];

/* Raw speed, which is all the headline used to consider. */
function speedTier(down) {
  const n = down < 3 ? 0 : down < 10 ? 1 : down < 30 ? 2 : down < 100 ? 3 : down < 500 ? 4 : 5;
  return [n, t(`speed.${n}`), t(`speed.${n}.note`)];
}

/**
 * How the line behaves rather than how big it is: idle ping, how far
 * latency climbs when busy, and how many packets go missing. This is
 * what decides whether calls and games feel right, and it is entirely
 * independent of megabits.
 */
function responsiveness(ping, rise, loss) {
  let tier = 4;
  const faults = [];

  if (ping > 150)      { tier = Math.min(tier, 1); faults.push(t('fault.ping')); }
  else if (ping > 80)  { tier = Math.min(tier, 3); }

  if (rise != null) {
    if (rise >= 250)      { tier = Math.min(tier, 0); faults.push(t('fault.collapse')); }
    else if (rise >= 125) { tier = Math.min(tier, 1); faults.push(t('fault.climb')); }
    else if (rise >= 60)  { tier = Math.min(tier, 2); faults.push(t('fault.build')); }
  }

  if (loss != null) {
    if (loss >= 2.5)     { tier = Math.min(tier, 0); faults.push(t('fault.lossHeavy')); }
    else if (loss >= 1)  { tier = Math.min(tier, 1); faults.push(t('fault.loss')); }
    else if (loss >= 0.3){ tier = Math.min(tier, 3); }
  }

  return { tier, faults };
}

/**
 * The headline. A connection can be fast and still miserable, so the
 * verdict has to carry both halves — saying "Very fast" about a line
 * whose ping triples under load is the sort of thing that makes people
 * distrust speed tests.
 */
function verdict(down, up, ping, rise, loss) {
  const [sTier, word, blurb] = speedTier(down);
  const r = responsiveness(ping, rise, loss);
  const faults = r.faults.slice(0, 2).join(t('verdict.and'));
  const lossLed = loss != null && loss >= 1;

  if (sTier >= 2 && r.tier <= 1) {
    return lossLed
      ? { headline: t('verdict.paper.head', { word }), note: t('verdict.paper.note', { faults }) }
      : { headline: t('verdict.busy.head',  { word }), note: t('verdict.busy.note',  { faults }) };
  }

  if (sTier <= 1 && r.tier >= 4) {
    return { headline: t('verdict.steady.head', { word }), note: t('verdict.steady.note', { blurb }) };
  }

  if (r.tier <= 1 && faults) {
    return { headline: word, note: t('verdict.also.note', { blurb, faults }) };
  }

  if (r.tier === 2) {
    return { headline: word, note: t('verdict.mild.note', { blurb }) };
  }

  return { headline: word, note: blurb };
}

/**
 * How much the line wandered while being measured. A single number is
 * only worth as much as its steadiness, so say so plainly.
 */
function steadiness(spread) {
  const k = spread <= 0.08 ? 'steady' : spread <= 0.20 ? 'variable'
          : spread <= 0.45 ? 'unsteady' : 'erratic';
  const tone = k === 'steady' ? 'yes' : k === 'erratic' ? 'no' : 'wait';
  return [t(`steady.${k}`), tone, t(`steady.${k}.note`)];
}

/**
 * Bufferbloat: how far latency climbs once the line is busy. This is why
 * a fast connection can still feel broken on calls — the speed is fine,
 * but every packet queues behind a download.
 */
function bloatGrade(rise) {
  if (rise == null || !isFinite(rise)) return null;
  const g = rise < 30 ? 'A' : rise < 60 ? 'B' : rise < 125 ? 'C' : rise < 250 ? 'D' : 'F';
  const tone = g === 'A' || g === 'B' ? 'yes' : g === 'C' ? 'wait' : 'no';
  return [g, tone, t(`bloat.${g}`)];
}

function lossVerdict(pct) {
  if (pct == null) return null;
  const n = pct.toFixed(pct < 1 ? 2 : 1);
  if (pct < 0.1) return [t('loss.none'), 'yes'];
  if (pct < 1)   return [t('loss.some',  { pct: n }), 'wait'];
  if (pct < 2.5) return [t('loss.bad',   { pct: n }), 'no'];
  return           [t('loss.awful', { pct: n }), 'no'];
}

/* `up` is null while the upload phase is still running. Anything that
   depends on it is marked pending rather than guessed at. */
function reason(need, down, up, ping, rise, loss) {
  const missing = [];
  if (need.down && down < need.down)          missing.push(t('acts.needsDown', { n: need.down }));
  if (need.up && up !== null && up < need.up) missing.push(t('acts.needsUp',   { n: need.up }));
  if (need.ping && ping > need.ping)          missing.push(t('acts.needsPing', { n: need.ping }));
  if (need.rise && rise != null && rise > need.rise) missing.push(t('acts.needsCalm'));
  if (need.loss && loss != null && loss > need.loss) missing.push(t('acts.needsLoss'));
  return missing.length ? t('acts.needs', { list: missing.join(' · ') }) : null;
}

function renderResults(down, up, ping, jitter, rise, loss) {
  const waiting = up === null;

  /* Activities */
  const acts = $('acts');
  acts.innerHTML = '';
  for (const a of ACTIVITIES) {
    const missing = reason(a.need, down, up, ping, rise, loss);

    // Only pending if upload is the one thing left that could fail it.
    const pending = waiting && !!a.need.up && !missing;
    const ok = !missing && !pending;

    const li = document.createElement('li');
    li.innerHTML = `
      <span class="ico" aria-hidden="true">${a.icon}</span>
      <span class="body">
        <span class="name${ok || pending ? '' : ' off'}">${t(a.k)}</span>
        <span class="note">${pending ? t('acts.waiting') : ok ? t(a.k + '.note') : missing}</span>
      </span>
      <span class="mark ${pending ? 'wait' : ok ? 'yes' : 'no'}">${pending ? '·' : ok ? '✓' : '✕'}</span>`;
    acts.appendChild(li);
  }

  /* Transfer times */
  const times = $('times');
  times.innerHTML = '';
  for (const f of TRANSFERS) {
    const pending = waiting && f.dir === 'up';
    const mbps = f.dir === 'down' ? down : up;
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="mark">${f.dir === 'down' ? '↓' : '↑'}</span>
      <span class="body">
        <span class="name">${t(f.k)}</span>
        ${f.note ? `<span class="note">${t(f.k + '.note')}</span>` : ''}
      </span>
      <span class="amount${pending ? ' dim' : ''}">${
        pending ? '…' : fmtDuration((f.bytes * 8) / (mbps * 1e6))
      }</span>`;
    times.appendChild(li);
  }

  /* Simultaneous use */
  const sim = $('sim');
  sim.innerHTML = '';
  const rows = [
    ['📺', t('sim.4k'),    Math.floor(down / 25), false],
    ['🎬', t('sim.hd'),    Math.floor(down / 5),  false],
    ['💬', t('sim.calls'), waiting ? 0 : Math.floor(Math.min(down / 3, up / 3)), waiting]
  ];
  for (const [icon, label, n, pending] of rows) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="mark">${icon}</span>
      <span class="body"><span class="name">${label}</span></span>
      <span class="amount${pending || !n ? ' dim' : ''}">${
        pending ? '…' : n < 1 ? t('sim.none') : n >= 20 ? '20+' : n
      }</span>`;
    sim.appendChild(li);
  }

  const v = verdict(down, up, ping, rise, loss);
  $('grade').textContent = v.headline;
  $('gradeNote').textContent = v.note;

  for (const id of ['verdict', 'canDo', 'timings', 'household']) $(id).hidden = false;
}

/** The "when the line is busy" card: bufferbloat, loss, steadiness. */
function renderQuality({ ping, rise, loaded, loss, spread, floorMbps, packets }) {
  const rows = [];

  const bloat = bloatGrade(rise);
  if (bloat) {
    const [letter, tone, blurb] = bloat;
    rows.push([letter, t('qual.bloat'), tone,
      t('qual.bloatDetail', { idle: Math.round(ping), loaded: Math.round(loaded), blurb })]);
  }

  const lv = lossVerdict(loss);
  if (lv) {
    const [text, tone] = lv;
    rows.push(['⇄', t('qual.loss'), tone, packets
      ? t('qual.lossDetail', { text,
          retrans: packets.retrans.toLocaleString(LANG),
          sent: packets.sent.toLocaleString(LANG) })
      : text]);
  }

  if (floorMbps) {
    rows.push(['↑', t('qual.floor'), 'wait',
      t('qual.floorDetail', { mbps: fmtSpeed(floorMbps) })]);
  }

  if (spread != null) {
    const [word, tone, blurb] = steadiness(spread);
    rows.push(['~', t('qual.steady'), tone, t('qual.steadyDetail', { word, blurb })]);
  }

  const el = $('qual');
  el.innerHTML = '';
  for (const [icon, label, tone, detail] of rows) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="mark ${tone} grade-mark">${icon}</span>
      <span class="body">
        <span class="name">${label}</span>
        <span class="note">${detail}</span>
      </span>`;
    el.appendChild(li);
  }
  $('quality').hidden = rows.length === 0;
}

/**
 * Past runs on this device, newest first, each with a bar so the spread
 * is obvious at a glance. Also says where the run just finished sits
 * against the usual, which is the whole point of keeping them.
 */
function renderHistory(justRan) {
  const list = loadHistory();
  const card = $('history');

  if (!list.length) { card.hidden = true; return; }

  const recent = list.slice(-8).reverse();
  const peak = Math.max(...recent.map(r => r.down));

  const el = $('hist');
  el.innerHTML = '';
  for (const [i, r] of recent.entries()) {
    // Only the newest row is "this run", and only right after one ran.
    const tag = justRan && i === 0 ? ` <em class="tag">${t('hist.thisRun')}</em>` : '';
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="body">
        <span class="name">${fmtSpeed(r.down)} <i>Mbps</i>${tag}</span>
        <span class="hist-bar"><span style="width:${(r.down / peak) * 100}%"></span></span>
      </span>
      <span class="amount dim">${fmtAgo(r.t)}</span>`;
    el.appendChild(li);
  }

  const note = $('histNote');
  note.textContent = '';

  if (justRan && list.length >= 2) {
    // Compare the run that just finished against everything before it.
    const past = list.slice(0, -1).map(r => r.down);
    const usual = median(past);
    const current = list[list.length - 1].down;
    const n = past.length;
    const runs = n === 1 ? t('hist.run') : t('hist.runs');

    if (usual > 0) {
      const diff = ((current - usual) / usual) * 100;
      note.textContent = Math.abs(diff) < 12
        ? t('hist.typical', { n, runs, usual: fmtSpeed(usual) })
        : t('hist.differs', { pct: Math.abs(Math.round(diff)), n, runs,
                              usual: fmtSpeed(usual),
                              dir: diff > 0 ? t('hist.faster') : t('hist.slower') });
    }
  } else if (list.length >= 2) {
    const all = list.map(r => r.down);
    note.textContent = t('hist.summary', { n: list.length, mid: fmtSpeed(median(all)),
      lo: fmtSpeed(Math.min(...all)), hi: fmtSpeed(Math.max(...all)) });
  }

  card.hidden = false;
}

/** "58 Mbps, but it ranged 41–72" — shown under the tile figure. */
function showRange(id, r) {
  const el = $(id);
  if (!r || !(r.hi > 0) || r.spread < 0.08) { el.textContent = ''; return; }
  el.textContent = t('tile.ranged', { lo: fmtSpeed(r.lo), hi: fmtSpeed(r.hi) });
}


/* ===========================================================
   Applying the chosen language
   =========================================================== */

/* Enough of the last render to rebuild it in another language. */
let lastRender = null;

function applyStaticText() {
  document.documentElement.lang = LANG;
  document.title = `${t('head.title')} — ${t('head.sub')}`;

  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }

  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    const key = el.dataset.i18nHtml;

    if (/^limits\.\d$/.test(key)) {
      // Each limit is a bold claim followed by its explanation.
      el.innerHTML = `<b>${t(key + '.b')}</b>${t(key)}`;
    } else if (key === 'foot.about') {
      el.innerHTML =
        `${t('foot.about1')} <a href="https://speed.cloudflare.com" rel="noopener">` +
        `${t('foot.about2')}</a>${t('foot.about3')} ` +
        `<a href="https://github.com/IliasPa/SpeedTest" rel="noopener">${t('foot.source')}</a>.`;
    } else {
      el.innerHTML = t(key);
    }
  }

  const btn = $('langBtn');
  btn.textContent = t('lang.other');
  btn.setAttribute('aria-label', t('lang.label'));

  // The gauge unit and the idle button label are not static markup.
  if (!ui.go.disabled) {
    phase(lastRender ? t('btn.done') : loadHistory().length ? t('btn.welcome') : t('btn.ready'));
  }
  if (ui.unit.textContent) ui.unit.textContent = t('unit.mbps');
}

/** Redraw whatever is on screen, in the language now selected. */
function rerender() {
  applyStaticText();
  if (!lastRender) { renderHistory(false); return; }

  const r = lastRender;
  renderResults(r.down, r.up, r.ping, r.jitter, r.rise, r.loss);
  renderQuality(r.quality);
  showRange('rDownRange', r.dl);
  showRange('rUpRange', r.ul);
  renderHistory(r.justRan);
  if (r.usage) $('usage').textContent = r.usage();
  if (r.shared) $('sharedBanner').textContent = t('share.banner', { when: r.when });
}

/* ===========================================================
   UI wiring
   =========================================================== */

const ARC = 424.12;                       // length of the 270° gauge arc
const LO = 0.5, HI = 1000;                // gauge range in Mbps (log scale)
const SPAN = Math.log10(HI / LO);

const ui = {
  arc:    $('gaugeArc'),
  value:  $('value'),
  unit:   $('unit'),
  go:     $('go'),
  goMain: $('goMain'),
  goSub:  $('goSub')
};

function setGauge(mbps) {
  const p = clamp(Math.log10(Math.max(mbps, LO) / LO) / SPAN, 0, 1);
  ui.arc.style.strokeDashoffset = String(ARC * (1 - p));
}

function show(mbps, kind) {
  ui.value.textContent = fmtSpeed(mbps);
  ui.unit.textContent = t('unit.mbps');
  ui.arc.classList.toggle('up', kind === 'up');
  setGauge(mbps);
}

function showPing(ms) {
  ui.value.textContent = Math.round(ms);
  ui.unit.textContent = t('unit.msPing');
  setGauge(0);
}

/* The button is the status line: phase on top, data spent underneath. */
function phase(text) { ui.goMain.textContent = text; }

function used(bytes) {
  ui.goSub.textContent = bytes > 0 ? t('btn.used', { bytes: fmtBytes(bytes) }) : '';
}

/* Quick mode reuses the Data Saver budget, but as a per-run choice
   rather than a browser setting. Applied fresh each run so unticking it
   restores the full measurement. */
function applyBudget(quick) {
  const frugal = quick || SAVE_DATA;
  Object.assign(CFG.down, frugal
    ? { warmupMs: 250, minMs: 500,  maxBytes: 11 << 20, sampleMs: 40 }
    : { warmupMs: 700, minMs: 1600, maxBytes: 400 << 20, sampleMs: 100 });
  Object.assign(CFG.up, frugal
    ? { warmupMs: 250, minMs: 600,  maxBytes: 5 << 20,  sampleMs: 40 }
    : { warmupMs: 600, minMs: 1800, maxBytes: 200 << 20, sampleMs: 100 });
  return frugal;
}

async function run() {
  ui.go.disabled = true;
  const frugal = applyBudget($('quick').checked);

  // The heading and the tiles are permanent fixtures; only the sections
  // below them come and go, so the layout above never jumps.
  for (const id of ['verdict', 'quality', 'canDo', 'timings', 'household', 'share', 'sharedBanner']) $(id).hidden = true;
  for (const id of ['rDown', 'rUp', 'rPing', 'rJitter']) $(id).textContent = '—';
  for (const id of ['rDownRange', 'rUpRange']) $(id).textContent = '';
  $('meta').textContent = '';
  $('usage').textContent = '';
  used(0);   // clear last run's figure; it fills in again once bytes move
  resetTcp();

  const started = now();
  let totalBytes = 0;
  let done = false;

  try {
    /* Location, in the background — never blocks the test. */
    const where = locate();

    phase(t('btn.latency'));
    const lat = await measureLatency(showPing);
    $('rPing').textContent   = Math.round(lat.ping);
    $('rJitter').textContent = Math.round(lat.jitter);

    phase(t('btn.download'));
    ui.arc.classList.remove('up');
    const dl = await measureDownload((mbps, bytes) => {
      show(mbps, 'down');
      totalBytes = bytes;
      used(bytes);
    });
    $('rDown').textContent = fmtSpeed(dl.mbps);

    // Show everything download and ping already settle, and leave only
    // the upload-dependent rows pending. Five of the ten activities, the
    // download timings and the grade are final at this point.
    renderResults(dl.mbps, null, lat.ping, lat.jitter,
                  dl.loaded > 0 ? dl.loaded - lat.ping : null, lossPercent());

    phase(t('btn.upload'));
    $('rUp').textContent = '…';
    const ulStart = totalBytes;
    const ul = await measureUpload(dl.mbps * 1e6 / 8, (mbps, bytes) => {
      show(mbps, 'up');
      totalBytes = ulStart + bytes;
      used(totalBytes);
    });
    $('rUp').textContent = fmtSpeed(ul.mbps);
    showRange('rDownRange', dl);
    showRange('rUpRange', ul);

    show(dl.mbps, 'down');

    $('liveStatus').textContent = t('sr.done', {
      down: fmtSpeed(dl.mbps), up: fmtSpeed(ul.mbps), ping: Math.round(lat.ping) });

    const worstLoaded = Math.max(dl.loaded || 0, ul.loaded || 0);
    const rise = worstLoaded > 0 ? worstLoaded - lat.ping : null;
    const loss = lossPercent();

    const quality = {
      ping: lat.ping, rise, loaded: worstLoaded, loss,
      spread: Math.max(dl.spread || 0, ul.spread || 0),
      floorMbps: browserLimited(dl.mbps),
      packets: tcpTotals().sent >= 200 ? tcpTotals() : null
    };

    lastRender = {
      down: dl.mbps, up: ul.mbps, ping: lat.ping, jitter: lat.jitter,
      rise, loss, quality, dl, ul, justRan: true
    };

    renderResults(dl.mbps, ul.mbps, lat.ping, lat.jitter, rise, loss);
    renderQuality(quality);

    showShareRow({
      t: Date.now(), down: dl.mbps, up: ul.mbps, ping: lat.ping,
      jitter: lat.jitter, loaded: worstLoaded || null, loss
    });

    saveRun({
      t: Date.now(),
      down: dl.mbps,
      up: ul.mbps,
      ping: Math.round(lat.ping),
      loaded: Math.round(Math.max(dl.loaded || 0, ul.loaded || 0)) || null,
      loss: lossPercent()
    });
    renderHistory(true);

    done = true;

    const w = await where;
    if (w) {
      const city = COLOS[w.colo];
      $('meta').textContent = t('foot.meta', {
        where: city ? `${city} (${w.colo})` : w.colo, ip: w.ip });
    }

    const secs = (now() - started) / 1000;
    lastRender.usage = () =>
      t('foot.usage', { bytes: fmtBytes(totalBytes), secs: secs.toFixed(1) }) +
      (frugal ? t(SAVE_DATA ? 'foot.usageSaver' : 'foot.usageQuick') : t('foot.usageNormal'));
    $('usage').textContent =
      t('foot.usage', { bytes: fmtBytes(totalBytes), secs: secs.toFixed(1) }) +
      (frugal ? t(SAVE_DATA ? 'foot.usageSaver' : 'foot.usageQuick') : t('foot.usageNormal'));

  } catch (err) {
    console.error(err);
    $('liveStatus').textContent = t('sr.failed');
    ui.value.textContent = '—';
    ui.unit.textContent = t('unit.error');
    $('meta').textContent = t('err.unreachable');
  } finally {
    ui.go.disabled = false;
    phase(done ? t('btn.done') : t('btn.failed'));
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

$('clearHist').addEventListener('click', () => {
  clearHistory();
  $('history').hidden = true;
});

$('copyLink').addEventListener('click', async () => {
  if (!lastResult) return;
  const url = shareLink(lastResult);
  try {
    await navigator.clipboard.writeText(url);
    flash(t('share.copied'));
  } catch {
    // Clipboard refused (permissions, or an insecure origin): fall back
    // to putting it in the address bar so it can be copied by hand.
    location.hash = url.split('#')[1] || '';
    flash(t('share.inBar'));
  }
});

$('saveCard').addEventListener('click', () => {
  if (!lastResult) return;
  try {
    const cv = drawCard(lastResult);
    cv.toBlob(blob => {
      if (!blob) { flash(t('share.failed')); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'speedtest.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      flash(t('share.saved'));
    }, 'image/png');
  } catch {
    flash(t('share.failed'));
  }
});

$('langBtn').addEventListener('click', () => {
  setLang(LANG === 'en' ? 'el' : 'en');
  rerender();
});

applyStaticText();

/* Show past runs on arrival, before anything is measured. */
renderHistory(false);

/* Someone who has already measured once knows what the full test costs,
   so they are the right person to offer a cheaper repeat to. */
if (loadHistory().length > 0) {
  $('quickWrap').hidden = false;
  phase(t('btn.welcome'));
}

/* A result may have arrived in the link rather than from a test. */
const shared = readShared();
if (shared) renderShared(shared);

/* Each card explains itself, in place. */
for (const btn of document.querySelectorAll('[data-note]')) {
  btn.addEventListener('click', () => {
    const note = $('note-' + btn.dataset.note);
    const opening = note.hidden;
    note.hidden = !opening;
    btn.setAttribute('aria-expanded', String(opening));
  });
}

/* Register the offline shell. Failure is harmless — the page works
   either way; this only makes it installable and survivable offline. */
if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
