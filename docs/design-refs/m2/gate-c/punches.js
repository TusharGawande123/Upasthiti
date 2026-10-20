/*
  Upasthiti – M2 design gate C: the punch log page (/admin/punches), fake data and renderer.
  Used by 01-punch-log.html and as the backdrop of the photo dialogs in 02-photo-dialogs.html.
  Fields follow the real API answer: GET /punches and GET /punches/summary. MOCKUP ONLY, not app code.
*/
(function () {
  const D = window.D;
  const C = window.C;

  // ---------- fake punches (all people invented) ----------
  // t, code, name, unknown (card not identified), hidden (card of another plant, Plant Head view), kiosk, kp (kiosk's plant),
  // dir in|out|null, dec accepted|rejected, reason, snap stored|purged|upload_failed|none, until (expires_at), purged, dark
  C.ROWS_ALL = [
    { t: "10:05:02", code: "T-2050", name: "Nisha Tambe", kiosk: "TP1 gate", kp: "TP1", dir: "in", dec: "accepted", snap: "stored", until: "19/12" },
    { t: "10:04:51", code: "T-2041", name: "Sunil More", kiosk: "K134 main gate", kp: "K134", dir: null, dec: "rejected", reason: "COOLDOWN_ACTIVE", snap: "none" },
    { t: "10:04:38", code: "T-2041", name: "Sunil More", kiosk: "K134 main gate", kp: "K134", dir: "in", dec: "accepted", snap: "stored", until: "19/12" },
    { t: "10:02:15", unknown: true, kiosk: "K134 main gate", kp: "K134", dir: null, dec: "rejected", reason: "QR_SIGNATURE_INVALID", snap: "stored", until: "19/12" },
    { t: "09:58:44", code: "T-2088", name: "Rutuja Salunkhe", kiosk: "K134 main gate", kp: "K134", dir: null, dec: "rejected", reason: "WRONG_PLANT", snap: "stored", until: "19/12" },
    { t: "09:55:10", code: "T-2060", name: "Asha Kale", kiosk: "K134 main gate", kp: "K134", dir: "in", dec: "accepted", snap: "stored", until: "19/12", dark: true },
    { t: "09:51:29", code: "T-3054", name: "Kavita Pawar", kiosk: "TP1 gate", kp: "TP1", dir: "in", dec: "accepted", snap: "stored", until: "19/12" },
    { t: "09:47:03", code: "T-2093", name: "Smita Ghorpade", kiosk: "X280 gate", kp: "X280", dir: null, dec: "rejected", reason: "QR_REVOKED", snap: "stored", until: "19/12" },
    { t: "09:40:18", code: "T-2091", name: "Neha Kamthe", kiosk: "X280 gate", kp: "X280", dir: null, dec: "rejected", reason: "QR_EXPIRED", snap: "stored", until: "19/12", dark: true },
    { t: "09:31:55", code: "T-2090", name: "Ashok Lad", kiosk: "X280 gate", kp: "X280", dir: "in", dec: "accepted", snap: "upload_failed" },
    { t: "09:22:07", code: "T-2095", name: "Leena Deore", kiosk: "X280 gate", kp: "X280", dir: null, dec: "rejected", reason: "OUT_TOO_SOON", snap: "none" },
    { t: "09:12:40", unknown: true, kiosk: "X280 gate", kp: "X280", dir: null, dec: "rejected", reason: "QR_FORMAT_INVALID", snap: "stored", until: "19/12" },
    { t: "08:03:26", code: "T-2071", name: "Santosh Chavan", kiosk: "K134 main gate", kp: "K134", dir: null, dec: "rejected", reason: "EMPLOYEE_NOT_QR", snap: "stored", until: "19/12" },
    { t: "07:58:02", code: "T-3051", name: "Mangesh Jagtap", kiosk: "TP1 gate", kp: "TP1", dir: null, dec: "rejected", reason: "SNAPSHOT_MISSING", snap: "none" },
    { t: "07:05:33", code: "T-3050", name: "Ravi Shinde", kiosk: "TP1 gate", kp: "TP1", dir: "out", dec: "accepted", snap: "stored", until: "19/12", dark: true },
  ];
  C.ROWS_X280 = [
    { t: "10:01:47", hidden: true, kiosk: "X280 gate", kp: "X280", dir: null, dec: "rejected", reason: "WRONG_PLANT", snap: "stored", until: "19/12" },
    { t: "09:52:30", code: "T-2089", name: "Sunita Rane", kiosk: "X280 gate", kp: "X280", dir: "in", dec: "accepted", snap: "stored", until: "19/12" },
    { t: "09:47:03", code: "T-2093", name: "Smita Ghorpade", kiosk: "X280 gate", kp: "X280", dir: null, dec: "rejected", reason: "QR_REVOKED", snap: "stored", until: "19/12" },
    { t: "09:40:18", code: "T-2091", name: "Neha Kamthe", kiosk: "X280 gate", kp: "X280", dir: null, dec: "rejected", reason: "QR_EXPIRED", snap: "stored", until: "19/12" },
    { t: "09:31:55", code: "T-2090", name: "Ashok Lad", kiosk: "X280 gate", kp: "X280", dir: "in", dec: "accepted", snap: "upload_failed" },
    { t: "09:22:07", code: "T-2095", name: "Leena Deore", kiosk: "X280 gate", kp: "X280", dir: null, dec: "rejected", reason: "OUT_TOO_SOON", snap: "none" },
    { t: "09:12:40", unknown: true, kiosk: "X280 gate", kp: "X280", dir: null, dec: "rejected", reason: "QR_FORMAT_INVALID", snap: "stored", until: "19/12" },
    { t: "09:05:12", code: "T-2095", name: "Leena Deore", kiosk: "X280 gate", kp: "X280", dir: "in", dec: "accepted", snap: "stored", until: "19/12" },
    { t: "07:01:15", code: "T-2088", name: "Rutuja Salunkhe", kiosk: "X280 gate", kp: "X280", dir: "in", dec: "accepted", snap: "stored", until: "19/12" },
    { t: "06:55:41", code: "T-2092", name: "Ganesh Jori", kiosk: "X280 gate", kp: "X280", dir: null, dec: "rejected", reason: "QR_NOT_YET_VALID", snap: "stored", until: "19/12" },
  ];
  // a past day older than the 60-day retention: the photos are deleted, the rows stay
  C.ROWS_PAST = [
    { t: "19:12:08", code: "T-2041", name: "Sunil More", kiosk: "K134 main gate", kp: "K134", dir: "out", dec: "accepted", snap: "purged", purged: "13/10" },
    { t: "19:06:44", code: "T-2060", name: "Asha Kale", kiosk: "K134 main gate", kp: "K134", dir: "out", dec: "accepted", snap: "purged", purged: "13/10" },
    { t: "19:03:10", code: "T-3050", name: "Ravi Shinde", kiosk: "TP1 gate", kp: "TP1", dir: "in", dec: "accepted", snap: "purged", purged: "13/10" },
    { t: "18:59:51", code: "T-3050", name: "Ravi Shinde", kiosk: "TP1 gate", kp: "TP1", dir: null, dec: "rejected", reason: "COOLDOWN_ACTIVE", snap: "none" },
    { t: "18:31:27", code: "T-2089", name: "Sunita Rane", kiosk: "X280 gate", kp: "X280", dir: "out", dec: "accepted", snap: "upload_failed" },
    { t: "12:40:02", unknown: true, kiosk: "X280 gate", kp: "X280", dir: null, dec: "rejected", reason: "QR_SIGNATURE_INVALID", snap: "purged", purged: "13/10" },
    { t: "07:04:15", code: "T-2041", name: "Sunil More", kiosk: "K134 main gate", kp: "K134", dir: "in", dec: "accepted", snap: "purged", purged: "13/10" },
    { t: "07:01:39", code: "T-2060", name: "Asha Kale", kiosk: "K134 main gate", kp: "K134", dir: "in", dec: "accepted", snap: "purged", purged: "13/10" },
  ];
  C.NEW_ROWS = [
    { t: "10:05:31", code: "T-2042", name: "Rekha Jagtap", kiosk: "K134 main gate", kp: "K134", dir: "in", dec: "accepted", snap: "stored", until: "19/12", isNew: true },
    { t: "10:05:19", code: "T-3055", name: "Sachin Kale", kiosk: "TP1 gate", kp: "TP1", dir: "in", dec: "accepted", snap: "stored", until: "19/12", isNew: true },
  ];

  // ---------- one row ----------
  C.punchRow = function (p, o) {
    const sa = C.isSa;
    let who;
    if (p.hidden) who = '<span class="who-none">' + D.icon("eye-off") + "Card of another plant</span>";
    else if (p.unknown) who = '<span class="who-none">' + D.icon("circle-help") + "Unknown card</span>";
    else who = '<span class="who"><b>' + p.name + '</b><span class="code">' + p.code + "</span></span>";
    const photo = C.photoText(p, sa && p.dark ? C.darkMark() : "");
    let acts = "";
    if (sa) {
      const canView = p.snap === "stored";
      const canCompare = canView && !p.unknown && !p.hidden;
      acts = '<td><div class="row-acts">' +
        (canView ? '<button class="btn btn-outline" aria-label="View photo of the punch at ' + p.t + '">' + D.icon("image") + "View photo</button>" : "") +
        (canCompare ? '<button class="btn btn-ghost" aria-label="Compare with earlier punches of this card">' + D.icon("columns-2") + "Compare</button>" : "") +
        "</div></td>";
    }
    const kioskCell = '<b style="font-weight:600">' + p.kiosk + "</b>" + (o.showPlant ? '<span class="sub code">' + p.kp + "</span>" : "");
    return '<tr class="' + (p.dec === "rejected" ? "is-rejected " : "") + (p.isNew ? "is-new" : "") + '">' +
      '<td><span class="time tnum">' + p.t + "</span>" + (p.isNew ? '<span class="new-tag">New</span>' : "") + "</td>" +
      "<td>" + who + "</td><td>" + C.direction(p.dir) + "</td><td>" + C.result(p.dec) + "</td><td>" + C.reason(p.reason) + "</td>" +
      "<td>" + kioskCell + "</td><td>" + photo + "</td>" + acts + "</tr>";
  };

  // ---------- the page ----------
  // o: { loading, error, empty, past, exportError, refreshed, plant }
  C.renderPunchLog = function (o) {
    o = o || {};
    const sa = C.isSa, ph = C.isPh, ch = C.isCh;
    const head = D.pageHead({
      title: "Punch log",
      desc: ph ? "Every card punch at the X280 gate, accepted or rejected. Times in IST."
        : "Every card punch at the gate kiosks, accepted or rejected. Times in IST.",
      actions: o.empty ? "" : '<span class="ext-note" style="margin-right:4px">' + D.icon("image-off") + "No photos in the file</span>" +
        '<button class="btn btn-outline btn-lg">' + D.icon("file-spreadsheet", 18) + "Export day (.xlsx)</button>",
    });

    let banner = "";
    if (ph) banner = C.roBanner("Read-only, your plant only (X280).", "You see punches made at the X280 gate. Only the Super Admin can open punch photos; here you see whether a photo was saved.");
    if (ch) banner = C.roBanner("Read-only, all plants.", "Only the Super Admin can open punch photos, and every view is recorded. Here you see whether a photo was saved.");

    let exportAlert = "";
    if (o.exportError) {
      exportAlert = '<div class="alert alert-danger anim-fade-up" role="alert" style="margin-bottom:14px;align-items:center">' + D.icon("circle-alert", 20) +
        '<div style="flex:1"><b>The file was not made.</b> At most 5,000 punches per file. Choose one plant. <span class="code" style="font-size:12.5px;opacity:.85">(EXPORT_TOO_LARGE)</span></div>' +
        '<button class="btn btn-outline btn-sm" style="background:#fff">' + D.icon("factory", 15) + "Choose a plant</button>" +
        '<button class="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss">' + D.icon("x", 16) + "</button></div>";
    }

    // summary chips (GET /punches/summary)
    let sum = ph ? { i: 31, out: 4, rej: 6, dark: 0, by: [["WRONG_PLANT", 1], ["QR_REVOKED", 1], ["QR_EXPIRED", 1], ["OUT_TOO_SOON", 1], ["QR_FORMAT_INVALID", 1], ["QR_NOT_YET_VALID", 1]] }
      : { i: 286, out: 41, rej: 15, dark: 3, by: [["COOLDOWN_ACTIVE", 4], ["WRONG_PLANT", 3], ["QR_EXPIRED", 2], ["QR_SIGNATURE_INVALID", 1], ["QR_REVOKED", 1], ["QR_FORMAT_INVALID", 1], ["OUT_TOO_SOON", 1], ["EMPLOYEE_NOT_QR", 1], ["SNAPSHOT_MISSING", 1]] };
    if (o.past) sum = { i: 301, out: 296, rej: 11, dark: 1, by: [["COOLDOWN_ACTIVE", 6], ["QR_EXPIRED", 2], ["QR_SIGNATURE_INVALID", 1], ["WRONG_PLANT", 1], ["OUT_TOO_SOON", 1]] };
    if (o.refreshed) sum.i += 2;
    // a hypothetical very busy day (for example a kiosk that sent punches in a loop): over the 5,000-row export limit
    if (o.exportError) sum = { i: 2604, out: 2512, rej: 98, dark: 3, by: [["COOLDOWN_ACTIVE", 61], ["OUT_TOO_SOON", 22], ["WRONG_PLANT", 9], ["QR_EXPIRED", 6]] };
    if (o.empty) sum = { i: 0, out: 0, rej: 0, dark: 0, by: [] };
    const num = function (n) { return o.error ? "–" : n.toLocaleString("en-IN"); };
    const stat = function (cls, icon, n, label) {
      return '<button class="stat ' + cls + '" aria-pressed="false"><span class="si">' + D.icon(icon) + "</span><span><b class=\"tnum\">" + num(n) + '</b><span class="sl">' + label + "</span></span></button>";
    };
    let stats;
    if (o.loading) stats = '<div class="stats" aria-hidden="true">' + new Array(sa ? 5 : 4).join('<div class="skeleton stat-skel"></div>') + "</div>";
    else {
      stats = '<div class="stats" role="group" aria-label="Day summary, press one to filter">' +
        stat("s-in", "log-in", sum.i, "Accepted IN") + stat("s-out", "log-out", sum.out, "Accepted OUT") + stat("s-rej", "circle-x", sum.rej, "Rejected") +
        (sa ? stat("s-dark", "moon", sum.dark, "Dark photos") : "") + (o.empty || o.error ? "" : '<span class="stat-hint">' + D.icon("mouse-pointer-click", 15) + "Press a number to show only those punches</span>") + "</div>";
      if (sum.by.length && !o.error) {
        stats += '<div class="by-reason"><span>Rejected because:</span>' + sum.by.map(function (b) {
          return '<button class="rchip" title="Show only ' + b[0] + '"><span class="n">' + b[1] + "</span>" + C.REASONS[b[0]] + "</button>";
        }).join("") + "</div>";
      }
    }

    // filters
    const dateLabel = o.past ? '<span class="tnum">Fri 14/08/2026</span>' : 'Today <small class="tnum">20/10/2026</small>';
    const toolbar = '<div class="toolbar">' +
      '<div class="date-step" role="group" aria-label="Day"><button aria-label="Previous day">' + D.icon("chevron-left", 18) + '</button><span class="dval">' + D.icon("calendar") + dateLabel + '</span><button aria-label="Next day"' + (o.past ? "" : ' disabled style="opacity:.4"') + ">" + D.icon("chevron-right", 18) + "</button></div>" +
      '<label class="search-input" style="width:220px"><i data-lucide="search"></i><span class="sr-only">Search by employee code or name</span><input class="input" placeholder="Code or name" /></label>' +
      C.filterBtn("Result", "Any", false) + C.filterBtn("Kiosk", ph ? "X280 gate" : "Any", false) + C.filterBtn("Reason", "Any", false) +
      "</div>";

    // meta row: count + live hint
    const total = o.empty ? 0 : sum.i + sum.out + sum.rej;
    let live;
    if (o.past) live = '<span class="live">' + D.icon("calendar-x", 15) + "<b>Past day</b> · the list does not update</span>";
    else if (o.refreshed) live = '<span class="live" role="status"><span class="dot" aria-hidden="true"></span><b>2 new punches</b> · updated <span class="tnum">10:05:32</span> · every 30 s</span>';
    else live = '<span class="live"><span class="dot" aria-hidden="true"></span><b>Live</b> · updates every 30 s · last <span class="tnum">10:05:02</span></span>';
    const meta = '<div class="toolbar" style="padding-top:10px;padding-bottom:10px;background:#fafbfc">' +
      '<span class="muted tnum" style="font-size:13px">' + (o.loading ? "Loading…" : o.error ? "Not loaded" : total.toLocaleString("en-IN") + " punches · newest first") + "</span>" +
      '<span class="ml-auto">' + (o.error || o.loading ? "" : live) + "</span></div>";

    // table
    let rows = ph ? C.ROWS_X280 : o.past ? C.ROWS_PAST : C.ROWS_ALL;
    if (o.refreshed) rows = C.NEW_ROWS.concat(rows);
    const showPlant = !ph && !o.plant;
    const headRow = '<thead><tr><th scope="col">Time</th><th scope="col">Employee</th><th scope="col">Direction</th><th scope="col">Result</th><th scope="col">Reason</th><th scope="col">Kiosk</th><th scope="col">Photo</th>' +
      (sa ? '<th scope="col"><span class="sr-only">Photo actions</span></th>' : "") + "</tr></thead>";
    let body;
    if (o.loading) {
      const widths = [64, 130, 54, 96, 150, 110, 104].concat(sa ? [150] : []);
      body = new Array(11).join("<tr>" + widths.map(function (w) { return '<td><div class="skeleton" style="height:14px;width:' + w + 'px"></div></td>'; }).join("") + "</tr>");
    } else if (o.error) {
      body = '<tr><td colspan="8" style="padding:48px 20px"><div class="alert alert-danger" role="alert" style="max-width:600px;margin:0 auto;align-items:center">' + D.icon("circle-alert", 20) +
        '<div style="flex:1"><b>Could not load the punch log.</b><div>Check the internet connection and try again. Punches at the gates are not affected.</div></div><button class="btn btn-outline btn-sm" style="background:#fff">' + D.icon("rotate-cw", 15) + "Try again</button></div></td></tr>";
    } else body = rows.map(function (p) { return C.punchRow(p, { showPlant: showPlant }); }).join("");
    let table = '<div style="overflow-x:auto"><table class="table pl" aria-busy="' + !!o.loading + '">' + headRow + "<tbody>" + body + "</tbody></table></div>";

    if (o.empty) {
      table = '<div class="empty" style="padding:64px 24px 60px"><div class="empty-icon">' + D.icon("history") + "</div><h2>No punches yet today at this plant.</h2>" +
        "<p>Punches show here within 30 seconds after a card is scanned at the " + (o.plant || "X280") + " gate. If people are coming in, check that the gate kiosk is on.</p>" +
        '<div class="flex justify-center gap-2" style="margin-top:20px"><a class="btn btn-outline btn-lg" href="04-kiosks.html">' + D.icon("tablet-smartphone", 18) + 'Open Kiosks</a><button class="btn btn-ghost btn-lg">' + D.icon("chevron-left", 18) + "Yesterday</button></div></div>";
    }

    const pages = Math.max(1, Math.ceil(total / 50));
    const foot = (o.empty || o.error) ? "" : '<div class="table-foot"><span class="tnum">' + (o.loading ? "Loading…" : "Showing 1–" + rows.length + " of " + total.toLocaleString("en-IN") + " (sample rows)") +
      '</span><div class="flex gap-2 items-center"><button class="btn btn-outline btn-sm" disabled>Previous</button><span class="tnum" style="padding:0 6px">Page 1 of ' + pages + '</span><button class="btn btn-outline btn-sm"' + (pages < 2 ? " disabled" : "") + ">Next</button></div><span>50 per page</span></div>";

    document.getElementById("page").innerHTML = head + banner + exportAlert + '<div class="anim-fade-up anim-delay-1">' + stats + "</div>" +
      '<div class="card anim-fade-up anim-delay-2" style="overflow:hidden">' + toolbar + meta + table + foot + "</div>";
  };
})();
