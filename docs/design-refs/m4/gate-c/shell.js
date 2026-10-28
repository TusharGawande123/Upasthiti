/*
  Upasthiti - M4 design gate C mockup (from m3/gate-c/shell.js): shared helpers (logo, admin shell, status chips, device data).
  MOCKUP ONLY, not app code. Each page sets window.MOCK_USER, optionally window.MOCK_SHELL, and calls window.mockStart(renderFn).
  window.MOCK_SHELL = { offline: n (devices offline in the user's scope), review: n (Needs review count, Super Admin),
                        banner: { name, since, minutes, more } | null, menu: bool (phone menu open) }.
  The state of a page is the URL hash, e.g. 01-devices.html#drawer-offline. Add ?shot to hide the state tag.
*/

window.ic = function (n) { return `<i data-lucide="${n}"></i>`; };
const ic = window.ic;

window.upasthitiLogo = function (size) {
  const s = size || 34;
  return `<svg width="${s}" height="${s}" viewBox="0 0 40 40" role="img" aria-label="Upasthiti logo"><defs><linearGradient id="lg-${s}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a4bb8"/><stop offset="1" stop-color="#162a6e"/></linearGradient></defs><rect width="40" height="40" rx="11" fill="url(#lg-${s})"/><path d="M11 29V16a9 9 0 0 1 18 0v13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".35"/><path d="M14.5 21.5l4 4 7.5-8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="31" cy="9" r="3.6" fill="#f5b700" stroke="#162a6e" stroke-width="1.2"/></svg>`;
};

window.initialsOf = function (name) {
  return name.split(/\s+/).map(function (p) { return p[0]; }).join("").slice(0, 2).toUpperCase();
};

/* ---------- Fake devices (today 28/10/2026, 08:26 IST). Words for people: "attendance device", never "kiosk". ---------- */
window.DEV = [
  { id: "d1", name: "Main gate phone", plant: "K134", plantName: "Sheet Shapers K-134", status: "online", contact: "20 s ago", punch: "08:24", wait: 0, sync: "07:58", loc: ["in", 12], ver: "1.4.0", kind: "Phone", battery: [86, true], camera: true, storage: [22, 5400], offlineReady: true, uptime: 99 },
  { id: "d2", name: "Gate PC", plant: "K135", plantName: "Sheet Shapers K-135", status: "online", contact: "1 min ago", punch: "08:19", wait: 0, sync: "Yesterday 18:41", loc: ["in", 8], ver: "1.4.0", kind: "PC", battery: null, camera: true, storage: [31, 48000], offlineReady: true, uptime: 100 },
  { id: "d3", name: "Press shop gate", plant: "PC1", plantName: "Press shop 1", status: "location", contact: "40 s ago", punch: "07:52", wait: 0, sync: "07:30", loc: ["edge", 64], ver: "1.4.0", kind: "Phone", battery: [58, false], camera: true, storage: [40, 3200], offlineReady: true, uptime: 94 },
  { id: "d4", name: "Gate tablet", plant: "PC2", plantName: "Press shop 2", status: "sending", contact: "15 s ago", punch: "08:23", wait: 12, oldest: "08:01", sync: "08:25", loc: ["in", 15], ver: "1.4.0", kind: "Tablet", battery: [71, true], camera: true, storage: [64, 2100], offlineReady: true, uptime: 97 },
  { id: "d5", name: "Spinning gate", plant: "SPI", plantName: "Spinning unit", status: "online", contact: "30 s ago", punch: "08:21", wait: 0, sync: "06:55", loc: ["in", 10], ver: "1.4.0", kind: "Phone", battery: [92, true], camera: true, storage: [18, 4800], offlineReady: true, uptime: 100 },
  { id: "d6", name: "TP1 Gate", plant: "TP1", plantName: "Tool plant 1", status: "offline", contact: "14 min ago", since: "08:12", punch: "08:09", wait: 0, sync: "08:11", loc: ["in", 18], ver: "1.4.0", kind: "Phone", battery: null, camera: true, storage: [27, 180], offlineReady: false, uptime: 96 },
  { id: "d7", name: "X280 Gate PC", plant: "X280", plantName: "Sheet Shapers X-280", status: "online", contact: "45 s ago", punch: "08:20", wait: 0, sync: "07:12", loc: ["in", 9], ver: "1.4.0", kind: "PC", battery: null, camera: true, storage: [12, 52000], offlineReady: true, uptime: 100 },
  { id: "d8", name: "Old gate tablet", plant: "K134", plantName: "Sheet Shapers K-134", status: "off", contact: "6 days ago", punch: "22/10 18:55", wait: 0, sync: "22/10 18:55", loc: null, ver: "1.2.1", kind: "Tablet" },
  { id: "d9", name: "Gate 2 phone", plant: "SPI", plantName: "Spinning unit", status: "pending", contact: null, punch: null, wait: 0, sync: null, loc: null, ver: null, kind: "Phone", code: "Pairing code ends in 6 min" },
];

