# Changelog

Every change to this speed test, newest first. Each version lives in its own folder
(`v0.0/`, `v0.1/`, …) and carries a matching git tag, so any version can be pulled
back up exactly as it shipped.

The live site always serves whatever is newest on `main`:
**[iliaspa.github.io/SpeedTest](https://iliaspa.github.io/SpeedTest/)**

---

## v0.3 — How far to trust it, and how it behaves under load

Three additions, all aimed at the same thing: one speed figure is not enough to
judge a connection by.

**Every figure now carries its range.** The test always collected dozens of
throughput samples and threw all but the middle one away. It now keeps the spread
too and prints it under the number — *135 Mbps, ranged 78–194*. When a line holds
steady the range is omitted, so seeing one is itself the signal.

**Delay when the line is busy — bufferbloat.** Speed is measured on an idle line,
but nobody uses an idle line. While the test saturates the connection it also
pings continuously, and compares that with the idle ping. On the line this was
built against: **63 ms idle → 312 ms under load** — a fast connection that still
breaks up every call. Graded A to F.

**Packet loss, for no extra data.** Cloudflare returns its kernel's TCP socket
statistics in a `Server-Timing` header, and the counters accumulate over the life
of a connection. After the transfer, that gives the number of packets sent and how
many had to be sent again — real loss, read off traffic already being moved. A
typical result: *0.16% — 49 of 30,910 packets resent*.

All three appear in a new "When the line is busy" card, with its own explanation.

*Known limitation:* Chromium sometimes spreads work over several connections, so
the packet-loss sample occasionally comes back too small to be worth reporting —
roughly one run in four. The row is then left out rather than guessed at.

---

## v0.2 — Appearance

Focused entirely on how it looks and feels. No change to how anything is measured.

**The result heading no longer disappears.** "Your connection" and its four tiles used to
be hidden until a test finished, which left an odd gap and made the page jump as sections
appeared. They are now permanent: the tiles simply show `—` until there is something to
put in them. Nothing above the results moves during a run any more.

**The reading is centred in the circle.** It was sitting at 46% of the gauge box, but the
arc is drawn around a point at 60% of it, so the number always looked slightly high.
Verified centred to within 0.1 px.

**The button is now the status line.** Every progress message lives in it — "Ready when
you are", "Measuring latency…", "Measuring download… 9.5 MB used", "Done — test again" —
so the gauge holds nothing but the reading. While a test runs the button styles itself as
a quiet status strip rather than a call to action, then turns back into a button.

**Activity rows read as a checklist.** The emoji identifies the activity on the left, and
the ✓ / ✕ moved to the right as a soft tinted badge, so all ten verdicts line up in a
single column that can be scanned straight down. Rows are roomier and the dividers between
them are much fainter.

---

## v0.1.2 — Per-item explanations and Data Saver

**An ⓘ on every item instead of one global one.** Each of the four metric tiles has its
own, opening that metric's explanation in a panel below the row, one at a time. Each of
the three result cards has one too, explaining in place what the card is showing. Seven in
total, all real buttons with screen-reader labels.

**Data Saver is honoured.** If the browser reports the flag, the test caps itself at about
22 MB instead of ~190 MB and says so under the result. This is a trade, not a free win:
22 MB is not enough to see a fast line at full stretch, so it reads around 650 Mbps on a
1.2 Gbps connection. Being on mobile data is deliberately *not* treated as consent — only
the explicit flag counts. Safari and Firefox do not report it, so there the full test runs.

**Corrected a false claim in the README.** It said a gigabit run was capped at 120 MB. The
real figure is ~190 MB: the 120 MB download ceiling and the 60 MB upload ceiling are
separate limits, not a shared total. All figures in the docs are now measured, not
estimated.

---

## v0.1.1 — Fix: download failed on fast connections

`speed.cloudflare.com/__down` refuses any request for **100,000,000 bytes or more** with a
403 that carries no CORS headers, so the browser reports it as an opaque network failure
rather than a status code. The chunk ceiling was `100 << 20` = 104,857,600 — just over the
line.

Once the probe estimated roughly 270 Mbps or more, that ceiling engaged, every download
worker failed at once, and the run fell to the error path with every result section left
hidden — no activity rows, no timings, no grade. v0.1's sharper probe estimate reached the
ceiling far more often than v0.0's blunter one, so a gigabit line hit it almost every time.

Capped at `90 << 20` (94.4 MB) and enforced inside `streamDown` as well, so no call site
can exceed it whatever it asks for. `__up` accepts 64 MB, the most that is ever sent, so it
needs no equivalent.

---

## v0.1 — Faster answers

**Probes are capped by time, not size.** The download probe was a fixed 1 MB, which took
**4.2 s** on a 3 Mbps line before measurement had even begun. It now stops at 600 ms and
takes its estimate from the second half, skipping most of the slow-start ramp. The upload
probe cannot be cut short once in flight, so its *size* is derived from the download result
to land near 400 ms instead.

**Results appear before the test ends.** Five of the ten activities never consult upload,
and neither do the download transfer estimates or the overall grade — all of it now
renders the moment download finishes. Of the five rows that do depend on upload, any
already ruled out by download or ping resolves immediately too; only genuinely undecided
ones wait.

Measured over three runs each on the same line: the answer reached the screen at **6.4 s**
instead of 12.6 s, and the whole test finished in 9.2 s instead of 12.6 s.

**A glossary** explaining download, upload, ping and jitter, behind a single ⓘ. Replaced in
v0.1.2 by per-item icons.

---

## v0.0 — First working version

A speed test that measures download, upload, ping and jitter, then says what the connection
can actually do: ten activities checked against their real requirements, transfer times for
familiar file sizes, and how many streams and calls the line carries at once.

**The idea it is built on:** speed is a *rate*, so you only need enough bytes to measure
the rate with confidence — not a fixed blob. Each phase probes, sizes itself from the
probe, discards the slow-start ramp, and aborts mid-transfer the moment consecutive
throughput samples agree. A 3 Mbps line finishes in about 3 MB.

**Upload takes two paths.** `fetch` gives no progress for a request body, so Chromium
streams one and measures it exactly like download; Firefox and Safari cannot, and there
short whole POSTs are timed instead. The streamed path is gated behind a live trial,
because Chromium requires HTTP/2 for it and fails outright when it cannot negotiate it.

**Hosting.** The page is static on GitHub Pages, but the test bytes come from Cloudflare's
public speed endpoints. GitHub Pages bandwidth is a shared, soft-limited resource and it
rejects `POST` outright, so upload could not be measured there at all.

---

## Planned

Not built yet, roughly in order of what they would buy:

- **A better stability test.** Coefficient of variation across raw 100 ms samples is noisy:
  one hiccup resets confidence, so a jittery line runs to the 7 s ceiling every time.
  Comparing two consecutive half-windows instead should settle far sooner on exactly those
  connections. Worth 1–2 s on an unstable line.
- **A more reliable packet-loss read**, so the row stops disappearing on the runs where
  Chromium spread the transfer across several connections.
- **Warm the connection on page load.** DNS, TLS and the first couple of round trips could
  happen while the page is being read rather than after the button is pressed. Worth
  0.3–1.5 s, and the most on high-latency links.
- **Remember previous runs**, so a result can be compared against the same line yesterday
  rather than judged in isolation.
- **A share card** — a small image of the result worth posting.

Explicitly rejected: running download and upload at the same time. It looks like an easy
halving, but the two contend for the same pipe and both read low.
