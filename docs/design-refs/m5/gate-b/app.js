/*
  Upasthiti - M5 design gate B mockup: draws every screen from fake data.
  MOCKUP ONLY (docs/design-refs), not app code. Open index.html?s=<screen>[&shot]
  Screens: list, list-today, list-loading, list-empty, list-error, register, employee, swap,
           drawer-sa, drawer-head, corrections, corrections-decided, corrections-mine, approvals,
           dialog, dialog-warn, wizard, wizard-done
*/
const $ = (id) => document.getElementById(id);
const P = new URLSearchParams(location.search);
const SCREEN = P.get("s") || "list";
const ic = (n, s) => `<i data-lucide="${n}"${s ? ` style="width:${s}px;height:${s}px"` : ""}></i>`;

/* ---------- fake people (invented names and codes; no real person) ---------- */
const initials = (n) => n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const USERS = {
  sa: { name: "Asha Rao", role: "Super Admin", plant: "All plants" },
  head: { name: "Nilesh Bhosale", role: "Plant Head", plant: "K134" },
  corp: { name: "Ravi Menon", role: "Corporate Head", plant: "All plants" },
};

/* ---------- status table: icon + word + colour, register code ---------- */
const ST = {
  present:    { label: "Present",         code: "P",    cls: "present",    icon: "circle-check" },
  half:       { label: "Half-day",        code: "HD",   cls: "half",       icon: "contrast" },
  short:      { label: "Short hours",     code: "SH",   cls: "short",      icon: "hourglass" },
  absent:     { label: "Absent",          code: "A",    cls: "absent",     icon: "circle-x" },
  incomplete: { label: "Incomplete",      code: "INC",  cls: "incomplete", icon: "circle-help" },
  leave:      { label: "Leave",           code: "PL",   cls: "leave",      icon: "calendar-heart" },
  weekoff:    { label: "Weekly off",      code: "WO",   cls: "weekoff",    icon: "moon" },
  holiday:    { label: "Holiday",         code: "H",    cls: "holiday",    icon: "sun" },
  wow:        { label: "Worked on off day", code: "WO-W", cls: "wow",      icon: "briefcase" },
  progress:   { label: "In progress",     code: "",     cls: "progress",   icon: "loader" },
};
const stChip = (k, lg, text) => `<span class="st st-${ST[k].cls}${lg ? " st-lg" : ""}">${ic(ST[k].icon)}${text || ST[k].label}</span>`;

const ROWS = [
  { code: "SS-1042", name: "Rohan Kulkarni", shift: "Office", plant: "K134", dept: "Assembly", st: "present", in: "08:52", out: "17:04", hrs: "8 h 12 m", ofs: "8 h of 8 h", marks: [] },
  { code: "SS-1187", name: "Meera Deshmukh", shift: "Office", plant: "K134", dept: "Stores", st: "half", in: "09:40", out: "17:00", hrs: "7 h 20 m", ofs: "7 h 20 m of 8 h", late: "40 m", marks: ["pencil"] },
  { code: "SS-1203", name: "Imran Shaikh", shift: "Office", plant: "K134", dept: "Press shop", st: "short", in: "09:10", out: "12:40", hrs: "3 h 30 m", ofs: "3 h 30 m of 8 h", early: "4 h 20 m", marks: ["flag", "exc:1"] },
  { code: "SS-2208", name: "Sneha Patil", shift: "Office", plant: "K134", dept: "Quality", st: "absent", in: "", out: "", hrs: "", marks: ["clock"] },
  { code: "SS-1310", name: "Vikram Jadhav", shift: "Office", plant: "K134", dept: "Assembly", st: "incomplete", in: "09:05", out: "", hrs: "", marks: ["exc:1", "clock"] },
  { code: "SS-1355", name: "Anita More", shift: "Office", plant: "K134", dept: "Accounts", st: "leave", in: "", out: "", hrs: "", marks: [], note: "Paid leave" },
  { code: "T-5521", name: "Pradeep Gaikwad", shift: "Day", plant: "K134", dept: "Press shop", st: "present", in: "07:02", out: "21:22", hrs: "14 h 20 m", ot: "2 h 22 m", type: "Temporary", marks: ["note"], contractor: "Shree Manpower" },
  { code: "SS-1418", name: "Dinesh Thakur", shift: "Office", plant: "K134", dept: "Maintenance", st: "present", in: "08:58", out: "17:10", hrs: "8 h 12 m", ofs: "8 h of 8 h", marks: ["flag", "note"] },
  { code: "T-5530", name: "Kiran Pawar", shift: "Day", plant: "K140", dept: "Dispatch", st: "wow", in: "07:20", out: "16:00", hrs: "8 h 40 m", type: "Temporary", marks: [], note: "Plant off day" },
  { code: "SS-1502", name: "Farah Khan", shift: "Office", plant: "K140", dept: "Stores", st: "weekoff", in: "", out: "", hrs: "", marks: [], note: "Thursday off at K140" },
];
const TODAY_ROWS = [
  { code: "SS-1042", name: "Rohan Kulkarni", shift: "Office", plant: "K134", st: "progress", prog: "Inside since 08:52", in: "08:52", out: "", marks: [] },
  { code: "SS-1187", name: "Meera Deshmukh", shift: "Office", plant: "K134", st: "progress", prog: "Inside since 09:12", in: "09:12", out: "", marks: [] },
  { code: "SS-1203", name: "Imran Shaikh", shift: "Office", plant: "K134", st: "progress", prog: "Inside since 09:44", in: "09:44", out: "", marks: ["flag"], late: "44 m" },
  { code: "SS-2208", name: "Sneha Patil", shift: "Office", plant: "K134", st: "progress", prog: "Not arrived yet", in: "", out: "", marks: [] },
  { code: "SS-1310", name: "Vikram Jadhav", shift: "Office", plant: "K134", st: "progress", prog: "Left at 11:20", in: "08:41", out: "11:20", marks: ["clock"], early: "5 h 40 m" },
  { code: "SS-1355", name: "Anita More", shift: "Office", plant: "K134", st: "leave", in: "", out: "", marks: [], note: "Paid leave" },
  { code: "T-5521", name: "Pradeep Gaikwad", shift: "Day", plant: "K134", st: "progress", prog: "Inside since 07:02", in: "07:02", out: "", marks: [], type: "Temporary" },
  { code: "SS-1418", name: "Dinesh Thakur", shift: "Office", plant: "K134", st: "progress", prog: "Inside since 08:58", in: "08:58", out: "", marks: [] },
];

/* ---------- shell ---------- */
const logo = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 40 40" role="img" aria-label="Upasthiti logo"><defs><linearGradient id="lg${s}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a4bb8"/><stop offset="1" stop-color="#162a6e"/></linearGradient></defs><rect width="40" height="40" rx="11" fill="url(#lg${s})"/><path d="M11 29V16a9 9 0 0 1 18 0v13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".35"/><path d="M14.5 21.5l4 4 7.5-8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="31" cy="9" r="3.6" fill="#f5b700" stroke="#162a6e" stroke-width="1.2"/></svg>`;
const NAV = [
  ["Overview", [["layout-dashboard", "Dashboard"], ["inbox", "Approvals", 3]]],
  ["Organisation", [["factory", "Plants"], ["tablet-smartphone", "Attendance devices"]]],
  ["People", [["users", "Employees"], ["hard-hat", "Contractors"], ["qr-code", "QR cards"]]],
  ["Attendance", [["calendar-check", "Attendance"], ["table-2", "Monthly register"], ["file-pen-line", "Corrections", 4], ["list-checks", "Punch log"], ["flag", "Needs review", 7]]],
  ["System", [["settings", "Settings"], ["scroll-text", "Audit log"]]],
];
function sidebar(active) {
  const g = NAV.map(([l, items]) => `<div class="sb-group"><div class="sb-group-label">${l}</div>${items.map(([i, t, c]) => `<a href="#" class="sb-item"${t === active ? ' aria-current="page"' : ""}>${ic(i)}<span>${t}</span>${c ? `<span class="sb-count ${t === "Needs review" ? "sb-count-warn" : ""}">${c}</span>` : ""}</a>`).join("")}</div>`).join("");
  return `<div class="sb-brand">${logo(34)}<div><div class="sb-brand-name">Upasthiti</div><div class="sb-brand-sub">Sheet Shapers · Admin</div></div></div><nav class="sb-nav" aria-label="Main">${g}</nav><div class="sb-footer">${ic("circle-check", 16)}<span>Server online</span></div>`;
}
function topbar(u) {
  return `<button class="menu-btn" aria-label="Open menu">${ic("menu")}</button><span class="topbar-brand">${logo(30)}<span>Upasthiti</span></span>
  <button class="search-trigger" aria-label="Search">${ic("search")}<span>Search employees, plants, pages…</span><span class="kbd-group"><span class="kbd">Ctrl</span><span class="kbd">K</span></span></button>
  <button class="btn btn-outline plant-filter">${ic("factory")}<span>${u.plant}</span></button><div class="spacer"></div>
  <button class="user-trigger" aria-label="Account menu"><span class="avatar" style="width:40px;height:40px">${initials(u.name)}</span><span class="user-meta"><b>${u.name}</b><span>${u.role}</span></span></button>`;
}

