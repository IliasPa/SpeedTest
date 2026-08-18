# ⚡ Speed Test

A small, fast internet speed test that **stops as soon as the answer is stable**, then
tells you what your connection can actually do — 4K streaming, video calls, cloud
gaming, how long a 60 GB game takes.

**→ [iliaspa.github.io/SpeedTest](https://iliaspa.github.io/SpeedTest/)**

No build step, no dependencies, no tracking. Three static files.

Version history and what is planned next: **[CHANGELOG.md](CHANGELOG.md)**.

---

## Why it uses so little data

Speed is a *rate*, not a total, so you only need enough bytes to measure the rate with
confidence. Most speed tests ignore this and push a fixed 100–500 MB at you regardless.

This one:

1. **Probes for 600 ms** — capped by *time*, not by size. A fixed 1 MB probe is over in an
   instant on fibre but costs a slow line four seconds before measuring even begins. The
   estimate is taken from the second half of the probe, skipping most of the slow-start ramp.
2. **Sizes the real run** from that probe — how many parallel streams, how big each request.
   The upload probe is sized from the download result, since a POST can't be cut short.
3. **Throws away the ramp-up.** TCP slow start makes the first ~700 ms meaningless, so
   throughput is sampled over a sliding window after it.
4. **Aborts the moment the answer settles.** Not when the samples look smooth — when
   taking more of them stops moving the running median. A jittery line never produces
   smooth samples, so the old test always ran to its ceiling; this one stops as soon as
   more data would tell it nothing new.

Measured: a 3 Mbps line finishes in about **3 MB**. A gigabit line spends about **190 MB**,
because there is no way around it — measuring a gigabit means actually moving a gigabit.
Download stops at 120 MB and upload at 60 MB, plus a little overshoot while the ceiling
is noticed.

So the saving is largest exactly where it matters most: the slower your connection, the
less this costs you. The page prints what it used every run, so you can check the claim.

## Data Saver

If the browser reports that **Data Saver** is switched on, the test caps itself at roughly
**22 MB** instead — about eight times lighter — and says so under the result.

That is a deliberate trade, not a free win. Twenty-odd megabytes is not enough to see a
fast line at full stretch, so the number reads low: on a 1.2 Gbps connection it reports
around 650 Mbps. Someone who has turned Data Saver on has already said they would rather
spend less, and this respects that.

Only the explicit flag counts. Merely being on mobile data is not consent, and is not
checked. Note that Safari and Firefox do not report the flag at all, so there the full
test always runs.

## Results arrive before the test ends

Five of the ten activities never look at upload at all, and neither do the three download
transfer estimates or the overall grade. All of that renders the moment download finishes,
while upload is still running.

Of the five rows that do depend on upload, any already ruled out by download or ping
resolves immediately too — a line too slow for a group call is too slow whatever its
upload turns out to be. Only the genuinely undecided ones wait, showing `·  checking
upload…` until it lands.

Measured over three runs each on the same 3 Mbps line: the answer reaches the screen in
**6.4 s** versus **12.6 s** before, and the whole test finishes in 9.2 s versus 12.6 s.

## What it measures

| | How |
|---|---|
| **Download** | Parallel streams, throughput sampled over a sliding window, median of the steady-state samples |
| **Upload** | Same method where the browser can stream a request body (Chrome/Edge); elsewhere, short POSTs are timed whole |
| **Ping** | Median round trip to a zero-byte endpoint, first two discarded for DNS/TLS |
| **Jitter** | Mean absolute change between consecutive round trips |
| **Range** | 10th–90th percentile of the throughput samples, shown whenever the line wandered |
| **Delay under load** | Pinged continuously *while* the transfer saturates the line, compared with the idle ping. Graded A–F |
| **Packet loss** | Read from the server's own TCP counters in its `Server-Timing` header — no extra bytes |

Those last three matter more than they look. A connection can be fast and still be
miserable to use: if latency climbs from 60 ms to 300 ms whenever anything downloads,
every call stutters no matter how many megabits the headline claims. That is the number
most speed tests never show you, and this one gets it free from traffic it is already
moving.

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

## Your past runs

Every completed test is kept in this browser's own storage — never uploaded, no account,
no cookie. They are shown newest-first with a bar each, and every new result is placed
against the earlier ones: *"46% faster than usual — your median across 3 earlier runs is
277 Mbps."*

This matters more than it sounds. The line this was built against measured 46 Mbps one
day and 1212 Mbps the next. Any single reading from any speed test is a snapshot; a dozen
of them is evidence. Clearing them is one click, and irreversible.

## Above ~500 Mbps

The reading loop runs in Web Workers, one per stream, so decrypting and counting bytes
does not compete with the page for the same thread. That is what a browser can do; it is
not unlimited. A native client with more threads will still beat it on a multi-gigabit
line.

So the page also checks the server's own view. Cloudflare reports its kernel's
`delivery_rate` for each connection, measured server-side and therefore immune to
whatever this browser can or cannot keep up with. If one connection alone delivered
faster than everything measured across all of them, the result is reported as a floor:
*"one connection alone delivered 780 Mbps — a browser tab cannot pull harder than this,
so treat the figure above as a floor."*

Better to say the number is a lower bound than to quietly print a wrong one.

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
