/*
  Upasthiti - M4 design gate B mockup (copied from gate B): shared helpers (logo, admin shell, avatar initials, pose pictures).
  MOCKUP ONLY, not app code. Each page sets window.MOCK_USER and calls window.mockStart(renderFn).
  The state of a page is the URL hash, e.g. 01-face-panel.html#enrolled. Add ?shot to hide the state tag.
*/

window.upasthitiLogo = function (size) {
  const s = size || 34;
  return `<svg width="${s}" height="${s}" viewBox="0 0 40 40" role="img" aria-label="Upasthiti logo"><defs><linearGradient id="lg-${s}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a4bb8"/><stop offset="1" stop-color="#162a6e"/></linearGradient></defs><rect width="40" height="40" rx="11" fill="url(#lg-${s})"/><path d="M11 29V16a9 9 0 0 1 18 0v13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".35"/><path d="M14.5 21.5l4 4 7.5-8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="31" cy="9" r="3.6" fill="#f5b700" stroke="#162a6e" stroke-width="1.2"/></svg>`;
};

const NAV_GROUPS = [
  { label: "Overview", items: [["layout-dashboard", "Dashboard"], ["inbox", "Approvals", 3]] },
  { label: "Organisation", items: [["factory", "Plants"], ["tablet-smartphone", "Attendance devices"]] },
  { label: "People", items: [["users", "Employees"], ["hard-hat", "Contractors"], ["qr-code", "QR cards"]] },
  { label: "Attendance", items: [["list-checks", "Punch log"], ["flag", "Needs review", 7]] },
  { label: "System", items: [["settings", "Settings"], ["scroll-text", "Audit log"]] },
];

window.initialsOf = function (name) {
  return name.split(/\s+/).map(function (p) { return p[0]; }).join("").slice(0, 2).toUpperCase();
};

function renderSidebar() {
  const groups = NAV_GROUPS.map(function (g) {
    const items = g.items.map(function (i) {
      const cur = (window.MOCK_ACTIVE || "Employees") === i[1] ? ' aria-current="page"' : "";
      const count = i[2] ? `<span class="sb-count ${i[1] === 'Needs review' ? 'sb-count-warn' : ''}" aria-label="${i[2]} ${i[1] === 'Needs review' ? 'to check' : 'waiting'}">${i[2]}</span>` : "";
      return `<a href="#" class="sb-item"${cur}><i data-lucide="${i[0]}"></i><span>${i[1]}</span>${count}</a>`;
    }).join("");
    return `<div class="sb-group"><div class="sb-group-label">${g.label}</div>${items}</div>`;
  }).join("");
  return `<div class="sb-brand">${window.upasthitiLogo(34)}<div><div class="sb-brand-name">Upasthiti</div><div class="sb-brand-sub">Sheet Shapers · Admin</div></div></div>
  <nav class="sb-nav" aria-label="Main">${groups}</nav>
  <div class="sb-footer"><i data-lucide="circle-check" style="width:16px;height:16px;color:var(--success)"></i><span>Server online</span></div>`;
}

function renderTopbar(user) {
  return `<button class="menu-btn" aria-label="Open menu"><i data-lucide="menu"></i></button>
  <span class="topbar-brand">${window.upasthitiLogo(30)}<span>Upasthiti</span></span>
  <button class="search-trigger" aria-label="Search (Ctrl+K)"><i data-lucide="search"></i><span>Search employees, plants, pages…</span><span class="kbd-group"><span class="kbd">Ctrl</span><span class="kbd">K</span></span></button>
  <button class="btn btn-outline plant-filter" aria-label="Plant filter: All plants"><i data-lucide="factory" style="color:var(--muted-foreground)"></i><span>${user.plant || "All plants"}</span><i data-lucide="chevrons-up-down" style="color:var(--subtle-foreground)"></i></button>
  <div class="spacer"></div>
  <button class="user-trigger" aria-label="Account menu for ${user.name}"><span class="avatar" style="width:40px;height:40px">${window.initialsOf(user.name)}</span><span class="user-meta"><b>${user.name}</b><span>${user.role}</span></span><i data-lucide="chevron-down" style="width:16px;height:16px;color:var(--muted-foreground)"></i></button>`;
}

