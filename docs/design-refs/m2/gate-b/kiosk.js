/*
  Upasthiti - M2 design gate B: kiosk mockup renderer. MOCKUP ONLY (static, fake data, English strings).
  Every page has <body data-group="scan|read|results|problems">; the state comes from the URL hash,
  for example 03-results.html#in. Add "?shot" to hide the small state tag (used for screenshots).
  All words below are the final English strings from docs/specs/M2-qr-attendance.md (section 4 and 9);
  in the real app they live in the translation file (kiosk.punch.<CODE>.*).
*/
(function () {
  const icon = (name, extra) => '<i data-lucide="' + name + '"' + (extra || "") + "></i>";
  const PLANT = "Sheet Shapers · K134";
  const KIOSK = "Main gate phone";

  function logo(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a4bb8"/><stop offset="1" stop-color="#162a6e"/></linearGradient></defs><rect width="40" height="40" rx="11" fill="url(#lg)"/><path d="M11 29V16a9 9 0 0 1 18 0v13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".35"/><path d="M14.5 21.5l4 4 7.5-8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="31" cy="9" r="3.6" fill="#f5b700" stroke="#162a6e" stroke-width="1.2"/></svg>`;
  }

  // ---------- shared frame pieces ----------
  function chip(online) {
    return online
      ? `<span class="k-chip chip-ok" role="status">${icon("wifi")}<span>Online</span></span>`
      : `<span class="k-chip chip-bad" role="status">${icon("wifi-off")}<span>No internet</span></span>`;
  }
  function topBar(opts) {
    opts = opts || {};
    return `
      <div>
        <div class="k-stripe" aria-hidden="true"></div>
        <header class="k-top">
          ${logo(56)}
          <div class="k-brand"><b>${PLANT}</b><span>${KIOSK}</span></div>
          ${opts.banner ? `<button class="sound-btn" id="sound">${icon("volume-2")}<span>Tap once to turn on sound and full screen</span></button>` : ""}
          <div class="k-top-right">
            ${chip(opts.online !== false)}
            <div class="k-clock" role="timer" aria-label="Server time, India Standard Time"><span id="clock">09:24:07</span><small>IST</small></div>
          </div>
        </header>
      </div>`;
  }
  function footer() {
    return `
      <footer class="k-foot">
        <p class="privacy" style="margin:0">${icon("shield-check")}<span>A photo is taken at each card punch to stop card sharing. Kept for 60 days.</span></p>
        <p class="help">${icon("life-buoy")}Need help? Ask the plant office.</p>
      </footer>`;
  }
  function shell(inner, opts) {
    return `<div class="k-app">${topBar(opts)}<main class="k-main" id="main">${inner}</main>${footer()}</div>`;
  }

  // ---------- camera ----------
  const BRACKETS = `
    <svg class="brackets" viewBox="0 0 100 100" aria-hidden="true">
      <g class="b-dark"><path d="M3 22V9a6 6 0 0 1 6-6h13"/><path d="M78 3h13a6 6 0 0 1 6 6v13"/><path d="M97 78v13a6 6 0 0 1-6 6H78"/><path d="M22 97H9a6 6 0 0 1-6-6V78"/></g>
      <g class="b-main"><path d="M3 22V9a6 6 0 0 1 6-6h13"/><path d="M78 3h13a6 6 0 0 1 6 6v13"/><path d="M97 78v13a6 6 0 0 1-6 6H78"/><path d="M22 97H9a6 6 0 0 1-6-6V78"/></g>
    </svg>`;
  const GHOST_PERSON = `
    <svg class="ghost" viewBox="0 0 200 160" aria-hidden="true"><circle cx="100" cy="52" r="34" fill="#9aa3b2"/><path d="M26 160c4-46 34-66 74-66s70 20 74 66z" fill="#9aa3b2"/></svg>`;

  function camera(o) {
    // o: { tone: "yellow"|"blue"|"amber", badge, strip: {text, icon, tone}, ghost, off }
    if (o.off) {
      return `<div class="cam"><div class="cam-off">${icon("camera-off")}
        <button class="btn-k btn-k-primary" autofocus>${icon("camera")}Start camera</button></div></div>`;
    }
    const tone = o.tone || "yellow";
    const strip = o.strip ? `<div class="cam-strip ${o.strip.tone ? "is-" + o.strip.tone : ""}">${icon(o.strip.icon)}<span>${o.strip.text}</span></div>` : "";
    const badge = o.badge ? `<div class="frame-badge ${o.badge.tone ? "is-" + o.badge.tone : ""}">${icon(o.badge.icon, o.badge.spin ? ' class="spin"' : "")}</div>` : "";
    return `<div class="cam" aria-label="Camera picture (mirrored)">
      <div class="cam-feed">${o.ghost ? GHOST_PERSON : ""}</div>
      <div class="frame ${tone === "yellow" ? "" : "is-" + tone}">${BRACKETS}<div class="scanline-wrap"><div class="scanline"></div></div>${badge}</div>
      ${strip}
    </div>`;
  }

  // ---------- notices ----------
  const NOTICES = {
    important: { important: true, text: "Gate 2 is closed for repair until 14:00. Please use Gate 1." },
    helmet: { text: "Safety shoes and helmets are required inside the plant." },
    canteen: { text: "Canteen timing today: 12:30 to 13:15." },
    holiday: { important: true, text: "Plant holiday on Friday 23/10/2026 for Dussehra. Night shift workers: please punch OUT before leaving and carry your ID card at all times. Questions? Ask the plant office." },
    marathi: { text: "उद्या सकाळी ७ वाजता सुरक्षा प्रशिक्षण आहे. सर्वांनी वेळेवर यावे." },
    camp: { text: "Free eye check-up camp at the plant office on Saturday, 10:00 to 13:00." },
  };
  function noticeHtml(n) {
    if (n.important) {
      return `<div class="notice is-important">${icon("triangle-alert")}<p><span class="tagword">Important</span>${n.text}</p></div>`;
    }
    return `<div class="notice">${icon("megaphone")}<p>${n.text}</p></div>`;
  }
  function rotor(total, current) {
    let dots = "";
    for (let i = 1; i <= total; i++) dots += `<span class="${i === current ? "on" : ""}"></span>`;
    return `<div class="rotor" aria-label="Notice ${current} of ${total}, changes every 8 seconds"><span>${current} of ${total}</span><div class="dots">${dots}</div><div class="bar"><i></i></div></div>`;
  }

  const ILLO = `
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <rect x="30" y="6" width="40" height="22" rx="6" fill="#0e1726"/><circle cx="50" cy="17" r="6" fill="#f5b700" stroke="#fff" stroke-width="2"/>
      <circle class="ring" cx="50" cy="24" r="22" fill="none" stroke="#1f3a93" stroke-width="3"/>
      <g class="card-move">
        <rect x="24" y="46" width="52" height="38" rx="6" fill="#fff" stroke="#0e1726" stroke-width="3"/>
        <rect x="30" y="52" width="14" height="4" rx="2" fill="#1f3a93"/><rect x="30" y="60" width="18" height="3" rx="1.5" fill="#868fa0"/>
        <g fill="#0e1726"><rect x="54" y="52" width="16" height="16"/></g>
        <g fill="#fff"><rect x="56" y="54" width="4" height="4"/><rect x="64" y="54" width="4" height="4"/><rect x="56" y="62" width="4" height="4"/><rect x="62" y="60" width="3" height="3"/></g>
        <circle cx="38" cy="74" r="4" fill="#f5b700" stroke="#0e1726" stroke-width="1.5"/>
      </g>
    </svg>`;

  function scanScreen(o) {
    o = o || {};
    const list = o.notices || [];
    // Notices that do not fit rotate every 8 s: 3 at a time on a tablet, 1 at a time on a phone
    const portrait = window.matchMedia("(orientation: portrait)").matches;
    const limit = portrait ? 1 : 3;
    const shown = list.slice(0, limit);
    const big = shown.length === 0 && !o.notAtCard;
    const strip = o.lowLight ? { text: "Too dark. Please switch on the gate light.", icon: "sun-dim", tone: "amber" }
      : o.notAtCard ? { text: "This is not an Upasthiti ID card", icon: "ban", tone: "amber" } : null;
    const cam = camera({
      off: o.cameraOff, strip,
      tone: o.notAtCard ? "amber" : "yellow",
      badge: o.notAtCard ? { icon: "qr-code", tone: "amber" } : null,
    });
    const side = o.cameraOff
      ? `<div class="instr"><div class="illo">${ILLO}</div><h1>Show your ID card to the camera</h1></div>`
      : `<div class="instr ${big ? "is-big" : ""} ${o.compact ? "is-compact" : ""}"><div class="illo" ${big ? 'style="width:200px;height:200px"' : ""}>${ILLO}</div><h1 ${big ? 'style="font-size:56px"' : ""}>Show your ID card to the camera</h1></div>`;
    const notice = o.notAtCard
      ? `<div class="notices" role="alert"><div class="notice is-important" style="font-size:34px;font-weight:750;padding:20px 24px">${icon("ban")}<p>This is not an Upasthiti ID card.</p></div></div>`
      : shown.length ? `<div class="notices" aria-label="Gate notices" role="region">${shown.map(noticeHtml).join("")}${list.length > limit ? rotor(list.length, 1) : ""}</div>` : "";
    return `<div class="scan-layout"><div class="cam-col">${cam}</div><div class="side">${side}${notice}</div></div>`;
  }

  function readScreen(kind) {
    const steps = (a, b, c) => `<div class="progress-steps" aria-hidden="true">
      <span class="pstep ${a}">${icon(a === "done" ? "check" : "circle-dashed")}Card read</span>
      <span class="pstep ${b}">${icon(b === "done" ? "check" : b === "now" ? "scan-face" : "circle-dashed")}Look at the camera</span>
      <span class="pstep ${c}">${icon(c === "now" ? "loader-circle" : "circle-dashed", c === "now" ? ' class="spin"' : "")}Checking…</span></div>`;
    if (kind === "card-read") {
      return `<div class="scan-layout"><div class="cam-col">${camera({ tone: "blue", ghost: true, badge: { icon: "check", tone: "" }, strip: { text: "Card read. Look at the camera", icon: "scan-face", tone: "blue" } })}</div>
        <div class="side status-side"><div class="status-card" role="status" aria-live="polite"><div class="status-icon">${icon("scan-face")}</div><h1>Card read.<br>Look at the camera</h1>${steps("done", "now", "")}</div></div></div>`;
    }
    if (kind === "checking") {
      return `<div class="scan-layout"><div class="cam-col">${camera({ tone: "blue", ghost: true, badge: { icon: "loader-circle", spin: true }, strip: { text: "Checking…", icon: "loader-circle", tone: "blue" } })}</div>
        <div class="side status-side"><div class="status-card" role="status" aria-live="polite"><div class="status-icon">${icon("loader-circle", ' class="spin"')}</div><h1>Checking…</h1>${steps("done", "done", "now")}</div></div></div>`;
    }
    return `<div class="scan-layout"><div class="cam-col">${camera({ tone: "blue", ghost: true, badge: { icon: "loader-circle", spin: true }, strip: { text: "The server is starting. Please wait…", icon: "server", tone: "amber" } })}</div>
      <div class="side status-side"><div class="status-card" role="status" aria-live="polite" style="border-color:#6b3f00;box-shadow:0 8px 0 #6b3f00"><div class="status-icon is-amber">${icon("server", ' class="dotpulse"')}</div><h1>The server is starting.<br>Please wait…</h1>${steps("done", "done", "now")}</div></div></div>`;
  }

  // ---------- result floods ----------
  function nameClass(name) {
    const n = Array.from(name).length;
    return n <= 28 ? "" : n <= 44 ? " is-long" : " is-xlong";
  }
  function timeBox(t, label) {
    return `<div class="res-timebox"><small>${label || "Server time"}</small><div class="res-time">${t}</div></div>`;
  }
  function resTop(chipHtml) {
    return `<div class="res-top">${logo(48)}<div class="k-brand"><b>${PLANT}</b><span>${KIOSK}</span></div>${chipHtml || chip(true)}</div>`;
  }
  function res(o) {
    // o: cls, icon, word, wordSize, time, hello+name, info, msg, next, code, secs, left, live, left-extra
    const name = o.name
      ? `<h2 class="res-name${nameClass(o.name)}"${/[ऀ-ॿ]/.test(o.name) ? ' style="line-height:1.3"' : ""}>${o.hello ? `<span class="hello">${o.hello}</span>` : ""}${o.name}</h2>` : "";
    const checks = o.checks ? `<div class="res-checks">${o.checks.map((c) => `<span>${icon("check")}${c}</span>`).join("")}</div>` : "";
    const info = o.info ? `<div class="res-info${o.infoBig ? " is-big" : ""}">${icon(o.infoIcon || "badge-check")}<span>${o.info}</span></div>` : "";
    const msg = o.msg ? `<p class="res-msg">${o.msg}</p>` : "";
    const next = o.next ? `<div class="res-next">${icon("arrow-right")}<span>${o.next}</span></div>` : "";
    const code = o.code ? `<p class="res-admin">For the admin: <code>${o.code}</code></p>` : "";
    const secs = o.secs || 4;
    const leftRatio = o.left || 0.62;
    return `<div class="k-app" style="grid-template-rows:1fr"><div class="res ${o.cls}" role="${o.live === "assertive" ? "alert" : "status"}" aria-live="${o.live || "polite"}" style="--secs:${secs}s;--left:${leftRatio}">
      ${resTop(o.chipHtml)}
      <div class="res-body">
        <div class="res-left"><div class="res-icon">${icon(o.icon)}</div>${o.time ? timeBox(o.time, o.timeLabel) : ""}</div>
        <div class="res-right">
          <h1 class="res-word ${o.wordSize || ""}">${o.word}</h1>
          ${name}${msg}${checks}${info}${next}${code}
        </div>
      </div>
      <div class="res-count" aria-hidden="true"><div class="res-count-label">${icon("timer")}Back to scanning in ${secs} s</div><div class="res-bar"><i></i></div></div>
    </div></div>`;
  }

  const REJECT = {
    QR_REVOKED: ["This card is blocked.", "Please see the plant office.", "ban"],
    QR_EXPIRED: ["This card has expired.", "Please see the plant office.", "calendar-x"],
    QR_NOT_YET_VALID: ["This card is not active yet.", "Please see the plant office.", "calendar-clock"],
    WRONG_PLANT: ["This card is for another plant.", "Please see the plant office.", "building-2"],
    EMPLOYEE_NOT_QR: ["This card cannot be used for punching.", "Please see the plant office.", "id-card"],
    QR_SIGNATURE_INVALID: ["This card is not valid.", "Please see the plant office.", "shield-x"],
    QR_FORMAT_INVALID: ["The card could not be read.", "Hold it still, about 20 cm from the camera.", "scan-line"],
    SNAPSHOT_MISSING: ["The photo could not be taken.", "Stand in front of the camera and try again.", "camera-off"],
    EMPLOYEE_INACTIVE: ["This card cannot be used.", "Please see the plant office.", "user-x"],
    QR_SIGNING_NOT_CONFIGURED: ["Cards are not set up on the server.", "Tell the admin.", "settings"],
    PAYLOAD_TOO_LARGE: ["The photo was too large.", "Try again.", "image-off"],
  };
  function rejectScreen(code) {
    const r = REJECT[code];
    const wordSize = "is-long";
    return res({ cls: "is-reject", icon: "x", word: "NOT ACCEPTED", wordSize, time: "07:02", msg: r[0], next: r[1], code, secs: 6, left: 0.7, live: "assertive" });
  }

  const LONG_NAME = "Venkatachalapathy Ramakrishnan Subramaniam-Iyer Junior";
  const MARATHI_NAME = "सुनील रामचंद्र मोरे-देशमुख";
  const MARATHI_LONG = "श्रीमती सुनंदाबाई रामचंद्र पांडुरंग कुलकर्णी-देशपांडे (कनिष्ठ)";

  const RESULTS = {
    "in": () => res({ cls: "is-in", icon: "log-in", word: "IN", time: "07:02", hello: "Welcome,", name: "Sunil More", info: 'Employee code <span class="code">T-2041</span> · Checked in', infoIcon: "id-card", secs: 4 }),
    "out": () => res({ cls: "is-out", icon: "log-out", word: "OUT", time: "19:05", hello: "Goodbye,", name: "Asha Kale", info: 'Employee code <span class="code">E-0318</span> · Checked out', infoIcon: "id-card", secs: 4 }),
    "already-in": () => res({ cls: "is-already", icon: "info", word: "ALREADY IN", wordSize: "is-mid", time: "07:04", name: "Sunil More", msg: "", info: 'Already IN at 07:02. No need to punch again.<span class="sub">Employee code <span class="code">T-2041</span></span>', infoIcon: "info", infoBig: true, secs: 4 }),
    "already-in-soon": () => res({ cls: "is-already", icon: "info", word: "ALREADY IN", wordSize: "is-mid", time: "07:12", name: "Sunil More", info: 'Already IN at 07:02. You can punch OUT after 07:32.<span class="sub">Employee code <span class="code">T-2041</span></span>', infoIcon: "info", infoBig: true, secs: 4 }),
    "already-out": () => res({ cls: "is-already", icon: "info", word: "ALREADY OUT", wordSize: "is-mid", time: "19:07", name: "Asha Kale", info: 'Already OUT at 19:05. No need to punch again.<span class="sub">Employee code <span class="code">E-0318</span></span>', infoIcon: "info", infoBig: true, secs: 4 }),
    "self-test": () => res({ cls: "is-test", icon: "wrench", word: "KIOSK OK", wordSize: "is-mid", time: "07:02", timeLabel: "Server time", msg: "No attendance was recorded.", info: 'Camera ✓ · Server ✓ · Clock ✓ (server time 07:02:15)<span class="sub">' + KIOSK + "</span>", infoIcon: "wrench", infoBig: true, secs: 6, left: 0.7 }),
    "in-long-name": () => res({ cls: "is-in", icon: "log-in", word: "IN", time: "07:02", hello: "Welcome,", name: LONG_NAME, info: 'Employee code <span class="code">T-2187</span> · Checked in', infoIcon: "id-card", secs: 4 }),
    "in-devanagari-name": () => res({ cls: "is-in", icon: "log-in", word: "IN", time: "07:02", hello: "Welcome,", name: MARATHI_NAME, info: 'Employee code <span class="code">E-0412</span> · Checked in', infoIcon: "id-card", secs: 4 }),
    "in-devanagari-long-name": () => res({ cls: "is-in", icon: "log-in", word: "IN", time: "07:02", hello: "Welcome,", name: MARATHI_LONG, info: 'Employee code <span class="code">E-0733</span> · Checked in', infoIcon: "id-card", secs: 4 }),
  };
  Object.keys(REJECT).forEach(function (c) { RESULTS["rejected-" + c.toLowerCase().replace(/_/g, "-")] = function () { return rejectScreen(c); }; });

  // ---------- problems ----------
  function steady(o) {
    const steps = o.steps.map((s, i) => `<li><span class="n">${i + 1}</span><span>${s}</span></li>`).join("");
    const action = o.action ? `<div class="actions"><button class="btn-k btn-k-primary">${icon(o.actionIcon)}${o.action}</button></div>` : "";
    return `<div class="center" role="alert">
      <div class="hero ${o.tone === "bad" ? "hero-bad octagon" : "hero-warn"}">${icon(o.icon, ' class="ic"')}</div>
      <h1 class="k-title">${o.title}</h1><p class="msg">${o.msg}</p>
      <ol class="steps-k" aria-label="What to do">${steps}</ol>${action}
      <p class="err-code">For the admin: <code>${o.code}</code></p></div>`;
  }
  const PROBLEMS = {
    "network-offline": () => res({ cls: "is-reject", icon: "wifi-off", word: "NOT SAVED", wordSize: "is-long", msg: "No internet. Your punch was NOT saved.", next: "Try again in a moment.", code: "NETWORK_OFFLINE", secs: 6, left: 0.7, live: "assertive", chipHtml: chip(false) }),
    "internal-error": () => res({ cls: "is-reject", icon: "triangle-alert", word: "ERROR", wordSize: "is-long", msg: "Something went wrong. Try again.", next: "If it repeats, see the plant office.", code: "INTERNAL_ERROR", secs: 6, left: 0.7, live: "assertive" }),
    "too-many-requests": () => res({ cls: "is-already", icon: "hourglass", word: "PLEASE WAIT", wordSize: "is-mid", msg: "Please wait a moment and try again.", code: "TOO_MANY_REQUESTS", secs: 4, left: 0.7 }),
    "camera-blocked": () => shell(steady({ tone: "bad", icon: "camera-off", title: "Camera is blocked", msg: "Allow the camera for this site.", steps: ["Tap the padlock or camera icon next to the web address.", "Set Camera to “Allow”.", "Press “Try again”."], action: "Try again", actionIcon: "rotate-cw", code: "CAMERA_BLOCKED" })),
    "camera-not-found": () => shell(steady({ tone: "bad", icon: "camera-off", title: "No camera found", msg: "Connect a camera.", steps: ["Check that the camera is plugged in.", "Close other apps that use the camera.", "Press “Try again”."], action: "Try again", actionIcon: "rotate-cw", code: "CAMERA_NOT_FOUND" })),
    "browser-not-supported": () => shell(steady({ tone: "bad", icon: "monitor-x", title: "Browser not supported", msg: "Open this page in the latest Chrome or Edge.", steps: ["Open Chrome or Edge on this device (update it if it asks).", "Go to upasthiti.example/kiosk", "This page needs a secure (https) connection."], action: null, code: "BROWSER_NOT_SUPPORTED" })),
    "m1-screens": () => {
      const frame = (hash, title, caption) => `<figure style="margin:0"><div style="width:600px;height:376px;overflow:hidden;border:4px solid #0e1726;border-radius:16px;background:#fff"><iframe src="../../m1/gate-bc/C3-kiosk-pairing.html${hash}" title="${title}" style="width:1280px;height:800px;border:0;transform:scale(.46);transform-origin:0 0" tabindex="-1"></iframe></div><figcaption style="font-size:24px;font-weight:650;margin-top:10px">${caption}</figcaption></figure>`;
      return `<div class="k-app" style="grid-template-rows:auto 1fr;background:#e8ebf0;padding:24px;gap:20px;align-content:start">
        <div style="font-size:28px;font-weight:700">Already approved in M1 (not redesigned), shown as the sister screens of the new ones</div>
        <div style="display:flex;gap:24px;flex-wrap:wrap">${frame("#revoked", "M1 revoked screen", "Switched off (DEVICE_REVOKED), M1 C3")}${frame("", "M1 not paired screen", "Not paired (DEVICE_SIGNATURE_INVALID), M1 C3")}</div></div>`;
    },
  };

  const SCAN = {
    "default": () => scanScreen({ notices: [NOTICES.important, NOTICES.helmet, NOTICES.canteen] }),
    "no-notices": () => scanScreen({ notices: [] }),
    "one-notice": () => scanScreen({ notices: [NOTICES.helmet] }),
    "important-first": () => scanScreen({ notices: [NOTICES.important, NOTICES.holiday, NOTICES.helmet] }),
    "rotating": () => scanScreen({ notices: [NOTICES.important, NOTICES.helmet, NOTICES.canteen, NOTICES.camp, NOTICES.marathi] }),
    "long-notice": () => scanScreen({ notices: [NOTICES.holiday, NOTICES.marathi] }),
    "low-light": () => scanScreen({ notices: [NOTICES.helmet, NOTICES.canteen], lowLight: true }),
    "sound-banner": () => scanScreen({ notices: [NOTICES.important, NOTICES.helmet], banner: true }),
    "camera-fallback": () => scanScreen({ notices: [NOTICES.helmet], cameraOff: true, banner: true }),
    "not-upasthiti": () => scanScreen({ notices: [], notAtCard: true }),
    "no-internet": () => scanScreen({ notices: [NOTICES.helmet], offlineChip: true }),
    "busiest": () => scanScreen({ notices: [NOTICES.important, NOTICES.holiday, NOTICES.marathi, NOTICES.canteen], lowLight: true, banner: true, compact: true }),
  };
  const READ = { "card-read": () => readScreen("card-read"), "checking": () => readScreen("checking"), "server-waking": () => readScreen("server-waking") };

  const GROUPS = { scan: SCAN, read: READ, results: RESULTS, problems: PROBLEMS };
  const FULL = { results: true, problems: false };

  function render() {
    const group = document.body.dataset.group;
    const states = GROUPS[group];
    const keys = Object.keys(states);
    const state = location.hash.replace("#", "").split("+")[0] || keys[0];
    const make = Object.hasOwn(states, state) ? states[state] : states[keys[0]];
    let html = make();
    // scan / read states live inside the standard frame; results already are a full frame
    if (group === "scan" || group === "read") html = shell(html, { online: state !== "no-internet", banner: /banner|fallback|busiest/.test(state) });
    if (group === "problems" && /^(camera|browser)/.test(state) === false) { /* flood or reference, already complete */ }
    document.getElementById("root").innerHTML = html;
    const tag = document.getElementById("state-tag");
    if (tag) tag.textContent = "State: " + state;
    if (/[?&]shot/.test(location.search)) document.body.classList.add("no-tag");
    if (window.lucide) window.lucide.createIcons();
    const sound = document.getElementById("sound");
    if (sound) sound.addEventListener("click", function () { sound.hidden = true; });
    // live clock (mockup starts from a fixed server time)
    let seconds = 9 * 3600 + 24 * 60 + 7;
    setInterval(function () {
      seconds += 1;
      const el = document.getElementById("clock");
      if (!el) return;
      const p = (n) => String(n).padStart(2, "0");
      el.textContent = p(Math.floor(seconds / 3600) % 24) + ":" + p(Math.floor(seconds / 60) % 60) + ":" + p(seconds % 60);
    }, 1000);
  }
  window.addEventListener("hashchange", function () { location.reload(); });
  document.addEventListener("DOMContentLoaded", render);
  window.KIOSK_STATES = { scan: Object.keys(SCAN), read: Object.keys(READ), results: Object.keys(RESULTS), problems: Object.keys(PROBLEMS) };
})();
