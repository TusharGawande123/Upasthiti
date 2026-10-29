/*
  Upasthiti - M4 design gate A: gate screen (attendance device) location + offline mockups. MOCKUP ONLY
  (static HTML, fake data, English strings, no camera, no photo of any person).
  Every page has <body data-group="loc|status|card|face|results|queue">; the state comes from the URL hash,
  for example 01-location.html#needs-weak. Add "?shot" to hide the state tag and freeze the loops.
  Words: the exact words of docs/specs/M4-anti-proxy-offline.md sections 4.1 to 4.6; words the spec does not
  have are listed in notes.md ("New texts"). The gate says "attendance device", never "kiosk".
  Reused from M3 gate A (copied, small patches): logo, camera, face screens, code pad, result floods.
*/
(function () {
  const icon = (name, extra) => '<i data-lucide="' + name + '"' + (extra || "") + "></i>";
  const spinIcon = (name) => icon(name, ' class="spin"');
  // Lucide 0.469 has no "cloud-check": same cloud path as Lucide's "cloud" plus a tick
  const cloudCheck = '<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9.5 14 2 2 4-4"/></svg>';
  const PLANT = "Sheet Shapers · K134";
  const KIOSK = "Main gate phone";
  const DAYS = 60;
  const PRIVACY =
    `<b>Face punch:</b> your face is checked against an encrypted record. A photo is kept for ${DAYS} days only if the punch fails or you type your code. ` +
    `<b>Card punch:</b> a photo is kept for ${DAYS} days and checked automatically to see that a face is present.`;
  // Spec 4.2: the one new sentence of kiosk.footer.privacy
  const PRIVACY_OFFLINE = "When the internet is down, your punch is saved on this attendance device in a locked form that only our server can open, and it is deleted from the device once it is sent.";

  function logo(size) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a4bb8"/><stop offset="1" stop-color="#162a6e"/></linearGradient></defs><rect width="40" height="40" rx="11" fill="url(#lg)"/><path d="M11 29V16a9 9 0 0 1 18 0v13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".35"/><path d="M14.5 21.5l4 4 7.5-8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="31" cy="9" r="3.6" fill="#f5b700" stroke="#162a6e" stroke-width="1.2"/></svg>`;
  }

  // ---------------------------------------------------------------- chips (colour + icon + word)
  const chip = (tone, ic, text, spin) => `<span class="k-chip chip-${tone}" role="status">${spin ? spinIcon(ic) : icon(ic)}<span>${text}</span></span>`;
  const NET = {
    online: () => chip("ok", "wifi", "Online"),
    offline: () => chip("warn", "wifi-off", "No internet – punches are saved"),
  };
  const LOC = {
    finding: () => chip("wait", "loader-circle", "Finding location…", true),
    good: () => chip("ok", "map-pin", "Location good (±12 m)"),
    weak: () => chip("warn", "satellite-dish", "Location weak (±140 m)"),
    none: () => chip("bad", "map-pin-off", "No location"),
    last: () => chip("info", "history", "Last location (offline)"),
  };
  const savedChip = (n) => chip("info", "hourglass", `${n} saved`);
  const sendingChip = (n) => chip("info", "cloud-upload", `Sending saved punches… ${n} left`, false);
  const statusChips = (t) => [NET[t.net || "online"](), t.loc ? LOC[t.loc]() : "", t.saved ? savedChip(t.saved) : "", t.sending ? sendingChip(t.sending) : ""].join("");

  function topBar(t) {
    t = t || {};
    return `<div class="k-stripe" aria-hidden="true"></div>
      <header class="k-top">${logo(56)}
        <div class="k-brand"><b>${PLANT}</b><span>${KIOSK}</span></div>
        <div class="k-top-right"><div class="k-clock" role="timer" aria-label="Time, India Standard Time"><span>${t.time || "07:02:41"}</span>${t.net === "offline" ? '<em class="off">(offline)</em>' : "<small>IST</small>"}</div></div>
        <div class="k-status" role="group" aria-label="Status of this attendance device">${statusChips(t)}</div>
      </header>`;
  }
  // F-55 last sync line (always shown) + privacy line with the offline sentence
  function footer(sync) {
    const line = sync && sync.waiting
      ? `<p class="sync is-waiting" role="status">${icon("hourglass")}<span>${sync.waiting} punches waiting since ${sync.since}</span></p>`
      : `<p class="sync" role="status">${icon("circle-check")}<span>All punches sent ✓ ${(sync && sync.at) || "09:02"}</span></p>`;
    return `<footer class="k-foot">${line}<span class="foot-break" aria-hidden="true"></span>
      <p class="privacy">${icon("shield-check")}<span>${PRIVACY} ${PRIVACY_OFFLINE}</span></p>
      <p class="help">${icon("life-buoy")}Need help? Ask the plant office.</p>
      <details class="privacy-fold"${sync && sync.open ? " open" : ""}><summary>${icon("shield-check")}<span>Privacy</span>${icon("chevron-down", ' class="chev"')}</summary>
        <p>${PRIVACY} ${PRIVACY_OFFLINE}</p></details></footer>`;
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

  // ---- face screens (M3, copied)
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
    const foot = `<footer class="face-foot">${o.footChip || ""}${steps(o.steps || ["now", "", ""])}${o.cancel === false ? "" : `<button class="btn-k btn-k-light">${icon("x")}Cancel</button>`}</footer>`;
    return `<div class="face-app"><div class="k-stripe" aria-hidden="true"></div>${head}${cam}${foot}</div>`;
  }

  // ---- code pad (M3, patched: offline lead + chip)
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
    return `<div class="pad-app${o.offline ? " is-offline" : ""}"><div class="k-stripe" aria-hidden="true"></div>
      <main class="pad-layout">
        <section class="pad-info" aria-live="polite">
          <div class="pad-title"><span class="pi">${icon("info")}</span><h1>Type your employee code</h1></div>${o.offlineChip || ""}
          ${o.lead ? `<p class="lead">${o.lead}</p>` : o.wrong ? "" : '<p class="lead">We could not be sure it is you.</p>'}
          <div class="code-row">${box}${ring}</div>
          ${alert}${o.checking ? `<p class="pad-status" role="status">${spinIcon("loader-circle")}Checking…</p>` : ""}
          <button class="btn-k btn-k-light pad-cancel desk-cancel"${disabled}>${icon("x")}Cancel</button>
        </section>
        <section class="keys-wrap" aria-label="Keypad">${o.prefixRow || ""}${mode}${keys}</section>
      </main></div>`;
  }

  // ---- result floods (M3, patched: chip, time label, custom icon)
  function res(o) {
    const name = o.name ? `<h2 class="res-name">${o.hello ? `<span class="hello">${o.hello}</span>` : ""}${o.name}</h2>` : "";
    const info = o.info ? `<div class="res-info${o.infoBig ? " is-big" : ""}">${icon(o.infoIcon || "id-card")}<span>${o.info}</span></div>` : "";
    const msg = o.msg ? `<p class="res-msg">${o.msg}</p>` : "";
    const next = o.next ? `<div class="res-next">${icon("arrow-right")}<span>${o.next}</span></div>` : "";
    const actions = o.retry ? `<div class="res-actions"><button class="btn-k btn-k-white">${icon("rotate-cw")}Try again</button></div>` : "";
    const code = o.code ? `<p class="res-admin">For the admin: <code>${o.code.replace(/_/g, '_<wbr>')}</code></p>` : "";
    const secs = o.secs || 4;
    return `<div class="res ${o.cls}" role="${o.live === "assertive" ? "alert" : "status"}" aria-live="${o.live || "polite"}" style="--secs:${secs}s">
      <div class="res-top">${logo(48)}<div class="k-brand"><b>${PLANT}</b><span>${KIOSK}</span></div>${o.chipHtml || chipOnline()}</div>
      <div class="res-body">
        <div class="res-left"><div class="res-icon">${o.iconHtml || icon(o.icon)}</div>${o.time ? `<div class="res-timebox"><small>${o.timeLabel || "Server time"}</small><div class="res-time">${o.time}</div></div>` : ""}</div>
        <div class="res-right"><h1 class="res-word ${o.wordSize || ""}">${o.word}</h1>${name}${msg}${info}${next}${actions}${code}</div>
      </div>
      <div class="res-count" aria-hidden="true"><div class="res-count-label">${icon("timer")}Back to scanning in ${secs} s</div><div class="res-bar"><i></i></div></div></div>`;
  }

  // ---------------------------------------------------------------- camera + idle skeleton (M2/M3 look)
  function faceButton(state, reason) {
    if (state === "ready") {
      return `<button class="face-btn" type="button"><span class="fb-icon">${icon("scan-face")}</span><span class="fb-text"><b>Punch with face</b></span></button>`;
    }
    return `<button class="face-btn is-off" type="button" disabled aria-describedby="fb-why">
      <span class="fb-icon">${icon("ban")}</span>
      <span class="fb-text"><b>Punch with face</b><small id="fb-why">${reason}</small></span></button>`;
  }
  function camera(o) {
    o = o || {};
    const strip = o.strip ? `<div class="cam-strip is-${o.strip.tone}" role="status">${o.strip.spin ? spinIcon(o.strip.icon) : icon(o.strip.icon)}<span>${o.strip.text}</span></div>` : "";
    const ghost = o.ghost ? `<div class="mini-ghost">${ghostSvg()}</div>` : "";
    return `<div class="cam" aria-label="Camera picture"><div class="cam-feed"></div>${ghost}
      <div class="frame">${BRACKETS}<div class="scanline-wrap" aria-hidden="true"><div class="scanline"></div></div></div>${strip}</div>`;
  }
  const INSTR = `<div class="instr"><span class="illo">${icon("id-card")}<span class="mini">${icon("scan-line")}</span></span><h1>Show your ID card to the camera</h1></div>`;
  function banner(tone, ic, text) {
    return `<div class="k-banner is-${tone}" role="status">${icon(ic)}<span>${text}</span></div>`;
  }
  // o: top (chip state), sync, button ("ready" | {off: reason} | null), notices, cam (camera options), side (html override), banner
  function scan(o) {
    const list = o.notices || [];
    const button = o.button ? `<div class="or" aria-hidden="true">or</div>${o.button === "ready" ? faceButton("ready") : faceButton("off", o.button.off)}` : "";
    const notices = list.length ? `<div class="notices" role="region" aria-label="Gate notices">${list.slice(0, 1).map(noticeHtml).join("")}</div>` : "";
    return `<div class="k-app"><div>${topBar(o.top)}${o.banner || ""}</div>
      <main class="scan-layout"><div>${camera(o.cam)}</div><div class="side">${o.side || INSTR}${button}${notices}</div></main>${footer(o.sync)}</div>`;
  }
  const ON_GOOD = { net: "online", loc: "good" };

  // ---------------------------------------------------------------- 01 location
  // Sketch (F-53): plain SVG, no map tiles, no internet. Fence = solid blue, margin = dashed, device = point + accuracy circle.
  const FENCE = "90,70 270,60 290,200 210,240 80,210";
  const MARGIN = "58,38 302,26 326,224 216,274 46,238";
  function sketchSvg(kind) {
    const base = `<rect width="440" height="300" rx="14" fill="#f5f6f8"/>
      <polygon points="${MARGIN}" fill="none" stroke="#6b3f00" stroke-width="4" stroke-dasharray="14 9" stroke-linejoin="round"/>
      `;
    const fence = `<polygon points="${FENCE}" fill="#9fb0ea" fill-opacity=".35" stroke="#1f3a93" stroke-width="7" stroke-linejoin="round"/>`;
    if (kind === "weak") {
      return `<svg viewBox="0 0 440 300" role="img" aria-label="Sketch: the device is inside the fence but its location is only known within 140 m; 50 m is needed">${base}
        <circle cx="185" cy="142" r="112" fill="#ffc233" fill-opacity=".28" stroke="#6b3f00" stroke-width="4"/>${fence}
        <circle cx="185" cy="142" r="40" fill="none" stroke="#0e1726" stroke-width="5" stroke-dasharray="2 9" stroke-linecap="round"/>
        <g stroke="#0e1726" stroke-width="3"><path d="M185 120v44M163 142h44"/></g>
        <circle cx="185" cy="142" r="11" fill="#6b3f00" stroke="#fff" stroke-width="4"/></svg>`;
    }
    return `<svg viewBox="0 0 440 300" role="img" aria-label="Sketch: the device is about 60 m outside the fence">${base}${fence}
      <path d="M368 140 L292 135" stroke="#8a1a10" stroke-width="5" stroke-linecap="round"/>
      <path d="M296 120v30M368 125v30" stroke="#8a1a10" stroke-width="4" stroke-linecap="round"/>
      <circle cx="392" cy="141" r="26" fill="#ffc233" fill-opacity=".28" stroke="#6b3f00" stroke-width="4"/>
      <circle cx="392" cy="141" r="11" fill="#8a1a10" stroke="#fff" stroke-width="4"/></svg>`;
  }
  const swatch = (inner) => `<svg class="sw" viewBox="0 0 48 32" aria-hidden="true">${inner}</svg>`;
  const SW = {
    fence: swatch('<rect x="4" y="5" width="40" height="22" rx="4" fill="#dfe6fa" stroke="#1f3a93" stroke-width="4"/>'),
    margin: swatch('<rect x="4" y="5" width="40" height="22" rx="4" fill="none" stroke="#6b3f00" stroke-width="4" stroke-dasharray="7 5"/>'),
    device: swatch('<circle cx="24" cy="16" r="13" fill="#ffc233" fill-opacity=".35" stroke="#6b3f00" stroke-width="3"/><circle cx="24" cy="16" r="5" fill="#6b3f00" stroke="#fff" stroke-width="2"/>'),
    needed: swatch('<circle cx="24" cy="16" r="12" fill="none" stroke="#0e1726" stroke-width="4" stroke-dasharray="1 6" stroke-linecap="round"/>'),
    gap: swatch('<path d="M4 16h40" stroke="#8a1a10" stroke-width="5" stroke-linecap="round"/><path d="M6 8v16M42 8v16" stroke="#8a1a10" stroke-width="4" stroke-linecap="round"/>'),
  };
  function sketchCard(kind) {
    const weak = kind === "weak";
    const caption = weak ? "±140 m now, ±50 m needed" : "about 60 m outside the fence";
    const legend = weak
      ? [[SW.fence, "Plant fence"], [SW.margin, "Allowed margin"], [SW.device, "This device and its accuracy"], [SW.needed, "Accuracy needed"]]
      : [[SW.fence, "Plant fence"], [SW.margin, "Allowed margin"], [SW.device, "This device"], [SW.gap, "Distance to the fence"]];
    return `<section class="sketch-card" aria-label="Why paused?">
      <h2>${icon("map")}Why paused?</h2>
      <div class="sketch">${sketchSvg(kind)}</div>
      <p class="sketch-caption">${caption}</p>
      <ul class="legend">${legend.map(([s, t]) => `<li>${s}<span>${t}</span></li>`).join("")}</ul></section>`;
  }
  function noSketchCard(ic) {
    return `<section class="sketch-card is-plain" aria-hidden="true"><div class="big-pin">${icon(ic)}</div></section>`;
  }
  const CAUSES = {
    denied: { code: "LOCATION_DENIED", icon: "ban", loc: "none", text: "Location is blocked for this website. Ask the plant office to allow it.", guide: true },
    unavailable: { code: "LOCATION_UNAVAILABLE", icon: "map-pin-off", loc: "none", text: "Location is switched off or not available on this attendance device." },
    weak: { code: "LOCATION_WEAK", icon: "satellite-dish", loc: "weak", text: "Waiting for a better location signal (now ±140 m, needed ±50 m).", sketch: "weak" },
    outside: { code: "LOCATION_OUTSIDE", icon: "map-pin-x", loc: "good", text: "This attendance device does not seem to be at the plant gate.", sketch: "outside" },
  };
  function needs(key) {
    const c = CAUSES[key];
    const left = c.sketch ? sketchCard(c.sketch) : noSketchCard(c.icon);
    return `<div class="k-app"><div>${topBar({ net: "online", loc: c.loc })}</div>
      <main class="needs-layout">${left}
        <div class="needs-side" role="alert">
          <div class="needs-title"><span class="nt-icon">${icon("map-pin-off")}</span><h1>This attendance device needs its location</h1></div>
          <p class="needs-lead">Punching is paused. Please wait a moment. If this stays, please visit the plant office.</p>
          <div class="cause">${icon(c.icon)}<p>${c.text}</p></div>
          ${c.guide ? `<a class="guide-link" href="#needs-denied">${icon("book-open")}Steps for the admin: setup guide</a>` : ""}
          <p class="checking-line" role="status">${spinIcon("loader-circle")}Checking again…</p>
          <p class="res-admin-line">For the admin: <code>${c.code.replace(/_/g, '_<wbr>')}</code></p>
        </div></main>${footer()}</div>`;
  }
  const WAITING = "Waiting for the location…";
  const LOCATION = {
    "starting": () => scan({ top: { net: "online", loc: "finding" }, button: { off: WAITING },
      cam: { strip: { tone: "blue", icon: "loader-circle", spin: true, text: "Finding location…" } } }),
    "chip-good": () => scan({ top: ON_GOOD, button: "ready", notices: [NOTICES.helmet] }),
    "chip-weak": () => scan({ top: { net: "online", loc: "weak" }, button: "ready", notices: [NOTICES.helmet] }),
    "chip-none": () => scan({ top: { net: "online", loc: "none" }, button: { off: WAITING }, notices: [NOTICES.helmet] }),
    "chip-last-offline": () => scan({ top: { net: "offline", loc: "last", time: "08:03:12" }, button: "ready", notices: [NOTICES.helmet], sync: { at: "07:58" } }),
    "needs-denied": () => needs("denied"),
    "needs-unavailable": () => needs("unavailable"),
    "needs-weak": () => needs("weak"),
    "needs-outside": () => needs("outside"),
  };

  // ---------------------------------------------------------------- 02 offline status
  const STATUS = {
    "offline-saved": () => scan({ top: { net: "offline", loc: "good", saved: 12, time: "08:12:30" }, button: "ready", notices: [NOTICES.helmet], sync: { waiting: 12, since: "08:05" } }),
    "sending": () => scan({ top: { net: "online", loc: "good", sending: 12, time: "08:31:09" }, button: "ready", notices: [NOTICES.helmet], sync: { waiting: 12, since: "08:05" } }),
    "all-sent": () => scan({ top: ON_GOOD, button: "ready", notices: [NOTICES.helmet], sync: { at: "09:02" } }),
    "privacy-open": () => scan({ top: { net: "offline", loc: "good", saved: 12, time: "08:12:30" }, button: "ready", notices: [NOTICES.helmet], sync: { waiting: 12, since: "08:05", open: true } }),
    "offline-empty": () => scan({ top: { net: "offline", loc: "last", time: "08:03:12" }, button: "ready", notices: [NOTICES.helmet], sync: { at: "07:58" } }),
  };

  // ---------------------------------------------------------------- 03 offline card
  const stepChips = (a, b, c, words) => `<div class="progress-steps" aria-hidden="true">${[a, b, c].map((s, i) => {
    const ic = s === "done" ? icon("check") : s === "now" ? (i === 2 ? spinIcon("loader-circle") : icon("camera")) : icon("circle-dashed");
    return `<span class="pstep ${s}">${ic}${words[i]}</span>`;
  }).join("")}</div>`;
  const CARD_WORDS = ["Card read", "Get ready", "Saving…"];
  const OFF_TOP = { net: "offline", loc: "good", time: "08:03:12" };
  function statusScreen(o) {
    return `<div class="k-app"><div>${topBar(OFF_TOP)}</div>
      <main class="scan-layout"><div>${camera({ ghost: true, strip: o.strip })}</div>
      <div class="side status-side"><div class="status-card" role="status" aria-live="polite">
        <div class="status-icon">${icon(o.icon)}</div><h1>${o.title}</h1>${o.ring || ""}${o.steps || ""}</div></div></main>
      ${footer({ waiting: 3, since: "08:02" })}</div>`;
  }
  function ringHtml(seconds, total) {
    const C = 2 * Math.PI * 44;
    return `<div class="ready-row"><div class="ring" role="timer" aria-label="Time left: ${seconds} seconds"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="44"/><circle class="bar" cx="50" cy="50" r="44" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - seconds / total)).toFixed(1)}"/></svg><div class="num">${seconds} s</div></div>
      <div class="ready-btns"><button class="btn-k btn-k-primary">${icon("camera")}I'm ready</button><button class="btn-k btn-k-light">${icon("x")}Cancel</button></div></div>`;
  }
  function testCard() {
    const row = (ok, ic, label, word) => `<li class="${ok ? "is-ok" : "is-no"}"><span class="t-ic">${icon(ic)}</span><b>${label}</b><span class="t-word">${icon(ok ? "check" : "x")}${word}</span></li>`;
    return `<div class="k-app"><div>${topBar(OFF_TOP)}</div>
      <main class="test-layout"><section class="test-card" role="status" aria-live="polite">
        <div class="test-head"><span class="status-icon">${icon("clipboard-check")}</span><h1>Attendance device test</h1></div>
        <ul class="test-rows">${row(true, "camera", "Camera", "Working")}${row(true, "map-pin", "Location", "Working")}${row(false, "wifi-off", "Internet", "Not working")}</ul>
        <p class="test-note">${icon("info")}No attendance was recorded.</p>
      </section></main>${footer({ waiting: 3, since: "08:02" })}</div>`;
  }

  // ---------------------------------------------------------------- results (M2 floods + new slate-blue SAVED)
  const OFF_CHIP = chip("warn", "wifi-off", "No internet – punches are saved");
  const VISIT = "Please visit the plant office.";
  function offlineResult(kind) {
    const base = { chipHtml: OFF_CHIP, time: "08:03", timeLabel: "Time (offline)" };
    if (kind === "saved") {
      return res(Object.assign({ cls: "is-saved", iconHtml: cloudCheck, word: "SAVED", msg: "Saved – will be confirmed",
        info: "Your punch is saved on this attendance device. It will be checked when the internet is back.", infoIcon: "hard-drive", secs: 8, live: "polite" }, base));
    }
    if (kind === "already") {
      return res(Object.assign({ cls: "is-already", icon: "info", word: "ALREADY SAVED", wordSize: "is-mid", time: "08:04",
        info: "Already saved at 08:02. No need to punch again.", infoIcon: "info", infoBig: true, secs: 4 }, { chipHtml: OFF_CHIP, timeLabel: "Time (offline)" }));
    }
    const small = kind === "storage-small";
    return res(Object.assign({ cls: "is-reject", icon: "x", word: "NOT SAVED", wordSize: "is-long", live: "assertive", secs: 6,
      msg: small ? "This attendance device cannot save punches without internet." : "This attendance device cannot save more punches.",
      info: "Your punch was NOT saved.", infoIcon: "ban", infoBig: true, next: VISIT,
      code: small ? "OFFLINE_STORAGE_TOO_SMALL" : "QUEUE_FULL" }, base));
  }
  const RESULTS = {
    "saved": () => offlineResult("saved"),
    "already-saved": () => offlineResult("already"),
    "not-saved-queue-full": () => offlineResult("queue-full"),
    "not-saved-storage-too-small": () => offlineResult("storage-small"),
  };
  const CARD = {
    "get-ready": () => statusScreen({ icon: "id-card", title: "Card read.<br>Get ready for your photo.", strip: { tone: "blue", icon: "camera", text: "Get ready for your photo" }, ring: ringHtml(17, 20) }),
    "photo": () => statusScreen({ icon: "camera", title: "Look at the camera", strip: { tone: "blue", icon: "scan-face", text: "Look at the camera" }, steps: stepChips("done", "done", "now", CARD_WORDS) }),
    "already-saved": () => offlineResult("already"),
    "test-card": () => testCard(),
  };

  // ---------------------------------------------------------------- 04 offline face
  const LOOK = "Look at the camera. Keep your face inside the oval.";
  const FOOT_CHIP = `<div class="foot-chip">${OFF_CHIP}</div>`;
  const faceOff = (o) => faceScreen(Object.assign({ footChip: FOOT_CHIP }, o));
  const PREFIXES = `<div class="prefix-row" role="group" aria-label="Start of the employee code">${["EMP-", "T-", "C-"].map((p) => `<button class="key prefix-key">${p}</button>`).join("")}</div>`;
  const offPad = (o) => pad(Object.assign({ offline: true, prefixRow: o.typed ? "" : PREFIXES, mode: "digits", seconds: 88, offlineChip: `<div class="pad-chips">${OFF_CHIP}</div>`,
    lead: "No internet right now. Type your code, then look at the camera." }, o));
  const turnTitle = (dir) => `Turn your head to your <span class="dir">${dir}</span>`;
  const FACE = {
    "code-pad-empty": () => offPad({ typed: "" }),
    "code-pad-typing": () => offPad({ typed: "EMP-03", seconds: 71, pressed: "3" }),
    "switch-from-online": () => pad({ offline: true, prefixRow: PREFIXES, mode: "digits", typed: "", seconds: 90, offlineChip: `<div class="pad-chips">${OFF_CHIP}</div>`,
      lead: "No internet. Type your employee code to save your punch." }),
    "face-look": () => faceOff({ headIcon: "scan-face", title: LOOK, ghost: "normal" }),
    "face-turn": () => faceOff({ headIcon: "move-horizontal", title: turnTitle("LEFT"), bigArrow: "arrow-left", ghost: "turn-left", arrow: "left", steps: ["done", "now", ""] }),
    "face-saved": () => offlineResult("saved"),
  };

  // ---------------------------------------------------------------- 06 queue warning + revoked
  function revoked(withQueue) {
    return `<div class="k-app"><div>${topBar({ net: "online", loc: "good" })}</div>
      <main class="prob-layout"><section class="prob-card" role="alert">
        <div class="prob-head"><span class="prob-icon">${icon("power-off")}</span><h1>Switched off</h1></div>
        <p class="prob-msg">This device has been switched off by the admin.</p>
        ${withQueue ? `<div class="prob-queue">${icon("cloud-off")}<p>12 saved punches could not be sent. ${VISIT}</p></div>` : ""}
        <ol class="prob-steps"><li>To use it again, the admin adds it as a new attendance device.</li><li>Then type the new code on this device.</li></ol>
        <p class="res-admin-line">For the admin: <code>${(withQueue ? "REVOKED_WITH_QUEUE" : "DEVICE_REVOKED").replace(/_/g, "_<wbr>")}</code></p>
      </section></main>${footer({ waiting: 12, since: "08:05" })}</div>`;
  }
  const FULL_BANNER = () => banner("warn", "hard-drive", "Storage almost full – please restore the internet.");
  const QUEUE = {
    "storage-almost-full": () => scan({ top: { net: "offline", loc: "good", saved: 400, time: "10:41:07" }, banner: FULL_BANNER(), button: "ready", notices: [NOTICES.helmet], sync: { waiting: 400, since: "08:05" } }),
    "storage-almost-full-sending": () => scan({ top: { net: "online", loc: "good", sending: 400, time: "10:55:30" }, banner: FULL_BANNER(), button: "ready", sync: { waiting: 400, since: "08:05" } }),
    "revoked-with-queue": () => revoked(true),
    "revoked": () => revoked(false),
  };

  const GROUPS = { loc: LOCATION, status: STATUS, card: CARD, face: FACE, results: RESULTS, queue: QUEUE };
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
