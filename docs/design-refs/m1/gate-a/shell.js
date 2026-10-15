/*
  Upasthiti – M1 gate A mockup: draws the shared admin shell (sidebar + top bar)
  so every screen file stays short. MOCKUP ONLY, not app code.
  Usage: <body data-active="users" data-title="Users"> with #sidebar and #topbar.
*/

// The logo mark: a rounded steel-blue tile with a "gate + tick" glyph and a signal-yellow dot.
window.upasthitiLogo = function (size) {
  const s = size || 34;
  return `
  <svg width="${s}" height="${s}" viewBox="0 0 40 40" role="img" aria-label="Upasthiti logo">
    <defs>
      <linearGradient id="lg-${s}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#2a4bb8"/><stop offset="1" stop-color="#162a6e"/>
      </linearGradient>
    </defs>
    <rect width="40" height="40" rx="11" fill="url(#lg-${s})"/>
    <path d="M11 29V16a9 9 0 0 1 18 0v13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".35"/>
    <path d="M14.5 21.5l4 4 7.5-8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="31" cy="9" r="3.6" fill="#f5b700" stroke="#162a6e" stroke-width="1.2"/>
  </svg>`;
};

const NAV_GROUPS = [
  { label: "Overview", items: [
    { id: "dashboard", icon: "layout-dashboard", text: "Dashboard" },
    { id: "setup", icon: "list-checks", text: "Setup wizard", progress: "3 of 5" },
    { id: "approvals", icon: "inbox", text: "Approvals", count: 3, countLabel: "3 waiting" },
  ]},
  { label: "Organisation", items: [
    { id: "plants", icon: "factory", text: "Plants" },
    { id: "kiosks", icon: "tablet-smartphone", text: "Kiosks" },
  ]},
  { label: "People", items: [
    { id: "employees", icon: "users", text: "Employees" },
    { id: "contractors", icon: "hard-hat", text: "Contractors" },
    { id: "users", icon: "user-cog", text: "Users" },
  ]},
  { label: "System", items: [
    { id: "settings", icon: "settings", text: "Settings" },
    { id: "audit", icon: "scroll-text", text: "Audit log" },
  ]},
];

function renderSidebar(active) {
  const groups = NAV_GROUPS.map(function (group) {
    const items = group.items.map(function (item) {
      const current = item.id === active ? ' aria-current="page"' : "";
      const count = item.count ? `<span class="sb-count tnum" aria-label="${item.countLabel}">${item.count}</span>` : "";
      const progress = item.progress ? `<span class="sb-progress tnum">${item.progress}</span>` : "";
      return `<a href="#" class="sb-item"${current} title="${item.text}"><i data-lucide="${item.icon}"></i><span class="sb-label">${item.text}</span>${count}${progress}</a>`;
    }).join("");
    return `<div class="sb-group"><div class="sb-group-label">${group.label}</div>${items}</div>`;
  }).join("");

  return `
    <div class="sb-brand">${window.upasthitiLogo(34)}
      <div class="sb-brand-text"><div class="sb-brand-name">Upasthiti</div><div class="sb-brand-sub">Sheet Shapers · Admin</div></div>
    </div>
    <nav class="sb-nav" aria-label="Main">${groups}</nav>
    <div class="sb-footer"><i data-lucide="circle-check" style="width:16px;height:16px;color:var(--success)"></i><span class="sb-footer-text">Server online · v0.1 (M1)</span></div>`;
}

function renderTopbar() {
  return `
    <button class="search-trigger" aria-label="Search (Ctrl+K)">
      <i data-lucide="search"></i><span class="search-text">Search employees, plants, pages…</span>
      <span class="kbd-group"><span class="kbd">Ctrl</span><span class="kbd">K</span></span>
    </button>
    <button class="btn btn-outline plant-filter" aria-label="Plant filter: All plants">
      <i data-lucide="factory" style="width:18px;height:18px;color:var(--muted-foreground)"></i>
      <span>All plants</span><i data-lucide="chevrons-up-down" style="width:16px;height:16px;color:var(--subtle-foreground)"></i>
    </button>
    <div class="topbar-spacer"></div>
    <button class="user-trigger" aria-haspopup="menu" aria-label="Account menu for Asha Rao">
      <span class="avatar" style="width:36px;height:36px">AR</span>
      <span class="user-meta"><b>Asha Rao</b><span>Super Admin</span></span>
      <i data-lucide="chevron-down" style="width:16px;height:16px;color:var(--muted-foreground)"></i>
    </button>`;
}

function renderUserMenu() {
  return `
  <div class="menu anim-fade-up" role="menu" aria-label="Account">
    <div style="padding:10px 10px 8px;display:flex;gap:10px;align-items:center">
      <span class="avatar" style="width:40px;height:40px">AR</span>
      <div style="line-height:1.3"><div style="font-weight:600">Asha Rao</div><div class="code" style="font-size:12.5px;color:var(--muted-foreground)">asha.rao@sheetshapers.example</div>
      <span class="badge badge-info" style="margin-top:6px;height:22px"><i data-lucide="shield-check"></i>Super Admin</span></div>
    </div>
    <div class="menu-sep"></div>
    <a class="menu-item" role="menuitem" href="06-sessions.html"><i data-lucide="monitor-smartphone"></i>My sessions<span class="badge badge-neutral tnum" style="margin-left:auto;height:22px">3</span></a>
    <a class="menu-item" role="menuitem" href="#"><i data-lucide="key-round"></i>Change password</a>
    <a class="menu-item" role="menuitem" href="#" aria-disabled="true" style="color:var(--muted-foreground)"><i data-lucide="languages"></i>Language: English<span style="margin-left:auto;font-size:12px">More later</span></a>
    <div class="menu-sep"></div>
    <a class="menu-item" role="menuitem" href="#"><i data-lucide="log-out"></i>Log out</a>
  </div>`;
}

document.addEventListener("DOMContentLoaded", function () {
  const active = document.body.dataset.active;
  const sidebar = document.getElementById("sidebar");
  const topbar = document.getElementById("topbar");
  if (sidebar) sidebar.innerHTML = renderSidebar(active);
  if (topbar) topbar.innerHTML = renderTopbar();
  if (location.hash === "#menu" && topbar) topbar.insertAdjacentHTML("beforeend", renderUserMenu());
  document.querySelectorAll("[data-logo]").forEach(function (el) { el.innerHTML = window.upasthitiLogo(Number(el.dataset.logo)); });
  if (window.onMockState) window.onMockState(location.hash.replace("#", ""));
  if (window.lucide) window.lucide.createIcons();
});