/* ---------- small helpers ---------- */
const dash = '<span class="dash" aria-label="none">–</span>';
const mk = {
  pencil: `<span class="mk" title="Corrected" aria-label="Corrected">${ic("pencil")}</span>`,
  clock: `<span class="mk mk-pend" title="Correction pending" aria-label="Correction pending">${ic("clock-3")}</span>`,
  flag: `<span class="mk mk-flag" title="Flagged punch, not checked yet" aria-label="Flagged punch, not checked yet">${ic("flag")}</span>`,
  note: `<span class="mk" title="Extra punches" aria-label="Extra punches">${ic("sticky-note")}</span>`,
};
const marksHtml = (m) => m.length ? `<span class="marks">${m.map((x) => x.startsWith("exc:") ? `<span class="mk mk-exc" title="${x.slice(4)} exception" aria-label="${x.slice(4)} exception">${ic("triangle-alert")}${x.slice(4)}</span>` : mk[x]).join("")}</span>` : dash;
const sel = (label, val) => `<div class="fld"><label class="label">${label}</label><div class="sel"><div class="input" style="display:flex;align-items:center">${val}</div>${ic("chevron-down")}</div></div>`;

/* ---------- 1. attendance list ---------- */
function filters(today) {
  return `<section class="card filters" aria-label="Filters">
  <div class="f-row">
    <div class="fld"><label class="label">Date</label><div class="datebox"><button class="btn btn-outline" aria-label="Previous day">${ic("chevron-left")}</button><div class="input" style="display:flex;align-items:center;justify-content:center">${today ? "31/10/2026" : "29/10/2026"}</div><button class="btn btn-outline" aria-label="Next day">${ic("chevron-right")}</button></div></div>
    ${sel("Plant", "All plants")}${sel("Status", "Any status")}
    <div class="fld"><label class="label">Code or name</label><div class="searchbox">${ic("search")}<div class="input" style="display:flex;align-items:center;color:var(--subtle-foreground)">Search</div></div></div>
  </div>
  <div class="f-row f-more">${sel("Type", "All")}${sel("Department", "All")}${sel("Category", "All")}${sel("Contractor", "All")}${sel("Shift", "All shifts")}</div>
  <div class="chips-row"><button class="fchip" aria-pressed="false">${ic("triangle-alert")}Has exceptions<span class="n">14</span></button><button class="fchip" aria-pressed="false">${ic("pencil")}Corrected<span class="n">3</span></button><button class="btn btn-ghost more" style="margin-left:auto">${ic("rotate-ccw")}Clear filters</button></div></section>`;
}
function listRowsTable(rows, today) {
  const body = rows.map((r) => `<tr>
    <td class="emp"><b>${r.name}</b><span class="cd">${r.code}</span><span class="sub">${r.shift} · ${r.plant}${r.type ? " · " + r.type : ""}</span></td>
    <td>${stChip(r.st)}${r.prog ? `<span class="sub">${r.prog}</span>` : r.note ? `<span class="sub">${r.note}</span>` : ""}</td>
    <td class="num">${r.in || dash}</td><td class="num">${r.out || dash}</td>
    <td class="num">${r.hrs ? `<b>${r.hrs}</b>${r.ofs ? `<span class="sub">${r.ofs}</span>` : ""}` : dash}</td>
    <td class="num">${r.late ? `<span class="late">${r.late}</span>` : dash}</td>
    <td class="num">${r.early ? `<span class="early">${r.early}</span>` : dash}</td>
    <td class="num">${r.ot ? `<span class="ot">${r.ot}</span>` : dash}</td>
    <td>${marksHtml(r.marks)}</td>
    <td style="text-align:right"><button class="btn btn-ghost btn-sm" style="min-height:44px" aria-label="Open the day of ${r.name}">Open day${ic("chevron-right")}</button></td></tr>`).join("");
  return `<div class="tscroll"><table class="at"><thead><tr><th>Employee</th><th>Status</th><th class="num">IN</th><th class="num">OUT</th><th class="num">Hours</th><th class="num">Late</th><th class="num">Early exit</th><th class="num">Overtime</th><th>Marks</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>${body}</tbody></table></div>`;
}
function listCards(rows) {
  return `<div class="cards">${rows.map((r) => `<div class="acard"><div class="acard-top"><div><b>${r.name}</b><span class="cd">${r.code} · ${r.shift} · ${r.plant}</span></div>${stChip(r.st)}</div>
  ${r.prog || r.note ? `<div class="muted" style="margin-top:8px;font-size:13.5px">${r.prog || r.note}</div>` : ""}
  ${r.in || r.out ? `<div class="acard-times"><div><small>IN</small><b>${r.in || "–"}</b></div><div><small>OUT</small><b>${r.out || "–"}</b></div><div><small>Hours</small><b>${r.hrs || "–"}</b></div></div>` : ""}
  <div class="acard-flags">${r.late ? `<span class="pill pill-late">${ic("clock-alert")}Late ${r.late}</span>` : ""}${r.early ? `<span class="pill pill-early">${ic("log-out")}Early exit ${r.early}</span>` : ""}${r.ot ? `<span class="pill pill-ot">${ic("timer")}Overtime ${r.ot}</span>` : ""}${r.marks.length ? marksHtml(r.marks) : ""}</div>
  <button class="btn btn-outline">Open day${ic("chevron-right")}</button></div>`).join("")}</div>`;
}
function listPage(state) {
  const today = state === "today";
  const rows = today ? TODAY_ROWS : ROWS;
  let main;
  if (state === "loading") main = `<div class="tol">${ic("shield-check")}<span>Loading the shift rules…</span></div>` + Array.from({ length: 7 }, () => `<div class="skel-row"><div class="skeleton"></div><div class="skeleton tall" style="width:120px"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`).join("");
  else if (state === "empty") main = `<div class="state"><div class="big">${ic("calendar-search")}</div><h3>No attendance for these filters</h3><p>Nobody matches the date and filters you chose. Try another date, or clear the filters.</p><button class="btn btn-outline">${ic("rotate-ccw")}Clear filters</button></div>`;
  else if (state === "error") main = `<div class="state err"><div class="big">${ic("wifi-off")}</div><h3>The list could not be loaded</h3><p>Check your internet connection and try again. Nothing was changed. (Error code: NETWORK)</p><button class="btn btn-primary">${ic("refresh-cw")}Try again</button></div>`;
  else main = `<div class="tol">${ic("shield-check")}<span><b>Office 09:00–17:00:</b> On time until 09:30. Leave from 17:00.</span><span class="tag">${today ? "Updated 11:42 · refreshes every 30 s" : "Rules in force on 29/10/2026"}</span></div>${listRowsTable(rows, today)}${listCards(rows)}
  <div class="legend-marks"><b style="color:var(--foreground)">Marks</b><span>${mk.pencil}Corrected</span><span>${mk.clock}Correction pending</span><span>${mk.flag}Flagged punch, not checked</span><span>${mk.note}Extra punches</span></div>
  <div class="tfoot"><span>Showing 10 of 648 people</span><span class="nowrap"><button class="btn btn-outline btn-sm" style="min-height:44px">${ic("chevron-left")}Previous</button> <button class="btn btn-outline btn-sm" style="min-height:44px">Next${ic("chevron-right")}</button></span></div>`;
  return `<div class="crumbs">Attendance</div>
  <div class="page-head"><div><h1 class="page-title">Attendance</h1><p class="page-desc">${today ? "Today, Saturday 31/10/2026. Open days show who is inside now." : "One row for every person and day, worked out by the server from the punches."}</p></div>
  <div class="head-actions"><a class="btn btn-outline" href="#">${ic("table-2")}Monthly register</a><button class="btn btn-outline">${ic("download")}Download daily muster</button></div></div>
  <div class="banner" role="status"><span class="ic">${ic("hourglass", 22)}</span><div><b>12 days to decide</b><span>Short-hours days wait for a decision. Set each one to Present, Half-day or Absent.</span></div><button class="btn btn-primary">Show them${ic("arrow-right")}</button></div>
  ${filters(today)}
  <section class="card tcard" aria-label="Attendance list">${main}</section>`;
}

