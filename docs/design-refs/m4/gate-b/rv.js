/*
  Upasthiti - M4 design gate B: shared data and drawing helpers for the "Needs review" mockups.
  MOCKUP ONLY, not app code. Fake people and codes. No photo of any person.
  Used by 01-list.html, 02-detail.html and 03-dialogs.html. Texts say "attendance device", never "kiosk".
*/

const ic = (n) => `<i data-lucide="${n}"></i>`;

/* ---------- Text catalogue (becomes punchReasons.<CODE> and punchReasons.<CODE>_help) ---------- */
const FLAG = {
  LOCATION_AT_EDGE: { icon: "map-pin", title: "At the edge of the fence", help: "The attendance device was just outside the drawn fence, but inside the margin. GPS can drift a little, so this is not rejected. The punch counts until you decide." },
  LOCATION_STALE: { icon: "satellite-dish", title: "Location reading was old", help: "The last location reading was older than allowed when the punch was made. The punch counts until you decide." },
  IMPOSSIBLE_TRAVEL: { icon: "route", title: "Impossible travel", help: "The same person punched at two places that are too far apart for the time between them. Someone else may have used the card or code." },
  TWO_DEVICES_SOON: { icon: "arrow-left-right", title: "Two attendance devices, minutes apart", help: "The same person punched at two different attendance devices within a few minutes." },
  OFFLINE_TIME_UNPROVEN: { icon: "history", title: "Time not proven", help: "The punch was saved without internet and the device restarted, so its clock could not be checked. The time shown is the device's own clock." },
  OFFLINE_TOO_OLD: { icon: "hourglass", title: "Saved offline for too long", help: "The punch waited on the device longer than the allowed offline time before it was sent." },
  SYNC_ORDER_CONFLICT: { icon: "shuffle", title: "Order changed after sending", help: "After the saved punches were sent, the order of IN and OUT no longer fits this person's other punches." },
};
const REASON = {
  OUTSIDE_GEOFENCE: { icon: "map-pin-off", title: "Outside the plant fence", help: "The attendance device's location was outside the fence and its margin." },
  GPS_ACCURACY_TOO_LOW: { icon: "satellite-dish", title: "Location not accurate enough", help: "The attendance device could not fix its position well enough (worse than the 50 m limit)." },
  LOCATION_REQUIRED: { icon: "map-pin-off", title: "No location sent", help: "The punch came without a location." },
  FACE_NOT_RECOGNISED: { icon: "scan-face", title: "Face not recognised", help: "The face did not match the code that was typed." },
  LIVENESS_FAILED: { icon: "user-x", title: "Head did not turn", help: "The live-face check failed: the head did not turn as asked." },
  CARD_EXPIRED: { icon: "id-card", title: "Card expired", help: "The QR card was past its end date." },
  OFFLINE_EVIDENCE_UNREADABLE: { icon: "file-x", title: "Saved punch could not be read", help: "The punch saved offline could not be checked when it was sent, so it was rejected." },
  COOLDOWN_ACTIVE: { icon: "repeat", title: "Already punched (scanned again too soon)", help: "A punch of this person already counts a moment before. Nothing to approve." },
};
const CODETEXT = Object.assign({}, FLAG, REASON);
const REVIEW_LABEL = {
  confirm: { icon: "circle-check", text: "Confirmed", badge: "badge-success" },
  not_accepted: { icon: "circle-x", text: "Not accepted", badge: "badge-danger" },
  approve_in: { icon: "log-in", text: "Approved as IN", badge: "badge-info" },
  approve_out: { icon: "log-out", text: "Approved as OUT", badge: "badge-info" },
};

/* ---------- Badges ---------- */
const B = {
  in: `<span class="badge badge-success">${ic("log-in")}IN</span>`,
  out: `<span class="badge badge-info">${ic("log-out")}OUT</span>`,
  flag: `<span class="badge badge-flag">${ic("flag")}Flagged</span>`,
  rej: `<span class="badge badge-danger">${ic("circle-x")}Rejected</span>`,
  face: `<span class="badge badge-method-face">${ic("scan-face")}Face</span>`,
  card: `<span class="badge badge-method-card">${ic("id-card")}Card</span>`,
  code: `<span class="badge badge-method-face">${ic("keyboard")}Code and face</span>`,
  offline: `<span class="badge badge-warning">${ic("hourglass")}Saved offline</span>`,
};
const reviewBadge = (r) => { const l = REVIEW_LABEL[r]; return `<span class="badge ${l.badge}">${ic(l.icon)}${l.text}</span>`; };

