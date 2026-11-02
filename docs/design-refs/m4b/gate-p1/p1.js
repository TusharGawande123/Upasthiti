/*
  Upasthiti - M4b design gate P1 mockup: shared helpers for the phone pages (logo, top bar, menu sheet, messages, buttons).
  MOCKUP ONLY, not app code. A page calls P.start({ user, split, menu, render }) where render(state) returns the HTML of <main>.
  The state of a page is the URL hash, e.g. 01-login.html#locked. Add ?shot before the # to hide the state tag.
  Words for people: "attendance device", never "kiosk". Today in the mockups is Saturday 31/10/2026 (IST).
*/
window.ic = function (n) { return `<i data-lucide="${n}"></i>`; };
const ic = window.ic;
const P = (window.P = {});

P.logo = function (size) {
  const s = size || 36;
  return `<svg width="${s}" height="${s}" viewBox="0 0 40 40" role="img" aria-label="Upasthiti logo"><defs><linearGradient id="lg-${s}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a4bb8"/><stop offset="1" stop-color="#162a6e"/></linearGradient></defs><rect width="40" height="40" rx="11" fill="url(#lg-${s})"/><path d="M11 29V16a9 9 0 0 1 18 0v13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".35"/><path d="M14.5 21.5l4 4 7.5-8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="31" cy="9" r="3.6" fill="#f5b700" stroke="#162a6e" stroke-width="1.2"/></svg>`;
};

/* Fake people (never real data). */
P.FACE = { first: "Sunita", name: "Sunita Jadhav", code: "E0412", plant: "K134", method: "face" };
P.QR = { first: "Ramesh", name: "Ramesh Pawar", code: "T0877", plant: "K134", method: "qr" };

P.menuSheet = function (u, passkeys) {
  const pks = (passkeys || []).map(function (k) {
    return `<div class="pk"><span class="pki">${ic("fingerprint")}</span><span class="pkt">${k[0]}<small>${k[1]}</small></span><button class="rm" aria-label="Remove passkey: ${k[0]}">${ic("trash-2")}Remove</button></div>`;
  }).join("");
  return `<div class="overlay"></div><div class="msheet anim-sheet-up" role="dialog" aria-modal="true" aria-label="Menu"><div class="grab"></div>
    <div class="mhead"><span class="avatar-l" aria-hidden="true">${P.initials(u.name)}</span><div><b>${u.name}</b><span>${u.code} · ${u.plant}</span></div><button class="x" aria-label="Close menu">${ic("x")}</button></div>
    <button class="mitem">${ic("shield-check")}Privacy notice</button>
    ${pks ? `<div class="msec"><h4>Passkeys on this account</h4>${pks}</div>` : ""}
    <div class="msec"><button class="mitem danger">${ic("hand")}Stop phone punching</button><button class="mitem">${ic("log-out")}Sign out</button></div></div>`;
};
P.initials = function (n) { return n.split(/\s+/).map(function (p) { return p[0]; }).join("").slice(0, 2).toUpperCase(); };

P.top = function (u, menuOpen) {
  if (!u) {
    return `<span class="pt-brand">${P.logo(40)}<span class="pt-title"><b>Phone attendance</b><span>Sheet Shapers</span></span></span>`;
  }
  return `<span class="pt-brand">${P.logo(40)}<span class="pt-title"><b>Phone attendance</b><span>${u.name} · ${u.code}</span></span></span>
    <button class="pt-menu" aria-label="Menu" aria-expanded="${!!menuOpen}">${ic("menu")}<span>Menu</span></button>`;
};

P.panel = function () {
  return `<aside class="brand-panel" aria-hidden="true">
    <svg class="rings" viewBox="0 0 480 480" fill="none"><circle cx="240" cy="240" r="236" stroke="#fff" stroke-opacity=".10" stroke-width="2"/><circle cx="240" cy="240" r="176" stroke="#fff" stroke-opacity=".14" stroke-width="2"/><circle cx="240" cy="240" r="116" stroke="#fff" stroke-opacity=".20" stroke-width="2"/><circle cx="240" cy="240" r="56" fill="#f5b700" fill-opacity=".9"/><path d="M216 242l18 18 32-36" stroke="#0e1726" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="bp-top">${P.logo(48)}<b>Upasthiti</b></div>
    <div class="bp-mid"><div class="bp-bar"></div><h1>Phone attendance</h1><p>Sheet Shapers</p></div>
    <div class="bp-foot">${ic("map-pin")}<span>Location is read only at the moment of a punch or card check, never in the background.</span></div></aside>`;
};