/* ---------- 2. monthly register ---------- */
function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const DAYS = 31;
const WD = ["Th", "F", "Sa", "Su", "M", "Tu", "W"]; // 1 Oct 2026 is a Thursday
const isSun = (d) => new Date(2026, 9, d).getDay() === 0;
const REG_PEOPLE = [
  ["SS-1042", "Rohan Kulkarni", "Permanent"], ["SS-1187", "Meera Deshmukh", "Permanent"], ["SS-1203", "Imran Shaikh", "Permanent"],
  ["SS-1310", "Vikram Jadhav", "Permanent"], ["SS-1355", "Anita More", "Permanent"], ["SS-1418", "Dinesh Thakur", "Permanent"],
  ["SS-1502", "Farah Khan", "Permanent"], ["SS-1561", "Sachin Pawar", "Permanent"], ["T-5521", "Pradeep Gaikwad", "Temporary"],
  ["T-5530", "Kiran Pawar", "Temporary"], ["T-5544", "Lata Wagh", "Temporary"], ["SS-1620", "Omkar Joshi", "Permanent"],
];
function monthData(seed, temp) {
  const r = rnd(seed), out = [];
  for (let d = 1; d <= DAYS; d++) {
    let c;
    if (d === 31) c = "none";
    else if (isSun(d)) c = r() < 0.07 && !temp ? "WO-W" : "WO";
    else if (d === 2 || d === 20) c = "H";
    else { const x = r(); c = x < 0.80 ? "P" : x < 0.86 ? "HD" : x < 0.89 ? "SH" : x < 0.93 ? "A" : x < 0.96 ? "PL" : x < 0.975 ? "INC" : "UL"; if (temp && (c === "HD" || c === "SH")) c = "P"; }
    out.push({ c, cor: c !== "WO" && c !== "H" && r() < 0.045 });
  }
  return out;
}
function totalsOf(arr, seed) {
  const n = (k) => arr.filter((x) => x.c === k).length, r = rnd(seed + 7);
  const present = n("P"), hd = n("HD"), sh = n("SH");
  const hrs = present * 8 + hd * 7 + sh * 3 + Math.round(r() * 8), ot = Math.round(r() * 12);
  return [present, hd, sh, n("A"), `${n("PL")}/${n("UL")}`, n("WO"), n("H"), n("WO-W") + n("H-W"), n("INC"), `${hrs} h`, `${ot} h`, Math.round(r() * 6)];
}
const TOT_HEAD = ["Present days", "Half-days", "Short-hours days", "Absent", "Leave paid / unpaid", "Weekly offs", "Holidays", "Worked on off days", "Incomplete", "Worked hours", "Overtime hours", "Late count"];
function registerPage() {
  const rows = REG_PEOPLE.map((p, i) => {
    const arr = monthData(11 + i * 13, p[2] === "Temporary"), t = totalsOf(arr, 11 + i * 13);
    return { p, arr, t };
  });
  const head = `<tr><th class="namecol">Employee</th>${Array.from({ length: DAYS }, (_, i) => `<th class="${isSun(i + 1) ? "sun" : ""}" style="min-width:36px">${i + 1}<small>${WD[i % 7]}</small></th>`).join("")}${TOT_HEAD.map((h, i) => `<th class="tot ${i === 0 ? "first" : ""} ${i >= 9 ? "wide" : ""}" title="${h}">${h}</th>`).join("")}</tr>`;
  const body = rows.map(({ p, arr, t }) => `<tr><th class="namecol" scope="row"><b>${p[1]}</b><span class="code">${p[0]} · ${p[2]}</span></th>${arr.map((x, i) => `<td class="d"><button class="cell c-${x.c}" aria-label="${p[1]}, ${i + 1} October: ${x.c === "none" ? "no result yet" : x.c}${x.cor ? ", corrected" : ""}">${x.c === "none" ? "–" : x.c}${x.cor ? '<span class="cor" title="Corrected"></span>' : ""}</button></td>`).join("")}${t.map((v, i) => `<td class="tot ${i === 0 ? "first" : ""} ${i >= 9 ? "wide" : ""}">${v}</td>`).join("")}</tr>`).join("");
  const legend = [["P", "Present", "P"], ["HD", "Half-day", "HD"], ["SH", "Short hours", "SH"], ["A", "Absent", "A"], ["INC", "Incomplete (OUT missing)", "INC"], ["PL", "Paid leave", "PL"], ["UL", "Unpaid leave", "UL"], ["WO", "Weekly off", "WO"], ["H", "Holiday", "H"], ["WO-W", "Worked on a weekly off", "WO-W"], ["H-W", "Worked on a holiday", "H-W"], ["–", "No result (future day or not employed)", "none"]].map(([c, t, k]) => `<li><span class="cell c-${k}">${c}</span>${t}</li>`).join("");
  // phone: one expanded employee with a month card
  const first = rows[1];
  const wd7 = ["M", "T", "W", "T", "F", "S", "S"].map((w) => `<div class="wd">${w}</div>`).join("");
  const cal = `<div class="mcal">${wd7}${Array.from({ length: 3 }, () => '<div class="blank"></div>').join("")}${first.arr.map((x, i) => `<div class="dayc c-${x.c}${i === 30 ? " today" : ""}">${x.cor ? '<span class="cor" title="Corrected"></span>' : ""}<i>${i + 1}</i><b>${x.c === "none" ? "–" : x.c}</b></div>`).join("")}</div>`;
  const tg = first.t.map((v, i) => `<div class="tt ${i === 11 ? "k-late" : ""}"><small>${TOT_HEAD[i]}</small><b>${v}</b></div>`).join("");
  const rl = rows.map((r, i) => `<div class="remp"><button class="remp-head" aria-expanded="${i === 1}"><span class="avatar">${initials(r.p[1])}</span><span><b>${r.p[1]}</b><small>${r.p[0]} · ${r.p[2]}</small></span><span class="mini"><span class="st st-present" style="height:24px;font-size:12px;padding:0 8px">P ${r.t[0]}</span></span>${ic(i === 1 ? "chevron-up" : "chevron-down")}</button>${i === 1 ? `<div class="remp-body">${cal}<div class="totals-grid">${tg}</div></div>` : ""}</div>`).join("");
  return `<div class="crumbs"><a href="#" class="link">Attendance</a> / Monthly register</div>
  <div class="page-head"><div><h1 class="page-title">Monthly register</h1><p class="page-desc">One cell for every person and day. Open a cell to see the day.</p></div><div class="head-actions"><button class="btn btn-outline">${ic("file-spreadsheet")}Excel</button><button class="btn btn-outline">${ic("file-text")}PDF</button></div></div>
  <section class="card rtoolbar"><div class="fld"><label class="label">Month</label><div class="monthpick"><button class="btn btn-outline" aria-label="Previous month">${ic("chevron-left")}</button><div class="input" style="display:flex;align-items:center;justify-content:center">October 2026</div><button class="btn btn-outline" aria-label="Next month">${ic("chevron-right")}</button></div></div>${sel("Plant", "K134 · Waluj Unit 4")}<div class="grow"></div>
  <span class="muted" style="font-size:13.5px;align-self:center">${ic("pencil", 14)} A black dot means the day was corrected.</span></section>
  <section class="card tcard"><div class="rscroll-wrap rwrap"><div class="rscroll"><table class="rg" aria-label="Attendance register, October 2026"><thead>${head}</thead><tbody>${body}</tbody></table></div><div class="fade-r"></div></div>
  <div class="rlist">${rl}</div>
  <div class="scrollhint rscroll-wrap">${ic("move-horizontal")}Scroll sideways inside this card to see all 31 days and the month totals. The name stays in place.</div>
  <div class="legend"><h3>Legend</h3><ul>${legend}<li><span class="cor-demo" style="margin:0 17px 0 16px"></span>Corrected day</li></ul></div></section>`;
}