window.statusChip = function (d) {
  switch (d.status) {
    case "online": return `<span class="stchip is-online"><span class="pdot" aria-hidden="true"></span>${ic("wifi")}Online</span>`;
    case "offline": return `<span class="stchip is-offline">${ic("wifi-off")}Offline since ${d.since}</span>`;
    case "location": return `<span class="stchip is-location">${ic("map-pin-off")}Needs location</span>`;
    case "sending": return `<span class="stchip is-sending">${ic("refresh-cw")}Sending saved punches (${d.wait})</span>`;
    case "off": return `<span class="stchip is-off">${ic("power-off")}Switched off</span>`;
    default: return `<span class="stchip is-wait">${ic("hourglass")}Waiting for pairing</span>`;
  }
};
window.locText = function (d) {
  if (!d.loc) return `<span class="loc none">${ic("minus")}Not reported</span>`;
  const [s, m] = d.loc;
  const w = { in: ["circle-check", "inside"], edge: ["triangle-alert", "edge"], out: ["circle-x", "outside"] }[s];
  return `<span class="loc ${s}">${ic(w[0])}±${m} m · ${w[1]}</span>`;
};

/* ---------- Shell ---------- */
function shellOpts() { return window.MOCK_SHELL || {}; }

function navGroups() {
  const o = shellOpts();
  const role = (window.MOCK_USER && window.MOCK_USER.role) || "";
  const sa = role === "Super Admin";
  const dev = o.offline ? `<span class="sb-count sb-warn" aria-label="${o.offline} attendance device${o.offline > 1 ? "s" : ""} offline">${ic("triangle-alert")}${o.offline}</span>` : "";
  const rev = sa && o.review ? `<span class="sb-count sb-review" aria-label="${o.review} punches to check">${o.review}</span>` : "";
  const attendance = [["list-checks", "Punch log"]];
  if (sa) attendance.push(["flag", "Needs review", rev]);
  return [
    { label: "Overview", items: [["layout-dashboard", "Dashboard"], ["inbox", "Approvals", `<span class="sb-count" aria-label="3 waiting">3</span>`]] },
    { label: "Organisation", items: [["factory", "Plants"], ["tablet-smartphone", "Attendance devices", dev]] },
    { label: "People", items: [["users", "Employees"], ["hard-hat", "Contractors"], ["qr-code", "QR cards"]] },
    { label: "Attendance", items: attendance },
    { label: "System", items: [["settings", "Settings"], ["scroll-text", "Audit log"]] },
  ];
}

function renderNav() {
  const groups = navGroups().map(function (g) {
    const items = g.items.map(function (i) {
      const cur = (window.MOCK_ACTIVE || "Employees") === i[1] ? ' aria-current="page"' : "";
      return `<a href="#" class="sb-item"${cur}><i data-lucide="${i[0]}"></i><span>${i[1]}</span>${i[2] || ""}</a>`;
    }).join("");
    return `<div class="sb-group"><div class="sb-group-label">${g.label}</div>${items}</div>`;
  }).join("");
  return `<nav class="sb-nav" aria-label="Main">${groups}</nav>`;
}