/* A message: tone danger | warning | info | success, icon name, title (optional), body, actions html (optional). */
P.msg = function (tone, icon, title, body, acts) {
  const role = tone === "danger" || tone === "warning" ? "alert" : "status";
  return `<div class="msg msg-${tone} anim-fade-up" role="${role}">${ic(icon)}<div style="flex:1;min-width:0">${title ? `<span class="mt">${title}</span>` : ""}<span class="mb">${body}</span>${acts ? `<div class="acts">${acts}</div>` : ""}</div></div>`;
};

P.btn = function (kind, icon, label, o) {
  o = o || {};
  return `<button class="pbtn pbtn-${kind} ${o.cls || ""}" ${o.disabled ? 'disabled aria-disabled="true"' : ""}${o.busy ? ' aria-busy="true"' : ""}>${o.busy ? `<span class="spinner" aria-hidden="true"></span>` : icon ? ic(icon) : ""}<span>${label}</span></button>`;
};

/* Text input. o: type, code (upper-case code font), eye (show/hide button), err, help, invalid, disabled, ph, auto */
P.field = function (id, label, value, o) {
  o = o || {};
  const inv = o.err ? ` aria-invalid="true" aria-describedby="${id}-e"` : "";
  const type = o.type || "text";
  const eye = o.eye ? `<button class="eye" type="button" aria-label="${o.shown ? "Hide password" : "Show password"}">${ic(o.shown ? "eye-off" : "eye")}</button>` : "";
  return `<div class="pf"><label for="${id}">${label}</label><div class="pin ${o.eye ? "has-eye" : ""}"><input id="${id}" type="${type}" value="${value || ""}" ${o.ph ? `placeholder="${o.ph}"` : ""} ${o.disabled ? "disabled" : ""} ${o.code ? 'class="code" autocapitalize="characters" autocomplete="username" inputmode="text"' : ""} ${o.auto ? `autocomplete="${o.auto}"` : ""}${inv} />${eye}</div>
    ${o.err ? `<p class="ferr" id="${id}-e">${ic("circle-alert")}<span>${o.err}</span></p>` : ""}${o.help ? `<p class="fhelp">${o.help}</p>` : ""}</div>`;
};

/* The fake person for camera pictures. */
P.person = function () {
  return `<svg class="person" viewBox="0 0 200 220" aria-hidden="true"><ellipse cx="100" cy="82" rx="46" ry="56" fill="#cfd6e4"/><path d="M8 220c4-52 40-78 92-78s88 26 92 78z" fill="#cfd6e4"/></svg>`;
};

P.qrDrawing = function () {
  const cells = [];
  const seed = [1,1,1,0,1,1,1, 1,0,1,0,1,0,1, 1,1,1,1,1,1,1, 0,0,1,0,0,1,0, 1,0,1,1,0,1,1, 0,1,0,1,1,0,0, 1,1,1,0,1,0,1];
  seed.forEach(function (v, i) { if (v) cells.push(`<rect x="${(i % 7) * 10}" y="${Math.floor(i / 7) * 10}" width="10" height="10"/>`); });
  return `<svg class="q" viewBox="0 0 70 70" fill="#0e1726" aria-hidden="true">${cells.join("")}</svg>`;
};

P.start = function (o) {
  document.addEventListener("DOMContentLoaded", function () {
    if (location.search.indexOf("shot") >= 0) document.body.classList.add("shot");
    const state = location.hash.replace("#", "") || "default";
    const html = o.render(state);
    const menuOpen = !!(o.menu && o.menu(state));
    const root = document.getElementById("root");
    const user = typeof o.user === "function" ? o.user(state) : o.user;
    root.innerHTML = `<div class="ph ${o.split ? "split" : ""}">${o.split ? P.panel() : ""}<div class="col"><header class="pt">${P.top(user, menuOpen)}</header><main class="pm ${o.wide ? "wide" : ""}" id="page">${html}</main></div></div>${menuOpen ? P.menuSheet(user, o.menu(state)) : ""}`;
    const tag = document.getElementById("state-tag");
    if (tag) tag.textContent = "State: " + state;
    if (window.lucide) window.lucide.createIcons();
    document.documentElement.setAttribute("data-ready", "1");
  });
  window.addEventListener("hashchange", function () { location.reload(); });
};

/* Page head template used by most pages. */
P.head = function (title, sub) { return `<div class="phead anim-fade-up"><h1 class="ptitle">${title}</h1>${sub ? `<p class="psub">${sub}</p>` : ""}</div>`; };

P.shell = function (title, ver) {
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..800&display=swap" rel="stylesheet" />
<script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js"></script>
<link rel="stylesheet" href="tokens.css" /><link rel="stylesheet" href="p1.css" /></head><body>`;
};