/* ---------- 3. employee attendance tab ---------- */
function employeePage(withSwap) {
  const arr = monthData(11, false);
  arr[28] = { c: "HD", cor: false }; arr[29] = { c: "P", cor: true }; arr[30] = { c: "none" };
  const times = { P: "08:52–17:04", HD: "09:40–17:00", SH: "09:10–12:40", A: "", INC: "09:05–?", PL: "", WO: "", H: "", "WO-W": "07:30–16:00", UL: "", "H-W": "07:30–16:00", none: "" };
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => `<div class="wd">${w}</div>`).join("");
  const bc = arr.map((x, i) => `<button class="bc c-${x.c}${i === 30 ? " today" : ""}" aria-label="${i + 1} October, ${x.c}"><span class="n"><span>${i + 1}</span>${x.cor ? '<span class="cor" title="Corrected"></span>' : ""}</span><span class="code">${x.c === "none" ? "–" : x.c}</span><span class="tm">${times[x.c] || ""}</span></button>`).join("");
  const tot = totalsOf(arr, 11);
  const tgrid = tot.map((v, i) => `<div class="tt ${i === 11 ? "k-late" : ""}"><small>${TOT_HEAD[i]}</small><b>${v}</b></div>`).join("");
  const months = [["Nov 2025", 2025, 10], ["Dec 2025", 2025, 11], ["Jan 2026", 2026, 0], ["Feb 2026", 2026, 1], ["Mar 2026", 2026, 2], ["Apr 2026", 2026, 3], ["May 2026", 2026, 4], ["Jun 2026", 2026, 5], ["Jul 2026", 2026, 6], ["Aug 2026", 2026, 7], ["Sep 2026", 2026, 8], ["Oct 2026", 2026, 9]];
  const heat = months.map(([lab, y, m], k) => {
    const dim = new Date(y, m + 1, 0).getDate(), off = (new Date(y, m, 1).getDay() + 6) % 7, r = rnd(100 + k * 31);
    let pr = 0, cells = "";
    for (let d = 1; d <= dim; d++) {
      const dow = new Date(y, m, d).getDay(); let c;
      if (y === 2026 && m === 9 && d === 31) c = "none";
      else if (dow === 0) c = "WO"; else { const x = r(); c = x < 0.84 ? "P" : x < 0.89 ? "HD" : x < 0.91 ? "SH" : x < 0.94 ? "A" : x < 0.98 ? "PL" : "INC"; }
      if (c === "P") pr++;
      cells += `<button class="hs c-${c}" aria-label="${d} ${lab.split(" ")[0]}: ${c}">${c === "none" ? "–" : c}</button>`;
    }
    return `<div><h4>${lab}<small>${pr} present</small></h4><div class="hm">${["M", "T", "W", "T", "F", "S", "S"].map((w) => `<div class="wd">${w}</div>`).join("")}${'<div class="hs blank"></div>'.repeat(off)}${cells}</div></div>`;
  }).join("");
  const legendInline = [["P", "Present"], ["HD", "Half-day"], ["SH", "Short hours"], ["A", "Absent"], ["INC", "Incomplete"], ["PL", "Paid leave"], ["UL", "Unpaid leave"], ["WO", "Weekly off"], ["H", "Holiday"], ["WO-W", "Worked on off day"]].map(([c, t]) => `<span><span class="hs c-${c}">${c}</span>${t}</span>`).join("");
  return `<div class="crumbs"><a href="#" class="link">Employees</a> / Rohan Kulkarni</div>
  <section class="card emp-head"><span class="avatar avatar-lg">RK</span><div style="flex:1;min-width:200px"><h1>Rohan Kulkarni</h1><div class="meta"><span class="code">SS-1042</span><span class="badge badge-info">Permanent</span><span>Assembly · Operator</span><span>Plant K134 · Office shift 09:00–17:00</span></div></div></section>
  <div class="tabs" role="tablist"><button class="tab" role="tab">${ic("user")}Details</button><button class="tab" role="tab" aria-selected="true">${ic("calendar-check")}Attendance</button><button class="tab" role="tab">${ic("scan-face")}Face</button><button class="tab" role="tab">${ic("qr-code")}Card</button><button class="tab" role="tab">${ic("history")}History</button></div>
  <div class="two-col"><div>
  <section class="card sect"><div class="sect-head"><div><h2>October 2026</h2><p>Open a day to see its timeline.</p></div><div class="monthpick"><button class="btn btn-outline" aria-label="Previous month">${ic("chevron-left")}</button><div class="input" style="display:flex;align-items:center;justify-content:center">October 2026</div><button class="btn btn-outline" aria-label="Next month">${ic("chevron-right")}</button></div></div>
  <div class="bigcal">${wd}${'<div class="bc blank"></div>'.repeat(3)}${bc}</div>
  <div class="legend-inline">${legendInline}<span><span class="cor-demo" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--foreground);border:1.5px solid #fff;box-shadow:0 0 0 .5px var(--foreground)"></span>Corrected</span></div></section>
  <section class="card sect"><div class="sect-head"><div><h2>Last 12 months</h2><p>Each square has its register code, so colour is never the only cue.</p></div></div><div class="heat">${heat}</div><div class="legend-inline">${legendInline}</div></section>
  </div><div>
  <section class="card sect"><div class="sect-head"><h2>Month totals</h2><span class="muted" style="font-size:13px">Oct 2026</span></div><div class="totals-grid" style="margin-top:0">${tgrid}</div></section>
  <section class="card sect"><div class="sect-head"><div><h2>Corrections and leave</h2><p>This month</p></div></div><ul class="list-lines">
    <li><span class="ico b">${ic("calendar-heart")}</span><div><b>Paid leave</b><span class="muted">12/10 to 13/10 · 2 working days</span></div></li>
    <li><span class="ico o">${ic("pencil")}</span><div><b>Ignore punch 13:31 IN</b><span class="muted">29/10 · Approved by Asha Rao</span></div><div class="when"><span class="st st-approved" style="height:24px;font-size:12px">${ic("check")}Approved</span></div></li>
    <li><span class="ico b">${ic("clock-3")}</span><div><b>Set status: Present</b><span class="muted">29/10 · Asked by Nilesh Bhosale</span></div><div class="when"><span class="st st-pending" style="height:24px;font-size:12px">${ic("clock-3")}Pending</span></div></li></ul></section>
  <section class="card sect"><div class="sect-head"><div><h2>One-day shift swap</h2><p>Super Admin only</p></div></div><ul class="list-lines"><li><span class="ico t">${ic("repeat")}</span><div><b>Swapped to Night on 05/11/2026</b><span class="muted">By Asha Rao · reason: cover for a sick colleague</span></div></li></ul>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px"><button class="btn btn-outline" style="flex:1 1 200px">${ic("x")}Cancel the swap</button><button class="btn btn-primary" style="flex:1 1 200px">${ic("repeat")}Work another shift on one day</button></div></section>
  </div></div>`;
}
function swapDialog() {
  return `<div class="scrim"></div><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="sw"><div class="dlg-head"><div><h2 id="sw">Work another shift on one day</h2><p>Rohan Kulkarni · SS-1042. The day follows the rules of the shift you choose.</p></div><button class="btn btn-ghost btn-icon" aria-label="Close">${ic("x")}</button></div>
  <div class="dlg-body"><div class="f2"><div class="fld"><label class="label">Date (today or later)</label><div class="input" style="display:flex;align-items:center">05/11/2026</div></div>${sel("Shift (same plant)", "Night 19:00–07:00")}</div>
  <div class="rules">${ic("shield-check")}<div><b>Night 19:00–07:00 · full day 12 h</b>On time until 19:30. Leave from 07:00 the next morning.<small>Punches from 15:00 on 05/11 to 15:00 on 06/11 count for this day.</small></div></div>
  <label class="label">Reason</label><div class="textarea">Cover for a sick colleague on the night shift.</div><div class="count"><span>3 to 300 characters</span><span>46 / 300</span></div>
  <div class="alert alert-info" style="margin-top:12px">${ic("info")}<span>This replaces his Office shift for 05/11/2026 only. You can cancel it before the day starts.</span></div></div>
  <div class="dlg-foot"><button class="btn btn-outline">Cancel</button><button class="btn btn-primary">${ic("repeat")}Save the swap</button></div></div>`;
}