/* ---------- Fake data. Today = 28/10/2026 (IST). ---------- */
/* flags = codes on a flagged punch; reason = rejection code; off = saved offline; rev = latest review */
const TO_CHECK = [
  { id: "c1", date: "28/10/2026", t: "07:58", emp: ["Sunita Jadhav", "EMP-0312"], plant: "K134", dev: "Main gate phone", m: "face", dir: "in", flags: ["LOCATION_AT_EDGE"], photo: "none", kind: "edge" },
  { id: "c2", date: "28/10/2026", t: "07:41", emp: ["Santosh Gaikwad", "T-2041"], plant: "X280", dev: "Gate PC", m: "card", dir: "in", flags: ["IMPOSSIBLE_TRAVEL"], photo: "stored", kind: "travel" },
  { id: "c3", date: "28/10/2026", t: "07:30", emp: ["Anil Pawar", "T-2058"], plant: "K134", dev: "Main gate phone", m: "card", dir: "in", flags: ["OFFLINE_TIME_UNPROVEN"], off: { delay: "52 min", proof: "unproven" }, photo: "stored", kind: "unproven" },
  { id: "c4", date: "28/10/2026", t: "07:22", emp: ["Vijay Salunke", "EMP-0123"], plant: "K134", dev: "Main gate phone", m: "face", dir: "in", flags: ["LOCATION_AT_EDGE"], photo: "none", kind: "hints" },
  { id: "c5", date: "28/10/2026", t: "07:15", emp: ["Ganesh More", "T-2077"], plant: "K135", dev: "Gate tablet", m: "card", dir: "in", flags: ["TWO_DEVICES_SOON"], photo: "stored", kind: "two" },
  { id: "c6", date: "28/10/2026", t: "06:58", emp: ["Prakash Mane", "T-2090"], plant: "K134", dev: "Main gate phone", m: "card", dir: "in", flags: ["LOCATION_STALE"], off: { delay: "1 h 4 min", proof: "anchored" }, photo: "stored", kind: "anchored" },
  { id: "c7", date: "27/10/2026", t: "18:49", emp: ["Nilesh Kamble", "EMP-0089"], plant: "K134", dev: "Main gate phone", m: "face", dir: "out", flags: ["LOCATION_AT_EDGE"], photo: "none", kind: "edge-old" },
];
const REJECTED = [
  { id: "r1", date: "28/10/2026", t: "08:01", emp: ["Mahesh Wagh", "T-2102"], plant: "K134", dev: "Main gate phone", m: "card", reason: "OUTSIDE_GEOFENCE", photo: "stored", kind: "outside", approvable: true },
  { id: "r2", date: "28/10/2026", t: "07:47", emp: ["Ramesh Patil", "EMP-0457"], claimed: true, plant: "K134", dev: "Main gate phone", m: "code", reason: "FACE_NOT_RECOGNISED", photo: "stored", kind: "codefail", approvable: true },
  { id: "r3", date: "28/10/2026", t: "07:20", emp: null, plant: "K134", dev: "Main gate phone", m: "face", reason: "LIVENESS_FAILED", photo: "stored", kind: "nobody", approvable: false },
  { id: "r4", date: "28/10/2026", t: "07:09", emp: null, plant: "K134", dev: "Main gate phone", m: "card", reason: "OFFLINE_EVIDENCE_UNREADABLE", off: { delay: "2 h 10 min", proof: "unproven" }, photo: "none", kind: "nobody2", approvable: false },
  { id: "r5", date: "28/10/2026", t: "06:52", emp: ["Anil Pawar", "T-2058"], plant: "X280", dev: "Gate PC", m: "card", reason: "GPS_ACCURACY_TOO_LOW", photo: "stored", kind: "gps", approvable: true },
  { id: "r6", date: "28/10/2026", t: "06:41", emp: ["Sunita Jadhav", "EMP-0312"], plant: "K134", dev: "Main gate phone", m: "face", reason: "COOLDOWN_ACTIVE", photo: "none", kind: "cooldown", approvable: false, cooldown: true },
];
const REVIEWED = [
  { id: "v1", date: "28/10/2026", t: "07:02", emp: ["Nilesh Kamble", "EMP-0089"], plant: "K134", dev: "Main gate phone", m: "face", dir: "in", flags: ["LOCATION_AT_EDGE"], photo: "none", kind: "history", rev: { a: "not_accepted", by: "Asha Rao", at: "28/10/2026 09:10" } },
  { id: "v2", date: "27/10/2026", t: "18:55", emp: ["Rekha Bhosale", "EMP-0204"], plant: "K134", dev: "Main gate phone", m: "face", dir: "out", flags: ["LOCATION_AT_EDGE"], photo: "none", kind: "x", rev: { a: "confirm", by: "Asha Rao", at: "28/10/2026 09:05" } },
  { id: "v3", date: "27/10/2026", t: "07:12", emp: ["Mahesh Wagh", "T-2102"], plant: "K134", dev: "Main gate phone", m: "card", reason: "OUTSIDE_GEOFENCE", photo: "stored", kind: "x", rev: { a: "approve_in", by: "Asha Rao", at: "27/10/2026 18:20" } },
  { id: "v4", date: "27/10/2026", t: "06:50", emp: ["Santosh Gaikwad", "T-2041"], plant: "K134", dev: "Main gate phone", m: "card", dir: "in", flags: ["TWO_DEVICES_SOON"], photo: "stored", kind: "x", rev: { a: "confirm", by: "Asha Rao", at: "27/10/2026 18:14" } },
];
const ALL_ROWS = [].concat(TO_CHECK, REJECTED, REVIEWED);
const byId = (id) => ALL_ROWS.find((r) => r.id === id);

/* ---------- List ---------- */
function codeLines(r) {
  const out = [];
  (r.flags || []).forEach((c) => out.push(`<span class="rv-line t-warn">${ic(FLAG[c].icon)}<span>${FLAG[c].title} <span class="code">${c}</span></span></span>`));
  if (r.reason) out.push(`<span class="rv-line t-danger">${ic(REASON[r.reason].icon)}<span>${REASON[r.reason].title} <span class="code">${r.reason}</span></span></span>`);
  return `<span class="rv-lines">${out.join("")}</span>`;
}
function photoWord(r) {
  if (r.photo === "stored") return `<span class="rv-clip" style="display:inline-flex;gap:6px;align-items:center">${ic("image")}Photo stored</span>`;
  return `<span class="muted rv-clip" style="display:inline-flex;gap:6px;align-items:center">${ic("image-off")}No photo kept</span>`;
}
function resultCell(r, tab) {
  if (tab === "check") return `<div class="res-stack"><span style="display:flex;gap:6px;flex-wrap:wrap">${B.flag}${B[r.dir]}</span>${codeLines(r)}</div>`;
  if (tab === "rejected") {
    const names = r.emp ? (r.claimed ? "Names an employee (code typed)" : "Names an employee") : "Names nobody";
    const extra = r.cooldown ? `<span class="sub">Already counted: nothing to approve</span>` : "";
    return `<div class="res-stack">${B.rej}${codeLines(r)}<span class="sub">${names}</span>${extra}</div>`;
  }
  const dirText = r.dir ? `<span style="margin-left:6px">${B[r.dir]}</span>` : "";
  return `<div class="res-stack"><span>${reviewBadge(r.rev.a)}</span>${codeLines(r)}<span class="sub">by ${r.rev.by}, ${r.rev.at}</span></div>`;
}
function empCell(r) {
  if (r.emp) return `<span class="rv-who"><b>${r.emp[0]}</b><span class="code sub">${r.emp[1]}${r.claimed ? " · code typed" : ""}</span></span>`;
  return `<span class="quiet">${ic("circle-help")}Unknown</span>`;
}
function timeCell(r) {
  const off = r.off ? `<span class="rv-offline" style="margin-top:4px">${ic("hourglass")}Saved offline, sent ${r.off.delay} later</span>` : "";
  return `<span class="time" style="display:block">${r.t}</span><span class="sub">${r.date === "28/10/2026" ? "Today" : r.date}</span>${off}`;
}
function rowClass(r, tab, openId) {
  return [tab === "check" ? "is-flag" : tab === "rejected" ? "is-rej" : "is-done", r.cooldown ? "is-muted" : "", openId === r.id ? "is-open" : ""].join(" ");
}
function actionBtn(r, tab) {
  const label = tab === "reviewed" ? "Open" : r.cooldown ? "Details" : "Review";
  const aria = `${label} the punch of ${r.emp ? r.emp[0] : "an unknown person"} at ${r.t}`;
  return `<button class="btn ${tab === "check" ? "btn-primary" : "btn-outline"}" aria-label="${aria}">${label}${ic("chevron-right")}</button>`;
}
function tableHtml(rows, tab, openId) {
  const trs = rows.map((r) => `<tr class="${rowClass(r, tab, openId)}"><td class="c-time">${timeCell(r)}</td><td class="c-emp">${empCell(r)}</td>
    <td class="c-dev"><b style="font-weight:600;white-space:nowrap">${r.plant}</b><span class="sub">${r.dev}</span><span style="display:block;margin-top:6px">${B[r.m]}</span></td><td class="c-res">${resultCell(r, tab)}<span class="sub" style="margin-top:6px">${photoWord(r)}</span></td><td style="text-align:right">${actionBtn(r, tab)}</td></tr>`).join("");
  return `<div class="ptable-wrap table-scroll"><table class="table ptable rvtable"><caption class="sr-only">Punches that need a review</caption><thead><tr><th scope="col">Time</th><th scope="col">Employee</th><th scope="col">Plant, device and method</th><th scope="col">Result, why and photo</th><th scope="col"><span class="sr-only">Open</span></th></tr></thead><tbody>${trs}</tbody></table></div>`;
}
function cardsHtml(rows, tab, openId) {
  return `<div class="pcards">` + rows.map((r) => {
    const who = r.emp ? r.emp[0] : "Unknown";
    const code = r.emp ? `<span class="code">${r.emp[1]}</span> · ` : "";
    const names = tab === "rejected" ? `<div class="meta" style="margin-top:6px">${r.emp ? (r.claimed ? "Names an employee (code typed)" : "Names an employee") : "Names nobody"}${r.cooldown ? " · Already counted: nothing to approve" : ""}</div>` : "";
    const off = r.off ? `<div class="rv-offline" style="margin-top:6px">${ic("hourglass")}Saved offline, sent ${r.off.delay} later</div>` : "";
    const head = tab === "check" ? `${B.flag}${B[r.dir]}` : tab === "rejected" ? B.rej : reviewBadge(r.rev.a);
    const by = tab === "reviewed" ? `<div class="meta" style="margin-top:6px">by ${r.rev.by}, ${r.rev.at}</div>` : "";
    return `<div class="pcard ${rowClass(r, tab, openId)}"><div class="pcard-top"><b>${who}</b><span class="time">${r.t}</span></div>
      <div class="meta">${code}${r.plant} · ${r.dev} · ${r.date === "28/10/2026" ? "Today" : r.date}</div>${off}
      <div class="badges">${B[r.m]}${head}</div><div style="margin-top:10px">${codeLines(r)}</div>${by}${names}
      <div class="meta" style="margin-top:6px">${photoWord(r)}</div>
      <div class="acts">${actionBtn(r, tab)}</div></div>`;
  }).join("") + `</div>`;
}

