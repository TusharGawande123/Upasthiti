/*
  Upasthiti – M2 design gate A: shared mockup helpers for the QR cards screens
  (fake data, card state chips, the QR cards list, the card panel on the employee page).
  Load AFTER shell.js, d.js and d-extra.js. MOCKUP ONLY, not app code.
  Hash states are joined with "+", for example  #selected+ph  (see index.html).
*/
(function () {
  const D = window.D;
  const M2 = (window.M2 = {});

  // ---------- role from the hash: sa (default), ch, ph (long names also work) ----------
  D.role = D.has("ch") || D.has("corporate-head") ? "ch" : D.has("ph") || D.has("plant-head") ? "ph" : "sa";
  D.roleName = { sa: "Super Admin", ch: "Corporate Head", ph: "Plant Head" }[D.role];
  D.TODAY = "20/10/2026";

  // ---------- fake data (all people, contractors and numbers are invented) ----------
  const SHREE = "Shree Manpower Services";
  M2.PLANT_NAMES = {
    K134: "Sheet Shapers India Pvt Ltd (K-134)", X280: "Sheet Shapers India Pvt Ltd (X-280)",
    PC1: "Precise Cuts India Pvt Ltd, Unit 1", PC2: "Precise Cuts India Pvt Ltd, Unit 2",
    SPI: "Siddharth Pressings India Pvt Ltd", TP1: "Tirupati Pressco, Unit 1", TP2: "Tirupati Pressco, Unit 2",
  };
  // state: none | active | not_yet | ending | expired | revoked
  M2.ROWS = [
    { code: "T-2041", name: "Sunil More", type: "temporary", method: "qr", plant: "K134", contractor: SHREE, serial: "C000123", state: "active", until: "19/04/2027", rel: "in 181 days", prints: 1, last: "20/10/2026", shows: "K134" },
    { code: "T-2042", name: "Rekha Jagtap", type: "temporary", method: "qr", plant: "K134", contractor: "Omkar Labour Services", serial: "C000031", state: "ending", until: "28/10/2026", rel: "in 8 days", prints: 1, last: "29/04/2026", shows: "K134" },
    { code: "T-2043", name: "Mahesh Kadam", type: "temporary", method: "qr", plant: "X280", contractor: SHREE, state: "none" },
    { code: "T-2044", name: "Poonam Zende", type: "temporary", method: "qr", plant: "TP1", contractor: "Sai Krupa Enterprises", serial: "C000098", state: "active", until: "31/03/2027", rel: "in 162 days", prints: 1, last: "02/10/2026", shows: "K134" },
    { code: "T-2045", name: "Dattatray Pawar", type: "temporary", method: "qr", plant: "SPI", contractor: "Jai Hind Staffing", serial: "C000139", state: "not_yet", from: "01/11/2026", until: "30/04/2027", rel: "starts in 12 days", prints: 1, last: "20/10/2026", shows: "SPI" },
    { code: "T-2046", name: "Anita Gaikwad", type: "temporary", method: "qr", plant: "PC1", contractor: "Omkar Labour Services", serial: "C000044", state: "expired", until: "15/10/2026", rel: "5 days ago", prints: 1, last: "16/04/2026", shows: "PC1" },
    { code: "T-2047", name: "Kiran Shelar", type: "temporary", method: "qr", plant: "PC2", contractor: "Gajanan Workforce Pvt Ltd", serial: "C000067", state: "revoked", until: "30/11/2026", rel: "revoked 12/10/2026", prints: 1, last: "01/06/2026", shows: "PC2" },
    { code: "T-2048", name: "Ujwala Mane", type: "temporary", method: "qr", plant: "K134", contractor: SHREE, state: "none" },
    { code: "T-2049", name: "Vijay Bhor", type: "temporary", method: "qr", plant: "X280", contractor: "Omkar Labour Services", state: "none" },
    { code: "T-2050", name: "Nisha Tambe", type: "temporary", method: "qr", plant: "TP1", contractor: "Sai Krupa Enterprises", serial: "C000140", state: "active", until: "19/04/2027", rel: "in 181 days", prints: 0, shows: null },
    { code: "T-2051", name: "Prashant Kolhe", type: "temporary", method: "qr", plant: "K134", contractor: SHREE, serial: "C000029", state: "ending", until: "31/10/2026", rel: "in 11 days", prints: 2, last: "05/05/2026", shows: "K134" },
    { code: "T-2052", name: "Madhavi Surve", type: "temporary", method: "qr", plant: "SPI", contractor: "Jai Hind Staffing", state: "none" },
    { code: "T-2053", name: "Rahul Dhake", type: "temporary", method: "qr", plant: "PC1", contractor: "Omkar Labour Services", state: "none" },
    { code: "T-2054", name: "Bhushan Wagh", type: "temporary", method: "qr", plant: "PC2", contractor: "Gajanan Workforce Pvt Ltd", serial: "C000072", state: "revoked", until: "30/11/2026", rel: "revoked 14/10/2026", prints: 1, last: "03/06/2026", shows: "PC2" },
    { code: "T-2071", name: "Santosh Chavan", type: "temporary", method: "face", plant: "K134", contractor: SHREE, serial: "C000078", state: "active", until: "12/03/2027", rel: "in 143 days", prints: 1, last: "14/09/2026", shows: "K134" },
  ];
  // The Plant Head of X280 sees only these (all X280)
  M2.ROWS_X280 = [
    { code: "T-2043", name: "Mahesh Kadam", type: "temporary", method: "qr", plant: "X280", contractor: SHREE, state: "none" },
    { code: "T-2049", name: "Vijay Bhor", type: "temporary", method: "qr", plant: "X280", contractor: "Omkar Labour Services", state: "none" },
    { code: "T-2088", name: "Rutuja Salunkhe", type: "temporary", method: "qr", plant: "X280", contractor: "Omkar Labour Services", serial: "C000201", state: "active", until: "19/04/2027", rel: "in 181 days", prints: 1, last: "20/10/2026", shows: "X280" },
    { code: "T-2089", name: "Sunita Rane", type: "temporary", method: "qr", plant: "X280", contractor: "Omkar Labour Services", serial: "C000033", state: "ending", until: "02/11/2026", rel: "in 13 days", prints: 1, last: "03/05/2026", shows: "X280" },
    { code: "T-2090", name: "Ashok Lad", type: "temporary", method: "qr", plant: "X280", contractor: SHREE, serial: "C000187", state: "active", until: "31/03/2027", rel: "in 162 days", prints: 1, last: "05/10/2026", shows: "X280" },
    { code: "T-2091", name: "Neha Kamthe", type: "temporary", method: "qr", plant: "X280", contractor: "Sai Krupa Enterprises", serial: "C000041", state: "expired", until: "10/10/2026", rel: "10 days ago", prints: 1, last: "11/04/2026", shows: "X280" },
    { code: "T-2092", name: "Ganesh Jori", type: "temporary", method: "qr", plant: "X280", contractor: SHREE, serial: "C000204", state: "not_yet", from: "26/10/2026", until: "25/04/2027", rel: "starts in 6 days", prints: 1, last: "20/10/2026", shows: "X280" },
    { code: "T-2093", name: "Smita Ghorpade", type: "temporary", method: "qr", plant: "X280", contractor: "Jai Hind Staffing", serial: "C000150", state: "revoked", until: "30/11/2026", rel: "revoked 09/10/2026", prints: 1, last: "20/09/2026", shows: "X280" },
    { code: "T-2094", name: "Omkar Phadke", type: "temporary", method: "qr", plant: "X280", contractor: "Jai Hind Staffing", state: "none" },
    { code: "T-2095", name: "Leena Deore", type: "temporary", method: "qr", plant: "X280", contractor: "Sai Krupa Enterprises", serial: "C000112", state: "active", until: "15/03/2027", rel: "in 146 days", prints: 1, last: "30/09/2026", shows: "TP1" },
  ];

  // ---------- small helpers ----------
  M2.STATES = {
    none: ["badge-dashed", "circle-dashed", "No card"],
    active: ["badge-success", "circle-check", "Active"],
    not_yet: ["badge-info", "calendar-clock", "Not yet valid"],
    ending: ["badge-warning", "triangle-alert", "Ends soon"],
    expired: ["badge-expired", "timer-off", "Expired"],
    revoked: ["badge-danger", "ban", "Revoked"],
  };
  M2.chip = function (state) {
    const s = M2.STATES[state];
    return '<span class="badge ' + s[0] + '">' + D.icon(s[1]) + s[2] + "</span>";
  };
  M2.reprintBadge = function (shows) {
    return '<span class="badge badge-warning badge-wrap">' + D.icon("printer") + "<span>Reprint needed <span style=\"font-weight:500\">(card shows " + shows + ")</span></span></span>";
  };
  M2.needsReprint = function (r) { return r.serial && r.state !== "revoked" && r.shows && r.shows !== r.plant; };
  M2.methodLine = function (r) {
    return r.method === "qr"
      ? '<span class="sub">' + D.icon("qr-code") + "QR card</span>"
      : '<span class="sub warn">' + D.icon("scan-face") + "Face recognition</span>";
  };
  M2.printedCell = function (r) {
    if (!r.serial) return '<span class="muted">—</span>';
    if (!r.prints) return '<span class="badge badge-neutral" style="height:22px">' + D.icon("printer") + "Not printed</span>";
    return '<span class="tnum"><b>' + r.prints + "</b> " + (r.prints === 1 ? "time" : "times") + '</span><span class="sub tnum">last ' + r.last + "</span>";
  };

  // ---------- one row of the QR cards table ----------
  M2.row = function (r, o) {
    o = o || {};
    const checked = o.selected && o.selected.indexOf(r.code) !== -1;
    const cb = o.selectable ? '<td class="cb-cell" style="width:36px;padding:10px 0 10px 14px"><input type="checkbox" class="cb" aria-label="Select ' + r.name + '"' + (checked ? " checked" : "") + " /></td>" : "";
    const until = r.serial
      ? '<span class="tnum">' + r.until + '</span><span class="sub tnum" style="' + (r.state === "ending" ? "color:var(--warning);font-weight:600" : "") + '">' + r.rel + "</span>"
      : '<span class="muted">—</span>';
    return '<tr class="' + (checked ? "is-selected" : "") + (o.selectable ? "" : " is-read-only") + '">' + cb +
      '<td><div class="emp-name"><span class="avatar" style="width:34px;height:34px">' + D.initials(r.name) + '</span><span style="min-width:0"><b class="trunc" style="max-width:130px"><a href="03-employee-card-panel.html#active" style="color:inherit;text-decoration:none">' + r.name + '</a></b><small class="code" style="display:block;font-size:12.5px;color:var(--muted-foreground)">' + r.code + "</small></span></div></td>" +
      "<td>" + D.typeBadge(r.type).replace("Temporary", "Temporary") + M2.methodLine(r) + "</td>" +
      '<td><b class="code">' + r.plant + "</b></td>" +
      '<td>' + (r.contractor ? '<span class="trunc" style="max-width:96px" title="' + r.contractor + '">' + r.contractor + "</span>" : '<span class="muted">—</span>') + "</td>" +
      "<td>" + (r.serial ? '<b class="code">' + r.serial + "</b>" : '<span class="muted">—</span>') + "</td>" +
      '<td class="state-col">' + M2.chip(r.state) + (M2.needsReprint(r) ? "<br>" + M2.reprintBadge(r.shows) : "") + "</td>" +
      "<td>" + until + (r.state === "not_yet" ? '<span class="sub tnum">from ' + r.from + "</span>" : "") + "</td>" +
      "<td>" + M2.printedCell(r) + "</td></tr>";
  };

  M2.tableHead = function (selectable) {
    const all = selectable ? '<th scope="col" style="width:36px;padding:10px 0 10px 14px"><input type="checkbox" class="cb" aria-label="Select all 50 on this page"/></th>' : "";
    return "<thead><tr>" + all + '<th scope="col">Employee</th><th scope="col">Type · punch method</th><th scope="col">Plant</th><th scope="col">Contractor</th><th scope="col">Card</th><th scope="col">State</th><th scope="col">Valid until</th><th scope="col">Printed</th></tr></thead>';
  };
  M2.skeletonRows = function (n, selectable) {
    const widths = [150, 120, 40, 110, 70, 100, 80, 70];
    const one = "<tr>" + (selectable ? '<td style="width:44px;padding-left:16px"><div class="skeleton" style="height:18px;width:18px"></div></td>' : "") +
      widths.map(function (w) { return '<td><div class="skeleton" style="height:14px;width:' + w + 'px"></div></td>'; }).join("") + "</tr>";
    return new Array(n + 1).join(one);
  };

  // ---------- filters ----------
  M2.filterBtn = function (label, value, on) {
    return '<button class="btn btn-outline" style="height:38px;' + (on ? "background:var(--primary-soft);border-color:#b9c6ef;color:var(--primary-soft-foreground)" : "") + '" aria-haspopup="listbox">' +
      '<span class="muted" style="font-weight:500;' + (on ? "color:inherit" : "") + '">' + label + "</span><b>" + value + "</b>" + D.icon("chevron-down", 15, "color:var(--muted-foreground)") + "</button>";
  };
  M2.toggleBtn = function (label, icon, on) {
    return '<button class="btn btn-outline" aria-pressed="' + !!on + '" style="height:38px;' + (on ? "background:var(--warning-soft);border-color:#f1d79c;color:var(--warning)" : "") + '">' + D.icon(icon, 16) + label + (on ? D.icon("check", 15) : "") + "</button>";
  };

  // ---------- selection hint (what each bulk button will do) ----------
  M2.selectionHint = function (rows) {
    const n = rows.length;
    const noCard = rows.filter(function (r) { return !r.serial && r.method === "qr"; });
    const hasCard = rows.filter(function (r) { return r.serial && r.state !== "revoked"; });
    const face = rows.filter(function (r) { return !r.serial && r.method !== "qr"; });
    const alreadyActive = rows.filter(function (r) { return r.serial && r.state !== "revoked"; });
    const skipped = n - noCard.length;
    return '<div class="sel-hint" role="status"><b>What each button will do with these ' + n + " people</b><ul>" +
      "<li>" + D.icon("id-card") + "<span><b>Issue cards:</b> " + noCard.length + " get a new card. <span style=\"color:var(--warning);font-weight:600\">" + skipped + " skipped</span> (" + alreadyActive.length + " already " + (alreadyActive.length === 1 ? "has" : "have") + " a card" + (face.length ? ", " + face.length + " punch by face" : "") + "). Skipped people are listed afterwards.</span></li>" +
      "<li>" + D.icon("printer") + "<span><b>Print cards (A4):</b> " + hasCard.length + " of " + n + " have a card to print. At most 200 at a time.</span></li>" +
      "<li>" + D.icon("ban") + "<span><b>Revoke cards:</b> " + hasCard.length + " active cards. A reason is required.</span></li></ul></div>";
  };

  // ---------- the whole QR cards list page (also the backdrop of the bulk dialogs) ----------
  // o: { selected:[codes], loading, error, empty, noMatch, endingSoon, resultPanel, hint }
  M2.renderList = function (o) {
    o = o || {};
    const isPh = D.role === "ph", isCh = D.role === "ch", isSa = D.role === "sa";
    const selectable = isSa;
    const rows = isPh ? M2.ROWS_X280 : M2.ROWS;
    const shownRows = o.endingSoon ? rows.filter(function (r) { return r.state === "ending"; }) : rows;
    const total = isPh ? 37 : o.endingSoon ? 12 : 361;

    const head = D.pageHead({
      title: "QR cards",
      desc: isPh ? "ID cards of the people at your plant, X280. You can look, but not change anything."
        : "Issue, print and revoke the QR ID cards of temporary workers. A card works only at the person's own plant.",
      actions: isSa ? "" : '<span class="badge badge-neutral">' + D.icon("lock") + "Read-only</span>",
    });

    let banner = "";
    if (isPh) banner = '<div class="ro-banner" role="note">' + D.icon("lock", 18) + "<span><b>Read-only, your plant only (X280).</b> Only the Super Admin issues, prints and revokes cards, because a printed card works like a key to the gate. If a card is lost or a worker needs one, ask the Super Admin.</span></div>";
    if (isCh) banner = '<div class="ro-banner" role="note">' + D.icon("lock", 18) + "<span><b>Read-only, all plants.</b> Only the Super Admin issues, prints and revokes cards. You can see every card and when it ends.</span></div>";

    const tabs = isSa ? '<div class="tabs" role="tablist" aria-label="QR cards" style="margin:0 0 16px">' +
      '<a class="tab" role="tab" href="01-qr-cards.html" aria-selected="true">' + D.icon("users") + 'Employees<span class="tab-count tnum">361</span></a>' +
      '<a class="tab" role="tab" href="02-test-cards.html" aria-selected="false">' + D.icon("flask-conical") + 'Test cards<span class="tab-count tnum">4</span></a></div>' : "";

    const on = !!(o.noMatch || o.endingSoon);
    const toolbar1 = '<div class="toolbar"><label class="search-input" style="min-width:300px"><i data-lucide="search"></i><span class="sr-only">Search by code, name or card serial</span><input class="input" placeholder="Search code, name or card serial" value="' + (o.noMatch ? "C009999" : "") + '" /></label>' +
      (isPh ? '<span class="badge badge-outline" style="height:38px;padding:0 12px;border-radius:10px">' + D.icon("factory", 15, "color:var(--muted-foreground)") + '<b class="code">X280</b> only' + D.icon("lock", 13, "color:var(--subtle-foreground)") + "</span>" : M2.filterBtn("Plant", o.noMatch ? "X280" : "All", o.noMatch)) +
      M2.filterBtn("Type", "Any", false) + M2.filterBtn("Punch method", "Any", false) + M2.filterBtn("Contractor", "Any", false) + "</div>";
    const toolbar2 = '<div class="toolbar" style="padding-top:0;border-top:0">' + M2.filterBtn("Category", "Any", false) + M2.filterBtn("State", o.endingSoon ? "Ends soon" : o.noMatch ? "Revoked" : "Any", on) +
      M2.filterBtn("Printed", "Any", false) + M2.toggleBtn("Reprint needed", "printer", false) +
      '<span class="ml-auto flex gap-2">' + (on ? '<button class="btn btn-ghost" style="height:38px">' + D.icon("x", 15) + "Clear filters</button>" : "") + '<button class="btn btn-outline" style="height:38px">' + D.icon("columns-3", 16) + "Columns</button></span></div>";

    let table, body;
    if (o.loading) body = M2.skeletonRows(10, selectable);
    else if (o.error) body = '<tr><td colspan="9" style="padding:48px 20px"><div class="alert alert-danger" role="alert" style="max-width:560px;margin:0 auto">' + D.icon("circle-alert", 20) + '<div style="flex:1"><b>Could not load the QR cards.</b><div>Check the internet connection and try again. Nothing was changed.</div></div><button class="btn btn-outline btn-sm">' + D.icon("rotate-cw", 15) + "Try again</button></div></td></tr>";
    else body = shownRows.map(function (r) { return M2.row(r, { selectable: selectable, selected: o.selected || [] }); }).join("");
    table = '<div style="overflow-x:auto"><table class="table qr" aria-busy="' + !!o.loading + '">' + M2.tableHead(selectable) + "<tbody>" + body + "</tbody></table></div>";

    if (o.empty) {
      table = '<div class="empty" style="padding:64px 24px 60px"><div class="empty-icon">' + D.icon("qr-code") + '</div><h2>No cards yet</h2><p>Select employees and press <b>Issue cards</b>.</p><p style="font-size:13.5px;margin-top:10px">No temporary worker is in the system yet, so there is nobody to select. Add or import employees first.</p><div class="flex justify-center gap-2" style="margin-top:22px"><a href="../../m1/gate-d/D6-import.html" class="btn btn-primary btn-lg">' + D.icon("file-spreadsheet", 18) + 'Import from Excel</a><a href="../../m1/gate-d/D1-employees.html" class="btn btn-outline btn-lg">' + D.icon("users", 18) + "Go to Employees</a></div></div>";
    }
    if (o.noMatch) {
      table = '<div class="empty" style="padding:56px 24px"><div class="empty-icon">' + D.icon("search-x") + '</div><h2>No cards match</h2><p>Nothing matches "C009999" with Plant X280 and State Revoked. Check the serial, or remove a filter.</p><div class="flex justify-center gap-2" style="margin-top:20px"><button class="btn btn-primary btn-lg">' + D.icon("x", 18) + "Clear filters</button></div></div>";
    }

    const showFoot = !(o.empty || o.noMatch || o.error);
    const pages = Math.ceil(total / 50);
    const foot = showFoot ? '<div class="table-foot"><span class="tnum">' + (o.loading ? "Loading…" : "Showing 1–" + shownRows.length + " of " + total.toLocaleString("en-IN") + " (sample)") + '</span><div class="flex gap-2 items-center"><button class="btn btn-outline btn-sm" disabled>Previous</button><span class="tnum" style="padding:0 6px">Page 1 of ' + pages + '</span><button class="btn btn-outline btn-sm"' + (pages < 2 ? " disabled" : "") + '>Next</button></div><span>50 per page</span></div>' : "";

    let bar = "";
    if (isSa && o.selected && o.selected.length) {
      const picked = M2.ROWS.filter(function (r) { return o.selected.indexOf(r.code) !== -1; });
      bar = (o.hint === false ? "" : M2.selectionHint(picked)) +
        '<div class="bulkbar" role="region" aria-label="Actions for selected employees"><span class="count"><b class="tnum">' + (o.count || o.selected.length) + "</b>selected</span>" +
        '<button class="btn btn-dark">' + D.icon("id-card", 16) + 'Issue cards</button><button class="btn btn-dark">' + D.icon("printer", 16) + 'Print cards (A4)</button>' +
        '<button class="btn btn-dark-danger btn">' + D.icon("ban", 16) + 'Revoke cards</button><button class="btn btn-dark x" aria-label="Clear selection">' + D.icon("x", 18) + "</button></div>";
    }

    document.getElementById("page").innerHTML = head + banner + tabs +
      '<div class="card anim-fade-up anim-delay-1" style="overflow:hidden">' + toolbar1 + toolbar2 + (o.resultPanel || "") + table + foot + "</div>" + bar;
  };

  // ---------- shell: role variants (same idea as M1 gate D) ----------
  D.patchShell = function () {
    const sidebar = document.getElementById("sidebar");
    const topbar = document.getElementById("topbar");
    const find = function (title) { return sidebar.querySelector('.sb-item[title="' + title + '"]'); };
    const remove = function (titles) { titles.forEach(function (t) { const el = find(t); if (el) el.remove(); }); };
    const qr = find("QR cards");
    const qrBadge = qr && qr.querySelector(".sb-count");
    if (D.role !== "sa" && qrBadge) qrBadge.remove();
    const approvals = find("Approvals");

    if (D.role === "ch") {
      remove(["Setup wizard", "Users"]);
      if (approvals) {
        approvals.title = "My requests";
        approvals.querySelector(".sb-label").textContent = "My requests";
        approvals.querySelector("i").setAttribute("data-lucide", "send");
        const b = approvals.querySelector(".sb-count"); if (b) { b.textContent = "1"; b.setAttribute("aria-label", "1 waiting"); }
      }
      const user = topbar.querySelector(".user-trigger");
      user.setAttribute("aria-label", "Account menu for Vikram Deshmukh");
      user.querySelector(".avatar").textContent = "VD";
      user.querySelector(".user-meta").innerHTML = "<b>Vikram Deshmukh</b><span>Corporate Head</span>";
    }
    if (D.role === "ph") {
      remove(["Setup wizard", "Approvals", "Users", "Import"]);
      const filter = topbar.querySelector(".plant-filter");
      filter.outerHTML = '<span class="badge badge-outline" style="height:40px;padding:0 14px;border-radius:10px;font-size:14px" aria-label="Your plant: X280, fixed">' +
        D.icon("factory", 17, "color:var(--muted-foreground)") + '<b class="code">X280</b><span style="font-weight:500">Sheet Shapers (X-280)</span>' + D.icon("lock", 14, "color:var(--subtle-foreground)") + "</span>";
      const user = topbar.querySelector(".user-trigger");
      user.setAttribute("aria-label", "Account menu for Sameer Joshi");
      user.querySelector(".avatar").textContent = "SJ";
      user.querySelector(".user-meta").innerHTML = "<b>Sameer Joshi</b><span>Plant Head · X280</span>";
      const search = topbar.querySelector(".search-text");
      if (search) search.textContent = "Search your plant, X280…";
    }
  };

  // =====================================================================
  // The employee detail page with the QR card panel (spec §4.7)
  // =====================================================================
  const SUNIL_HISTORY = [
    { serial: "C000087", issued: "02/09/2026", until: "01/03/2027", end: "Revoked 20/10/2026 09:41", by: "Asha Rao", reason: "Replaced by C000123", kind: "Replaced" },
    { serial: "C000041", issued: "15/04/2026", until: "14/10/2026", end: "Revoked 01/09/2026 17:20", by: "Asha Rao", reason: "Lost on the bus to the plant", kind: "Lost" },
  ];
  M2.PEOPLE = {
    sunil: { code: "T-2041", name: "Sunil More", type: "temporary", plant: "K134", cat: "Helper", dep: "Fabrication", shift: "General", contractor: SHREE, method: "qr", joined: "12/08/2026" },
    mahesh: { code: "T-2043", name: "Mahesh Kadam", type: "temporary", plant: "X280", cat: "Helper", dep: "Assembly", shift: "General", contractor: SHREE, method: "qr", joined: "05/10/2026" },
    pradeep: { code: "1042", name: "Pradeep Jadhav", type: "permanent", plant: "K134", cat: "Operator", dep: "Press shop", shift: "General", contractor: null, method: "face", joined: "03/02/2019" },
    santosh: { code: "T-2071", name: "Santosh Chavan", type: "temporary", plant: "K134", cat: "Operator", dep: "Press shop", shift: "Night", contractor: SHREE, method: "face", joined: "21/07/2026" },
    poonam: { code: "T-2044", name: "Poonam Zende", type: "temporary", plant: "TP1", cat: "Helper", dep: "Stores", shift: "General", contractor: "Sai Krupa Enterprises", method: "qr", joined: "18/09/2026" },
    kiran: { code: "T-2047", name: "Kiran Shelar", type: "temporary", plant: "PC2", cat: "Helper", dep: "Packing", shift: "General", contractor: "Gajanan Workforce Pvt Ltd", method: "qr", joined: "01/06/2026" },
    anita: { code: "T-2046", name: "Anita Gaikwad", type: "temporary", plant: "PC1", cat: "Helper", dep: "Quality", shift: "General", contractor: "Omkar Labour Services", method: "qr", joined: "10/04/2026" },
    rutuja: { code: "T-2088", name: "Rutuja Salunkhe", type: "temporary", plant: "X280", cat: "Helper", dep: "Assembly", shift: "General", contractor: "Omkar Labour Services", method: "qr", joined: "14/09/2026" },
  };

  const kv = function (k, v) { return '<div class="kv"><dt>' + k + "</dt><dd>" + v + "</dd></div>"; };

  // opts: { person, state, history ("open" | "closed"), role }
  M2.renderEmployee = function (stateName) {
    const isSa = D.role === "sa";
    const map = { active: "sunil", history: "sunil", none: "mahesh", "face-employee": "pradeep", "face-switched": "santosh", reprint: "sunil", revoked: "kiran", expired: "anita", "read-only": D.role === "ph" ? "rutuja" : "sunil" };
    const P = Object.assign({}, M2.PEOPLE[map[stateName] || "sunil"]);
    if (stateName === "reprint") P.plant = "TP1"; // Sunil was transferred from K134 to TP1; his printed card still says K134
    const isFaceOnly = stateName === "face-employee";
    const state = stateName === "read-only" ? "active" : stateName === "history" ? "active" : stateName;

    // ----- the card of this person in this state -----
    let card = null;
    if (!(state === "none" || isFaceOnly)) {
      card = { serial: "C000123", state: "active", from: "20/10/2026", until: "19/04/2027", rel: "in 181 days", by: "Asha Rao", on: "20/10/2026 09:41", prints: 1, last: "20/10/2026 09:44", shows: P.plant };
      if (P.code === "T-2088") Object.assign(card, { serial: "C000201" });
      if (state === "reprint") Object.assign(card, { shows: "K134" });
      if (state === "face-switched") Object.assign(card, { serial: "C000078", from: "14/09/2026", until: "12/03/2027", rel: "in 143 days", on: "14/09/2026 11:05", last: "14/09/2026 11:09" });
      if (state === "expired") Object.assign(card, { serial: "C000044", state: "expired", from: "16/04/2026", until: "15/10/2026", rel: "ended 5 days ago", on: "16/04/2026 10:30", last: "16/04/2026 10:33" });
      if (state === "revoked") Object.assign(card, { serial: "C000067", state: "revoked", from: "01/06/2026", until: "30/11/2026", rel: "", on: "01/06/2026 12:00", last: "01/06/2026 12:04", revokedOn: "12/10/2026 15:48", revokedBy: "Asha Rao", kind: "Lost", reason: "Lost at the canteen, reported by his contractor" });
    }

    // ----- header -----
    const actions = isSa
      ? '<a class="btn btn-outline btn-lg" href="#">' + D.icon("pencil", 18) + 'Edit</a><button class="btn btn-outline btn-lg">' + D.icon("arrow-left-right", 18) + 'Transfer to another plant</button><button class="btn btn-danger-outline btn-lg">' + D.icon("log-out", 18) + "Mark as left</button>"
      : "";
    const header = '<div class="card card-pad anim-fade-up"><div class="profile-head"><span class="avatar avatar-xl">' + D.initials(P.name) + '</span><div style="flex:1;min-width:260px"><div class="muted code" style="font-size:13px;font-weight:600">Employee code ' + P.code + '</div><h1 class="page-title" style="margin:2px 0 8px">' + P.name + '</h1><div class="flex gap-2 flex-wrap">' + D.typeBadge(P.type) + '<span class="badge badge-success">' + D.icon("circle-check") + 'Active</span><span class="badge badge-outline"><b class="code">' + P.plant + "</b>&nbsp;" + M2.PLANT_NAMES[P.plant] + "</span></div></div>" +
      '<div class="flex gap-2 flex-wrap" style="margin-left:auto">' + actions + "</div></div></div>";

    const roBanner = D.role === "ph" ? '<div style="margin-top:14px" class="ro-banner" role="note">' + D.icon("lock", 18) + "<span><b>Read-only.</b> You see only the employees of X280. Ask the Super Admin for any change.</span></div>"
      : D.role === "ch" ? '<div style="margin-top:14px" class="alert alert-info" role="note">' + D.icon("shield-check", 20) + "<div><b>Cards are handled by the Super Admin only.</b> You can see the card and its history, but not change it.</div></div>" : "";

    // ----- buttons -----
    const B = { // normal-size buttons so four fit in one row
      print: '<button class="btn btn-primary">' + D.icon("printer", 17) + "Print card</button>",
      printOutline: '<button class="btn btn-outline">' + D.icon("printer", 17) + "Print card</button>",
      end: '<button class="btn btn-outline">' + D.icon("calendar-clock", 18) + "Change end date</button>",
      endPrimary: '<button class="btn btn-primary">' + D.icon("calendar-clock", 18) + "Change end date</button>",
      issueNew: '<button class="btn btn-outline">' + D.icon("id-card", 18) + "Issue new card</button>",
      issuePrimary: '<button class="btn btn-primary">' + D.icon("id-card", 18) + "Issue new card</button>",
      revoke: '<button class="btn btn-danger-outline push">' + D.icon("ban", 18) + "Revoke</button>",
    };
    const seePunches = '<a class="link" href="#" style="font-weight:600;display:inline-flex;gap:6px;align-items:center">' + D.icon("history", 16) + "See punches</a>";
    const roFoot = '<div class="qp-actions"><span class="muted" style="display:inline-flex;gap:8px;align-items:center">' + D.icon("lock", 16) + "Only the Super Admin can print, change or revoke cards.</span><span class=\"push\">" + seePunches + "</span></div>";

    // ----- banners inside the panel -----
    let banner = "";
    if (state === "face-switched") banner = '<div class="alert alert-warning qp-banner" role="alert">' + D.icon("triangle-alert", 20) + '<div style="flex:1"><b>Revoke this card: the kiosk rejects it now.</b><div>' + P.name + " now punches by face. The card is not revoked automatically. Until you revoke it, the kiosk rejects it (code <span class=\"err-code code\">EMPLOYEE_NOT_QR</span>).</div></div>" + (isSa ? '<button class="btn btn-danger-outline btn-sm" style="background:#fff">' + D.icon("ban", 15) + "Revoke card</button>" : "") + "</div>";
    if (state === "reprint") banner = '<div class="alert alert-warning qp-banner" role="status">' + D.icon("printer", 20) + '<div style="flex:1"><b>Reprint needed.</b><div>Card shows K134; ' + P.name + " is now at TP1. The card still works. Reprint it when convenient.</div></div>" + (isSa ? '<button class="btn btn-primary btn-sm">' + D.icon("printer", 15) + "Print card</button>" : "") + "</div>";
    if (state === "revoked") banner = '<div class="alert alert-danger qp-banner" role="status">' + D.icon("ban", 20) + "<div><b>This card was revoked on " + card.revokedOn + ".</b> It no longer works at any gate. A revoked card is never switched back on: issue a new card instead.</div></div>";
    if (state === "expired") banner = '<div class="alert alert-info qp-banner" role="status">' + D.icon("timer-off", 20) + "<div><b>This card ended on " + card.until + ".</b> The kiosk rejects it. Extend the end date to switch it on again, or issue a new card.</div></div>";

    // ----- the panel -----
    let panel;
    const head = function (chip) { return '<div class="card-head"><h2 class="card-title" id="qr-title" style="display:flex;gap:10px;align-items:center">' + D.icon("qr-code", 20, "color:var(--primary)") + "QR card</h2>" + chip + "</div>"; };
    if (isFaceOnly) {
      panel = head('<span class="badge badge-outline">' + D.icon("scan-face") + "Not needed</span>") +
        '<div class="card-pad" style="display:flex;gap:16px;align-items:flex-start"><span class="dlg-icon di-primary">' + D.icon("scan-face") + "</span><div><b style=\"font-size:16px\">" + P.name + " punches by face, so no QR card is needed.</b><p class=\"muted\" style=\"margin:6px 0 0;max-width:60ch\">QR cards are only for employees whose punch method is QR card. If the punch method is changed to QR card, you can issue a card here.</p></div></div>" + (isSa ? "" : "");
    } else if (state === "none") {
      panel = head(M2.chip("none")) +
        '<div class="card-pad" style="text-align:center;padding:36px 24px"><div class="empty-icon" style="width:64px;height:64px">' + D.icon("qr-code") + '</div><h3 style="font-size:18px;margin:0 0 6px">' + P.name + " has no QR card yet</h3><p class=\"muted\" style=\"margin:0 auto 18px;max-width:52ch\">" + P.name.split(" ")[0] + " punches with a QR card. Issue a card, then print it. The card will work only at " + P.plant + ", and the plant is printed on it.</p>" + (isSa ? '<button class="btn btn-primary btn-lg">' + D.icon("id-card", 18) + "Issue card</button>" : '<span class="muted" style="display:inline-flex;gap:8px;align-items:center">' + D.icon("lock", 16) + "Only the Super Admin can issue cards.</span>") + "</div>" + (isSa ? "" : roFoot);
    } else {
      // the real card image shows Sunil More, so it is used only for his states
      const showThumb = card.state !== "revoked" && P.code === "T-2041";
      const thumb = showThumb
        ? '<figure class="card-thumb' + (card.state === "expired" ? " is-dim" : "") + '"><img src="screenshots/card-employee.png" alt="The printed card: Sunil More, T-2041, plant K134, card C000123, QR code" /><figcaption>' + D.icon("info") + "<span>As printed" + (card.shows ? ": plant " + card.shows : "") + ". No end date is printed.</span></figcaption></figure>"
        : "";
      const worksAt = state === "face-switched" ? '<span class="badge badge-warning" style="height:22px">' + D.icon("scan-face") + "Rejected: punches by face</span>"
        : card.state === "revoked" || card.state === "expired" ? '<span class="badge badge-danger" style="height:22px">' + D.icon("circle-x") + "Rejected at every gate</span>"
        : '<span class="badge badge-success" style="height:22px">' + D.icon("circle-check") + "Accepted at " + P.plant + " only</span>";
      const printedLine = card.prints ? '<span class="tnum">' + card.prints + (card.prints === 1 ? " time" : " times") + ", last " + card.last + "</span>" : "Not printed yet";
      const plantOnCard = card.shows === P.plant ? '<b class="code">' + card.shows + '</b> <span class="muted">(matches)</span>' : '<b class="code">' + card.shows + '</b> <span class="badge badge-warning" style="height:22px;margin-left:4px">' + D.icon("printer") + "Now " + P.plant + "</span>";
      const kvs = '<dl class="qp-kv" style="margin:0">' + kv("Card serial", '<span class="code serial-big">' + card.serial + "</span>") +
        kv("Valid from", '<span class="tnum">' + card.from + "</span>") +
        kv("Valid until", '<span class="tnum">' + card.until + "</span>" + (card.rel ? ' <span class="muted" style="font-size:13px">· ' + card.rel + "</span>" : "")) +
        kv("Issued", '<span class="tnum">' + card.on + "</span> by " + card.by) +
        kv("Printed", printedLine) + kv("Plant on the card", plantOnCard) + kv("At the kiosk", worksAt) +
        (card.state === "revoked" ? kv("Revoked", '<span class="tnum">' + card.revokedOn + "</span> by " + card.revokedBy + "<br><b>" + card.kind + ":</b> " + card.reason) : "") + "</dl>";
      let foot = "";
      if (!isSa) foot = roFoot;
      else if (state === "revoked") foot = '<div class="qp-actions">' + B.issuePrimary + '<span class="push">' + seePunches + "</span></div>";
      else if (state === "expired") foot = '<div class="qp-actions">' + B.endPrimary + B.printOutline + B.issueNew + B.revoke + "</div>";
      else if (state === "reprint") foot = '<div class="qp-actions">' + B.print + B.end + B.issueNew + B.revoke + "</div>";
      else if (state === "face-switched") foot = '<div class="qp-actions">' + B.printOutline + B.end + B.issueNew + B.revoke + "</div>";
      else foot = '<div class="qp-actions">' + B.print + B.end + B.issueNew + B.revoke + "</div>";
      const chip = state === "reprint" ? M2.chip("active") : M2.chip(card.state);
      panel = head(chip) + banner + '<div class="card-pad"><div class="qp-grid' + (showThumb ? "" : " no-thumb") + '">' + thumb + "<div>" + kvs + "</div></div></div>" + foot;
    }

    // ----- history -----
    const histRows = (stateName === "history" ? SUNIL_HISTORY : []).map(function (h) {
      return "<tr><td><b class=\"code\">" + h.serial + '</b></td><td class="tnum">' + h.issued + '</td><td class="tnum">' + h.until + '</td><td><span class="badge badge-danger">' + D.icon("ban") + "Revoked</span></td><td class=\"tnum\">" + h.end.replace("Revoked ", "") + '<span style="display:block;font-size:12.5px;color:var(--muted-foreground)">by ' + h.by + '</span></td><td class="wrap"><b>' + h.kind + ":</b> " + h.reason + "</td></tr>";
    }).join("");
    let history;
    if (stateName === "history") {
      history = '<section class="card anim-fade-up anim-delay-2" style="margin-top:20px" aria-labelledby="hist-title"><div class="card-head"><h2 class="card-title" id="hist-title" style="display:flex;gap:10px;align-items:center">' + D.icon("history", 20, "color:var(--primary)") + 'Card history</h2><span class="badge badge-neutral tnum">2 earlier cards</span></div>' +
        '<div style="overflow-x:auto"><table class="table history-table"><thead><tr><th scope="col">Card</th><th scope="col">Issued</th><th scope="col">Valid until</th><th scope="col">State</th><th scope="col">Revoked on, by</th><th scope="col">Kind and reason</th></tr></thead><tbody>' + histRows + "</tbody></table></div></section>";
    } else {
      const count = state === "none" || isFaceOnly ? 0 : (state === "revoked" ? 1 : 2);
      history = '<section class="card anim-fade-up anim-delay-2" style="margin-top:20px"><div class="collapsed-row">' + D.icon("history", 20) + "Card history" + (count ? '<span class="badge badge-neutral tnum">' + count + " earlier " + (count === 1 ? "card" : "cards") + "</span>" : '<span class="muted" style="font-weight:500">No earlier cards</span>') + '<span style="margin-left:auto">' + (count ? D.icon("chevron-down", 18) : "") + "</span></div></section>";
    }

    // ----- side card -----
    const side = '<section class="card card-pad anim-fade-up anim-delay-2 side-card"><h3>' + D.icon("user-round", 18, "color:var(--primary)") + 'Employee</h3><dl style="margin:0;display:grid;gap:10px;font-size:14px">' +
      kv("Code", '<span class="code">' + P.code + "</span>") + kv("Plant", '<b class="code">' + P.plant + "</b>") + kv("Category", P.cat) + kv("Contractor", P.contractor || "—") +
      kv("Punch method", P.method === "qr" ? D.icon("qr-code", 15) + " QR card" : D.icon("scan-face", 15) + " Face recognition") + "</dl>" +
      '<div style="margin-top:14px">' + seePunches + "</div></section>";

    const crumbs = D.crumb([{ text: "Employees", href: "../../m1/gate-d/D1-employees.html" }, { text: P.code + " " + P.name }]);
    document.getElementById("page").innerHTML = '<nav class="crumbs" aria-label="Breadcrumb">' + crumbs + "</nav>" + header + roBanner +
      '<div class="split2 wide-side" style="margin-top:20px"><section class="card anim-fade-up anim-delay-1" aria-labelledby="qr-title" style="min-width:0">' + panel + "</section><div>" + side + "</div></div>" + history;
  };

  M2.tagTitle = function (text) { D.tag(text + " · " + D.roleName); };
})();