/* ---------- 4. day timeline drawer ---------- */
function drawer(role) {
  const sa = role === "sa";
  const lockReason = `<span class="tag tag-lock">${ic("lock")}Reason: only the Super Admin can see it</span>`;
  const tl = `<ol class="tl">
  <li><span class="dot in">${ic("log-in")}</span><div class="box"><div class="l1"><span class="t-time">09:40</span><span class="t-dir in">IN</span><span class="tag tag-count">${ic("check")}Counts</span></div>
    <div class="l2"><span>${ic("tablet-smartphone")}Gate A · K134</span><span>${ic("scan-face")}Face</span><span>${ic("circle-check")}Accepted</span></div><div class="l3"><span class="tag tag-first">${ic("flag-triangle-right")}First IN: starts the hours</span></div></div></li>
  <li><span class="dot out">${ic("log-out")}</span><div class="box"><div class="l1"><span class="t-time">12:58</span><span class="t-dir out">OUT</span><span class="tag tag-count">${ic("check")}Counts</span></div>
    <div class="l2"><span>${ic("tablet-smartphone")}Gate A · K134</span><span>${ic("scan-face")}Face</span><span>${ic("circle-check")}Accepted</span></div><div class="l3"><span class="tag tag-extra">${ic("sticky-note")}Extra punch: not used for the hours</span></div></div></li>
  <li><span class="dot in dim">${ic("log-in")}</span><div class="box unused"><div class="l1"><span class="t-time">13:31</span><span class="t-dir in">IN</span><span class="tag tag-flag">${ic("flag")}Flagged: at the edge of the fence</span></div>
    <div class="l2"><span>${ic("tablet-smartphone")}Gate A · K134</span><span>${ic("scan-face")}Face</span></div><div class="l3"><span class="tag tag-notused">${ic("eye-off")}Not used for this day</span><span class="tag tag-notused">${ic("pencil")}Correction of 30/10</span>${sa ? `<a class="link" href="#" style="font-size:13px">Open in Needs review</a>` : ""}</div></div></li>
  <li><span class="dot out">${ic("log-out")}</span><div class="box"><div class="l1"><span class="t-time">17:00</span><span class="t-dir out">OUT</span><span class="tag tag-count">${ic("check")}Counts</span></div>
    <div class="l2"><span>${ic("tablet-smartphone")}Gate A · K134</span><span>${ic("scan-face")}Face</span><span>${ic("cloud-off")}Saved offline, sent 17:03</span></div><div class="l3"><span class="tag tag-last">${ic("flag-triangle-left")}Last OUT: ends the hours</span></div>
    ${sa ? `<div class="quote"><small>Review reason (Super Admin only)</small>Time shown by the gate was 3 minutes ahead of the server.</div>` : ""}</div></li>
  <li><span class="dot rev">${ic("badge-check")}</span><div class="box"><div class="l1"><b style="font-size:15px">Approved as OUT</b><span class="tag tag-ok">${ic("check")}Review</span></div><div class="l2"><span>${ic("user-round-check")}Asha Rao · 30/10/2026 10:12</span></div><div class="l3">${sa ? "" : lockReason}</div></div></li>
  <li><span class="dot cor">${ic("pencil")}</span><div class="box"><div class="l1"><b style="font-size:15px">Ignore punch 13:31 IN</b><span class="tag tag-ok">${ic("check")}Approved</span></div><div class="l2"><span>${ic("user")}Asked by Nilesh Bhosale · 30/10 09:02</span><span>${ic("user-round-check")}Decided by Asha Rao · 30/10 09:15</span></div><div class="quote"><small>Reason</small>Worker tapped twice at lunch.</div></div></li>
  <li><span class="dot cor">${ic("pencil")}</span><div class="box"><div class="l1"><b style="font-size:15px">Set status: Present</b><span class="tag tag-pend">${ic("clock-3")}Pending</span></div><div class="l2"><span>${ic("user")}Asked by Nilesh Bhosale · 30/10 16:20</span></div><div class="quote"><small>Reason</small>Full day on site, as the supervisor confirmed.</div>${sa ? `<div class="l3"><a class="link" href="#" style="font-size:13px">Decide in Corrections</a></div>` : ""}</div></li>
  </ol>`;
  return `<div class="scrim"></div><aside class="sheet" role="dialog" aria-modal="true" aria-labelledby="dd">
  <div class="sheet-head"><span class="avatar" style="width:44px;height:44px">RK</span><div><h2 id="dd">Rohan Kulkarni</h2><p><span class="code">SS-1042</span> · Thursday 29/10/2026 · Plant K134</p></div><div class="sheet-nav"><button class="btn btn-outline btn-icon" aria-label="Previous day">${ic("chevron-left")}</button><button class="btn btn-outline btn-icon" aria-label="Next day">${ic("chevron-right")}</button><button class="btn btn-ghost btn-icon" aria-label="Close">${ic("x")}</button></div></div>
  <div class="sheet-body">
  <div class="rules">${ic("shield-check")}<div><b>Office 09:00–17:00 · full day 8 h</b>On time until 09:30. Leave from 17:00.<small>Half-day from 4 h. Overtime from 17:00, only when it is 2 h or more. Punches from 05:00 on 29/10 to 05:00 on 30/10 count for this day.</small></div></div>
  <div class="rolebar">${ic(sa ? "shield" : "eye")}${sa ? "You are the Super Admin: you can correct this day directly." : "You are the Plant Head: you can ask for a correction. The Super Admin decides."}</div>
  <div class="res-top">${stChip("half", true)}<span class="st" style="border-color:var(--border-strong);background:var(--surface);color:var(--foreground)">${ic("pencil")}Corrected</span><span class="st st-pending">${ic("clock-3")}1 correction pending</span></div>
  <div class="res-grid"><div class="res"><small>IN (first)</small><b>09:40</b></div><div class="res"><small>OUT (last)</small><b>17:00</b></div><div class="res"><small>Worked</small><b>7 h 20 m</b></div>
  <div class="res wide"><small>Worked for the status</small><b>7 h 20 m <em>of 8 h</em></b></div><div class="res"><small>Payable</small><b>7 h 20 m</b></div>
  <div class="res k-late"><small>Late</small><b>40 m</b></div><div class="res"><small>Early exit</small><b>–</b></div><div class="res k-ot"><small>Overtime</small><b>–</b></div></div>
  <section class="explain" aria-label="Explain this day"><h3>${ic("lightbulb")}Explain this day</h3><ol>
    <li>IN 09:40: 40 minutes late (on time until 09:30).</li><li>OUT 17:00, at the shift end.</li><li>Worked for the status 7 h 20 m of 8 h, so Half-day.</li><li>No overtime: you left at the shift end.</li></ol>
    <div class="src">${ic("server")}Worked out by the server, the same way as the list and the register.</div></section>
  <div class="tl-title"><span>Timeline</span><span class="muted" style="font-weight:500;font-size:13px">7 items</span></div>${tl}</div>
  <div class="sheet-foot">${sa ? `<button class="btn btn-primary">${ic("pencil")}Correct</button><button class="btn btn-outline">${ic("list-checks")}Open in punch log</button><div class="next">${ic("info")}You correct directly. Every change is saved in the audit log.</div>` : `<button class="btn btn-primary">${ic("send")}Ask for a correction</button><button class="btn btn-outline">Close</button><div class="next">${ic("info")}The Super Admin decides. You will see the answer under Corrections.</div>`}</div></aside>`;
}