function sel(label, value, active) {
  return `<div class="sel ${active ? "is-active" : ""}"><select aria-label="${label}"><option>${value}</option></select>${ic("chevron-down")}</div>`;
}
function filtersHtml(cfg) {
  const rej = cfg.tab === "rejected";
  const f = cfg.filtered || {};
  const active = Object.keys(f).length;
  const nShow = active + (cfg.showCooldown ? 1 : 0);
  return `<div class="rv-filters ${cfg.filtersOpen ? "" : "is-collapsed"}">
    <button class="btn btn-outline btn-lg rv-fbtn" aria-expanded="${cfg.filtersOpen ? "true" : "false"}" aria-controls="rv-fbody">${ic("sliders-horizontal")}<span>Filters</span>${nShow ? `<span class="rv-fcount">${nShow}</span>` : ""}${ic(cfg.filtersOpen ? "chevron-up" : "chevron-down")}</button>
    <div class="rv-fbody" id="rv-fbody">
      <div class="rv-ftop"><div class="datebox"><button class="btn btn-ghost btn-icon" aria-label="Earlier dates">${ic("chevron-left")}</button><span>${ic("calendar-days")}Last 7 days · 22/10 to 28/10/2026</span><button class="btn btn-ghost btn-icon" aria-label="Pick dates">${ic("chevron-down")}</button></div>
        <div class="search-box">${ic("search")}<input class="input" placeholder="Employee code or name" aria-label="Employee code or name" value="${f.q || ""}" /></div></div>
      <div class="rv-frow">
        ${sel("Plant", f.plant ? "Plant: " + f.plant : "Plant: all", !!f.plant)}
        ${sel("Attendance device", "Attendance device: any", false)}
        ${sel("Code (flag or reason)", "Code: any", false)}
        ${sel("Method", "Method: card or face", false)}
        ${sel("Saved offline", f.offline ? "Saved offline: yes" : "Saved offline: any", !!f.offline)}
        ${rej ? sel("Names an employee", f.names ? "Names an employee: " + f.names : "Names an employee: any", !!f.names) : ""}
      </div>
      ${rej ? `<label class="rv-show"><input type="checkbox" ${cfg.showCooldown ? "checked" : ""} /><span>Show already-punched<small>Include scans that came a moment after a punch that already counts. They have nothing to approve.</small></span></label>` : ""}
    </div></div>`;
}
function tabsHtml(tab) {
  const t = (id, icon, label, n) => `<button class="rv-tab" role="tab" aria-selected="${tab === id}" tabindex="${tab === id ? 0 : -1}">${ic(icon)}<span>${label}</span>${n ? `<span class="n n-warn" aria-label="${n} to check">${n}</span>` : ""}</button>`;
  return `<div class="rv-tabs" role="tablist" aria-label="Review lists">${t("check", "flag", "To check", 7)}${t("rejected", "circle-x", "Rejected")}${t("reviewed", "circle-check", "Reviewed")}</div>`;
}

function listBodyHtml(cfg) {
  if (cfg.state === "loading") return `<div aria-busy="true" style="padding:16px;display:grid;gap:12px">${'<div class="skeleton" style="height:64px"></div>'.repeat(5)}</div>`;
  if (cfg.state === "error") return `<div class="alert alert-danger err-rv" role="alert">${ic("triangle-alert")}<div style="flex:1"><b style="display:block">The list could not be loaded.</b>Check the internet and try again. Nothing was changed.</div><button class="btn btn-outline">${ic("refresh-cw")}Try again</button></div>`;
  if (cfg.state === "empty-check") return `<div class="empty-rv"><div class="big-icon">${ic("circle-check")}</div><h2>Nothing to check. Well done.</h2><p>Every flagged punch of these dates has been reviewed. New ones appear here by themselves.</p><button class="btn btn-outline btn-lg">${ic("history")}See reviewed punches</button></div>`;
  if (cfg.state === "empty-rejected") return `<div class="empty-rv"><div class="big-icon" style="color:var(--primary)">${ic("shield-check")}</div><h2>No rejected punches in these dates.</h2><p>Try a longer date range, or tick "Show already-punched".</p><button class="btn btn-outline btn-lg">${ic("calendar-range")}Change dates</button></div>`;
  if (cfg.state === "empty-filter") return `<div class="empty-rv"><div class="big-icon" style="color:var(--primary)">${ic("search-x")}</div><h2>No punches match these filters.</h2><p>Remove a filter to see more.</p><button class="btn btn-outline btn-lg">${ic("x")}Clear filters</button></div>`;
  let rows = cfg.tab === "check" ? TO_CHECK : cfg.tab === "rejected" ? REJECTED.filter((r) => cfg.showCooldown || !r.cooldown) : REVIEWED;
  if (cfg.filtered && cfg.filtered.offline) rows = rows.filter((r) => r.off);
  if (cfg.filtered && cfg.filtered.plant) rows = rows.filter((r) => r.plant === cfg.filtered.plant);
  return tableHtml(rows, cfg.tab, cfg.openId) + cardsHtml(rows, cfg.tab, cfg.openId);
}
function listPage(cfg) {
  const rows = cfg.tab === "check" ? TO_CHECK : cfg.tab === "rejected" ? REJECTED.filter((r) => cfg.showCooldown || !r.cooldown) : REVIEWED;
  let shown = rows.length;
  if (cfg.filtered && cfg.filtered.offline) shown = rows.filter((r) => r.off).length;
  const nothing = cfg.state && cfg.state.indexOf("empty") === 0;
  const count = cfg.state === "loading" ? "Loading…" : cfg.state === "error" ? "–" : nothing ? "0 punches" : `${shown} ${shown === 1 ? "punch" : "punches"} · newest first`;
  const fresh = cfg.filtered && Object.keys(cfg.filtered).length ? `<div class="rv-fresh" style="padding:0 16px 10px">${ic("filter")}Filters on: <b style="color:var(--foreground)">${Object.keys(cfg.filtered).length}</b><button class="rv-clear">Clear filters</button></div>` : "";
  return `<div class="page-head anim-fade-up"><div><h1 class="page-title">Needs review</h1>
    <p class="page-desc">Punches the system flagged or rejected. Flagged punches already count; decide whether they should. Times in IST.</p></div>
    <div class="head-actions"><span class="role-chip">${ic("lock")}Super Admin only</span></div></div>
    <div class="card" style="overflow:hidden">${tabsHtml(cfg.tab)}${filtersHtml(cfg)}${fresh}
    <div class="countbar"><span aria-live="polite">${count}</span><span>${ic("radio")}<b style="color:var(--foreground)">Live</b> · updates every 30 s</span></div>
    ${listBodyHtml(cfg)}
    <div class="table-foot"><span>${nothing || cfg.state === "loading" || cfg.state === "error" ? "" : `Showing 1–${shown} of ${shown}`}</span><div class="pager"><button class="btn btn-outline" disabled aria-label="Previous page">${ic("chevron-left")}</button><button class="btn btn-outline" disabled aria-label="Next page">${ic("chevron-right")}</button></div></div></div>`;
}

