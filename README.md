# ⚡ Speed Test

A small, fast internet speed test that **stops as soon as the answer is stable**, then
tells you what your connection can actually do — 4K streaming, video calls, cloud
gaming, how long a 60 GB game takes.

**→ [iliaspa.github.io/SpeedTest](https://iliaspa.github.io/SpeedTest/)**

No build step, no dependencies, no tracking. Three static files.

---

## Why it uses so little data

Speed is a *rate*, not a total, so you only need enough bytes to measure the rate with
confidence. Most speed tests ignore this and push a fixed 100–500 MB at you regardless.

This one:

1. **Probes** with 1 MB to get a rough idea of the line.
2. **Sizes the real run** from that probe — how many parallel streams, how big each request.
3. **Throws away the ramp-up.** TCP slow start makes the first ~700 ms meaningless, so
   throughput is sampled over a sliding window after it.
4. **Aborts the moment it settles.** Once ten consecutive samples agree within 5 %, the
   transfer is cancelled mid-flight. Nothing more is pulled.

A 4 Mbps line finishes in about 3 MB. A 100 Mbps line uses roughly 30 MB. Even a gigabit
connection is capped at 120 MB — a fifth of what a conventional test would spend.

The page shows exactly how much it used, so you can check the claim.

## What it measures

| | How |
|---|---|
| **Download** | Parallel streams, throughput sampled over a sliding window, median of the steady-state samples |
| **Upload** | Same method where the browser can stream a request body (Chrome/Edge); elsewhere, short POSTs are timed whole |
| **Ping** | Median round trip to a zero-byte endpoint, first two discarded for DNS/TLS |
| **Jitter** | Mean absolute change between consecutive round trips |

Upload is the awkward one. `fetch` normally gives no progress events for a request body,
so a browser that can't stream one has to time complete POSTs — which under-reports
slightly, because bytes still in flight when the clock stops aren't counted. The fallback
keeps each POST short and requires several per stream to keep that error small.

## Where the test data comes from

GitHub Pages can only serve static files, and its bandwidth is a shared, soft-limited
resource — a speed test hosted there would exhaust it quickly and there'd be no way to
measure upload at all, since Pages rejects `POST`.

So the page is hosted on GitHub, but the bytes come from Cloudflare's public speed
endpoints (`speed.cloudflare.com/__down` and `/__up`) — the same ones behind
`speed.cloudflare.com`. They're CORS-open, globally distributed, and free. Nothing is
stored and no account is needed.

## Accuracy, honestly

- It measures the path from **your browser to the nearest Cloudflare edge**. That is the
  right question for "will Netflix work", not for "is my ISP hitting its contract speed".
- A browser tab can't saturate a very fast line as well as a native client. Above roughly
  500 Mbps, expect to read low.
- Wi-Fi is usually the bottleneck, not the line. Test wired if you want the line's number.
- Other traffic on the network during the test will pull the result down.

## Running it locally

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. There is nothing to install or compile.

## Files

| File | |
|---|---|
| `index.html` | Markup |
| `style.css` | Styling, dark and light |
| `app.js` | Measurement engine and result rendering |

## Tuning

Every threshold lives in the `CFG` object at the top of `app.js` — warm-up time, the
stability threshold, byte ceilings, stream counts. The activity requirements and file
sizes used for the "what you can do" section are the `ACTIVITIES` and `TRANSFERS` arrays
further down.

## Licence

MIT