/* ---------- 5. corrections ---------- */
const KIND = { add_punch: ["plus-circle", "Add a punch"], add_in_out: ["arrow-left-right", "Add IN and OUT"], ignore: ["eye-off", "Ignore a punch"], set_status: ["badge-check", "Set the status"] };
function beforeAfter(b, a, neutral) {
  const pane = (t, o, cls) => `<div class="pane ${cls || ""}"><h5>${t}</h5>${stChip(o.st)}<div class="ln"><span>IN <b>${o.in || "–"}</b></span><span>OUT <b>${o.out || "–"}</b></span><span>Worked <b>${o.w || "–"}</b></span></div></div>`;
  return `<div class="ba">${pane("Before", b)}<div class="arrow">${ic("arrow-right")}</div>${pane("After", a, "after" + (neutral ? " neutral" : ""))}</div>`;
}
const REQS = [
  { who: "Sneha Patil", code: "SS-2208", date: "29/10/2026", plant: "K134", kind: "add_in_out", req: [["clock", "IN 09:00"], ["clock", "OUT 17:00"]], reason: "The attendance device was off all morning. The supervisor saw her at work.", by: "Nilesh Bhosale (Plant Head)", at: "30/10 11:05", b: { st: "absent" }, a: { st: "present", in: "09:00", out: "17:00", w: "8 h" } },
  { who: "Vikram Jadhav", code: "SS-1310", date: "29/10/2026", plant: "K134", kind: "add_punch", req: [["clock", "OUT 17:00"]], reason: "Left at the end of the shift. The OUT was missed at a busy gate.", by: "Ravi Menon (Corporate Head)", at: "30/10 12:30", b: { st: "incomplete", in: "09:05" }, a: { st: "present", in: "09:05", out: "17:00", w: "7 h 55 m" } },
  { who: "Imran Shaikh", code: "SS-1203", date: "29/10/2026", plant: "K134", kind: "set_status", req: [["badge-check", "Half-day"]], reason: "Left for a hospital visit at 12:40 with the manager's permission.", by: "Nilesh Bhosale (Plant Head)", at: "30/10 14:48", b: { st: "short", in: "09:10", out: "12:40", w: "3 h 30 m" }, a: { st: "half", in: "09:10", out: "12:40", w: "3 h 30 m" }, reject: true },
  { who: "Dinesh Thakur", code: "SS-1418", date: "28/10/2026", plant: "K134", kind: "ignore", req: [["eye-off", "Punch 14:02 IN"]], reason: "A second IN after lunch. He had not left the plant.", by: "Nilesh Bhosale (Plant Head)", at: "29/10 16:10", b: { st: "present", in: "08:58", out: "17:10", w: "8 h 12 m" }, a: { st: "present", in: "08:58", out: "17:10", w: "8 h 12 m" }, neutral: true },
];
function reqCard(r, mode) {
  const k = KIND[r.kind], sa = mode === "sa";
  const foot = mode === "sa" && !r.reject ? `<div class="crq-foot"><span class="meta">${ic("user")}Asked by ${r.by} · ${r.at}</span><button class="btn btn-outline" style="border-color:#d98f88;color:var(--danger)">${ic("x")}Reject</button><button class="btn btn-primary">${ic("check")}Approve</button></div>`
    : mode === "sa" ? `<div class="crq-foot"><span class="meta">${ic("user")}Asked by ${r.by} · ${r.at}</span><button class="btn btn-outline" style="border-color:#d98f88;color:var(--danger)" disabled>${ic("x")}Reject</button><button class="btn btn-primary" disabled>${ic("check")}Approve</button></div><div class="reject-box"><label class="label">Why is it rejected? (shown to the requester)</label><div class="textarea" style="min-height:64px">There is no sign-in note from the manager. Please add it and ask again.</div><div class="count" style="color:#7a1a12"><span>3 to 300 characters</span><span>82 / 300</span></div><div class="row"><button class="btn btn-outline">Cancel</button><button class="btn btn-danger">${ic("x")}Reject this request</button></div></div>`
    : `<div class="crq-foot"><span class="meta">${ic("clock-3")}Waiting for the Super Admin · asked ${r.at}</span><button class="btn btn-outline">${ic("undo-2")}Withdraw</button></div>`;
  return `<article class="card crq"><div class="crq-top"><div class="who"><b>${r.who}</b><span class="code">${r.code}</span> · ${r.date} · ${r.plant}</div><span class="kindbadge">${ic(k[0])}${k[1]}</span><span class="st st-pending">${ic("clock-3")}Pending</span></div>
  <div class="crq-body"><div class="reqline">${r.req.map(([i, t]) => `<span style="font-weight:600">${ic(i)}${t}</span>`).join("")}</div><div class="quote"><small>Reason</small>${r.reason}</div>
  <div style="margin-top:10px;font-size:12.5px;color:var(--muted-foreground)" class="rolebar">${ic("server")}Day result worked out by the server</div>${beforeAfter(r.b, r.a, r.neutral)}${r.neutral ? `<div class="sentence muted">Only the extra punch is ignored: the hours stay the same.</div>` : ""}</div>${foot}</article>`;
}
function tabsBar(active, role) {
  const t = [["Pending", role === "sa" ? 4 : 2], ["Decided"], ["Punch approvals"]];
  if (role !== "sa") t.push(["My requests", 2]);
  return `<div class="tabs" role="tablist">${t.map(([n, c]) => `<button class="tab" role="tab" aria-selected="${n === active}">${n}${c ? `<span class="badge-n">${c}</span>` : ""}</button>`).join("")}</div>`;
}
function correctionsPage(tab) {
  const role = tab === "mine" ? "head" : "sa";
  let body;
  if (tab === "pending") body = `<div class="cr-list">${REQS.map((r) => reqCard(r, "sa")).join("")}</div>`;
  else if (tab === "mine") body = `<div class="cr-list">${[REQS[0], REQS[3]].map((r) => reqCard({ ...r, by: "you" }, "mine")).join("")}</div>`;
  else if (tab === "decided") {
    const drows = [["Imran Shaikh", "SS-1203", "28/10", "set_status", "Half-day", "approved", "Asha Rao · 29/10 09:10", "can-reverse"], ["Anita More", "SS-1355", "27/10", "add_in_out", "09:00 – 17:00", "approved", "Asha Rao · 28/10 10:02", "can-reverse"], ["Kiran Pawar", "T-5530", "26/10", "add_punch", "OUT 16:00", "rejected", "Asha Rao · 27/10 09:20", "Reason: OUT was not near any gate record."], ["Omkar Joshi", "SS-1620", "25/10", "set_status", "Present", "reversed", "Asha Rao · 26/10 18:00", "Reversed: entered for the wrong day."], ["Lata Wagh", "T-5544", "24/10", "ignore", "Punch 10:12 IN", "withdrawn", "By requester · 25/10 08:30", ""]];
    const stc = { approved: ["check", "Approved"], rejected: ["x", "Rejected"], reversed: ["undo-2", "Reversed"], withdrawn: ["minus", "Withdrawn"] };
    body = `<section class="card tcard"><div class="tol">${ic("history")}<span><b>Decided requests</b> · last 30 days</span><span class="tag">${ic("search", 14)} Filter by person, plant, kind or state</span></div><div class="tscroll"><table class="at" style="min-width:860px"><thead><tr><th>Employee</th><th>Day</th><th>Kind</th><th>What was asked</th><th>State</th><th>Decided by</th><th></th></tr></thead><tbody>${drows.map((d) => `<tr><td class="emp"><b>${d[0]}</b><span class="cd">${d[1]}</span></td><td class="tnum">${d[2]}/2026</td><td><span class="kindbadge">${ic(KIND[d[3]][0])}${KIND[d[3]][1]}</span></td><td>${d[4]}${d[7] && d[7] !== "can-reverse" ? `<span class="sub">${d[7]}</span>` : ""}</td><td><span class="st st-${d[5]}">${ic(stc[d[5]][0])}${stc[d[5]][1]}</span></td><td>${d[6]}</td><td style="text-align:right">${d[7] === "can-reverse" ? `<button class="btn btn-outline btn-sm" style="min-height:44px;border-color:#d98f88;color:var(--danger)">${ic("undo-2")}Reverse</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
    <div class="cards">${drows.map((d) => `<div class="acard"><div class="acard-top"><div><b>${d[0]}</b><span class="cd">${d[1]} · ${d[2]}/2026</span></div><span class="st st-${d[5]}">${ic(stc[d[5]][0])}${stc[d[5]][1]}</span></div><div style="margin:8px 0;font-size:14px"><span class="kindbadge">${ic(KIND[d[3]][0])}${KIND[d[3]][1]}</span> <b>${d[4]}</b></div><div class="muted" style="font-size:13px;margin-bottom:10px">${d[6]}${d[7] && d[7] !== "can-reverse" ? "<br>" + d[7] : ""}</div>${d[7] === "can-reverse" ? `<button class="btn btn-outline" style="border-color:#d98f88;color:var(--danger)">${ic("undo-2")}Reverse (reason needed)</button>` : ""}</div>`).join("")}</div></section>`;
  } else {
    const hide = tab === "approvals-head";
    const ap = [["Rohan Kulkarni", "SS-1042", "29/10 17:00", "OUT", "approved", "Asha Rao · 30/10 10:12", "Gate time was 3 minutes ahead."], ["Imran Shaikh", "SS-1203", "28/10 18:41", "OUT", "not_accepted", "Asha Rao · 29/10 09:40", "Person was not near the gate."], ["Anita More", "SS-1355", "27/10 08:55", "IN", "approved", "Asha Rao · 28/10 10:05", "Face was hidden by a helmet."]];
    body = `<section class="card tcard"><div class="tol">${ic("badge-check")}<span><b>Punch approvals</b> · last 30 days · read only</span><span class="tag">${hide ? "Reasons are only for the Super Admin" : ""}</span></div><div class="tscroll"><table class="at apr-table" style="min-width:820px"><thead><tr><th>Employee</th><th>Punch</th><th>Direction</th><th>Decision</th><th>Decided by</th><th>Reason</th><th></th></tr></thead><tbody>${ap.map((a) => `<tr><td class="emp"><b>${a[0]}</b><span class="cd">${a[1]}</span></td><td class="tnum">${a[2]}</td><td><span class="t-dir ${a[3] === "IN" ? "in" : "out"}">${a[3]}</span></td><td><span class="st ${a[4] === "approved" ? "st-approved" : "st-rejected"}">${ic(a[4] === "approved" ? "check" : "x")}${a[4] === "approved" ? "Approved" : "Not accepted"}</span></td><td>${a[5]}</td><td style="white-space:normal;min-width:200px">${hide ? `<span class="tag tag-lock">${ic("lock")}Only the Super Admin</span>` : a[6]}</td><td style="text-align:right">${hide ? "" : `<a class="btn btn-ghost btn-sm" style="min-height:44px" href="#">Needs review${ic("arrow-up-right")}</a>`}</td></tr>`).join("")}</tbody></table></div>
    <div class="cards">${ap.map((a) => `<div class="acard"><div class="acard-top"><div><b>${a[0]}</b><span class="cd">${a[1]} · ${a[2]}</span></div><span class="st ${a[4] === "approved" ? "st-approved" : "st-rejected"}">${ic(a[4] === "approved" ? "check" : "x")}${a[4] === "approved" ? "Approved" : "Not accepted"}</span></div><div style="margin:8px 0;font-size:13.5px"><span class="t-dir ${a[3] === "IN" ? "in" : "out"}">${a[3]}</span> · ${a[5]}</div>${hide ? `<span class="tag tag-lock">${ic("lock")}Reason: only the Super Admin</span>` : `<div class="quote">${a[6]}</div>`}</div>`).join("")}</div></section>`;
  }
  const active = { pending: "Pending", decided: "Decided", mine: "My requests", approvals: "Punch approvals", "approvals-head": "Punch approvals" }[tab];
  const crole = tab === "mine" || tab === "approvals-head" ? "head" : "sa";
  return `<div class="crumbs">Attendance / Corrections</div>
  <div class="page-head"><div><h1 class="page-title">Corrections</h1><p class="page-desc">${crole === "sa" ? "Requests from the Plant Heads and the Corporate Head wait here for your decision." : "Ask for a change to a day. The Super Admin decides."}</p></div><div class="head-actions"><button class="btn btn-primary">${ic("users-round")}Correct many people</button></div></div>
  ${tabsBar(active, crole)}${body}`;
}

/* correction dialog */
function correctionDialog(warn, sa) {
  return `<div class="scrim"></div><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="cd"><div class="dlg-head"><div><h2 id="cd">${sa ? "Correct this day" : "Ask for a correction"}</h2><p>Sneha Patil · SS-2208 · Thursday 29/10/2026 · K134 · Office 09:00–17:00</p></div><button class="btn btn-ghost btn-icon" aria-label="Close">${ic("x")}</button></div>
  <div class="dlg-body"><label class="label">What do you want to do?</label>
  <div class="kinds" role="radiogroup"><button class="kind" role="radio" aria-checked="false"><span class="rad"></span><span><b>Add a punch</b><small>One missing IN or OUT</small></span></button>
  <button class="kind" role="radio" aria-checked="true"><span class="rad"></span><span><b>Add IN and OUT</b><small>Both are missing, for example a gate outage</small></span></button>
  <button class="kind" role="radio" aria-checked="false" aria-disabled="true"><span class="rad"></span><span><b>Ignore a punch</b><small>Hide a wrong punch</small><span class="why">${ic("info")}This day has no punches to ignore.</span></span></button>
  <button class="kind" role="radio" aria-checked="false"><span class="rad"></span><span><b>Set the status</b><small>Present, Half-day or Absent</small></span></button></div>
  <div class="f2"><div class="fld"><label class="label">IN: date and time</label><div class="input tnum" style="display:flex;align-items:center">29/10/2026 &nbsp; ${warn ? "09:07" : "09:00"}</div></div><div class="fld"><label class="label">OUT: date and time</label><div class="input tnum" style="display:flex;align-items:center">29/10/2026 &nbsp; 17:00</div><div class="help">For a night shift the OUT can be on the next day.</div></div></div>
  ${warn ? `<div class="alert alert-warning" role="alert" style="margin-bottom:12px">${ic("triangle-alert")}<span><b>A counted punch exists at 09:05, 2 minutes away.</b> A correction this close to a real punch is not allowed. Choose a different time.</span></div>` : ""}
  <label class="label">Reason</label><div class="textarea">The attendance device was off all morning. The supervisor saw her at work.</div><div class="count"><span>3 to 300 characters</span><span>76 / 300</span></div>
  <div class="preview-box" style="margin-top:14px"><div class="ph">${ic("eye")}Preview of the day<span class="src">Worked out by the server</span></div>${warn ? `<div class="alert alert-danger" style="margin:10px 0">${ic("circle-x")}<span>Cannot be created: this time is too near a counted punch.</span></div>` : beforeAfter({ st: "absent" }, { st: "present", in: "09:00", out: "17:00", w: "8 h" })}<div class="sentence">${warn ? "Change the time to see the new result." : "On time. Worked 8 h, so Present. No overtime."}</div></div>
  ${sa ? `<div class="alert alert-info">${ic("info")}<span>You are the Super Admin: this takes effect at once and is saved in the audit log.</span></div>` : `<div class="alert alert-info">${ic("info")}<span>The Super Admin decides. Nothing changes until it is approved.</span></div>`}</div>
  <div class="dlg-foot"><button class="btn btn-outline">Cancel</button><button class="btn btn-primary"${warn ? " disabled" : ""}>${ic(sa ? "check" : "send")}${sa ? "Save the correction" : "Send the request"}</button></div></div>`;
}

/* bulk wizard */
function wizard(done) {
  const steps = ["Plant and day", "What to add", "People", "Reason", "Preview"];
  const stp = `<ol class="stepper">${steps.map((s, i) => `<li class="${done || i < 4 ? "done" : "cur"}"><span class="n">${done || i < 4 ? ic("check") : i + 1}</span><span class="t">${s}</span></li>`).join("")}</ol>`;
  const prows = [["Rohan Kulkarni", "SS-1042", "absent", "present", "08:52 – 17:04", "8 h 12 m"], ["Meera Deshmukh", "SS-1187", "absent", "present", "09:00 – 17:00", "8 h"], ["Sneha Patil", "SS-2208", "absent", "present", "09:00 – 17:00", "8 h"], ["Vikram Jadhav", "SS-1310", "incomplete", "present", "09:05 – 17:00", "7 h 55 m"], ["Pradeep Gaikwad", "T-5521", "absent", "present", "07:00 – 19:00", "12 h"], ["Dinesh Thakur", "SS-1418", "present", "SKIP", "", "CORRECTION_NEAR_PUNCH"], ["Anita More", "SS-1355", "leave", "SKIP", "", "ON_LEAVE"]];
  const table = `<div class="pv-scroll"><table class="pv"><thead><tr><th>Employee</th><th>Before</th><th>After</th><th>Times</th><th>Worked</th></tr></thead><tbody>${prows.map((p) => p[3] === "SKIP" ? `<tr class="skipped"><td><b>${p[0]}</b><div class="muted code" style="font-size:12px">${p[1]}</div></td><td>${stChip(p[2])}</td><td colspan="3"><span class="tag tag-flag">${ic("circle-slash")}Skipped</span> <span class="code" style="font-size:12.5px">${p[5]}</span> <span class="muted">${p[5] === "ON_LEAVE" ? "On paid leave that day" : "A counted punch is 2 minutes from this time"}</span></td></tr>` : `<tr><td><b>${p[0]}</b><div class="muted code" style="font-size:12px">${p[1]}</div></td><td>${stChip(p[2])}</td><td>${stChip(p[3])}</td><td class="tnum">${p[4]}</td><td class="tnum"><b>${p[5]}</b></td></tr>`).join("")}</tbody></table></div>
  <div class="pv-cards">${prows.map((p) => p[3] === "SKIP" ? `<div class="pcard skipped"><b>${p[0]}</b> <span class="code muted" style="font-size:12px">${p[1]}</span><div class="ln">${stChip(p[2])}</div><div class="ln"><span class="tag tag-flag">${ic("circle-slash")}Skipped</span><span class="code" style="font-size:12px">${p[5]}</span></div></div>` : `<div class="pcard"><b>${p[0]}</b> <span class="code muted" style="font-size:12px">${p[1]}</span><div class="ln">${stChip(p[2])}${ic("arrow-right", 16)}${stChip(p[3])}</div><div class="ln muted tnum">${p[4]} · <b style="color:var(--foreground)">${p[5]}</b></div></div>`).join("")}</div>`;
  const prev = `<div class="alert alert-info" style="margin-bottom:12px">${ic("info")}<span><b>Gate outage, plant K134, 29/10/2026.</b> Add IN 09:00 and OUT 17:00 for everyone listed. Reason: "Attendance device was off all day (power cut)."</span></div>
  <div class="sumbar"><div class="sum ok"><b>46</b><small>people will change</small></div><div class="sum skip"><b>3</b><small>will be skipped</small></div><div class="sum"><b>49</b><small>chosen, up to 200 allowed</small></div></div>${table}`;
  const dn = `<div class="state" style="padding:20px 8px 8px"><div class="big" style="background:var(--success-soft);color:var(--success);border-color:#bfe3d2">${ic("circle-check")}</div><h3>46 corrections made and approved</h3><p>3 people were skipped. They are listed in the batch. Batch number B-2026-0014.</p></div>
  <div class="card batch"><span class="bi">${ic("layers")}</span><div style="flex:1;min-width:200px"><b>Batch B-2026-0014 · K134 · 29/10/2026</b><div class="muted" style="font-size:13.5px">Add IN 09:00 and OUT 17:00 · 46 people · by Asha Rao · 31/10/2026 11:52</div></div><button class="btn btn-outline" style="border-color:#d98f88;color:var(--danger)">${ic("undo-2")}Reverse the whole batch</button></div>
  <div class="alert alert-warning" style="margin-top:12px">${ic("triangle-alert")}<span>Reversing the batch undoes all 46 corrections at once. You must give a reason, and it is saved in the audit log.</span></div>`;
  return `<div class="scrim"></div><div class="dlg dlg-wide" role="dialog" aria-modal="true" aria-labelledby="wz"><div class="dlg-head"><div><h2 id="wz">Correct many people</h2><p>${done ? "Finished." : "Step 5 of 5 · check the result before you create it."}</p></div><button class="btn btn-ghost btn-icon" aria-label="Close">${ic("x")}</button></div>
  <div class="dlg-body">${stp}${done ? dn : prev}</div>
  <div class="dlg-foot">${done ? `<button class="btn btn-primary">${ic("check")}Done</button>` : `<button class="btn btn-outline">${ic("arrow-left")}Back</button><button class="btn btn-primary">${ic("check-check")}Create 46 corrections and approve all</button>`}</div></div>`;
}

/* ---------- start ---------- */
const MAP = {
  list: () => ["Attendance", "sa", listPage("default")],
  "list-today": () => ["Attendance", "sa", listPage("today")],
  "list-loading": () => ["Attendance", "sa", listPage("loading")],
  "list-empty": () => ["Attendance", "sa", listPage("empty")],
  "list-error": () => ["Attendance", "sa", listPage("error")],
  register: () => ["Monthly register", "sa", registerPage()],
  employee: () => ["Employees", "sa", employeePage()],
  swap: () => ["Employees", "sa", employeePage(), swapDialog()],
  "drawer-sa": () => ["Attendance", "sa", listPage("default"), drawer("sa")],
  "drawer-head": () => ["Attendance", "head", listPage("default"), drawer("head")],
  corrections: () => ["Corrections", "sa", correctionsPage("pending")],
  "corrections-decided": () => ["Corrections", "sa", correctionsPage("decided")],
  "corrections-mine": () => ["Corrections", "head", correctionsPage("mine")],
  approvals: () => ["Corrections", "sa", correctionsPage("approvals")],
  "approvals-head": () => ["Corrections", "head", correctionsPage("approvals-head")],
  dialog: () => ["Corrections", "head", correctionsPage("mine"), correctionDialog(false, false)],
  "dialog-sa": () => ["Attendance", "sa", listPage("default"), correctionDialog(false, true)],
  "dialog-warn": () => ["Attendance", "head", listPage("default"), correctionDialog(true, false)],
  wizard: () => ["Corrections", "sa", correctionsPage("pending"), wizard(false)],
  "wizard-done": () => ["Corrections", "sa", correctionsPage("pending"), wizard(true)],
};
document.addEventListener("DOMContentLoaded", () => {
  const [active, role, page, overlay] = (MAP[SCREEN] || MAP.list)();
  const u = USERS[role];
  $("sidebar").innerHTML = sidebar(active);
  $("topbar").innerHTML = topbar(u);
  $("page").innerHTML = page;
  if (overlay) { $("layer").innerHTML = overlay; document.body.classList.add("lock"); $("page").classList.add("behind"); }
  if (P.has("shot")) document.body.classList.add("shot");
  $("state-tag").textContent = "Screen: " + SCREEN + " · " + u.role;
  if (window.lucide) window.lucide.createIcons();
  document.body.dataset.ready = "1";
});