/* ---------- Map drawings (Leaflet + OpenStreetMap / Esri in the build; here a drawn SVG, not a real place) ---------- */
function mapBase(sat, failed) {
  if (failed) return `<rect width="520" height="300" fill="#f4f5f7"/>`;
  if (!sat) return `<rect width="520" height="300" fill="#eceff3"/>
    <rect x="20" y="20" width="60" height="50" fill="#dde2ea"/><rect x="480" y="30" width="30" height="80" fill="#dde2ea"/><rect x="150" y="248" width="120" height="40" fill="#dde2ea"/><rect x="300" y="262" width="90" height="30" fill="#dde2ea"/><rect x="20" y="200" width="46" height="60" fill="#dde2ea"/>
    <rect x="440" y="215" width="60" height="70" fill="#dbe9d8"/><rect x="170" y="8" width="90" height="26" fill="#dbe9d8"/>
    <path d="M0 262 L520 244" stroke="#fff" stroke-width="14"/><path d="M70 0 L92 300" stroke="#fff" stroke-width="10"/><path d="M0 28 L520 40" stroke="#fff" stroke-width="8"/><path d="M468 0 L446 300" stroke="#fff" stroke-width="12"/>`;
  return `<rect width="520" height="300" fill="#3d4b3c"/><rect x="20" y="20" width="60" height="50" fill="#566352"/><rect x="480" y="30" width="30" height="80" fill="#6b6a62"/><rect x="150" y="248" width="120" height="40" fill="#6f6e66"/><rect x="440" y="215" width="60" height="70" fill="#2f4630"/><rect x="170" y="8" width="90" height="26" fill="#2f4630"/><rect x="20" y="200" width="46" height="60" fill="#5c5b54"/>
    <path d="M0 262 L520 244" stroke="#8a8a80" stroke-width="12"/><path d="M70 0 L92 300" stroke="#8a8a80" stroke-width="8"/><path d="M0 28 L520 40" stroke="#8a8a80" stroke-width="6"/><path d="M468 0 L446 300" stroke="#8a8a80" stroke-width="10"/>`;
}
const FENCE = "120,80 330,60 400,110 392,210 150,220 100,150";
function pill(x, y, w, text) {
  return `<g transform="translate(${x} ${y})"><rect x="0" y="-15" width="${w}" height="22" rx="11" fill="#fff" stroke="#0e1726" stroke-width="1.2"/><text x="${w / 2}" y="0" text-anchor="middle" font-size="13" font-weight="700" fill="#0e1726" font-family="Inter,sans-serif">${text}</text></g>`;
}
function fenceMap(o) {
  const sat = o.sat, px = o.outside ? 490 : 426, py = 150, r = o.outside ? 24 : 19;
  const stroke = sat ? "#9fb6ff" : "#1f3a93";
  const dist = o.outside ? "62 m" : "18 m";
  const label = o.outside ? "08:01" : "07:58";
  return `<svg class="map-svg" viewBox="0 0 520 300" role="img" aria-label="${o.outside ? "Map: the punch point is 62 metres outside the drawn fence and 37 metres beyond the 25 metre margin." : "Map: the punch point is 18 metres outside the drawn fence and inside the 25 metre margin."}">
    ${mapBase(sat, o.failed)}
    <g transform="translate(250 140) scale(1.27) translate(-250 -140)"><polygon points="${FENCE}" fill="rgba(245,183,0,.10)" stroke="${sat ? "#ffd666" : "#8f5300"}" stroke-width="2" stroke-dasharray="7 5" vector-effect="non-scaling-stroke"/></g>
    <polygon points="${FENCE}" fill="rgba(31,58,147,.18)" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
    <text x="235" y="150" text-anchor="middle" font-size="14" font-weight="700" fill="${sat ? "#fff" : "#1a3282"}" font-family="Inter,sans-serif">Plant K134 fence</text>
    <circle cx="${px}" cy="${py}" r="${r}" fill="rgba(180,35,24,.18)" stroke="#b42318" stroke-width="2" stroke-dasharray="2 3"/>
    <line x1="397" y1="${py}" x2="${px - 7}" y2="${py}" stroke="#b42318" stroke-width="2.5"/><line x1="397" y1="${py - 7}" x2="397" y2="${py + 7}" stroke="#b42318" stroke-width="2.5"/>
    <circle cx="${px}" cy="${py}" r="7" fill="#b42318" stroke="#fff" stroke-width="2.5"/>
    ${pill(px - 28, 116, 56, label)}
    ${pill(px - 90, 188, 54, dist)}
    <g transform="translate(24 284)"><rect x="-6" y="-16" width="108" height="24" rx="6" fill="rgba(255,255,255,.86)"/><path d="M0 0 H80 M0 -5 V5 M80 -5 V5" stroke="#0e1726" stroke-width="2"/><text x="88" y="4" font-size="12" font-weight="700" fill="#0e1726" font-family="Inter,sans-serif">50 m</text></g>
  </svg>`;
}
function travelMap(o) {
  const sat = o.sat;
  const stroke = sat ? "#9fb6ff" : "#1f3a93";
  return `<svg class="map-svg" viewBox="0 0 520 300" role="img" aria-label="Map: two punches 2.4 kilometres apart. Point 1 at K134 at 07:39, point 2 at X280 at 07:41.">
    ${mapBase(sat)}
    <polygon points="108,176 150,170 156,198 114,206" fill="rgba(31,58,147,.2)" stroke="${stroke}" stroke-width="3"/>
    <polygon points="378,84 420,80 426,108 382,114" fill="rgba(31,58,147,.2)" stroke="${stroke}" stroke-width="3"/>
    <line x1="132" y1="188" x2="402" y2="97" stroke="#b42318" stroke-width="3" stroke-dasharray="9 6"/>
    ${pill(205, 150, 128, "2.4 km apart")}
    <circle cx="132" cy="188" r="14" fill="rgba(180,35,24,.16)" stroke="#b42318" stroke-dasharray="2 3"/>
    <circle cx="402" cy="97" r="14" fill="rgba(180,35,24,.16)" stroke="#b42318" stroke-dasharray="2 3"/>
    <g font-family="Inter,sans-serif" font-weight="800" font-size="15" text-anchor="middle"><circle cx="132" cy="188" r="13" fill="#0e1726" stroke="#fff" stroke-width="2.5"/><text x="132" y="193.5" fill="#fff">1</text><circle cx="402" cy="97" r="13" fill="#b42318" stroke="#fff" stroke-width="2.5"/><text x="402" y="102.5" fill="#fff">2</text></g>
    <g font-family="Inter,sans-serif" font-weight="700" font-size="13" fill="${sat ? "#fff" : "#0e1726"}"><text x="132" y="224" text-anchor="middle">K134 · 07:39</text><text x="402" y="64" text-anchor="middle">X280 · 07:41</text></g>
    <g transform="translate(24 284)"><rect x="-6" y="-16" width="108" height="24" rx="6" fill="rgba(255,255,255,.86)"/><path d="M0 0 H58 M0 -5 V5 M58 -5 V5" stroke="#0e1726" stroke-width="2"/><text x="66" y="4" font-size="12" font-weight="700" fill="#0e1726" font-family="Inter,sans-serif">500 m</text></g>
  </svg>`;
}
function mapBlock(o) {
  const svg = o.kind === "travel" ? travelMap(o) : fenceMap(o);
  const fail = o.failed ? `<div class="map-fail" role="status">${ic("wifi-off")}<span><b>The map pictures could not be loaded.</b> The fence and the punch point are still drawn below, without the street map.</span></div>` : "";
  const cap = o.kind === "travel"
    ? `<div class="map-cap">${ic("route")}<div>2.4 km between the two punches<small>Both points with their accuracy circles. Dashed line = shortest distance.</small></div></div>`
    : o.outside
      ? `<div class="map-cap">${ic("map-pin-off")}<div>62 m outside the drawn fence, 37 m beyond the 25 m margin<small>Location accuracy ±15 m. The device could not be inside the plant.</small></div></div>`
      : `<div class="map-cap">${ic("map-pin")}<div>18 m outside the drawn fence, inside the 25 m margin<small>Location accuracy ±12 m, reading 3 s old.</small></div></div>`;
  const legend = o.kind === "travel"
    ? `<div class="map-legend"><span><i class="sw" style="border:3px solid var(--primary);background:rgba(31,58,147,.18)"></i>Fence of each plant</span><span><i class="sw" style="width:14px;height:14px;border-radius:99px;background:#0e1726"></i>1 earlier punch</span><span><i class="sw" style="width:14px;height:14px;border-radius:99px;background:#b42318"></i>2 this punch</span><span><i class="sw" style="border-top:3px dashed #b42318;height:0"></i>Distance</span></div>`
    : `<div class="map-legend"><span><i class="sw" style="border:3px solid var(--primary);background:rgba(31,58,147,.18)"></i>Fence (as drawn on 12/10/2026)</span><span><i class="sw" style="border:2px dashed #8f5300"></i>25 m margin</span><span><i class="sw" style="width:14px;height:14px;border-radius:99px;background:#b42318"></i>Punch point</span><span><i class="sw" style="width:16px;height:16px;border-radius:99px;border:2px dotted #b42318;background:rgba(180,35,24,.15)"></i>Accuracy</span></div>`;
  const ver = o.kind === "travel" ? "Fences current on 28/10/2026" : "Fence version of 12/10/2026 (current at punch time)";
  const body = svg;
  return `<div class="mapbox">${fail}<div class="map-bar"><span class="map-ver">${ic("history")}${ver}</span><div class="seg" role="group" aria-label="Map type"><button aria-pressed="${!o.sat}">${ic("map")}Map</button><button aria-pressed="${!!o.sat}">${ic("satellite")}Satellite</button></div></div>${body}<div class="map-attr">${o.sat ? "Imagery © Esri World Imagery" : "© OpenStreetMap contributors"} · drawing for the mockup</div>${cap}${legend}</div>`;
}

