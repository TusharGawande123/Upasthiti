/*
  Upasthiti - M4b design gate P2: gate phone code panel + reader message, and the phone punch pages.
  MOCKUP ONLY (static HTML, fake data, English strings, no camera, no photo of any person, the codes
  drawn here are NOT real codes). Every page has <body data-group="...">; the state is the URL hash, for
  example 06-results.html#in-face. Add "?shot" to hide the state tag and freeze all loops.
  Words: the exact sentences of docs/specs/M4b-phone-punch.md (section 4.2, 4.3, 4.8 to 4.11, 7 rules 10 to
  16 and the table in section 9); where the spec says "M2 text" or "M3 text" the existing kiosk.* keys of
  frontend/public/locales/en/common.json. Words that neither has are listed in README.md ("New texts").
*/
(function () {
  const icon = (name, extra) => '<i data-lucide="' + name + '"' + (extra || "") + "></i>";
  const spinIcon = (name) => icon(name, ' class="spin"');
  const PLANT = "Sheet Shapers · K134";
  const GATE = "Main gate phone";
  const FACE_PERSON = { name: "Sunita Jadhav", first: "Sunita", code: "EMP-0312" };
  const CODE_PERSON = { name: "Anil Shinde", first: "Anil", code: "EMP-0891" };

  function logo(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a4bb8"/><stop offset="1" stop-color="#162a6e"/></linearGradient></defs><rect width="40" height="40" rx="11" fill="url(#lg)"/><path d="M11 29V16a9 9 0 0 1 18 0v13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".35"/><path d="M14.5 21.5l4 4 7.5-8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="31" cy="9" r="3.6" fill="#f5b700" stroke="#162a6e" stroke-width="1.2"/></svg>`;
  }

  // ---------------------------------------------------------------- drawn pseudo QR (NOT a real code)
  function fakeQr(seed, n) {
    let s = seed;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const size = n || 37;
    const m = Array.from({ length: size }, () => Array.from({ length: size }, () => rnd() > 0.5));
    const finder = (ox, oy) => {
      for (let y = -1; y <= 7; y++) for (let x = -1; x <= 7; x++) {
        const X = ox + x, Y = oy + y;
        if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
        const ring = x === 0 || x === 6 || y === 0 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        m[Y][X] = x >= 0 && x <= 6 && y >= 0 && y <= 6 && (ring || core);
      }
    };
    finder(0, 0); finder(size - 7, 0); finder(0, size - 7);
    let d = "";
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) d += `M${x} ${y}h1v1h-1z`;
    return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Example of the changing phone code (not a real code)"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#0e1726"/></svg>`;
  }

  // ================================================================ GATE (gate look, text >= 24 px)
  const chipOnline = () => `<span class="k-chip chip-ok" role="status">${icon("wifi")}<span>Online</span></span>`;
  function topBar() {
    return `<div class="k-stripe" aria-hidden="true"></div>
      <header class="k-top">${logo(56)}
        <div class="k-brand"><b>${PLANT}</b><span>${GATE}</span></div>
        <div class="k-top-right">${chipOnline()}
          <div class="k-clock" role="timer" aria-label="Server time, India Standard Time"><span>07:02:41</span><small>IST</small></div></div>
      </header>`;
  }
  function footer() {
    return `<footer class="k-foot">
      <p class="privacy">${icon("shield-check")}<span><b>Face punch:</b> your face is checked against an encrypted record. A photo is kept for 60 days only if the punch fails or you type your code. <b>Card punch:</b> a photo is kept for 60 days and checked automatically to see that a face is present.</span></p>
      <p class="help">${icon("life-buoy")}Need help? Ask the plant office.</p></footer>`;
  }
  const BRACKETS = `<svg class="brackets" viewBox="0 0 100 100" aria-hidden="true">
      <g class="b-dark"><path d="M3 22V9a6 6 0 0 1 6-6h13"/><path d="M78 3h13a6 6 0 0 1 6 6v13"/><path d="M97 78v13a6 6 0 0 1-6 6H78"/><path d="M22 97H9a6 6 0 0 1-6-6V78"/></g>
      <g class="b-main"><path d="M3 22V9a6 6 0 0 1 6-6h13"/><path d="M78 3h13a6 6 0 0 1 6 6v13"/><path d="M97 78v13a6 6 0 0 1-6 6H78"/><path d="M22 97H9a6 6 0 0 1-6-6V78"/></g></svg>`;
  const notice = `<div class="notices" role="region" aria-label="Gate notices"><div class="notice">${icon("megaphone")}<p>Safety shoes and helmets are required inside the plant.</p></div></div>`;

  function panelCard(o) {
    if (o.off) {
      return `<section class="pc-card is-off" aria-labelledby="pc-h"><div class="pc-text"><h2 id="pc-h"><span class="pc-ic">${icon("smartphone")}</span>Phone code</h2>
        <p role="status">Phone code not available now. Show your ID card.</p></div></section>`;
    }
    return `<section class="pc-card" aria-labelledby="pc-h"><div class="pc-qr">${fakeQr(o.seed || 7)}</div>
      <div class="pc-text"><h2 id="pc-h"><span class="pc-ic">${icon("smartphone")}</span>Phone code</h2>
        <p>Workers with phone attendance: scan this with your phone</p>
        <div class="pc-bar${o.ending ? " is-ending" : ""}" role="timer" aria-label="The code changes in ${o.left} seconds" style="--from:${o.frac};--life:${o.left}s"><i></i></div></div></section>`;
  }
  function phoneButton(off) {
    if (off) {
      return `<div class="pc-btn-wrap"><button class="pc-btn is-off" type="button" disabled aria-describedby="pc-why"><span class="fb-icon">${icon("smartphone")}</span><span>Phone code</span></button>
        <p class="pc-btn-note" id="pc-why">Phone code not available now. Show your ID card.</p></div>`;
    }
    return `<div class="pc-btn-wrap"><button class="pc-btn" type="button"><span class="fb-icon">${icon("smartphone")}</span><span>Phone code</span></button></div>`;
  }
  function faceButton() {
    return `<button class="face-btn" type="button"><span class="fb-icon">${icon("scan-face")}</span><span class="fb-text"><b>Punch with face</b></span></button>`;
  }
  function readerMsg() {
    return `<div class="reader-msg" role="alert"><div class="rm-row"><span class="rm-ic">${icon("smartphone")}<span class="mini">${icon("x")}</span></span>
      <p>This code is for phones. Show your ID card to this attendance device.</p></div><div class="rm-bar" aria-hidden="true"><i></i></div></div>`;
  }
  function idle(o) {
    const cam = `<div class="cam" aria-label="Camera picture"><div class="cam-feed"></div>
      <div class="frame">${BRACKETS}<div class="scanline-wrap" aria-hidden="true"><div class="scanline"></div></div></div>${o.reader ? readerMsg() : ""}</div>`;
    const instr = `<div class="instr"><span class="illo">${icon("id-card")}<span class="mini">${icon("scan-line")}</span></span><h1>Show your ID card to the camera</h1></div>`;
    return `<div class="k-app has-panel"><div>${topBar()}</div>
      <main class="scan-layout"><div>${cam}</div><div class="side">${instr}<div class="or" aria-hidden="true">or</div>${faceButton()}${o.panel || ""}${o.button || ""}${notice}</div></main>${footer()}</div>`;
  }
  function codeScreen(o) {
    return `<div class="code-app"><div class="k-stripe" aria-hidden="true"></div>
      <header class="code-head"><span class="fh-icon">${icon("smartphone")}</span><h1>Phone code</h1></header>
      <main class="code-body"><div class="pc-qr">${fakeQr(o.seed || 7)}</div>
        <p class="lead">Workers with phone attendance: scan this with your phone</p>
        <div class="pc-bar${o.ending ? " is-ending" : ""}" role="timer" aria-label="The code changes in ${o.left} seconds" style="--from:${o.frac};--life:${o.left}s"><i></i></div></main>
      <footer class="code-foot"><div class="back-in">${icon("timer")}Back to scanning in ${o.back} s</div><button class="btn-k btn-k-light">${icon("arrow-left")}Back</button></footer></div>`;
  }
  const GPANEL = {
    "panel": () => idle({ panel: panelCard({ left: 14, frac: 0.7 }), button: phoneButton(false) }),
    "panel-ending": () => idle({ panel: panelCard({ left: 3, frac: 0.15, ending: true, seed: 11 }), button: phoneButton(false) }),
    "panel-offline": () => idle({ panel: panelCard({ off: true }), button: phoneButton(true) }),
    "code-full": () => codeScreen({ left: 14, frac: 0.7, back: 47 }),
    "code-full-ending": () => codeScreen({ left: 3, frac: 0.15, ending: true, seed: 11, back: 12 }),
  };
  const READER = {
    "seen": () => idle({ reader: true, panel: panelCard({ left: 14, frac: 0.7 }), button: phoneButton(false) }),
    "seen-no-panel": () => idle({ reader: true }),
  };

  // ================================================================ GATE-STYLE FACE CAMERA SCREENS (copied from M3 gate A, same texts)
  function ghostSvg(turn) {
    let head = `<ellipse class="g" cx="150" cy="172" rx="80" ry="104"/>`;
    if (turn === "left") head = `<ellipse class="g" cx="140" cy="172" rx="70" ry="104"/><path class="g" d="M74 160 L46 204 L78 212 Z"/>`;
    if (turn === "right") head = `<ellipse class="g" cx="160" cy="172" rx="70" ry="104"/><path class="g" d="M226 160 L254 204 L222 212 Z"/>`;
    return `<svg viewBox="0 0 300 400" aria-hidden="true">${head}<rect class="g" x="118" y="250" width="64" height="90" rx="20"/><path class="g" d="M-30 520 C-20 380 60 326 150 326 C240 326 320 380 330 520 Z"/></svg>`;
  }
  function ghosts(kind) {
    if (!kind) return "";
    if (kind === "two") return `<div class="ghost-box is-two-a">${ghostSvg()}</div><div class="ghost-box is-two-b">${ghostSvg()}</div>`;
    const cls = { small: "is-small", big: "is-big", dim: "is-dim" }[kind] || "";
    const turn = kind === "turn-left" ? "left" : kind === "turn-right" ? "right" : null;
    return `<div class="ghost-box ${cls}">${ghostSvg(turn)}</div>`;
  }
  const STEP_WORDS = ["Look at the camera", "Turn your head", "Checking…"];
  // the "Turn your head" step shows the asked direction (arrow-left / arrow-right), never a two-way arrow
  const turnIcon = (dir) => (dir ? "arrow-" + dir : "scan-face");
  function steps(states, dir) {
    return `<div class="progress-steps" aria-hidden="true">${states.map((s, i) => {
      const ic = s === "done" ? icon("check") : s === "now" ? (i === 2 ? spinIcon("loader-circle") : icon(i === 1 ? turnIcon(dir) : "scan-face")) : icon("circle-dashed");
      return `<span class="pstep ${s}">${ic}${STEP_WORDS[i]}</span>`;
    }).join("")}</div>`;
  }
  function faceScreen(o) {
    const head = `<header class="face-head" role="status" aria-live="polite">
      <span class="fh-icon ${o.headTone ? "is-" + o.headTone : ""}">${o.headSpin ? spinIcon(o.headIcon) : icon(o.headIcon)}</span>
      <h1>${o.title}</h1>${o.bigArrow ? icon(o.bigArrow, ' class="fh-big-arrow"') : ""}</header>`;
    const ovalCls = { search: "is-search", good: "is-good", blue: "is-blue", amber: "is-amber", muted: "is-muted" }[o.oval || "search"];
    const badge = o.badge ? `<div class="oval-badge ${o.badge.tone ? "is-" + o.badge.tone : ""}">${o.badge.spin ? spinIcon(o.badge.icon) : icon(o.badge.icon)}</div>` : "";
    const arrow = o.arrow ? `<div class="turn-arrow is-${o.arrow}" aria-hidden="true">${icon(o.arrow === "left" ? "arrow-left" : "arrow-right")}</div>` : "";
    const strip = o.strip ? `<div class="cam-strip is-${o.strip.tone}" role="status">${icon(o.strip.icon)}<span>${o.strip.text}</span></div>` : "";
    const card = o.card ? `<div class="cam-card" role="alert"><div class="cc-top"><span class="cc-icon">${icon(o.card.icon)}</span><h2>${o.card.text}</h2></div>
        <div class="cc-actions"><button class="btn-k btn-k-primary">${icon("rotate-cw")}Try again</button><button class="btn-k btn-k-light">${icon("x")}Cancel</button></div></div>` : "";
    const cam = `<div class="face-cam ${o.dark ? "is-dark" : ""}" aria-label="Camera picture (mirrored)">${ghosts(o.ghost)}<div class="oval ${ovalCls}"></div>${badge}${arrow}${strip}${card}</div>`;
    const foot = `<footer class="face-foot">${steps(o.steps || ["now", "", ""], o.dir)}${o.cancel === false ? "" : `<button class="btn-k btn-k-light">${icon("x")}Cancel</button>`}</footer>`;
    return `<div class="face-app"><div class="k-stripe" aria-hidden="true"></div>${head}${cam}${foot}</div>`;
  }
  const LOOK = "Look at the camera. Keep your face inside the oval.";
  const hint = (text, ic, extra) => faceScreen(Object.assign({ headIcon: "scan-face", title: LOOK, strip: { tone: "amber", icon: ic, text } }, extra));
  const turnTitle = (dir) => `Turn your head to your <span class="dir">${dir}</span>`;

  // ================================================================ PHONE SHELL
  function phone(inner, o) {
    const who = o && o.person === null ? "" : (o && o.person) || FACE_PERSON;
    const sub = who ? `${who.name} · ${who.code}` : PLANT;
    return `<div class="ph-app"><div class="k-stripe" aria-hidden="true" style="height:8px"></div>
      <header class="ph-top"><div class="ph-row">${logo(40)}<div class="ph-brand"><b>Phone attendance</b><span>${sub}</span></div>
        <button class="ph-menu" aria-label="Menu" type="button">${icon("menu")}</button></div></header>
      <main class="ph-main">${inner}</main></div>`;
  }
  const btn = (kind, ic, text, extra) => `<button class="ph-btn is-${kind}" type="button"${extra || ""}>${ic ? icon(ic) : ""}<span>${text}</span></button>`;
  function problem(o) {
    return phone(`<section class="ph-card ph-center" role="${o.live === "off" ? "status" : "alert"}">
      <span class="ph-tile is-${o.tone || "amber"}">${o.spin ? spinIcon(o.icon) : icon(o.icon)}</span>
      <h1 class="ph-h">${o.title}</h1>${o.lines ? o.lines.map((l) => `<p class="ph-p${l[1] ? " is-strong" : ""}">${l[0]}</p>`).join("") : ""}
      ${o.chips ? `<div class="ph-rows">${o.chips}</div>` : ""}
      ${o.steps ? `<ol class="ph-steps">${o.steps.map((s) => `<li>${s}</li>`).join("")}</ol>` : ""}
      <div class="ph-actions">${o.actions || ""}</div></section>`, o);
  }
  const TRY = btn("primary", "rotate-cw", "Try again");
  const BACK = btn("outline", "arrow-left", "Back");
  const CANCEL = btn("outline", "x", "Cancel");
  const chip = (tone, ic, text) => `<span class="ph-chip is-${tone}">${icon(ic)}<span>${text}</span></span>`;

  // location + camera problems (shared by the face and the gate code flow)
  const LOC = {
    "location-checking": (p) => problem({ person: p, tone: "blue", icon: "loader-circle", spin: true, title: "Finding location…", live: "off", actions: CANCEL }),
    "location-denied": (p) => problem({ person: p, icon: "map-pin-off", title: "Turn on location for this website.", lines: [["Please try again.", true]], actions: TRY + BACK }),
    "location-unavailable": (p) => problem({ person: p, icon: "map-pin-off", title: "We could not read your location.", lines: [["Please try again.", true]], actions: TRY + BACK }),
    "location-weak": (p) => problem({ person: p, icon: "satellite-dish", title: "Your location is not exact enough.", lines: [["Move to an open place.", false], ["Please try again.", true]],
      chips: chip("warn", "satellite-dish", "± 80 m") + chip("info", "crosshair", "± 50 m needed"), actions: TRY + BACK }),
    "camera-opening": (p) => problem({ person: p, tone: "blue", icon: "loader-circle", spin: true, title: "Face punch is starting…", live: "off", actions: CANCEL }),
    "camera-denied": (p) => problem({ person: p, icon: "camera-off", title: "Camera is blocked", lines: [["Allow the camera for this site.", true]],
      steps: ["Tap the padlock or camera icon next to the web address.", "Set Camera to “Allow”.", "Press “Try again”."], actions: TRY + BACK }),
    "camera-not-found": (p) => problem({ person: p, icon: "camera-off", title: "No camera found", lines: [["Connect a camera.", true]],
      steps: ["Check that the camera is plugged in.", "Close other apps that use the camera."], actions: TRY + BACK }),
    "browser-unsupported": (p) => problem({ person: p, tone: "grey", icon: "globe", title: "Please open this page in a current Chrome or Edge.", actions: BACK }),
  };

  // ---------------------------------------------------------------- 03 start (slice of the phone home, spec 4.8)
  function start(o) {
    const p = o.person || FACE_PERSON;
    const bigBtn = (kind, ic, text, disabled) => `<button class="ph-btn is-${kind} is-big" type="button"${disabled ? " disabled" : ""}>${icon(ic)}<span>${text}</span></button>`;
    const button = o.notReady ? "" : o.gate ? bigBtn(o.off ? "off" : "primary", "scan-qr-code", "Scan the QR code", o.off) : bigBtn("primary", "scan-face", "Punch with face");
    const badge = o.badge ? `<div class="ph-badge">${icon("briefcase-business")}<span>Outside work allowed${o.until ? `<small>until ${o.until}</small>` : ""}</span></div>` : "";
    const notReady = o.notReady ? `<div class="ph-badge" style="background:var(--warning-soft);border-color:#b97300;color:var(--k-warning)" role="status">${icon("scan-face")}<span>Your face is not set up. Please visit the plant office.</span></div>` : "";
    return phone(`<section class="ph-card">
      <p class="ph-hello">Welcome,<b>${p.first}</b></p>
      <p class="ph-p is-strong" style="display:flex;gap:10px;align-items:center">${icon("building-2", ' style="width:24px;height:24px;flex:none"')}${PLANT}</p>
      <div class="ph-last">${icon(o.lastIcon || "log-in")}<span>${o.last}</span></div>
      ${badge}${notReady}
      <div class="ph-rows" aria-label="Location">${o.chip}</div>
      ${button ? `<div class="ph-actions">${button}</div>` : ""}</section>`, { person: p });
  }
  const START = {
    "inside-face": () => start({ last: "IN at 07:02, attendance device", chip: chip("ok", "map-pin", "Location ready") }),
    "outside-allowed": () => start({ badge: true, last: "OUT at 19:04, phone", lastIcon: "log-out", chip: chip("ok", "map-pin", "Location ready") }),
    "outside-allowed-until": () => start({ badge: true, until: "06/11/2026", last: "OUT at 19:04, phone", lastIcon: "log-out", chip: chip("ok", "map-pin", "Location ready") }),
    "outside-work-ended": () => start({ last: "OUT at 19:04, phone", lastIcon: "log-out", chip: chip("ok", "map-pin", "Location ready") }),
    "location-off": () => start({ last: "IN at 07:02, attendance device", chip: chip("bad", "map-pin-off", "Turn on location") }),
    "location-weak": () => start({ last: "IN at 07:02, attendance device", chip: chip("warn", "satellite-dish", "Location not exact enough (80 m). Move to an open place.") }),
    "gate-worker": () => start({ person: CODE_PERSON, gate: true, last: "IN at 07:05, attendance device", chip: chip("ok", "map-pin", "Location ready") }),
    "gate-worker-not-at-plant": () => start({ person: CODE_PERSON, gate: true, off: true, last: "OUT at 19:04, attendance device", lastIcon: "log-out", chip: chip("bad", "map-pin-off", "You are not at the plant") }),
    "face-not-ready": () => start({ notReady: true, last: "No punch today", lastIcon: "info", chip: chip("ok", "map-pin", "Location ready") }),
  };

  // ---------------------------------------------------------------- 04 face punch
  const FACE = {};
  ["location-checking", "location-denied", "location-unavailable", "location-weak", "camera-opening", "camera-denied", "camera-not-found", "browser-unsupported"].forEach((k) => { FACE[k] = () => LOC[k](FACE_PERSON); });
  Object.assign(FACE, {
    "look": () => faceScreen({ headIcon: "scan-face", title: LOOK, ghost: "normal" }),
    "come-closer": () => hint("Come closer", "zoom-in", { ghost: "small" }),
    "move-back": () => hint("Move a little back", "zoom-out", { ghost: "big" }),
    "one-person": () => hint("Only one person, please", "users", { ghost: "two" }),
    "more-light": () => hint("More light needed", "sun-dim", { ghost: "dim", dark: true }),
    "face-good": () => faceScreen({ headIcon: "scan-face", title: LOOK, ghost: "normal", oval: "good", badge: { icon: "check" }, strip: { tone: "green", icon: "check", text: "Good. Hold still." } }),
    "timeout": () => faceScreen({ headIcon: "scan-face", title: LOOK, oval: "muted", cancel: false, card: { icon: "scan-face", text: "We could not see your face clearly. Try again." } }),
    "turn-left": () => faceScreen({ headIcon: "arrow-left", dir: "left", title: turnTitle("LEFT"), bigArrow: "arrow-left", ghost: "turn-left", arrow: "left", steps: ["done", "now", ""] }),
    "turn-right": () => faceScreen({ headIcon: "arrow-right", dir: "right", title: turnTitle("RIGHT"), bigArrow: "arrow-right", ghost: "turn-right", arrow: "right", steps: ["done", "now", ""] }),
    "frame-taken": () => faceScreen({ headIcon: "check", headTone: "green", title: "Now look straight again.", ghost: "normal", oval: "good", badge: { icon: "check" }, steps: ["done", "done", ""] }),
    "too-slow": () => faceScreen({ headIcon: "arrow-left", dir: "left", title: turnTitle("LEFT"), oval: "muted", cancel: false, steps: ["done", "now", ""], card: { icon: "hourglass", text: "Too slow. Please try again." } }),
    "checking": () => faceScreen({ headIcon: "loader-circle", headSpin: true, headTone: "blue", title: "Checking…", ghost: "normal", oval: "blue", badge: { icon: "loader-circle", tone: "blue", spin: true }, steps: ["done", "done", "now"], cancel: false }),
    "server-waking": () => faceScreen({ headIcon: "server", headTone: "amber", title: "Please wait. The server is starting; this can take up to a minute.", ghost: "normal", oval: "amber", badge: { icon: "server", tone: "amber" }, steps: ["done", "done", "now"], cancel: false }),
  });

  // ---------------------------------------------------------------- 05 gate code scan
  function camBlock(o) {
    const sheet = o.sheet === "qr" ? `<div class="ph-qr-sheet">${fakeQr(5, 29)}</div>` : o.sheet === "card" ? `<div class="ph-qr-sheet is-card">${icon("id-card")}</div>` : "";
    const ghost = o.ghost ? `<div class="ghost-box">${ghostSvg()}</div><div class="oval ${o.oval || "is-search"}"></div>` : "";
    const frame = o.frame ? `<div class="frame">${BRACKETS}<div class="scanline-wrap" aria-hidden="true"><div class="scanline"></div></div></div>` : "";
    const strip = o.strip ? `<div class="cam-strip is-${o.strip.tone}" role="status">${icon(o.strip.icon)}<span>${o.strip.text}</span></div>` : "";
    return `<div class="face-cam ph-cam" aria-label="${o.label}"><div class="cam-feed"></div>${sheet}${ghost}${frame}${strip}</div>`;
  }
  function timer(left, frac, ending) {
    return `<div class="ph-timer"><div class="t-label" role="timer">${icon("timer")}<span>Photo in ${left} s</span></div>
      <div class="pc-bar${ending ? " is-ending" : ""}" aria-hidden="true" style="--from:${frac};--life:${left}s"><i></i></div></div>`;
  }
  const SCAN = {};
  ["location-checking", "location-denied", "location-unavailable", "location-weak", "camera-denied", "camera-not-found", "browser-unsupported"].forEach((k) => { SCAN[k] = () => LOC[k](CODE_PERSON); });
  Object.assign(SCAN, {
    "not-at-plant": () => problem({ person: CODE_PERSON, tone: "red", icon: "map-pin-off", title: "You are not at the plant.", lines: [["Please visit the plant office.", true]], actions: BACK }),
    "camera-opening": () => problem({ person: CODE_PERSON, tone: "blue", icon: "loader-circle", spin: true, title: "Starting the camera…", live: "off", actions: CANCEL }),
    "scanning": () => phone(`<section class="ph-card"><h1 class="ph-h" style="margin:0">Scan the QR code</h1>${camBlock({ label: "Rear camera picture", sheet: "qr", frame: true })}<div class="ph-actions" style="margin-top:4px">${CANCEL}</div></section>`, { person: CODE_PERSON }),
    "not-gate-code": () => phone(`<section class="ph-card"><h1 class="ph-h" style="margin:0">Scan the QR code</h1>${camBlock({ label: "Rear camera picture", sheet: "card", frame: true, strip: { tone: "amber", icon: "triangle-alert", text: "This is not the phone code of the attendance device." } })}<div class="ph-actions" style="margin-top:4px">${CANCEL}</div></section>`, { person: CODE_PERSON }),
    "photo-ready": () => phone(`<section class="ph-card"><h1 class="ph-h" style="margin:0">Look at the camera</h1>${camBlock({ label: "Front camera picture (mirrored)", ghost: true })}${timer(20, 1, false)}
      <div class="ph-actions" style="margin-top:4px">${btn("primary", "camera", "I'm ready: take my photo")}${CANCEL}</div></section>`, { person: CODE_PERSON }),
    "photo-ending": () => phone(`<section class="ph-card"><h1 class="ph-h" style="margin:0">Look at the camera</h1>${camBlock({ label: "Front camera picture (mirrored)", ghost: true, oval: "is-good" })}${timer(4, 0.2, true)}
      <div class="ph-actions" style="margin-top:4px">${btn("primary", "camera", "I'm ready: take my photo")}${CANCEL}</div></section>`, { person: CODE_PERSON }),
    "checking": () => problem({ person: CODE_PERSON, tone: "blue", icon: "loader-circle", spin: true, title: "Checking…", live: "off" }),
  });

  // ---------------------------------------------------------------- 06 results (gate floods, phone words)
  function res(o) {
    const p = o.person || FACE_PERSON;
    const info = o.info ? `<div class="res-info${o.infoBig ? " is-big" : ""}">${icon(o.infoIcon || "building-2")}<span>${o.info}</span></div>` : "";
    const msg = o.msg ? `<p class="res-msg">${o.msg}</p>` : "";
    const next = o.next ? `<div class="res-next">${icon("arrow-right")}<span>${o.next}</span></div>` : "";
    const actions = `<div class="res-actions"><button class="btn-k btn-k-white">${icon("arrow-left")}Back</button></div>`;
    const code = o.code ? `<p class="res-admin">For the admin: <code>${o.code}</code></p>` : "";
    return `<div class="res is-phone ${o.cls}" role="${o.live === "assertive" ? "alert" : "status"}" aria-live="${o.live || "polite"}">
      <div class="res-top">${logo(44)}<div class="k-brand"><b>Phone attendance</b><span>${p.name} · ${p.code}</span></div></div>
      <div class="res-body">
        <div class="res-left"><div class="res-icon">${icon(o.icon)}</div>${o.time ? `<div class="res-timebox"><small>Server time</small><div class="res-time">${o.time}</div></div>` : ""}</div>
        <div class="res-right"><h1 class="res-word ${o.wordSize || ""}">${o.word}</h1>${msg}${info}${next}${actions}${code}</div>
      </div></div>`;
  }
  const accepted = (dir, time, via, person, extra) => res(Object.assign({
    cls: dir === "IN" ? "is-in" : "is-out", icon: dir === "IN" ? "log-in" : "log-out", word: dir, time, person,
    info: `${PLANT}<span class="sub">${dir === "IN" ? "Checked in" : "Checked out"} by ${via}</span>`, infoIcon: "building-2",
  }, extra || {}));
  const OUTSIDE_LINE = "Saved as an outside-plant punch. The office will check it.";
  const reject = (code, msg, next, o) => res(Object.assign({ cls: "is-reject", icon: "x", word: "NOT ACCEPTED", wordSize: "is-long", time: "07:02", msg, next, code, live: "assertive" }, o || {}));
  const RESULTS = {
    "in-face": () => accepted("IN", "07:02", "face"),
    "out-face": () => accepted("OUT", "19:04", "face"),
    "in-gate-code": () => accepted("IN", "07:05", "phone code", CODE_PERSON),
    "out-gate-code": () => accepted("OUT", "19:06", "phone code", CODE_PERSON),
    "in-outside-plant": () => accepted("IN", "09:12", "face", FACE_PERSON, { infoIcon: "map-pin", info: OUTSIDE_LINE }),
    "out-outside-plant": () => accepted("OUT", "17:40", "face", FACE_PERSON, { infoIcon: "map-pin", info: OUTSIDE_LINE }),
    // a flagged punch (edge of the fence, impossible trip, two devices) looks exactly like a normal one
    "in-flagged-shows-normal": () => accepted("IN", "07:02", "face"),
    "rejected-outside-geofence": () => reject("OUTSIDE_GEOFENCE", "You are not at the plant.", "Please visit the plant office."),
    "rejected-outside-work-ended": () => reject("OUTSIDE_GEOFENCE", "You are not at the plant.", "Please visit the plant office."),
    "rejected-gate-code-outside": () => reject("OUTSIDE_GEOFENCE", "You are not at the plant.", "Please visit the plant office.", { person: CODE_PERSON }),
    "rejected-location-required": () => reject("LOCATION_REQUIRED", "We could not read your location.", "Please try again."),
    "rejected-gps-accuracy-too-low": () => reject("GPS_ACCURACY_TOO_LOW", "Your location is not exact enough. Move to an open place.", "Please try again."),
    "rejected-face-not-recognised": () => reject("FACE_NOT_RECOGNISED", "Face did not match.", "Please visit the plant office."),
    "rejected-spoof-suspected": () => reject("SPOOF_SUSPECTED", "The check did not pass.", "Please try again. If it repeats, please visit the plant office."),
    "rejected-liveness-failed": () => reject("LIVENESS_FAILED", "Please turn your head as the arrow shows, then look straight.", "Please try again."),
    "rejected-challenge-expired": () => reject("CHALLENGE_EXPIRED", "Too slow.", "Please try again."),
    "rejected-face-quality-low": () => reject("FACE_QUALITY_LOW", "The picture is too dark or blurry.", "Please try again."),
    "rejected-no-face": () => reject("NO_FACE", "We could not see your face.", "Stand in front of the camera and try again."),
    "rejected-face-not-ready": () => reject("PHONE_FACE_NOT_READY", "Your face is not set up for attendance.", "Please visit the plant office."),
    "rejected-employee-not-face": () => reject("EMPLOYEE_NOT_FACE", "You punch with the phone code at the gate.", "Please visit the plant office if this is wrong.", { person: CODE_PERSON }),
    "rejected-employee-not-qr": () => reject("EMPLOYEE_NOT_QR", "You punch with your face.", "Please visit the plant office if this is wrong."),
    "rejected-gate-code-invalid": () => reject("GATE_CODE_INVALID", "This phone code is not valid.", "Scan the code on the attendance device again.", { person: CODE_PERSON }),
    "rejected-gate-code-expired": () => reject("GATE_CODE_EXPIRED", "The phone code has changed.", "Scan it again.", { person: CODE_PERSON }),
    "rejected-wrong-plant": () => reject("WRONG_PLANT", "You are registered at another plant.", "Please visit the plant office.", { person: CODE_PERSON }),
    "rejected-snapshot-missing": () => reject("SNAPSHOT_MISSING", "The photo could not be taken.", "Stand in front of the camera and try again.", { person: CODE_PERSON }),
    "already-punched": () => res({ cls: "is-already", icon: "info", word: "ALREADY PUNCHED", wordSize: "is-long", time: "07:03", msg: "Already IN at 07:02.", next: "No need to punch again.", code: "COOLDOWN_ACTIVE" }),
    "already-in-out-too-soon": () => res({ cls: "is-already", icon: "info", word: "ALREADY IN", wordSize: "is-mid", time: "07:10", msg: "Already IN at 07:02.", next: "You can punch OUT after 07:32.", code: "OUT_TOO_SOON" }),
    "shift-closed": () => res({ cls: "is-already", icon: "hourglass", word: "SHIFT CLOSED", wordSize: "is-mid", time: "19:20", msg: "Your shift is already closed.", next: "Please visit the plant office.", code: "SHIFT_ALREADY_CLOSED" }),
    "no-internet": () => res({ cls: "is-reject", icon: "wifi-off", word: "NOT SAVED", wordSize: "is-mid", msg: "No internet. Your punch was NOT saved.", next: "Try again when you have internet, or punch at the attendance device.", code: "PHONE_NETWORK_OFFLINE", live: "assertive" }),
  };

  const GROUPS = { gpanel: GPANEL, reader: READER, start: START, face: FACE, scan: SCAN, results: RESULTS };
  window.P2_STATES = Object.fromEntries(Object.entries(GROUPS).map(([k, v]) => [k, Object.keys(v)]));

  function render() {
    const group = document.body.dataset.group;
    const states = GROUPS[group];
    if (!states) return;
    const keys = Object.keys(states);
    const wanted = location.hash.replace("#", "");
    const state = Object.hasOwn(states, wanted) ? wanted : keys[0];
    document.getElementById("root").innerHTML = states[state]();
    const tag = document.getElementById("state-tag");
    if (tag) tag.textContent = "State: " + state;
    if (/[?&]shot/.test(location.search)) document.body.classList.add("no-tag", "freeze");
    if (window.lucide) window.lucide.createIcons();
  }
  window.addEventListener("hashchange", render);
  document.addEventListener("DOMContentLoaded", render);
})();
