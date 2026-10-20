/*
  Upasthiti – M2 design gate C: kiosk rows (M1 list + the M2 "Sound" switch and "Last self-test"), and the plant
  detail header with the "Download gate poster (A4 PDF)" button. Used by 04-kiosks.html and 06-plant-detail.html.
  Fields follow GET /kiosks (M1 fields + sound_muted, last_self_test_at). MOCKUP ONLY, not app code.
*/
(function () {
  const D = window.D;
  const C = window.C;

  // name, device icon, device line, plant, status, accuracy, accuracy bar %, location line, paired on, last seen, self-test, sound on
  C.KIOSKS = [
    { name: "K134 main gate", icon: "smartphone", dev: "Android · Chrome 141", plant: "K134", status: "active", acc: "± 18 m", bar: 82, accLine: "Inside the geofence", paired: ["12/10/2026", "16:42"], seen: ["2 min ago", "Today 10:13"], test: "20/10 07:58", sound: true },
    { name: "TP1 gate", icon: "monitor", dev: "Windows 11 · Edge 141", plant: "TP1", status: "active", acc: "± 41 m", bar: 30, accLine: "Inside · from Wi-Fi", paired: ["14/10/2026", "11:05"], seen: ["1 min ago", "Today 10:14"], test: null, sound: true },
    { name: "X280 gate", icon: "tablet", dev: "Android · Chrome 141", plant: "X280", status: "active", acc: "± 22 m", bar: 74, accLine: "Inside the geofence", paired: ["13/10/2026", "09:24"], seen: ["1 min ago", "Today 10:14"], test: "19/10 18:30", sound: false },
    { name: "Spare tablet", icon: "tablet", dev: "Not paired yet", plant: "X280", status: "pending", code: "06:12", sound: true },
    { name: "Old gate phone", icon: "smartphone", dev: 'Reason: "Screen broken"', plant: "K134", status: "revoked", acc: "± 12 m", paired: ["02/10/2026", "11:20"], seen: ["10/10/2026", "08:01"], test: "08/10 09:15", revoked: "10/10/2026 · Asha Rao" },
  ];

  const PLANT_SHORT = { K134: "Sheet Shapers (K-134)", X280: "Sheet Shapers (X-280)", TP1: "Tirupati Pressco, Unit 1" };

  function statusCell(k) {
    if (k.status === "active") return '<span class="badge badge-success">' + D.icon("circle-check") + "Active</span>";
    if (k.status === "pending") return '<span class="badge badge-warning">' + D.icon("hourglass") + 'Waiting for pairing</span><div class="muted tnum" style="font-size:12.5px;margin-top:3px">Code ends in ' + k.code + (C.isCh ? "" : ' · <button class="link" style="background:none;border:0;padding:0;font:inherit;font-weight:600;cursor:pointer">New code</button>') + "</div>";
    return '<span class="badge badge-neutral">' + D.icon("ban") + 'Revoked</span><div class="tnum" style="font-size:12.5px;margin-top:3px">' + k.revoked + "</div>";
  }
  function selfTestCell(k) {
    if (k.status === "pending") return '<span class="muted">–</span>';
    if (!k.test) return '<span class="selftest is-never">' + D.icon("circle-dashed") + "Never tested</span>";
    return '<span class="selftest' + (k.status === "revoked" ? " muted" : "") + '">' + D.icon("badge-check") + '<span class="tnum">' + k.test + "</span></span>";
  }
  // Sound: a switch for the Super Admin and the own Plant Head; text for the Corporate Head; nothing for a revoked kiosk
  function soundCell(k, o) {
    if (k.status === "revoked") return '<span class="muted" aria-label="Not used: kiosk revoked">–</span>';
    const on = o.mutedName === k.name ? false : k.sound;
    if (C.isCh) return C.soundText(on);
    return C.switchHtml(on, "Sound at " + k.name);
  }

  C.kioskRow = function (k, o) {
    o = o || {};
    const revoked = k.status === "revoked";
    const actions = C.isCh || revoked ? "" : '<button class="btn btn-ghost btn-icon btn-sm" aria-label="Actions for ' + k.name + '">' + D.icon("ellipsis", 18) + "</button>";
    return '<tr class="' + (revoked ? "is-revoked" : "") + (o.flash === k.name ? " is-new" : "") + '">' +
      '<td style="padding-left:20px"><div class="dev"><span class="dev-icon">' + D.icon(k.icon) + "</span><div><b>" + k.name + '</b><div class="muted" style="font-size:12.5px">' + k.dev + "</div></div></div></td>" +
      (o.hidePlant ? "" : '<td><b class="code" title="' + PLANT_SHORT[k.plant] + '">' + k.plant + "</b></td>") +
      "<td>" + statusCell(k) + "</td>" +
      (k.acc ? '<td><span class="acc tnum">' + k.acc + (k.bar ? ' <span class="acc-bar" aria-hidden="true"><i style="width:' + k.bar + "%;" + (k.bar < 50 ? "background:var(--warning)" : "") + '"></i></span>' : "") + "</span>" + (k.accLine ? '<div class="muted" style="font-size:12.5px">' + k.accLine + "</div>" : "") + "</td>" : '<td class="muted">–</td>') +
      (k.paired ? '<td class="tnum">' + k.paired[0] + '<br/><span class="muted">' + k.paired[1] + "</span></td>" : '<td class="muted">–</td>') +
      (k.seen ? '<td class="tnum">' + k.seen[0] + '<br/><span class="muted">' + k.seen[1] + "</span></td>" : '<td class="muted">Never</td>') +
      "<td>" + selfTestCell(k) + "</td><td>" + soundCell(k, o) + "</td>" +
      (C.isCh ? "" : '<td style="text-align:right">' + actions + "</td>") + "</tr>";
  };

  C.kioskHead = function (o) {
    o = o || {};
    return '<thead><tr><th scope="col" style="padding-left:20px">Kiosk</th>' + (o.hidePlant ? "" : '<th scope="col">Plant</th>') +
      '<th scope="col">Status</th><th scope="col">Location at pairing</th><th scope="col">Paired on</th><th scope="col">Last seen</th>' +
      '<th scope="col">Last self-test</th><th scope="col">Sound</th>' + (C.isCh ? "" : '<th scope="col"><span class="sr-only">Actions</span></th>') + "</tr></thead>";
  };

  C.kioskFootNote = '<div class="kiosk-notes">' +
    "<div>" + D.icon("volume-x") + "<span><b>Sound Off:</b> the kiosk still shows every result, but plays no tones and no voice (for example a gate next to an office). The company-wide switches are in Settings.</span></div>" +
    "<div>" + D.icon("badge-check") + "<span><b>Self-test:</b> scan a TEST card at the kiosk. It shows KIOSK OK and records no attendance.</span></div></div>";

  // ---------- plant detail header (M1 B3 look) + the poster button (M2, F-34) ----------
  const PLANTS = {
    K134: { name: "Sheet Shapers India Pvt Ltd (K-134)", address: "Plot K-134, MIDC Waluj, Aurangabad 431136", kiosks: 2 },
    X280: { name: "Sheet Shapers India Pvt Ltd (X-280)", address: "Plot X-280, MIDC Waluj, Aurangabad 431136", kiosks: 2 },
  };
  C.posterButton = function (big) {
    return '<a class="btn ' + (big ? "btn-primary" : "btn-outline") + '" href="screenshots/poster.pdf" target="_blank" rel="noopener">' + D.icon("printer", 16) + "Download gate poster (A4 PDF)" + D.icon("external-link", 14, "opacity:.7") + "</a>";
  };
  C.plantHeader = function (code, tab) {
    const p = PLANTS[code];
    const tabs = [["overview", "Overview", "layout-grid"], ["geofence", "Geofence", "map-pinned"], ["departments", "Departments", "network", 3], ["shifts", "Shifts", "clock-3", 2], ["categories", "Categories", "tags", 4], ["kiosks", "Kiosks", "tablet-smartphone", p.kiosks]]
      .map(function (t) {
        return '<a class="tab" role="tab" aria-selected="' + (t[0] === tab) + '" href="' + (t[0] === "kiosks" ? "04-kiosks.html#plant-tab" : t[0] === "overview" ? "06-plant-detail.html" : "#") + '">' + D.icon(t[2]) + t[1] + (t[3] !== undefined ? '<span class="tab-count tnum">' + t[3] + "</span>" : "") + "</a>";
      }).join("");
    let actions = "";
    if (C.isSa) actions = '<div class="flex gap-2">' + C.posterButton(false) + '<button class="btn btn-outline">' + D.icon("pencil", 16) + 'Edit details</button><button class="btn btn-ghost btn-icon" aria-label="More actions for ' + code + '">' + D.icon("ellipsis", 18) + "</button></div>";
    if (C.isPh) actions = '<div class="flex gap-2">' + C.posterButton(false) + "</div>";
    return '<nav class="crumbs" aria-label="Breadcrumb"><a href="#" style="color:inherit">Plants</a>' + D.icon("chevron-right", 14) + '<span aria-current="page">' + code + "</span></nav>" +
      '<div class="page-head" style="margin-bottom:0"><div class="plant-title-row"><span class="code-tile code" aria-hidden="true">' + code + "</span><div>" +
      '<div class="flex items-center gap-3 flex-wrap"><h1 class="page-title">' + p.name + '</h1><span class="badge badge-success">' + D.icon("circle-check") + "Active</span></div>" +
      '<p class="page-desc" style="margin-top:4px">' + D.icon("map-pin", 15, "display:inline;vertical-align:-2px") + " " + p.address + "</p></div></div>" + actions + "</div>" +
      '<div class="tabs" role="tablist" aria-label="Plant sections">' + tabs + "</div>";
  };
})();