/* ---------- Detail sheet pieces ---------- */
function flagBoxes(r) {
  let h = (r.flags || []).map((c) => `<div class="flagbox">${ic(FLAG[c].icon)}<div><b>${FLAG[c].title} <span class="code">${c}</span></b><span>${FLAG[c].help}</span></div></div>`).join("");
  if (r.reason) h += `<div class="flagbox is-rej">${ic(REASON[r.reason].icon)}<div><b>${REASON[r.reason].title} <span class="code">${r.reason}</span></b><span>${REASON[r.reason].help}</span></div></div>`;
  return h;
}
function hintsBlock(list) {
  if (!list || !list.length) return "";
  return `<div class="hints" role="note"><p class="hints-title">Seen in the last 7 days. Hints only: nothing is blocked.</p>${list.map((h) => `<div class="hint">${ic("lightbulb")}<span>${h[0]} <a href="#">${h[1]}</a></span></div>`).join("")}</div>`;
}
function countsLine(r) {
  if (r.rev) return r.rev.a === "not_accepted" ? `<span class="badge badge-danger">${ic("circle-x")}Does not count</span>` : `<span class="badge badge-success">${ic("circle-check")}Counts${r.rev.a === "approve_out" ? " as OUT" : r.rev.a === "approve_in" ? " as IN" : r.dir ? " as " + r.dir.toUpperCase() : ""}</span>`;
  if (r.flags) return `<span class="badge badge-warning">${ic("hourglass")}Counts as ${r.dir.toUpperCase()} until you decide</span>`;
  return `<span class="badge badge-neutral">${ic("ban")}Does not count</span>`;
}
function summaryBlock(r, extraRows) {
  const emp = r.emp
    ? `<b>${r.emp[0]}</b> · <span class="code">${r.emp[1]}</span> <a class="linkline" href="#">Open employee</a>`
    : `<span class="quiet">Unknown</span>`;
  const decision = r.rev ? reviewBadge(r.rev.a) : r.flags ? `${B.flag} ${B[r.dir]}` : B.rej;
  return `<section class="sec"><h3>${ic("list")}Punch</h3>
    <div>${flagBoxes(r)}</div>
    <dl class="kv2" style="margin-top:14px">
      <dt>Employee</dt><dd>${emp}</dd>
      <dt>Method</dt><dd>${B[r.m]}</dd>
      <dt>Decision</dt><dd>${decision}</dd>
      <dt>Counts</dt><dd>${countsLine(r)}</dd>
      <dt>Plant</dt><dd><span class="code">${r.plant}</span></dd>
      <dt>Attendance device</dt><dd>${r.dev}</dd>${extraRows || ""}
    </dl></section>`;
}
function timeBlock(r, serverTime) {
  let h = `<section class="sec"><h3>${ic("clock")}Time</h3><dl class="kv2"><dt>Server received</dt><dd class="tnum">${r.date} ${serverTime || r.t + ":14"} IST</dd>`;
  if (r.off) {
    h += `<dt>Punch time</dt><dd class="tnum"><b>${r.date} ${r.t}:12 IST</b></dd><dt>Delay</dt><dd>${r.off.delay} (saved offline, sent later)</dd></dl>`;
    h += r.off.proof === "anchored"
      ? `<div class="proof ok">${ic("shield-check")}<div><b>Time proof: anchored to server time</b><small>The attendance device last heard from the server at 05:52:40 and its clock was checked from that moment. The punch time can be trusted.</small></div></div>`
      : `<div class="proof warn">${ic("triangle-alert")}<div><b>⚠ Time not proven (device restarted while offline)</b><small>The punch time is the device's own clock. Compare it with the photo and the shift before you decide.</small></div></div>`;
  } else h += `<dt>Punch time</dt><dd>Same as the server time (online punch)</dd></dl>`;
  return h + `</section>`;
}
function photoBlock(r) {
  if (r.photo === "stored") return `<section class="sec"><h3>${ic("image")}Photo ${`<span class="sa-only">${ic("lock")}Super Admin only</span>`}</h3><div class="photo-box"><span class="photo-ph">${ic("image")}</span><div><p><b>Photo stored</b>, kept until 26/12/2026</p><small>Opening the photo is recorded in the audit log.</small><div style="margin-top:8px"><button class="btn btn-outline btn-lg">${ic("eye")}View photo</button></div></div></div></section>`;
  return `<section class="sec"><h3>${ic("image")}Photo</h3><div class="photo-box"><span class="photo-ph">${ic("image-off")}</span><div><p><b>No photo kept for this punch.</b></p><small>Accepted face punches are checked in memory and never stored.</small></div></div></section>`;
}
function historyBlock(list) {
  if (!list || !list.length) return `<section class="sec"><h3>${ic("history")}Review history</h3><p class="muted" style="margin:0;font-size:14px">Not reviewed yet.</p></section>`;
  const dot = { confirm: "background:var(--success-soft);color:var(--success);border-color:#bfe3d2", not_accepted: "background:var(--danger-soft);color:var(--danger);border-color:#f2c2bc", approve_in: "background:var(--primary-soft);color:var(--primary-soft-foreground);border-color:#cdd6f4", approve_out: "background:var(--primary-soft);color:var(--primary-soft-foreground);border-color:#cdd6f4" };
  return `<section class="sec"><h3>${ic("history")}Review history</h3><ol class="rh">${list.map((h, i) => `<li><span class="dotc" style="${dot[h.a]}">${ic(REVIEW_LABEL[h.a].icon)}</span><div class="${i ? "old" : ""}"><b>${REVIEW_LABEL[h.a].text}${i === 0 ? '<span class="cur">current</span>' : ""}</b><span style="font-size:13px">${h.by} · ${h.at}</span>${h.why ? `<div class="why">${h.why}</div>` : ""}</div></li>`).join("")}</ol></section>`;
}
function pairBlock() {
  const col = (n, label, tm, dev, plant, method, dec, here) => `<div class="pcol ${here ? "is-this" : ""}"><h4><span class="badge badge-neutral" style="height:22px">${n}</span>${label}</h4><div class="tm">${tm}</div>
    <dl><dt>Device</dt><dd>${dev}</dd><dt>Plant</dt><dd><span class="code">${plant}</span></dd><dt>Method</dt><dd>${method}</dd><dt>Decision</dt><dd>${dec}</dd></dl><button class="btn btn-outline">${ic("eye")}View photo</button></div>`;
  return `<section class="sec"><h3>${ic("columns-2")}The two punches</h3><div class="pair">
    ${col(1, "Earlier punch", "07:39:05", "Main gate phone", "K134", B.card, B.in, false)}
    ${col(2, "This punch", "07:41:20", "Gate PC", "X280", B.card, B.flag + " " + B.in, true)}</div>
    <div class="speed">${ic("gauge")}<div>2.4 km in 2 min = 72 km/h; limit 60 km/h<small>The same card moved faster than a person can travel between these two plants.</small></div></div></section>`;
}