function renderSidebar() {
  return `<div class="sb-brand">${window.upasthitiLogo(34)}<div><div class="sb-brand-name">Upasthiti</div><div class="sb-brand-sub">Sheet Shapers · Admin</div></div></div>
  ${renderNav()}
  <div class="sb-footer"><i data-lucide="circle-check" style="width:16px;height:16px;color:var(--success)"></i><span>Server online</span></div>`;
}

function renderTopbar(user) {
  const n = shellOpts().offline || 0;
  const badge = n ? `<a class="off-badge" href="#" aria-label="${n} attendance device${n > 1 ? "s" : ""} offline. Open the list of offline devices.">${ic("triangle-alert")}<span class="ob-long">${n} attendance device${n > 1 ? "s" : ""} offline</span><span class="ob-short">${n} offline</span></a>` : "";
  return `<button class="menu-btn" aria-label="Open menu"><i data-lucide="menu"></i></button>
  <span class="topbar-brand">${window.upasthitiLogo(30)}<span>Upasthiti</span></span>
  <button class="search-trigger" aria-label="Search (Ctrl+K)"><i data-lucide="search"></i><span>Search employees, plants, pages…</span><span class="kbd-group"><span class="kbd">Ctrl</span><span class="kbd">K</span></span></button>
  <button class="btn btn-outline plant-filter" aria-label="Plant filter: ${user.plant || "All plants"}"><i data-lucide="factory" style="color:var(--muted-foreground)"></i><span>${user.plant || "All plants"}</span><i data-lucide="chevrons-up-down" style="color:var(--subtle-foreground)"></i></button>
  <div class="spacer"></div>${badge}
  <button class="user-trigger" aria-label="Account menu for ${user.name}"><span class="avatar" style="width:40px;height:40px">${window.initialsOf(user.name)}</span><span class="user-meta"><b>${user.name}</b><span>${user.role}</span></span><i data-lucide="chevron-down" style="width:16px;height:16px;color:var(--muted-foreground)"></i></button>`;
}

/* The amber offline alert (F-46): Super Admin and Plant Head only; "Hide" keeps it away on this browser until the device is back. */
function renderBanner(b) {
  const text = b.more
    ? `Attendance device <b>'${b.name}'</b> has been offline since <b>${b.since}</b> (${b.minutes} min), and ${b.more} more ${b.more > 1 ? "are" : "is"} offline. Check their power and internet.`
    : `Attendance device <b>'${b.name}'</b> has been offline since <b>${b.since}</b> (${b.minutes} min). Check its power and internet.`;
  return `<div class="offline-banner" role="alert">${ic("wifi-off")}<div class="ob-text">${text}</div><div class="ob-acts"><a class="btn btn-outline" href="#">${ic("eye")}View</a><button class="btn btn-ghost">${ic("eye-off")}Hide</button></div></div>`;
}

window.mockStart = function (render) {
  document.addEventListener("DOMContentLoaded", function () {
    if (location.search.indexOf("shot") >= 0) document.body.classList.add("shot");
    const user = window.MOCK_USER;
    const o = shellOpts();
    const sb = document.getElementById("sidebar");
    const tb = document.getElementById("topbar");
    if (sb) sb.innerHTML = renderSidebar();
    if (tb && user) tb.innerHTML = renderTopbar(user);
    if (tb && o.banner) tb.insertAdjacentHTML("afterend", renderBanner(o.banner));
    if (o.menu) {
      const ov = document.createElement("div");
      ov.innerHTML = `<div class="overlay"></div><aside class="menu-sheet" role="dialog" aria-modal="true" aria-label="Menu"><button class="btn btn-ghost btn-icon menu-close" aria-label="Close menu">${ic("x")}</button><div class="sb-brand">${window.upasthitiLogo(34)}<div><div class="sb-brand-name">Upasthiti</div><div class="sb-brand-sub">Sheet Shapers · Admin</div></div></div>${renderNav()}</aside>`;
      document.body.appendChild(ov);
    }
    render(location.hash.replace("#", "") || "");
    const tag = document.getElementById("state-tag");
    if (tag && !tag.textContent) tag.textContent = "State: " + (location.hash.replace("#", "") || "default");
    if (window.lucide) window.lucide.createIcons();
  });
  window.addEventListener("hashchange", function () { location.reload(); });
};