/* Pose pictures: a simple head-and-shoulders figure, drawn as the employee sees themselves in the mirrored preview. */
window.poseSvg = function (pose) {
  const P = {
    straight: { dx: 0, dy: 0, s: 1 },
    left: { dx: -9, dy: 0, s: 1, arrow: "left" },
    right: { dx: 9, dy: 0, s: 1, arrow: "right" },
    up: { dx: 0, dy: -4, s: 1, arrow: "up", eyeUp: true },
    down: { dx: 0, dy: 5, s: 1, arrow: "down", eyeDown: true },
    closer: { dx: 0, dy: 0, s: 1.14, arrow: "closer" },
    farther: { dx: 0, dy: 3, s: 0.84, arrow: "farther" },
    gate: { dx: 0, dy: 0, s: 1, helmet: true, glasses: true },
  }[pose];
  const cx = 48 + P.dx, cy = 42 + P.dy, rx = 16 * P.s, ry = 20 * P.s;
  const ey = cy - 4 * P.s + (P.eyeUp ? -2 : 0) + (P.eyeDown ? 2 : 0);
  const ex = 6.5 * P.s, nx = cx + P.dx * 0.5;
  const ink = "#1a3282";
  let g = `<svg viewBox="0 0 96 96" role="img" aria-hidden="true">`;
  g += `<path d="M12 96 C12 76 28 70 48 70 C68 70 84 76 84 96 Z" fill="#b9c6ef"/>`;
  g += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff" stroke="${ink}" stroke-width="2.4"/>`;
  g += `<circle cx="${cx - ex + P.dx * 0.4}" cy="${ey}" r="2" fill="${ink}"/><circle cx="${cx + ex + P.dx * 0.4}" cy="${ey}" r="2" fill="${ink}"/>`;
  g += `<path d="M${nx} ${ey + 3} l-2 7 h4" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  g += `<path d="M${cx - 6 * P.s + P.dx * 0.3} ${cy + 12 * P.s} q6 3.5 12 0" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`;
  if (P.glasses) g += `<circle cx="${cx - ex}" cy="${ey}" r="5" fill="none" stroke="${ink}" stroke-width="1.6"/><circle cx="${cx + ex}" cy="${ey}" r="5" fill="none" stroke="${ink}" stroke-width="1.6"/><path d="M${cx - 1.5} ${ey}h3" stroke="${ink}" stroke-width="1.6"/>`;
  if (P.helmet) g += `<path d="M${cx - rx - 3} ${cy - 6} A${rx + 3} ${ry + 1} 0 0 1 ${cx + rx + 3} ${cy - 6} Z" fill="#f5b700" stroke="${ink}" stroke-width="2.2"/><path d="M${cx - rx - 5} ${cy - 6} h${2 * rx + 10}" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/>`;
  const A = `fill="none" stroke="#1f3a93" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"`;
  if (P.arrow === "left") g += `<path d="M20 14 H6 M12 8 L6 14 L12 20" ${A}/>`;
  if (P.arrow === "right") g += `<path d="M76 14 H90 M84 8 L90 14 L84 20" ${A}/>`;
  if (P.arrow === "up") g += `<path d="M80 30 V10 M73 17 L80 10 L87 17" ${A}/>`;
  if (P.arrow === "down") g += `<path d="M80 10 V30 M73 23 L80 30 L87 23" ${A}/>`;
  if (P.arrow === "closer") g += `<path d="M8 8 L18 18 M8 16 V8 H16 M88 8 L78 18 M80 8 H88 V16" ${A}/>`;
  if (P.arrow === "farther") g += `<path d="M18 18 L8 8 M10 16 H18 V8 M78 18 L88 8 M86 16 H78 V8" ${A}/>`;
  return g + `</svg>`;
};

window.POSES = [
  ["straight", "Look straight at the camera"],
  ["left", "Turn your head slightly to your left"],
  ["right", "Turn your head slightly to your right"],
  ["up", "Lift your chin slightly"],
  ["down", "Lower your chin slightly"],
];

/* The shell is drawn only when the page has #sidebar / #topbar. */
window.mockStart = function (render) {
  document.addEventListener("DOMContentLoaded", function () {
    if (location.search.indexOf("shot") >= 0) document.body.classList.add("shot");
    const user = window.MOCK_USER;
    const sb = document.getElementById("sidebar");
    const tb = document.getElementById("topbar");
    if (sb) sb.innerHTML = renderSidebar();
    if (tb && user) tb.innerHTML = renderTopbar(user);
    render(location.hash.replace("#", "") || "");
    const tag = document.getElementById("state-tag");
    if (tag && !tag.textContent) tag.textContent = "State: " + (location.hash.replace("#", "") || "default");
    if (window.lucide) window.lucide.createIcons();
  });
  window.addEventListener("hashchange", function () { location.reload(); });
};