/* ---------- Actions and the sheet ---------- */
function sheetFoot(kind) {
  const nextNote = `<div class="next">${ic("corner-down-right")}After you decide, the next punch opens.</div>`;
  if (kind === "flagged") return `<div class="sheet-foot"><button class="btn btn-danger-outline btn-lg">${ic("circle-x")}Not accepted</button><button class="btn btn-primary btn-lg">${ic("circle-check")}Confirm</button>${nextNote}</div>`;
  if (kind === "approve") return `<div class="sheet-foot"><button class="btn btn-primary btn-lg">${ic("circle-check")}Approve</button>${nextNote}</div>`;
  if (kind === "nobody") return `<div class="sheet-foot"><div class="nobody">${ic("user-x")}<div>No employee is known for this punch.<small>There is nobody to count it for, so there is no action. It stays here for your records.</small></div></div></div>`;
  if (kind === "cooldown") return `<div class="sheet-foot"><div class="nobody">${ic("repeat")}<div>This punch was a repeat scan.<small>A punch of this person already counts a moment before. Nothing to approve.</small></div></div></div>`;
  if (kind === "reviewed") return `<div class="sheet-foot"><button class="btn btn-outline btn-lg">${ic("pencil")}Change review</button><div class="next">${ic("info")}The old review stays in the history above.</div></div>`;
  return "";
}
function sheetHead(r, title, tone, icon, pos) {
  const colors = { warn: "var(--warning-soft);color:var(--warning)", danger: "var(--danger-soft);color:var(--danger)", ok: "var(--success-soft);color:var(--success)" };
  const nav = pos ? `<div class="sheet-nav"><span class="pos">${pos}</span><button class="btn btn-ghost btn-icon" aria-label="Previous punch">${ic("chevron-up")}</button><button class="btn btn-ghost btn-icon" aria-label="Next punch">${ic("chevron-down")}</button></div>` : `<div class="sheet-nav"></div>`;
  return `<div class="sheet-head"><div class="dlg-icon" style="background:${colors[tone]}">${ic(icon)}</div><div style="min-width:0"><h2>${title}</h2><p class="tnum">${r.date} ${r.t} IST · ${r.dev} · ${r.plant}</p></div>${nav}<button class="btn btn-ghost btn-icon close" aria-label="Close (Esc)">${ic("x")}</button></div>`;
}
function sheetShell(head, body, foot, label) {
  return `<div class="overlay"></div><aside class="sheet anim-sheet-r" role="dialog" aria-modal="true" aria-label="${label || "Punch review"}">${head}<div class="sheet-body">${body}</div>${foot}</aside>`;
}
function sheetLoading(r) {
  return `<div class="overlay"></div><aside class="sheet anim-sheet-r" role="dialog" aria-modal="true" aria-busy="true" aria-label="Punch review">${sheetHead(r, "Loading the punch…", "warn", "loader")}<div class="sheet-body"><div class="skel-lines">${'<div class="skeleton"></div>'.repeat(4)}</div><div class="skeleton" style="height:230px;margin-top:20px"></div><div class="skeleton" style="height:56px;margin-top:12px"></div></div></aside>`;
}
function sheetError(r) {
  return `<div class="overlay"></div><aside class="sheet anim-sheet-r" role="dialog" aria-modal="true" aria-label="Punch review">${sheetHead(r, "Could not open this punch", "danger", "triangle-alert")}<div class="sheet-body"><div class="alert alert-danger" role="alert">${ic("triangle-alert")}<div style="flex:1"><b style="display:block">The details could not be loaded.</b>Check the internet and try again. Nothing was changed.</div></div><button class="btn btn-outline btn-lg" style="margin-top:12px">${ic("refresh-cw")}Try again</button></div></aside>`;
}

