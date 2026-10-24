/*
  Upasthiti - M3 design gate A: gate screen (attendance device) face punch mockups. MOCKUP ONLY
  (static HTML, fake data, English strings, no camera, no photo of any person).
  Every page has <body data-group="idle|guide|challenge|checking|pad|results">; the state comes from
  the URL hash, for example 06-results.html#rejected-no-face. Add "?shot" to hide the state tag and
  freeze the loops (used for the screenshots).
  Words: existing kiosk.* keys of frontend/public/locales/en/common.json where they exist, otherwise
  the exact words of docs/specs/M3-face-attendance.md (sections 4.1 to 4.6, 8.1 and 9). Words that
  neither has are listed in notes.md ("New texts").
*/
(function () {
  const icon = (name, extra) => '<i data-lucide="' + name + '"' + (extra || "") + "></i>";
  const spinIcon = (name) => icon(name, ' class="spin"');
  const PLANT = "Sheet Shapers · K134";
  const KIOSK = "Main gate phone";
  const DAYS = 60;
  // Spec 8.1 text of kiosk.footer.privacy (see notes.md: section 4.1 has an older draft of it)
  const PRIVACY =
    `<b>Face punch:</b> your face is checked against an encrypted record. A photo is kept for ${DAYS} days only if the punch fails or you type your code. ` +
    `<b>Card punch:</b> a photo is kept for ${DAYS} days and checked automatically to see that a face is present.`;

  function logo(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a4bb8"/><stop offset="1" stop-color="#162a6e"/></linearGradient></defs><rect width="40" height="40" rx="11" fill="url(#lg)"/><path d="M11 29V16a9 9 0 0 1 18 0v13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".35"/><path d="M14.5 21.5l4 4 7.5-8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="31" cy="9" r="3.6" fill="#f5b700" stroke="#162a6e" stroke-width="1.2"/></svg>`;
  }
  const chipOnline = () => `<span class="k-chip chip-ok" role="status">${icon("wifi")}<span>Online</span></span>`;

  // ---------------------------------------------------------------- 01 idle
  function topBar(banner) {
    return `<div class="k-stripe" aria-hidden="true"></div>
      <header class="k-top">${logo(56)}
        <div class="k-brand"><b>${PLANT}</b><span>${KIOSK}</span></div>
        ${banner ? `<button class="sound-btn">${icon("volume-2")}<span>Tap once to turn on sound and full screen. Tap again after every update.</span></button>` : ""}
        <div class="k-top-right">${chipOnline()}
          <div class="k-clock" role="timer" aria-label="Server time, India Standard Time"><span>07:02:41</span><small>IST</small></div></div>
      </header>`;
  }
  function footer() {
    return `<footer class="k-foot">
      <p class="privacy">${icon("shield-check")}<span>${PRIVACY}</span></p>
      <p class="help">${icon("life-buoy")}Need help? Ask the plant office.</p></footer>`;
  }
  const BRACKETS = `<svg class="brackets" viewBox="0 0 100 100" aria-hidden="true">
      <g class="b-dark"><path d="M3 22V9a6 6 0 0 1 6-6h13"/><path d="M78 3h13a6 6 0 0 1 6 6v13"/><path d="M97 78v13a6 6 0 0 1-6 6H78"/><path d="M22 97H9a6 6 0 0 1-6-6V78"/></g>
      <g class="b-main"><path d="M3 22V9a6 6 0 0 1 6-6h13"/><path d="M78 3h13a6 6 0 0 1 6 6v13"/><path d="M97 78v13a6 6 0 0 1-6 6H78"/><path d="M22 97H9a6 6 0 0 1-6-6V78"/></g></svg>`;
  const NOTICES = {
    important: { important: true, text: "Gate 2 is closed for repair until 14:00. Please use Gate 1." },
    helmet: { text: "Safety shoes and helmets are required inside the plant." },
    canteen: { text: "Canteen timing today: 12:30 to 13:15." },
  };
  function noticeHtml(n) {
    return n.important
      ? `<div class="notice is-important">${icon("triangle-alert")}<p><span class="tagword">Important</span>${n.text}</p></div>`
      : `<div class="notice">${icon("megaphone")}<p>${n.text}</p></div>`;
  }
  function faceButton(state) {
    if (!state) return "";
    if (state === "ready") {
      return `<button class="face-btn" type="button"><span class="fb-icon">${icon("scan-face")}</span><span class="fb-text"><b>Punch with face</b></span></button>`;
    }
    const starting = state === "starting";
    return `<button class="face-btn is-off" type="button" disabled aria-describedby="fb-why">
      <span class="fb-icon">${starting ? spinIcon("loader-circle") : icon("ban")}</span>
      <span class="fb-text"><b>Punch with face</b><small id="fb-why">${starting ? "Face punch is starting…" : "Face punch is not available right now"}</small></span></button>`;
  }
  function idle(o) {
    const cam = `<div class="cam" aria-label="Camera picture"><div class="cam-feed"></div>
      <div class="frame">${BRACKETS}<div class="scanline-wrap" aria-hidden="true"><div class="scanline"></div></div></div>
      ${o.lowLight ? `<div class="cam-strip is-amber">${icon("sun-dim")}<span>Too dark. Please switch on the gate light.</span></div>` : ""}</div>`;
    const instr = `<div class="instr"><span class="illo">${icon("id-card")}<span class="mini">${icon("scan-line")}</span></span><h1>Show your ID card to the camera</h1></div>`;
    const button = o.button ? `<div class="or" aria-hidden="true">or</div>${faceButton(o.button)}` : "";
    const list = o.notices || [];
    // Phone: one notice at a time, the rest rotate every 8 s (approved M2 rule); "1 of 2" shows it
    // PC: at most 2 notices next to the face button; what does not fit rotates (approved M2 rule)
    const limit = o.button ? 2 : 3;
    const page = list.length > 1 ? `<p class="notice-page${list.length > limit ? " always" : ""}">1 of ${list.length}</p>` : "";
    const notices = list.length ? `<div class="notices" role="region" aria-label="Gate notices">${list.slice(0, limit).map(noticeHtml).join("")}${page}</div>` : "";
    return `<div class="k-app">${`<div>${topBar(o.banner)}</div>`}
      <main class="scan-layout"><div>${cam}</div><div class="side">${instr}${button}${notices}</div></main>${footer()}</div>`;
  }
  const IDLE = {
    "ready": () => idle({ button: "ready", notices: [NOTICES.important, NOTICES.helmet] }),
    "starting": () => idle({ button: "starting", notices: [NOTICES.helmet] }),
    "unavailable": () => idle({ button: "off", notices: [NOTICES.helmet] }),
    "no-button": () => idle({ button: null, notices: [NOTICES.important, NOTICES.helmet] }),
    "busiest": () => idle({ button: "ready", notices: [NOTICES.important, NOTICES.helmet, NOTICES.canteen], lowLight: true, banner: true }),
  };

  // ---------------------------------------------------------------- 02-04 face flow
  // Neutral drawn figure, never a photo. "turn" draws the head turned to the person's left or right
  // as seen in the mirrored preview (the person's left is on the screen's left).
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
  const STEP_NOW_ICON = ["scan-face", "move-horizontal", "loader-circle"];
  function steps(states) {
    return `<div class="progress-steps" aria-hidden="true">${states.map((s, i) => {
      const ic = s === "done" ? icon("check") : s === "now" ? (i === 2 ? spinIcon("loader-circle") : icon(STEP_NOW_ICON[i])) : icon("circle-dashed");
      return `<span class="pstep ${s}">${ic}${STEP_WORDS[i]}</span>`;
    }).join("")}</div>`;
  }
  function faceScreen(o) {
    const head = `<header class="face-head" role="status" aria-live="polite">
      <span class="fh-icon ${o.headTone ? "is-" + o.headTone : ""}">${o.headSpin ? spinIcon(o.headIcon) : icon(o.headIcon)}</span>
      <h1>${o.title}</h1>${o.bigArrow ? icon(o.bigArrow, ' class="fh-big-arrow"') : ""}</header>`;
    const ovalCls = { search: "is-search", good: "is-good", blue: "is-blue", amber: "is-amber", muted: "is-muted" }[o.oval || "search"];
    const badge = o.badge ? `<div class="oval-badge ${o.badge.tone ? "is-" + o.badge.tone : ""} ${o.badge.pop ? "is-pop" : ""}">${o.badge.spin ? spinIcon(o.badge.icon) : icon(o.badge.icon)}</div>` : "";
    const arrow = o.arrow ? `<div class="turn-arrow is-${o.arrow}" aria-hidden="true">${icon(o.arrow === "left" ? "arrow-left" : "arrow-right")}</div>` : "";
    const strip = o.strip ? `<div class="cam-strip is-${o.strip.tone}" role="status">${icon(o.strip.icon)}<span>${o.strip.text}</span></div>` : "";
    const card = o.card ? `<div class="cam-card" role="alert"><div class="cc-top"><span class="cc-icon">${icon(o.card.icon)}</span><h2>${o.card.text}</h2></div>
        <div class="cc-actions"><button class="btn-k btn-k-primary">${icon("rotate-cw")}Try again</button><button class="btn-k btn-k-light">${icon("x")}Cancel</button></div></div>` : "";
    const cam = `<div class="face-cam ${o.dark ? "is-dark" : ""}" aria-label="Camera picture (mirrored)">${ghosts(o.ghost)}<div class="oval ${ovalCls}"></div>${badge}${arrow}${strip}${card}</div>`;
    const foot = `<footer class="face-foot">${steps(o.steps || ["now", "", ""])}${o.cancel === false ? "" : `<button class="btn-k btn-k-light">${icon("x")}Cancel</button>`}</footer>`;
    return `<div class="face-app"><div class="k-stripe" aria-hidden="true"></div>${head}${cam}${foot}</div>`;
  }
  const LOOK = "Look at the camera. Keep your face inside the oval.";
  const hint = (text, ic, extra) => faceScreen(Object.assign({ headIcon: "scan-face", title: LOOK, strip: { tone: "amber", icon: ic, text } }, extra));
  const GUIDE = {
    "look": () => faceScreen({ headIcon: "scan-face", title: LOOK, ghost: "normal" }),
    "come-closer": () => hint("Come closer", "zoom-in", { ghost: "small" }),
    "move-back": () => hint("Move a little back", "zoom-out", { ghost: "big" }),
    "one-person": () => hint("Only one person, please", "users", { ghost: "two" }),
    "more-light": () => hint("More light needed", "sun-dim", { ghost: "dim", dark: true }),
    "face-good": () => faceScreen({ headIcon: "scan-face", title: LOOK, ghost: "normal", oval: "good", badge: { icon: "check", pop: true }, strip: { tone: "green", icon: "check", text: "Good. Hold still." } }),
    "timeout": () => faceScreen({ headIcon: "scan-face", title: LOOK, oval: "muted", cancel: false, card: { icon: "scan-face", text: "We could not see your face clearly. Try again." } }),
  };
  const turnTitle = (dir) => `Turn your head to your <span class="dir">${dir}</span>`;
  const CHALLENGE = {
    "turn-left": () => faceScreen({ headIcon: "move-horizontal", title: turnTitle("LEFT"), bigArrow: "arrow-left", ghost: "turn-left", arrow: "left", steps: ["done", "now", ""] }),
    "turn-right": () => faceScreen({ headIcon: "move-horizontal", title: turnTitle("RIGHT"), bigArrow: "arrow-right", ghost: "turn-right", arrow: "right", steps: ["done", "now", ""] }),
    "frame-taken": () => faceScreen({ headIcon: "check", headTone: "green", title: "Now look straight again.", ghost: "normal", oval: "good", badge: { icon: "check", pop: true }, steps: ["done", "done", ""] }),
    "too-slow": () => faceScreen({ headIcon: "move-horizontal", title: turnTitle("LEFT"), oval: "muted", cancel: false, steps: ["done", "now", ""], card: { icon: "hourglass", text: "Too slow. Please try again." } }),
  };
  const CHECKING = {
    "checking": () => faceScreen({ headIcon: "loader-circle", headSpin: true, headTone: "blue", title: "Checking…", ghost: "normal", oval: "blue", badge: { icon: "loader-circle", tone: "blue", spin: true }, steps: ["done", "done", "now"], cancel: false }),
    "server-waking": () => faceScreen({ headIcon: "server", headTone: "amber", title: "Please wait. The server is starting; this can take up to a minute.", ghost: "normal", oval: "amber", badge: { icon: "server", tone: "amber" }, steps: ["done", "done", "now"], cancel: false }),
  };

  // ---------------------------------------------------------------- 05 code pad
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ-/".split("");
  function pad(o) {
    const total = 90;
    const C = 2 * Math.PI * 44;
    const offset = (C * (1 - o.seconds / total)).toFixed(1);
    const disabled = o.checking ? " disabled" : "";
    const keyCls = (k) => (o.pressed === k ? " is-pressed" : "");
    const keyStyle = o.checking ? ' style="background:#eef1f5;color:#3d4757;box-shadow:none;border-style:dashed"' : "";
    const del = `<button class="key is-del" aria-label="Delete last character"${disabled}${keyStyle}>${icon("delete")}<small>Delete</small></button>`;
    const okInner = o.checking ? `${spinIcon("loader-circle")}<span class="sr-only">Checking…</span>` : `${icon("check")}OK`;
    const ok = `<button class="key is-ok"${o.typed ? "" : " disabled"}${o.checking ? ' aria-disabled="true"' : ""}>${okInner}</button>`;
    let keys;
    if (o.mode === "letters") {
      keys = `<div class="keys is-letters">${LETTERS.map((k) => `<button class="key${keyCls(k)}"${disabled}${keyStyle}>${k}</button>`).join("")}${del}${ok}</div>`;
    } else {
      const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => `<button class="key${keyCls(k)}"${disabled}${keyStyle}>${k}</button>`).join("");
      keys = `<div class="keys">${digits}${del}<button class="key${keyCls("0")}"${disabled}${keyStyle}>0</button>${ok}</div>`;
    }
    const mode = `<div class="pad-bar"><button class="btn-k btn-k-light pad-cancel phone-cancel"${disabled}>${icon("x")}Cancel</button><div class="mode" role="group" aria-label="Keys">
      <button aria-pressed="${o.mode !== "letters"}"${disabled}>${icon("hash")}123</button>
      <button aria-pressed="${o.mode === "letters"}"${disabled}>${icon("case-upper")}ABC</button></div></div>`;
    const alert = o.wrong ? `<div class="pad-alert" role="alert">${icon("circle-x")}<div>That code does not match your face. Check it and try once more.<br><span class="tries">1 try left</span></div></div>` : "";
    const box = `<div class="code-box ${o.checking ? "is-checking" : ""}" aria-label="Employee code typed so far" role="textbox" aria-readonly="true">
      <span class="typed">${o.typed}</span>${o.checking ? "" : '<span class="caret" aria-hidden="true"></span>'}</div>`;
    const ring = `<div class="ring ${o.seconds <= 15 ? "is-low" : ""}" role="timer" aria-label="Time left: ${o.seconds} seconds">
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="44"/><circle class="bar" cx="50" cy="50" r="44" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${offset}"/></svg>
      <div class="num">${o.seconds} s</div></div>`;
    return `<div class="pad-app"><div class="k-stripe" aria-hidden="true"></div>
      <main class="pad-layout">
        <section class="pad-info" aria-live="polite">
          <div class="pad-title"><span class="pi">${icon("info")}</span><h1>Type your employee code</h1></div>
          ${o.wrong ? "" : '<p class="lead">We could not be sure it is you.</p>'}
          <div class="code-row">${box}${ring}</div>
          ${alert}${o.checking ? `<p class="pad-status" role="status">${spinIcon("loader-circle")}Checking…</p>` : ""}
          <button class="btn-k btn-k-light pad-cancel desk-cancel"${disabled}>${icon("x")}Cancel</button>
        </section>
        <section class="keys-wrap" aria-label="Keypad">${mode}${keys}</section>
      </main></div>`;
  }
  const PAD = {
    "empty": () => pad({ mode: "digits", typed: "", seconds: 88 }),
    "letters": () => pad({ mode: "letters", typed: "EM", seconds: 80, pressed: "M" }),
    "typing": () => pad({ mode: "digits", typed: "EMP-03", seconds: 71, pressed: "3" }),
    "wrong-once": () => pad({ mode: "digits", typed: "EMP-0321", seconds: 51, wrong: true }),
    "time-low": () => pad({ mode: "digits", typed: "EMP-03", seconds: 12 }),
    "checking": () => pad({ mode: "digits", typed: "EMP-0312", seconds: 64, checking: true }),
  };

  // ---------------------------------------------------------------- 06 results (M2 floods)
  function res(o) {
    const name = o.name ? `<h2 class="res-name">${o.hello ? `<span class="hello">${o.hello}</span>` : ""}${o.name}</h2>` : "";
    const info = o.info ? `<div class="res-info${o.infoBig ? " is-big" : ""}">${icon(o.infoIcon || "id-card")}<span>${o.info}</span></div>` : "";
    const msg = o.msg ? `<p class="res-msg">${o.msg}</p>` : "";
    const next = o.next ? `<div class="res-next">${icon("arrow-right")}<span>${o.next}</span></div>` : "";
    const actions = o.retry ? `<div class="res-actions"><button class="btn-k btn-k-white">${icon("rotate-cw")}Try again</button></div>` : "";
    const code = o.code ? `<p class="res-admin">For the admin: <code>${o.code}</code></p>` : "";
    const secs = o.secs || 4;
    return `<div class="res ${o.cls}" role="${o.live === "assertive" ? "alert" : "status"}" aria-live="${o.live || "polite"}" style="--secs:${secs}s">
      <div class="res-top">${logo(48)}<div class="k-brand"><b>${PLANT}</b><span>${KIOSK}</span></div>${chipOnline()}</div>
      <div class="res-body">
        <div class="res-left"><div class="res-icon">${icon(o.icon)}</div>${o.time ? `<div class="res-timebox"><small>Server time</small><div class="res-time">${o.time}</div></div>` : ""}</div>
        <div class="res-right"><h1 class="res-word ${o.wordSize || ""}">${o.word}</h1>${name}${msg}${info}${next}${actions}${code}</div>
      </div>
      <div class="res-count" aria-hidden="true"><div class="res-count-label">${icon("timer")}Back to scanning in ${secs} s</div><div class="res-bar"><i></i></div></div></div>`;
  }
  // [message, next step, retry allowed] - spec section 9 sentences, split at the sentence break
  const FACE_REJECT = {
    NO_FACE: ["We could not see your face.", "Stand in front of the camera and try again.", true],
    MULTIPLE_FACES: ["Only one person, please. Try again.", null, true],
    FACE_TOO_SMALL: ["Come a little closer and try again.", null, true],
    FACE_QUALITY_LOW: ["The picture is too dark or blurry.", "Please switch on the gate light and hold still.", true],
    LIVENESS_FAILED: ["Please turn your head as the arrow shows, then look straight.", null, true],
    FACE_INCONSISTENT: ["The check did not pass. Please try again.", null, true],
    CHALLENGE_EXPIRED: ["Too slow. Please try again.", null, true],
    SPOOF_SUSPECTED: ["The check did not pass.", "Look at the camera yourself and try again. If it repeats, please visit the plant office.", false],
    CHALLENGE_INVALID: ["Please try again.", null, false],
    FRAMES_INVALID: ["The pictures could not be read.", "Please try again.", false],
    FACE_NOT_RECOGNISED: ["We could not recognise you.", "If you have an ID card, show it to the camera. Otherwise, please visit the plant office.", false],
    CODE_ENTRY_EXPIRED: ["Time is up.", "Please try again.", false],
    WRONG_PLANT: ["You are registered at another plant.", "Please visit the plant office.", false],
  };
  function reject(code) {
    const r = FACE_REJECT[code];
    return res({ cls: "is-reject", icon: "x", word: "NOT ACCEPTED", wordSize: "is-long", time: "07:02", msg: r[0], next: r[1], retry: r[2], code, secs: r[2] ? 10 : 6, live: "assertive" });
  }
  const wait = (code, msg, next) => res({ cls: "is-already", icon: "hourglass", word: "PLEASE WAIT", wordSize: "is-mid", time: "07:02", msg, next, code, secs: 6 });
  const RESULTS = {
    "in-face": () => res({ cls: "is-in", icon: "log-in", word: "IN", time: "07:02", hello: "Welcome,", name: "Sunita Jadhav", info: 'Employee code <span class="code">EMP-0312</span> · Checked in' }),
    "out-face": () => res({ cls: "is-out", icon: "log-out", word: "OUT", time: "19:04", hello: "Goodbye,", name: "Ramesh Patil", info: 'Employee code <span class="code">EMP-0457</span> · Checked out' }),
    "in-code": () => res({ cls: "is-in", icon: "log-in", word: "IN", time: "07:05", hello: "Welcome,", name: "Sunita Jadhav", info: 'Employee code <span class="code">EMP-0312</span> · Checked in' }),
    "already-in": () => res({ cls: "is-already", icon: "info", word: "ALREADY IN", wordSize: "is-mid", time: "07:03", name: "Sunita Jadhav", info: 'Already IN at 07:02. No need to punch again.<span class="sub">Employee code <span class="code">EMP-0312</span></span>', infoIcon: "info", infoBig: true }),
  };
  Object.keys(FACE_REJECT).forEach((c) => {
    const key = c === "WRONG_PLANT" ? "rejected-wrong-plant-face" : "rejected-" + c.toLowerCase().replace(/_/g, "-");
    RESULTS[key] = () => reject(c);
  });
  RESULTS["wait-face-service-unavailable"] = () => wait("FACE_SERVICE_UNAVAILABLE", "Face punch is starting.", "Please wait a minute.");
  RESULTS["wait-face-service-busy"] = () => wait("FACE_SERVICE_BUSY", "Many people are punching.", "Please try again in a moment.");

  const GROUPS = { idle: IDLE, guide: GUIDE, challenge: CHALLENGE, checking: CHECKING, pad: PAD, results: RESULTS };
  window.GATE_STATES = Object.fromEntries(Object.entries(GROUPS).map(([k, v]) => [k, Object.keys(v)]));

  function render() {
    const group = document.body.dataset.group;
    if (!group) return;
    const states = GROUPS[group];
    const keys = Object.keys(states);
    const wanted = location.hash.replace("#", "");
    const state = Object.hasOwn(states, wanted) ? wanted : keys[0];
    document.getElementById("root").innerHTML = states[state]();
    const tag = document.getElementById("state-tag");
    if (tag) tag.textContent = "State: " + state;
    if (/[?&]shot/.test(location.search)) document.body.classList.add("no-tag");
    if (window.lucide) window.lucide.createIcons();
  }
  window.addEventListener("hashchange", render);
  document.addEventListener("DOMContentLoaded", render);
})();
