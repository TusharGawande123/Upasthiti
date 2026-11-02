/*
  Upasthiti - M5 design gate C mockup (from m4/gate-c/shell.js): shared helpers - logo, admin shell, bell, small widgets.
  MOCKUP ONLY, not app code. Each page sets window.MOCK_USER, window.MOCK_ACTIVE, optionally window.MOCK_SHELL, and calls window.mockStart(renderFn).
  window.MOCK_SHELL = { offline: n, bell: n (unread count), bellPanel: html | null (open dropdown), menu: bool (phone menu open) }.
  The state of a page is the URL hash, e.g. 01-leave.html#add-dialog. Add ?shot to hide the state tag.
  Words for people: "attendance device", never "kiosk". Today in the mockups is Saturday 31/10/2026.
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

function shellOpts() { return window.MOCK_SHELL || {}; }

function navGroups() {
  const o = shellOpts();
  const sa = ((window.MOCK_USER && window.MOCK_USER.role) || "") === "Super Admin";
  const dev = o.offline ? `<span class="sb-count sb-warn" aria-label="${o.offline} attendance device offline">${ic("triangle-alert")}${o.offline}</span>` : "";
  const bellCount = o.bell ? `<span class="sb-count" aria-label="${o.bell} unread">${o.bell}</span>` : "";
  const attendance = [["calendar-check", "Attendance"], ["file-pen", "Corrections"], ["list-checks", "Punch log"]];
  if (sa) attendance.push(["flag", "Needs review"]);
  attendance.push(["plane", "Leave"], ["calendar-days", "Holidays"]);
  return [
    { label: "Overview", items: [["layout-dashboard", "Dashboard"], ["inbox", "Approvals"]] },
    { label: "Organisation", items: [["factory", "Plants"], ["tablet-smartphone", "Attendance devices", dev]] },
    { label: "People", items: [["users", "Employees"], ["hard-hat", "Contractors"], ["qr-code", "QR cards"]] },
    { label: "Attendance", items: attendance },
    { label: "Insights", items: [["timer", "Punctuality"], ["file-spreadsheet", "Reports"], ["bell", "Notifications", bellCount]] },
    { label: "System", items: [["settings", "Settings"], ["scroll-text", "Audit log"]] },
  ];
}

function renderNav() {
  const groups = navGroups().map(function (g) {
    const items = g.items.map(function (i) {
      const cur = (window.MOCK_ACTIVE || "") === i[1] ? ' aria-current="page"' : "";
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

function renderBell() {
  const o = shellOpts();
  const n = o.bell || 0;
  const open = !!o.bellPanel;
  return `<span class="bell-wrap"><button class="bell-btn" aria-label="Notifications${n ? ", " + n + " unread" : ", none unread"}" aria-expanded="${open}"${open ? ' data-open="1"' : ""}>${ic("bell")}${n ? `<span class="bell-count" aria-hidden="true">${n > 9 ? "9+" : n}</span>` : ""}</button>${open ? o.bellPanel : ""}</span>`;
}

function renderTopbar(user) {
  const n = shellOpts().offline || 0;
  const badge = n ? `<a class="off-badge" href="#" aria-label="${n} attendance device offline. Open the list of offline devices.">${ic("triangle-alert")}<span class="ob-long">${n} attendance device offline</span><span class="ob-short">${n} offline</span></a>` : "";
  return `<button class="menu-btn" aria-label="Open menu"><i data-lucide="menu"></i></button>
  <span class="topbar-brand">${window.upasthitiLogo(30)}<span>Upasthiti</span></span>
  <button class="search-trigger" aria-label="Search (Ctrl+K)"><i data-lucide="search"></i><span>Search employees, plants, pages…</span><span class="kbd-group"><span class="kbd">Ctrl</span><span class="kbd">K</span></span></button>
  <button class="btn btn-outline plant-filter" aria-label="Plant filter: ${user.plant || "All plants"}"><i data-lucide="factory" style="color:var(--muted-foreground)"></i><span>${user.plant || "All plants"}</span><i data-lucide="chevrons-up-down" style="color:var(--subtle-foreground)"></i></button>
  <div class="spacer"></div>${badge}${renderBell()}
  <button class="user-trigger" aria-label="Account menu for ${user.name}"><span class="avatar" style="width:40px;height:40px">${window.initialsOf(user.name)}</span><span class="user-meta"><b>${user.name}</b><span>${user.role}</span></span><i data-lucide="chevron-down" style="width:16px;height:16px;color:var(--muted-foreground)"></i></button>`;
}

/* ---------- Small widgets shared by the M5 pages ---------- */
window.USERS = {
  sa: { name: "Asha Rao", role: "Super Admin" },
  ch: { name: "Meera Joshi", role: "Corporate Head" },
  ph: { name: "Prakash Kale", role: "Plant Head · K134", plant: "K134" },
};

