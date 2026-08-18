/* ===========================================================
   Language

   English and Greek. Keys are grouped by where they appear. The
   language is remembered per device, and guessed from the browser on a
   first visit. Anything with {braces} takes a value at render time.
   =========================================================== */

'use strict';

const STRINGS = {
  en: {
    'lang.other': 'Ελληνικά',
    'lang.label': 'Switch to Greek',

    'head.title': 'Speed Test',
    'head.sub': 'Measures only as much as it needs, then stops.',
    'skip': 'Skip to the test',

    'btn.ready': 'Ready when you are',
    'btn.welcome': 'Welcome back — test again',
    'btn.latency': 'Measuring latency…',
    'btn.download': 'Measuring download…',
    'btn.upload': 'Measuring upload…',
    'btn.done': 'Done — test again',
    'btn.failed': 'Something went wrong — try again',
    'btn.shared': 'Run your own test',
    'btn.used': '{bytes} used',

    'quick.label': 'Quick test — about a fifth of the data, slightly rougher',

    'tiles.head': 'Your connection',
    'tile.down': 'Download',
    'tile.up': 'Upload',
    'tile.ping': 'Ping',
    'tile.jitter': 'Jitter',
    'tile.ranged': 'ranged {lo}–{hi}',
    'ask.down': 'What is download speed?',
    'ask.up': 'What is upload speed?',
    'ask.ping': 'What is ping?',
    'ask.jitter': 'What is jitter?',

    'explain.down': 'How fast data reaches you. It decides what video quality you can stream and how quickly pages and files load — the number most people mean by "internet speed".',
    'explain.up': 'How fast data leaves your device: video calls, sending files to cloud storage, live streaming. Home connections are usually far slower upward than downward, and that is normal.',
    'explain.ping': 'How long one message takes to reach the server and come back, in milliseconds. Low ping is what makes a connection feel instant. Gaming and calls care about this far more than about speed.',
    'explain.jitter': 'How much the ping varies from one message to the next. Steady is good — high jitter is what makes a call stutter or a game jump, even when the ping and speed both look fine.',

    'speed.0': 'Slow',        'speed.0.note': 'Fine for email, messaging and reading. Video will struggle.',
    'speed.1': 'Basic',       'speed.1.note': 'One HD stream or one video call at a time — not both.',
    'speed.2': 'Comfortable', 'speed.2.note': 'HD everywhere, 4K on one screen, calls without drama.',
    'speed.3': 'Fast',        'speed.3.note': 'A busy household: several 4K streams, calls and downloads at once.',
    'speed.4': 'Very fast',   'speed.4.note': 'Effectively unlimited for everyday use. Big downloads land in minutes.',
    'speed.5': 'Blazing',     'speed.5.note': 'Gigabit-class. Nothing you do day to day will be the bottleneck.',

    'fault.ping': 'a slow round trip',
    'fault.collapse': 'latency collapsing under load',
    'fault.climb': 'latency climbing badly when busy',
    'fault.build': 'some delay building when busy',
    'fault.lossHeavy': 'heavy packet loss',
    'fault.loss': 'packet loss',

    'verdict.busy.head': '{word} — until it gets busy',
    'verdict.busy.note': 'Plenty of speed for streaming and downloads, but {faults} means calls and games will suffer whenever anything else is using the line.',
    'verdict.paper.head': '{word} on paper',
    'verdict.paper.note': 'The speed is there, but {faults} will break calls and games regardless of how many megabits you have.',
    'verdict.steady.head': '{word}, but steady',
    'verdict.steady.note': '{blurb} What there is, though, is reliable — low latency and no loss, so calls hold up.',
    'verdict.also.note': '{blurb} It also suffers from {faults}.',
    'verdict.mild.note': '{blurb} Latency does build a little when the line is busy.',
    'verdict.and': ' and ',

    'qual.title': 'When the line is busy',
    'qual.ask': 'What is this measuring?',
    'qual.note': 'Speed is measured on an idle line, but you rarely use an idle line. These are taken <em>while</em> the test is saturating your connection, which is when calls stutter and games lag. A fast connection can still fail here — and that failure is what people actually notice.',
    'qual.bloat': 'Delay when busy',
    'qual.bloatDetail': 'ping goes {idle} ms → {loaded} ms — {blurb}',
    'qual.loss': 'Packet loss',
    'qual.lossDetail': '{text} — the server resent {retrans} of the {sent} packets it sent you',
    'qual.floor': 'Faster than this page can measure',
    'qual.floorDetail': 'one connection alone delivered {mbps} Mbps — a browser tab cannot pull harder than this, so treat the figure above as a floor',
    'qual.steady': 'Steadiness',
    'qual.steadyDetail': '{word} — {blurb}',

    'bloat.A': 'stays responsive even when busy',
    'bloat.B': 'barely suffers under load',
    'bloat.C': 'calls and games will wobble during downloads',
    'bloat.D': 'anything live breaks up while the line is busy',
    'bloat.F': 'unusable for calls or gaming whenever anything downloads',

    'loss.none': 'none worth noting',
    'loss.some': '{pct}% of packets resent',
    'loss.bad': '{pct}% lost — calls will glitch',
    'loss.awful': '{pct}% lost — badly degraded',

    'steady.steady': 'steady',     'steady.steady.note': 'held its speed throughout',
    'steady.variable': 'variable', 'steady.variable.note': 'wandered a little while measuring',
    'steady.unsteady': 'unsteady', 'steady.unsteady.note': 'moved around a lot — treat as rough',
    'steady.erratic': 'erratic',   'steady.erratic.note': 'swung wildly — something is congested',

    'acts.title': 'What you can do',
    'acts.ask': 'What does this list show?',
    'acts.note': 'Each row checks your measured speed and ping against what that activity actually needs. A tick means your connection clears the bar with room to spare; a cross names the one thing that falls short.',
    'acts.waiting': 'checking upload…',
    'acts.needs': 'needs {list}',
    'acts.needsDown': '{n} Mbps down',
    'acts.needsUp': '{n} Mbps up',
    'acts.needsPing': 'ping under {n} ms',
    'acts.needsCalm': 'a line that stays calm when busy',
    'acts.needsLoss': 'fewer dropped packets',

    'act.4k': '4K / UHD streaming',            'act.4k.note': 'Netflix, YouTube, Disney+',
    'act.hd': '1080p HD streaming',            'act.hd.note': 'the usual "watch a film" case',
    'act.music': 'Lossless music streaming',   'act.music.note': 'Apple Music, Tidal, Qobuz',
    'act.call': 'HD video call, 1-on-1',       'act.call.note': 'Zoom, Meet, FaceTime, Teams',
    'act.group': 'Group video call in HD',     'act.group.note': 'a full meeting room of faces',
    'act.work': 'Working from home',           'act.work.note': 'VPN, cloud drives, screen share',
    'act.game': 'Online gaming',               'act.game.note': 'ping matters far more than speed',
    'act.cloud': 'Cloud gaming at 1080p60',    'act.cloud.note': 'GeForce NOW, Xbox Cloud',
    'act.live': 'Live streaming 1080p60',      'act.live.note': 'Twitch, YouTube Live',
    'act.backup': 'Cloud backup & big uploads','act.backup.note': 'iCloud, Drive, Dropbox sync',

    'times.title': 'How long things take',
    'times.ask': 'How are these times worked out?',
    'times.note': 'File size divided by the speed just measured. Treat these as a best case: the far end, your disk and your Wi-Fi each add limits of their own, so real transfers usually take a little longer.',
    'file.app': 'A 25 MB app update',
    'file.film': 'A 1 GB film',
    'file.game': 'A 60 GB game',
    'file.photos': '200 photos to the cloud',  'file.photos.note': '~800 MB',
    'file.video': 'A 4 GB video to the cloud',

    'sim.title': 'At the same time',
    'sim.ask': 'What does this mean?',
    'sim.note': 'How many of each your line could carry at once, everyone sharing it together — one person on 4K in the living room while another is on a call upstairs.',
    'sim.4k': '4K streams',
    'sim.hd': '1080p streams',
    'sim.calls': 'HD video calls',
    'sim.none': 'not really',

    'hist.title': 'Your past runs',
    'hist.ask': 'Where is this stored?',
    'hist.note': "Kept on this device only, in your browser's own storage. Nothing is uploaded, there is no account, and clearing it below erases it for good. One reading tells you very little; a dozen tell you what your line actually does.",
    'hist.clear': 'Clear history',
    'hist.thisRun': 'this run',
    'hist.typical': 'Typical for this connection — your median across {n} earlier {runs} is {usual} Mbps.',
    'hist.differs': '{pct}% {dir} than usual — your median across {n} earlier {runs} is {usual} Mbps.',
    'hist.faster': 'faster',
    'hist.slower': 'slower',
    'hist.run': 'run',
    'hist.runs': 'runs',
    'hist.summary': 'Median of your last {n} runs: {mid} Mbps, ranging {lo}–{hi}.',
    'ago.now': 'just now',
    'ago.min': '{n} min ago',
    'ago.hr': '{n} hr ago',
    'ago.yesterday': 'yesterday',
    'ago.days': '{n} days ago',

    'share.copy': 'Copy link',
    'share.save': 'Save image',
    'share.copied': 'Link copied',
    'share.inBar': 'Link is in the address bar',
    'share.saved': 'Image saved',
    'share.failed': 'Could not build the image',
    'share.banner': 'Someone shared this result with you — measured {when}. The numbers travel inside the link, so they are not verified and could have been edited. Press the button to measure your own connection.',

    'limits.title': 'What this test can and cannot tell you',
    'limits.1.b': 'It measures the path to the nearest Cloudflare data centre',
    'limits.1': ', not your provider’s contracted speed. That is the right question for "will Netflix work" and the wrong one for "am I getting what I pay for". For a billing dispute, use your provider’s own test.',
    'limits.2.b': 'A browser tab cannot saturate a very fast line.',
    'limits.2': ' Above roughly 500 Mbps expect this to read low — a native app with more threads will beat it. Below that it is accurate.',
    'limits.3.b': 'Wi-Fi is usually the bottleneck, not the line.',
    'limits.3': ' If the result disappoints, test again over a cable before blaming your provider.',
    'limits.4.b': 'Anything else using the connection counts against you',
    'limits.4': ' — a phone backing up, someone streaming in the next room, an update downloading.',
    'limits.5.b': 'One run is a snapshot, not a verdict.',
    'limits.5': ' Connections vary by the hour, which is exactly why past runs are kept above.',

    'foot.meta': 'Tested against {where} · your IP {ip}',
    'foot.usage': '{bytes} of data in {secs} s',
    'foot.usageNormal': ' — a typical speed test spends 5–20× that.',
    'foot.usageSaver': ' — Data Saver is on, so the test stopped early. On a fast line that reads low.',
    'foot.usageQuick': ' — quick mode, so the test stopped early. On a fast line that reads low.',
    'foot.about1': 'Test data is served by',
    'foot.about2': 'Cloudflare’s public speed endpoints',
    'foot.about3': '; results are stored only in this browser.',
    'foot.source': 'Source',

    'err.unreachable': 'Could not reach the test server. Check your connection, or disable a VPN / content blocker and try again.',
    'sr.done': 'Done. Download {down} megabits per second, upload {up}, ping {ping} milliseconds.',
    'sr.failed': 'The test could not reach the server.',
    'unit.mbps': 'Mbps',
    'unit.ms': 'ms',
    'unit.msPing': 'ms ping',
    'unit.error': 'error',
    'dur.sub1': 'under a second',
    'dur.sec': '{n} sec',
    'dur.min': '{n} min',
    'dur.minSec': '{m} min {s} sec',
    'dur.hr': '{n} hr',
    'dur.hrMin': '{h} hr {m} min',
    'dur.days': '{n} days'
  },

  el: {
    'lang.other': 'English',
    'lang.label': 'Αλλαγή σε αγγλικά',

    'head.title': 'Τεστ Ταχύτητας',
    'head.sub': 'Μετράει μόνο όσα χρειάζεται και σταματά.',
    'skip': 'Μετάβαση στο τεστ',

    'btn.ready': 'Όποτε είστε έτοιμοι',
    'btn.welcome': 'Καλώς ορίσατε ξανά — νέα μέτρηση',
    'btn.latency': 'Μέτρηση καθυστέρησης…',
    'btn.download': 'Μέτρηση λήψης…',
    'btn.upload': 'Μέτρηση αποστολής…',
    'btn.done': 'Έτοιμο — νέα μέτρηση',
    'btn.failed': 'Κάτι πήγε λάθος — δοκιμάστε ξανά',
    'btn.shared': 'Μετρήστε τη δική σας σύνδεση',
    'btn.used': '{bytes} σε χρήση',

    'quick.label': 'Γρήγορο τεστ — περίπου το ένα πέμπτο των δεδομένων, ελαφρώς πιο πρόχειρο',

    'tiles.head': 'Η σύνδεσή σας',
    'tile.down': 'Λήψη',
    'tile.up': 'Αποστολή',
    'tile.ping': 'Ping',
    'tile.jitter': 'Διακύμανση',
    'tile.ranged': 'κύμανε {lo}–{hi}',
    'ask.down': 'Τι είναι η ταχύτητα λήψης;',
    'ask.up': 'Τι είναι η ταχύτητα αποστολής;',
    'ask.ping': 'Τι είναι το ping;',
    'ask.jitter': 'Τι είναι η διακύμανση;',

    'explain.down': 'Πόσο γρήγορα φτάνουν σε εσάς τα δεδομένα. Καθορίζει σε τι ποιότητα μπορείτε να δείτε βίντεο και πόσο γρήγορα ανοίγουν σελίδες και αρχεία — είναι ο αριθμός που οι περισσότεροι εννοούν όταν λένε «ταχύτητα ίντερνετ».',
    'explain.up': 'Πόσο γρήγορα φεύγουν τα δεδομένα από τη συσκευή σας: βιντεοκλήσεις, αποστολή αρχείων στο cloud, ζωντανές μεταδόσεις. Οι οικιακές συνδέσεις είναι συνήθως πολύ πιο αργές προς τα πάνω από ό,τι προς τα κάτω, και αυτό είναι κανονικό.',
    'explain.ping': 'Πόση ώρα κάνει ένα μήνυμα να φτάσει στον διακομιστή και να επιστρέψει, σε χιλιοστά του δευτερολέπτου. Το χαμηλό ping είναι αυτό που κάνει μια σύνδεση να μοιάζει ακαριαία. Στα παιχνίδια και στις κλήσεις μετράει πολύ περισσότερο από την ταχύτητα.',
    'explain.jitter': 'Πόσο αλλάζει το ping από μήνυμα σε μήνυμα. Το σταθερό είναι καλό — η μεγάλη διακύμανση είναι αυτό που κάνει μια κλήση να κολλάει ή ένα παιχνίδι να αναπηδά, ακόμη κι όταν το ping και η ταχύτητα φαίνονται εντάξει.',

    'speed.0': 'Αργή',        'speed.0.note': 'Αρκεί για email, μηνύματα και ανάγνωση. Το βίντεο θα δυσκολεύεται.',
    'speed.1': 'Βασική',      'speed.1.note': 'Μία ροή HD ή μία βιντεοκλήση τη φορά — όχι και τα δύο.',
    'speed.2': 'Άνετη',       'speed.2.note': 'HD παντού, 4K σε μία οθόνη, κλήσεις χωρίς προβλήματα.',
    'speed.3': 'Γρήγορη',     'speed.3.note': 'Για πολυάσχολο σπίτι: πολλές ροές 4K, κλήσεις και λήψεις μαζί.',
    'speed.4': 'Πολύ γρήγορη','speed.4.note': 'Πρακτικά χωρίς όρια για καθημερινή χρήση. Οι μεγάλες λήψεις τελειώνουν σε λίγα λεπτά.',
    'speed.5': 'Αστραπιαία',  'speed.5.note': 'Επιπέδου gigabit. Τίποτα από την καθημερινή σας χρήση δεν θα σας περιορίζει.',

    'fault.ping': 'η αργή διαδρομή μετ’ επιστροφής',
    'fault.collapse': 'η καθυστέρηση που εκτοξεύεται με φορτίο',
    'fault.climb': 'η καθυστέρηση που ανεβαίνει πολύ όταν η γραμμή απασχολείται',
    'fault.build': 'μια κάποια καθυστέρηση που συσσωρεύεται όταν η γραμμή απασχολείται',
    'fault.lossHeavy': 'τα πολλά χαμένα πακέτα',
    'fault.loss': 'η απώλεια πακέτων',

    'verdict.busy.head': '{word} — μέχρι να πέσει φόρτος',
    'verdict.busy.note': 'Άφθονη ταχύτητα για βίντεο και λήψεις, όμως {faults} σημαίνει ότι οι κλήσεις και τα παιχνίδια θα υποφέρουν κάθε φορά που κάτι άλλο χρησιμοποιεί τη γραμμή.',
    'verdict.paper.head': '{word} στα χαρτιά',
    'verdict.paper.note': 'Η ταχύτητα υπάρχει, αλλά {faults} θα χαλάει τις κλήσεις και τα παιχνίδια όσα megabit κι αν έχετε.',
    'verdict.steady.head': '{word}, αλλά σταθερή',
    'verdict.steady.note': '{blurb} Ό,τι υπάρχει όμως είναι αξιόπιστο — χαμηλή καθυστέρηση και καθόλου απώλειες, άρα οι κλήσεις κρατούν.',
    'verdict.also.note': '{blurb} Υποφέρει επίσης από {faults}.',
    'verdict.mild.note': '{blurb} Η καθυστέρηση πάντως ανεβαίνει λίγο όταν η γραμμή απασχολείται.',
    'verdict.and': ' και ',

    'qual.title': 'Όταν η γραμμή απασχολείται',
    'qual.ask': 'Τι μετράει αυτό;',
    'qual.note': 'Η ταχύτητα μετριέται σε αδρανή γραμμή, αλλά σπάνια χρησιμοποιείτε αδρανή γραμμή. Αυτά τα νούμερα λαμβάνονται <em>ενώ</em> το τεστ φορτώνει στο μέγιστο τη σύνδεσή σας — δηλαδή τη στιγμή που οι κλήσεις κολλούν και τα παιχνίδια καθυστερούν. Μια γρήγορη σύνδεση μπορεί κάλλιστα να αποτύχει εδώ, και αυτή η αποτυχία είναι που όντως ενοχλεί.',
    'qual.bloat': 'Καθυστέρηση με φόρτο',
    'qual.bloatDetail': 'το ping πάει από {idle} ms σε {loaded} ms — {blurb}',
    'qual.loss': 'Απώλεια πακέτων',
    'qual.lossDetail': '{text} — ο διακομιστής ξαναέστειλε {retrans} από τα {sent} πακέτα που σας έστειλε',
    'qual.floor': 'Πιο γρήγορη από όσο μπορεί να μετρήσει η σελίδα',
    'qual.floorDetail': 'μία μόνο σύνδεση απέδωσε {mbps} Mbps — ένα παράθυρο περιηγητή δεν μπορεί να τραβήξει περισσότερο, άρα το παραπάνω νούμερο είναι κατώτατο όριο',
    'qual.steady': 'Σταθερότητα',
    'qual.steadyDetail': '{word} — {blurb}',

    'bloat.A': 'παραμένει άμεση ακόμη και με φόρτο',
    'bloat.B': 'σχεδόν δεν επηρεάζεται από τον φόρτο',
    'bloat.C': 'οι κλήσεις και τα παιχνίδια θα τρεμοπαίζουν κατά τις λήψεις',
    'bloat.D': 'ό,τι είναι ζωντανό διαλύεται όταν η γραμμή απασχολείται',
    'bloat.F': 'άχρηστη για κλήσεις ή παιχνίδια όποτε κατεβαίνει κάτι',

    'loss.none': 'καμία αξιοσημείωτη',
    'loss.some': '{pct}% των πακέτων ξαναστάλθηκαν',
    'loss.bad': '{pct}% χάθηκαν — οι κλήσεις θα κολλούν',
    'loss.awful': '{pct}% χάθηκαν — σοβαρά υποβαθμισμένη',

    'steady.steady': 'σταθερή',     'steady.steady.note': 'κράτησε την ταχύτητά της σε όλη τη διάρκεια',
    'steady.variable': 'μεταβλητή', 'steady.variable.note': 'κύμανε λίγο κατά τη μέτρηση',
    'steady.unsteady': 'άστατη',    'steady.unsteady.note': 'μετακινήθηκε πολύ — δείτε το ως πρόχειρο',
    'steady.erratic': 'ασταθής',    'steady.erratic.note': 'κύμανε έντονα — κάτι είναι συμφορημένο',

    'acts.title': 'Τι μπορείτε να κάνετε',
    'acts.ask': 'Τι δείχνει αυτή η λίστα;',
    'acts.note': 'Κάθε γραμμή συγκρίνει τη μετρημένη ταχύτητα και το ping σας με ό,τι χρειάζεται στην πράξη η κάθε δραστηριότητα. Το τικ σημαίνει ότι η σύνδεσή σας περνά τον πήχη με άνεση· ο σταυρός δείχνει το ένα πράγμα που υστερεί.',
    'acts.waiting': 'έλεγχος αποστολής…',
    'acts.needs': 'χρειάζεται {list}',
    'acts.needsDown': '{n} Mbps λήψη',
    'acts.needsUp': '{n} Mbps αποστολή',
    'acts.needsPing': 'ping κάτω από {n} ms',
    'acts.needsCalm': 'γραμμή που μένει ήρεμη με φόρτο',
    'acts.needsLoss': 'λιγότερα χαμένα πακέτα',

    'act.4k': 'Ροή 4K / UHD',                   'act.4k.note': 'Netflix, YouTube, Disney+',
    'act.hd': 'Ροή 1080p HD',                   'act.hd.note': 'η κλασική περίπτωση «να δω μια ταινία»',
    'act.music': 'Μουσική σε lossless',          'act.music.note': 'Apple Music, Tidal, Qobuz',
    'act.call': 'Βιντεοκλήση HD, ένας με έναν',  'act.call.note': 'Zoom, Meet, FaceTime, Teams',
    'act.group': 'Ομαδική βιντεοκλήση σε HD',    'act.group.note': 'μια αίθουσα γεμάτη πρόσωπα',
    'act.work': 'Εργασία από το σπίτι',          'act.work.note': 'VPN, cloud δίσκοι, κοινή χρήση οθόνης',
    'act.game': 'Διαδικτυακό παιχνίδι',          'act.game.note': 'το ping μετράει πολύ περισσότερο από την ταχύτητα',
    'act.cloud': 'Cloud gaming σε 1080p60',      'act.cloud.note': 'GeForce NOW, Xbox Cloud',
    'act.live': 'Ζωντανή μετάδοση 1080p60',      'act.live.note': 'Twitch, YouTube Live',
    'act.backup': 'Αντίγραφα και μεγάλες αποστολές', 'act.backup.note': 'iCloud, Drive, Dropbox',

    'times.title': 'Πόση ώρα θέλουν τα πράγματα',
    'times.ask': 'Πώς υπολογίζονται αυτοί οι χρόνοι;',
    'times.note': 'Το μέγεθος του αρχείου διά την ταχύτητα που μόλις μετρήθηκε. Δείτε τους ως την καλύτερη περίπτωση: ο διακομιστής στην άλλη άκρη, ο δίσκος σας και το Wi-Fi βάζουν τα δικά τους όρια, άρα στην πράξη οι μεταφορές θέλουν λίγο παραπάνω.',
    'file.app': 'Ενημέρωση εφαρμογής 25 MB',
    'file.film': 'Μια ταινία 1 GB',
    'file.game': 'Ένα παιχνίδι 60 GB',
    'file.photos': '200 φωτογραφίες στο cloud',  'file.photos.note': '~800 MB',
    'file.video': 'Ένα βίντεο 4 GB στο cloud',

    'sim.title': 'Ταυτόχρονα',
    'sim.ask': 'Τι σημαίνει αυτό;',
    'sim.note': 'Πόσα από το καθένα θα άντεχε η γραμμή σας μαζί, με όλους να τη μοιράζονται — ένας να βλέπει 4K στο σαλόνι κι ένας άλλος σε κλήση στον πάνω όροφο.',
    'sim.4k': 'ροές 4K',
    'sim.hd': 'ροές 1080p',
    'sim.calls': 'βιντεοκλήσεις HD',
    'sim.none': 'μάλλον όχι',

    'hist.title': 'Οι προηγούμενες μετρήσεις σας',
    'hist.ask': 'Πού αποθηκεύονται;',
    'hist.note': 'Μένουν μόνο σε αυτή τη συσκευή, στον αποθηκευτικό χώρο του περιηγητή σας. Τίποτα δεν ανεβαίνει, δεν υπάρχει λογαριασμός, και η διαγραφή παρακάτω τα σβήνει οριστικά. Μία μέτρηση λέει πολύ λίγα· μια δωδεκάδα σας λέει τι κάνει όντως η γραμμή σας.',
    'hist.clear': 'Διαγραφή ιστορικού',
    'hist.thisRun': 'αυτή η μέτρηση',
    'hist.typical': 'Τυπικό για αυτή τη σύνδεση — η διάμεσος από {n} προηγούμενες {runs} είναι {usual} Mbps.',
    'hist.differs': '{pct}% {dir} από το συνηθισμένο — η διάμεσος από {n} προηγούμενες {runs} είναι {usual} Mbps.',
    'hist.faster': 'πιο γρήγορα',
    'hist.slower': 'πιο αργά',
    'hist.run': 'μέτρηση',
    'hist.runs': 'μετρήσεις',
    'hist.summary': 'Διάμεσος των τελευταίων {n} μετρήσεων: {mid} Mbps, με εύρος {lo}–{hi}.',
    'ago.now': 'μόλις τώρα',
    'ago.min': 'πριν {n} λεπτά',
    'ago.hr': 'πριν {n} ώρες',
    'ago.yesterday': 'χθες',
    'ago.days': 'πριν {n} μέρες',

    'share.copy': 'Αντιγραφή συνδέσμου',
    'share.save': 'Αποθήκευση εικόνας',
    'share.copied': 'Ο σύνδεσμος αντιγράφηκε',
    'share.inBar': 'Ο σύνδεσμος είναι στη γραμμή διευθύνσεων',
    'share.saved': 'Η εικόνα αποθηκεύτηκε',
    'share.failed': 'Δεν έγινε η δημιουργία της εικόνας',
    'share.banner': 'Κάποιος σας μοιράστηκε αυτό το αποτέλεσμα — μετρήθηκε {when}. Τα νούμερα ταξιδεύουν μέσα στον σύνδεσμο, άρα δεν είναι επαληθευμένα και μπορεί να έχουν αλλαχτεί. Πατήστε το κουμπί για να μετρήσετε τη δική σας σύνδεση.',

    'limits.title': 'Τι μπορεί και τι δεν μπορεί να σας πει αυτό το τεστ',
    'limits.1.b': 'Μετράει τη διαδρομή προς το πλησιέστερο κέντρο δεδομένων της Cloudflare',
    'limits.1': ', όχι την ταχύτητα που έχετε συμβόλαιο. Αυτό είναι το σωστό ερώτημα για το «θα δουλέψει το Netflix» και το λάθος για το «παίρνω όσα πληρώνω». Για διαφωνία με τον πάροχο, χρησιμοποιήστε το δικό του τεστ.',
    'limits.2.b': 'Ένα παράθυρο περιηγητή δεν μπορεί να κορέσει μια πολύ γρήγορη γραμμή.',
    'limits.2': ' Πάνω από περίπου 500 Mbps περιμένετε χαμηλότερη μέτρηση — μια εγγενής εφαρμογή με περισσότερα νήματα θα το ξεπεράσει. Κάτω από αυτό είναι ακριβές.',
    'limits.3.b': 'Το Wi-Fi είναι συνήθως το στενό σημείο, όχι η γραμμή.',
    'limits.3': ' Αν το αποτέλεσμα απογοητεύει, δοκιμάστε ξανά με καλώδιο πριν κατηγορήσετε τον πάροχο.',
    'limits.4.b': 'Ό,τι άλλο χρησιμοποιεί τη σύνδεση μετράει εις βάρος σας',
    'limits.4': ' — ένα κινητό που κρατά αντίγραφα, κάποιος που βλέπει βίντεο στο άλλο δωμάτιο, μια ενημέρωση που κατεβαίνει.',
    'limits.5.b': 'Μία μέτρηση είναι στιγμιότυπο, όχι ετυμηγορία.',
    'limits.5': ' Οι συνδέσεις αλλάζουν από ώρα σε ώρα, και γι’ αυτό ακριβώς κρατούνται παραπάνω οι προηγούμενες μετρήσεις.',

    'foot.meta': 'Μετρήθηκε προς {where} · η IP σας {ip}',
    'foot.usage': '{bytes} δεδομένων σε {secs} δευτ.',
    'foot.usageNormal': ' — ένα τυπικό τεστ ταχύτητας ξοδεύει 5–20× περισσότερα.',
    'foot.usageSaver': ' — η Οικονομία δεδομένων είναι ενεργή, άρα το τεστ σταμάτησε νωρίς. Σε γρήγορη γραμμή αυτό μετράει χαμηλά.',
    'foot.usageQuick': ' — γρήγορη λειτουργία, άρα το τεστ σταμάτησε νωρίς. Σε γρήγορη γραμμή αυτό μετράει χαμηλά.',
    'foot.about1': 'Τα δεδομένα του τεστ σερβίρονται από τα',
    'foot.about2': 'δημόσια σημεία μέτρησης της Cloudflare',
    'foot.about3': '· τα αποτελέσματα αποθηκεύονται μόνο σε αυτόν τον περιηγητή.',
    'foot.source': 'Πηγαίος κώδικας',

    'err.unreachable': 'Δεν ήταν δυνατή η σύνδεση με τον διακομιστή του τεστ. Ελέγξτε τη σύνδεσή σας ή απενεργοποιήστε VPN / φραγή περιεχομένου και δοκιμάστε ξανά.',
    'sr.done': 'Έτοιμο. Λήψη {down} megabit ανά δευτερόλεπτο, αποστολή {up}, ping {ping} χιλιοστά.',
    'sr.failed': 'Το τεστ δεν μπόρεσε να φτάσει στον διακομιστή.',
    'unit.mbps': 'Mbps',
    'unit.ms': 'ms',
    'unit.msPing': 'ms ping',
    'unit.error': 'σφάλμα',
    'dur.sub1': 'κάτω από ένα δευτερόλεπτο',
    'dur.sec': '{n} δευτ.',
    'dur.min': '{n} λεπτά',
    'dur.minSec': '{m} λεπτά {s} δευτ.',
    'dur.hr': '{n} ώρες',
    'dur.hrMin': '{h} ώρες {m} λεπτά',
    'dur.days': '{n} μέρες'
  }
};

const LANG_KEY = 'speedtest.lang';

function pickLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && STRINGS[saved]) return saved;
  } catch {}
  const nav = (navigator.languages || [navigator.language || 'en']).join(',').toLowerCase();
  return /\bel\b|^el|greek/.test(nav) ? 'el' : 'en';
}

let LANG = pickLang();

function setLang(code) {
  if (!STRINGS[code]) return;
  LANG = code;
  try { localStorage.setItem(LANG_KEY, code); } catch {}
}

/** Look up a string and fill in any {placeholders}. */
function t(key, vars) {
  const table = STRINGS[LANG] || STRINGS.en;
  let str = table[key];
  if (str == null) str = STRINGS.en[key];
  if (str == null) return key;              // visible, so it gets noticed
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