/* One builder per detail state used by 02-detail.html and 03-dialogs.html */
function buildSheet(state) {
  const sat = state === "edge-satellite";
  switch (state) {
    case "edge": case "edge-satellite": case "map-failed": {
      const r = byId("c1");
      const body = summaryBlock(r) + `<section class="sec"><h3>${ic("map")}Where the punch was made</h3>${mapBlock({ kind: "edge", sat: sat, failed: state === "map-failed" })}</section>` + timeBlock(r) + photoBlock(r) + historyBlock([]);
      return sheetShell(sheetHead(r, "Flagged · At the edge of the fence", "warn", "flag", "1 of 7"), body, sheetFoot("flagged"));
    }
    case "travel": {
      const r = byId("c2");
      const body = summaryBlock(r) + hintsBlock([["This card was used at two attendance devices 2 times this week", "Show those punches"]]) + pairBlock() + `<section class="sec"><h3>${ic("map")}Where the two punches were made</h3>${mapBlock({ kind: "travel" })}</section>` + timeBlock(r) + photoBlock(r) + historyBlock([]);
      return sheetShell(sheetHead(r, "Flagged · Impossible travel", "warn", "flag", "2 of 7"), body, sheetFoot("flagged"));
    }
    case "offline-anchored": {
      const r = byId("c6");
      const body = summaryBlock(r) + timeBlock(r, "08:02:31") + `<section class="sec"><h3>${ic("map-pin")}Location</h3><dl class="kv2"><dt>Reading</dt><dd>Inside the fence, ±9 m</dd><dt>Age of the reading</dt><dd>3 min 40 s (limit 3 min)</dd></dl></section>` + photoBlock(r) + historyBlock([]);
      return sheetShell(sheetHead(r, "Flagged · Location reading was old", "warn", "flag", "6 of 7"), body, sheetFoot("flagged"));
    }
    case "offline-unproven": {
      const r = byId("c3");
      const body = summaryBlock(r) + timeBlock(r, "08:22:40") + `<section class="sec"><h3>${ic("map-pin")}Location</h3><dl class="kv2"><dt>Reading</dt><dd>Inside the fence, ±11 m</dd></dl></section>` + photoBlock(r) + historyBlock([]);
      return sheetShell(sheetHead(r, "Flagged · Time not proven", "warn", "flag", "3 of 7"), body, sheetFoot("flagged"));
    }
    case "hints": {
      const r = byId("c4");
      const body = summaryBlock(r) + hintsBlock([["EMP-0123 was rejected 3 times this week", "Show those punches"], ["This attendance device had 24 fence-edge flags this week – check its location or the fence margin", "Show those punches"]]) + `<section class="sec"><h3>${ic("map")}Where the punch was made</h3>${mapBlock({ kind: "edge" })}</section>` + timeBlock(r) + photoBlock(r) + historyBlock([]);
      return sheetShell(sheetHead(r, "Flagged · At the edge of the fence", "warn", "flag", "4 of 7"), body, sheetFoot("flagged"));
    }
    case "rejected-outside": {
      const r = byId("r1");
      const body = summaryBlock(r) + `<section class="sec"><h3>${ic("map")}Where the punch was made</h3>${mapBlock({ kind: "edge", outside: true })}</section>` + timeBlock(r) + photoBlock(r) + historyBlock([]);
      return sheetShell(sheetHead(r, "Rejected · Outside the plant fence", "danger", "circle-x", "1 of 5"), body, sheetFoot("approve"));
    }
    case "rejected-code": {
      const r = byId("r2");
      const claim = `<div class="claim" style="margin-top:12px"><span class="avatar">RP</span><div><b>Code typed: <span class="code">EMP-0457</span> – face did not match</b><span>Ramesh Patil · K134 · Worker. Someone typed this employee's code, but the face was not alike enough. Look at the photo: this can be a proxy attempt.</span></div></div>`;
      const body = summaryBlock(r).replace(`</dl></section>`, `</dl>${claim}</section>`) + timeBlock(r) + photoBlock(r) + historyBlock([]);
      return sheetShell(sheetHead(r, "Rejected · Face not recognised", "danger", "circle-x", "2 of 5"), body, sheetFoot("approve"));
    }
    case "rejected-nobody": {
      const r = byId("r3");
      const body = summaryBlock(r) + timeBlock(r) + photoBlock(r) + historyBlock([]);
      return sheetShell(sheetHead(r, "Rejected · Head did not turn", "danger", "circle-x", "3 of 5"), body, sheetFoot("nobody"));
    }
    case "rejected-cooldown": {
      const r = byId("r6");
      const body = summaryBlock(r) + timeBlock(r) + photoBlock(r) + historyBlock([]);
      return sheetShell(sheetHead(r, "Rejected · Already punched", "danger", "circle-x", "5 of 6"), body, sheetFoot("cooldown"));
    }
    case "history": {
      const r = byId("v1");
      const body = summaryBlock(r) + `<section class="sec"><h3>${ic("map")}Where the punch was made</h3>${mapBlock({ kind: "edge" })}</section>` + timeBlock(r) + photoBlock(r) + historyBlock([
        { a: "not_accepted", by: "Asha Rao", at: "28/10/2026 09:10", why: "Plant Head says Nilesh was on leave that day. The code was used by someone else." },
        { a: "confirm", by: "Asha Rao", at: "27/10/2026 17:55", why: "Seen on the gate photo, looks like him." }]);
      return sheetShell(sheetHead(r, "Reviewed · Not accepted", "danger", "circle-x"), body, sheetFoot("reviewed"));
    }
    case "loading": return sheetLoading(byId("c1"));
    case "error": return sheetError(byId("c1"));
  }
  return "";
}

/* ---------- Dialogs ---------- */
function dlgFrame(icon, tone, title, desc, body, foot, id) {
  const colors = { warn: "var(--warning-soft);color:var(--warning)", danger: "var(--danger-soft);color:var(--danger)", ok: "var(--success-soft);color:var(--success)", info: "var(--primary-soft);color:var(--primary)" };
  return `<div class="overlay overlay-2"></div><div class="dialog rd anim-scale-in" role="dialog" aria-modal="true" aria-labelledby="${id}-t" aria-describedby="${id}-d">
    <div class="dlg-head"><div class="dlg-icon" style="background:${colors[tone]}">${ic(icon)}</div><div style="flex:1"><h2 class="dlg-title" id="${id}-t">${title}</h2><p class="dlg-desc" id="${id}-d">${desc}</p></div><button class="btn btn-ghost btn-icon" aria-label="Close" style="margin-top:-6px">${ic("x")}</button></div>
    <div class="dlg-body">${body}</div><div class="dlg-foot">${foot}</div></div>`;
}
function whoBox(name, code, line) {
  const ini = name.split(" ").map((p) => p[0]).join("");
  return `<div class="who"><span class="avatar">${ini}</span><div><b>${name} · <span class="code">${code}</span></b><span>${line}</span></div></div>`;
}
function reasonField(id, label, required, value, error, hint) {
  const n = value ? value.length : 0;
  return `<div><div class="fl"><label class="label" for="${id}">${label}${required ? ' <span style="color:var(--danger)" aria-hidden="true">*</span> <span class="sr-only">(required)</span>' : ' <span class="muted" style="font-weight:400">(optional)</span>'}</label><span class="ct" id="${id}-c">${n} / 300</span></div>
    <textarea id="${id}" maxlength="300" ${error ? 'aria-invalid="true" aria-describedby="' + id + '-e"' : 'aria-describedby="' + id + '-h"'} placeholder="${hint}">${value || ""}</textarea>
    ${error ? `<div class="field-error" id="${id}-e" role="alert">${ic("circle-alert")}${error}</div>` : `<div class="help" id="${id}-h">${required ? "3 to 300 characters. It is saved in the audit log." : "Up to 300 characters. It is saved in the audit log."}</div>`}</div>`;
}
const cancelBtn = `<button class="btn btn-outline btn-lg">Cancel</button>`;