window.dialog = function (o) {
  /* o: icon, tone (primary|warning|danger), title, desc, body, foot, wide */
  const tone = { primary: ["var(--primary-soft)", "var(--primary)"], warning: ["var(--warning-soft)", "var(--warning)"], danger: ["var(--danger-soft)", "var(--danger)"] }[o.tone || "primary"];
  return `<div class="overlay"></div><div class="dialog anim-scale-in ${o.wide ? "dialog-wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="dlg-t">
    <div class="dlg-head"><span class="dlg-icon" style="background:${tone[0]};color:${tone[1]}">${ic(o.icon)}</span><div style="flex:1;min-width:0"><h2 class="dlg-title" id="dlg-t">${o.title}</h2>${o.desc ? `<p class="dlg-desc">${o.desc}</p>` : ""}</div><button class="btn btn-ghost btn-icon dlg-x" aria-label="Close">${ic("x")}</button></div>
    <div class="dlg-body">${o.body}</div><div class="dlg-foot">${o.foot}</div></div>`;
};

window.sel = function (id, label, value, active) {
  return `<div class="sel ${active ? "is-active" : ""}"><select id="${id}" aria-label="${label}"><option>${value}</option></select>${ic("chevron-down")}</div>`;
};

window.field = function (id, label, value, o) {
  o = o || {};
  const inv = o.err ? ` aria-invalid="true" aria-describedby="${id}-e"` : "";
  return `<div class="fld ${o.cls || ""}"><label class="label" for="${id}">${label}${o.opt ? ` <span class="opt">(optional)</span>` : ""}</label>
    <div class="inrow2"><input class="input" id="${id}" value="${value}" ${o.ro ? "readonly" : ""} ${o.mode ? `inputmode="${o.mode}"` : ""} ${o.ph ? `placeholder="${o.ph}"` : ""}${inv} />${o.unit ? `<span class="unit">${o.unit}</span>` : ""}</div>
    ${o.err ? `<p class="errline" id="${id}-e">${ic("circle-alert")}${o.err}</p>` : ""}${o.help ? `<p class="help">${o.help}</p>` : ""}</div>`;
};

window.spinner = function () { return `<span class="spinner" aria-hidden="true"></span>`; };

window.mockStart = function (render) {
  document.addEventListener("DOMContentLoaded", function () {
    if (location.search.indexOf("shot") >= 0) document.body.classList.add("shot");
    const user = window.MOCK_USER;
    const o = shellOpts();
    const sb = document.getElementById("sidebar");
    const tb = document.getElementById("topbar");
    render(location.hash.replace("#", "") || "");
    if (sb) sb.innerHTML = renderSidebar();
    if (tb && user) tb.innerHTML = renderTopbar(user);
    if (o.menu) {
      const ov = document.createElement("div");
      ov.innerHTML = `<div class="overlay"></div><aside class="menu-sheet" role="dialog" aria-modal="true" aria-label="Menu"><button class="btn btn-ghost btn-icon menu-close" aria-label="Close menu">${ic("x")}</button><div class="sb-brand">${window.upasthitiLogo(34)}<div><div class="sb-brand-name">Upasthiti</div><div class="sb-brand-sub">Sheet Shapers · Admin</div></div></div>${renderNav()}</aside>`;
      document.body.appendChild(ov);
    }
    const tag = document.getElementById("state-tag");
    if (tag && !tag.textContent) tag.textContent = "State: " + (location.hash.replace("#", "") || "default");
    if (window.lucide) window.lucide.createIcons();
    const sc = document.querySelector("[data-scroll-end]");
    if (sc) { const t = sc.closest(".dlg-body") || sc; t.scrollTop = t.scrollHeight; }
    const hs = document.querySelector("[data-scroll-helper]");
    if (hs) { const bd = hs.closest(".dlg-body"); bd.scrollTop = hs.getBoundingClientRect().top - bd.getBoundingClientRect().top + bd.scrollTop - 8; }
    document.documentElement.setAttribute("data-ready", "1");
  });
  window.addEventListener("hashchange", function () { location.reload(); });
};