function buildDialog(state) {
  const flaggedWho = whoBox("Sunita Jadhav", "EMP-0312", "Flagged IN at 07:58 · At the edge of the fence · Main gate phone");
  switch (state) {
    case "confirm":
      return dlgFrame("circle-check", "ok", "Confirm this punch", "You checked the flag and the punch is fine. It keeps counting as IN.", flaggedWho + reasonField("note", "Note", false, "", "", "For example: checked the photo, all fine"), `${cancelBtn}<button class="btn btn-primary btn-lg">${ic("circle-check")}Confirm</button>`, "d1");
    case "not-accepted":
      return dlgFrame("circle-x", "danger", "Not accepted", "Say why this punch should not count.", flaggedWho + reasonField("why", "Reason", true, "", "", "Why is this punch not accepted?") + `<div class="warnbox warnbox-danger">${ic("triangle-alert")}<span><b>This punch will no longer count as IN/OUT.</b> You can change your mind later with "Change review".</span></div>`, `${cancelBtn}<button class="btn btn-danger btn-lg" style="background:var(--danger);color:#fff">${ic("circle-x")}Not accepted</button>`, "d2");
    case "not-accepted-error":
      return dlgFrame("circle-x", "danger", "Not accepted", "Say why this punch should not count.", flaggedWho + reasonField("why", "Reason", true, "ok", "Write at least 3 characters.", "Why is this punch not accepted?") + `<div class="warnbox warnbox-danger">${ic("triangle-alert")}<span><b>This punch will no longer count as IN/OUT.</b> You can change your mind later with "Change review".</span></div>`, `${cancelBtn}<button class="btn btn-danger btn-lg" style="background:var(--danger);color:#fff">${ic("circle-x")}Not accepted</button>`, "d3");
    case "approve": case "approve-error": case "approve-submitting": {
      const rcard = (id, icon, label, sugg, on) => `<label class="rcard ${on ? "is-on" : ""}"><input type="radio" name="dir" ${on ? "checked" : ""}/><span class="rd-dot"></span><span><b>${ic(icon)}${label}${sugg ? ' <span class="badge badge-suggested">Suggested</span>' : ""}</b><small>${sugg ? "Fits the earlier counted punches of the day" : "Use this if the person really punched the other way"}</small></span></label>`;
      const val = state === "approve" ? "" : state === "approve-error" ? "" : "Location problem at the gate, the supervisor saw him enter.";
      const err = state === "approve-error" ? "Write at least 3 characters." : "";
      const sub = state === "approve-submitting";
      return dlgFrame("circle-check", "info", "Approve this punch", "Count this rejected punch as attendance. It was rejected because the device was outside the plant fence.",
        whoBox("Mahesh Wagh", "T-2102", "Rejected at 08:01 · Outside the plant fence · Main gate phone") +
        `<fieldset style="border:0;margin:0;padding:0"><legend class="label">Count it as</legend><div class="rcards">${rcard("o", "log-in", "Count as IN", false, false)}${rcard("o2", "log-out", "Count as OUT", true, true)}</div></fieldset>` +
        reasonField("why", "Reason", true, val, err, "Why do you approve this punch?") +
        `<div class="warnbox">${ic("triangle-alert")}<span><b>There is a counted OUT at 08:03.</b> Approving may count this person twice. You can still approve.</span></div>`,
        `${cancelBtn}<button class="btn btn-primary btn-lg ${sub ? "btn-spin" : ""}" ${sub ? 'aria-busy="true" aria-disabled="true"' : ""}>${sub ? '<span class="spinner"></span>Saving…' : ic("circle-check") + "Approve as OUT"}</button>`, "d4");
    }
    case "change":
      return dlgFrame("pencil", "info", "Change review", "Your new decision is added. The old one stays in the history.",
        `<div class="cur-review"><b>Now: Confirmed</b>Asha Rao · 28/10/2026 09:05 · "Seen on the gate photo."</div>` + whoBox("Rekha Bhosale", "EMP-0204", "Flagged OUT at 18:55 on 27/10/2026 · At the edge of the fence") +
        `<fieldset style="border:0;margin:0 0 14px;padding:0"><legend class="label">New decision</legend><div class="rcards"><label class="rcard"><input type="radio" name="n"/><span class="rd-dot"></span><span><b>${ic("circle-check")}Confirm</b><small>Keep counting it</small></span></label><label class="rcard is-on"><input type="radio" name="n" checked/><span class="rd-dot"></span><span><b>${ic("circle-x")}Not accepted</b><small>Stop counting it</small></span></label></div></fieldset>` +
        reasonField("why", "Reason", true, "", "", "Why are you changing the review?") + `<div class="warnbox warnbox-danger">${ic("triangle-alert")}<span><b>This punch will no longer count as IN/OUT.</b></span></div>`,
        `${cancelBtn}<button class="btn btn-danger btn-lg" style="background:var(--danger);color:#fff">${ic("circle-x")}Not accepted</button>`, "d5");
    case "conflict":
      return dlgFrame("circle-x", "danger", "Not accepted", "Say why this punch should not count.",
        `<div class="conflict" role="alert">${ic("circle-alert")}<div><b>This punch was reviewed in the meantime.</b><span>Another Super Admin, Meera Patil, confirmed it at 09:12. Nothing was saved. Load the latest and decide again.</span></div></div>` + flaggedWho + reasonField("why", "Reason", true, "The card was shown by someone else.", "", ""),
        `${cancelBtn}<button class="btn btn-primary btn-lg">${ic("refresh-cw")}Load the latest</button>`, "d6");
    case "server-error":
      return dlgFrame("circle-check", "ok", "Confirm this punch", "You checked the flag and the punch is fine. It keeps counting as IN.",
        `<div class="alert alert-danger" role="alert" style="margin-bottom:14px">${ic("triangle-alert")}<div><b style="display:block">The review could not be saved.</b>Check the internet and press Confirm again. Nothing was changed.</div></div>` + flaggedWho + reasonField("note", "Note", false, "", "", ""),
        `${cancelBtn}<button class="btn btn-primary btn-lg">${ic("circle-check")}Confirm</button>`, "d7");
  }
  return "";
}
function toastHtml() {
  return `<div class="toast-demo" role="status">${ic("circle-check")}<div><b>Confirmed. Next: 07:41 Santosh Gaikwad</b><span>6 punches left to check</span></div></div>`;
}

/* Screenshots only: make the page as tall as the sheet or dialog so the dim layer covers everything. */
function fitShot() {
  if (location.search.indexOf("shot") < 0) return;
  setTimeout(function () {
    let h = 0;
    document.querySelectorAll(".sheet, .rd").forEach(function (el) { h = Math.max(h, el.offsetTop + el.offsetHeight); });
    document.body.style.minHeight = h + "px";
  }, 50);
}
