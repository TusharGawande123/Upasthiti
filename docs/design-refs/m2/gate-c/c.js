/*
  Upasthiti – M2 design gate C: shared mockup helpers for the admin screens of the punch log, photo
  dialogs, gate notices, kiosks, settings and plant detail (fake data, role variants of the shell,
  reason texts, photo placeholder). Load AFTER shell.js, d.js and d-extra.js. MOCKUP ONLY, not app code.
  Hash states are joined with "+", for example  #loading+ph  (ph = Plant Head X280, ch = Corporate Head).
*/
(function () {
  const D = window.D;
  const C = (window.C = {});

  // ---------- role from the hash: sa (default), ch, ph (long names also work) ----------
  D.role = D.has("ch") || D.has("corporate-head") ? "ch" : D.has("ph") || D.has("plant-head") ? "ph" : "sa";
  D.roleName = { sa: "Super Admin", ch: "Corporate Head", ph: "Plant Head" }[D.role];
  C.isSa = D.role === "sa";
  C.isPh = D.role === "ph";
  C.isCh = D.role === "ch";
  C.TODAY = "20/10/2026";

  // ---------- fake plants and kiosks ----------
  C.PLANT_NAMES = {
    K134: "Sheet Shapers India Pvt Ltd (K-134)", X280: "Sheet Shapers India Pvt Ltd (X-280)",
    TP1: "Tirupati Pressco, Unit 1", PC1: "Precise Cuts India Pvt Ltd, Unit 1",
  };

  // ---------- reason codes -> short admin text (spec §9, punchReasons.<CODE>) ----------
  C.REASONS = {
    SNAPSHOT_MISSING: "No photo was sent",
    SNAPSHOT_INVALID: "The photo was not usable",
    QR_FORMAT_INVALID: "The card could not be read",
    QR_SIGNATURE_INVALID: "Not a valid Upasthiti card",
    QR_REVOKED: "Card blocked",
    QR_NOT_YET_VALID: "Card not active yet",
    QR_EXPIRED: "Card expired",
    EMPLOYEE_INACTIVE: "Employee has left",
    EMPLOYEE_NOT_QR: "Employee punches by face",
    WRONG_PLANT: "Card of another plant",
    COOLDOWN_ACTIVE: "Already punched (scanned again too soon)",
    OUT_TOO_SOON: "Already IN (OUT not allowed yet)",
  };

  // ---------- small renderers (status is always icon + word) ----------
  C.result = function (decision) {
    return decision === "accepted"
      ? '<span class="badge badge-success">' + D.icon("circle-check") + "Accepted</span>"
      : '<span class="badge badge-danger">' + D.icon("circle-x") + "Rejected</span>";
  };
  C.direction = function (dir) {
    if (dir === "in") return '<span class="dir dir-in">' + D.icon("log-in") + "IN</span>";
    if (dir === "out") return '<span class="dir dir-out">' + D.icon("log-out") + "OUT</span>";
    return '<span class="dir dir-none"><span aria-hidden="true">–</span><span class="sr-only">No direction</span></span>';
  };
  C.reason = function (code) {
    if (!code) return '<span class="muted" aria-label="No reason">–</span>';
    return '<span class="reason">' + C.REASONS[code] + '<span class="rc">' + code + "</span></span>";
  };
  // snapshot state as text: stored | purged | upload_failed | none
  C.photoText = function (p, extra) {
    if (p.snap === "stored") return '<span class="ptxt">' + D.icon("image") + "Photo stored</span>" + (extra ? '<span class="sub">' + extra + "</span>" : p.until ? '<span class="sub tnum">kept until ' + p.until + "</span>" : "");
    if (p.snap === "purged") return '<span class="ptxt p-gone">' + D.icon("image-off") + 'Photo deleted on <span class="tnum">' + p.purged + "</span></span>" + (extra ? '<span class="sub">' + extra + "</span>" : "");
    if (p.snap === "upload_failed") return '<span class="ptxt p-failed">' + D.icon("triangle-alert") + "Photo not saved</span>";
    return '<span class="ptxt p-none">' + D.icon("minus") + "No photo</span>";
  };
  C.darkMark = function () { return '<span class="dark-mark">' + D.icon("moon") + "Dark photo</span>"; };

  // ---------- neutral photo placeholder (never a real person) ----------
  // o: { w, dark, v (0..3 small variations), card (true: a card held up) }
  C.photo = function (o) {
    o = o || {};
    const v = o.v || 0;
    const tones = o.dark ? ["#2a2e35", "#1d2026", "#15171b"] : [["#a9b0bb", "#8b929e", "#6c7380"], ["#b3aea6", "#958f86", "#77716a"], ["#a3adb6", "#86909a", "#69727c"], ["#aeb3a8", "#90958a", "#72776d"]][v % 4];
    const fig = o.dark ? "#3a3f47" : ["#575e6a", "#5f5a53", "#535c66", "#5a6056"][v % 4];
    const dx = [0, -18, 14, -6][v % 4];
    const s = [1, 0.92, 1.06, 0.97][v % 4];
    const id = "g" + Math.random().toString(36).slice(2, 8);
    const card = o.card === false ? "" :
      '<g transform="translate(' + (196 + dx) + ',170) rotate(-6)"><rect width="58" height="38" rx="5" fill="' + (o.dark ? "#4a4f57" : "#e9ecf0") + '" stroke="' + (o.dark ? "#2a2e35" : "#5d6470") + '" stroke-width="2"/><rect x="34" y="8" width="18" height="18" fill="' + (o.dark ? "#2a2e35" : "#3a404a") + '"/><rect x="7" y="9" width="20" height="4" rx="2" fill="' + (o.dark ? "#2a2e35" : "#8b929e") + '"/><rect x="7" y="17" width="14" height="3" rx="1.5" fill="' + (o.dark ? "#2a2e35" : "#a9b0bb") + '"/></g>';
    return '<figure class="photo" style="' + (o.w ? "width:" + o.w + "px" : "") + '"><svg viewBox="0 0 320 240" role="img" aria-label="' + (o.alt || "Placeholder for the punch photo (not a real person)") + '">' +
      '<defs><radialGradient id="' + id + '" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="' + tones[0] + '"/><stop offset=".6" stop-color="' + tones[1] + '"/><stop offset="1" stop-color="' + tones[2] + '"/></radialGradient></defs>' +
      '<rect width="320" height="240" fill="url(#' + id + ')"/>' +
      '<rect x="0" y="0" width="70" height="240" fill="' + (o.dark ? "#1a1d22" : "rgba(255,255,255,.08)") + '"/>' +
      '<g transform="translate(' + (160 + dx) + ',0) scale(' + s + ') translate(-160,0)" fill="' + fig + '">' +
      '<circle cx="160" cy="98" r="40"/><path d="M78 240c0-56 36-92 82-92s82 36 82 92z"/></g>' + card +
      "</svg>" + '<span class="ph-tag">' + D.icon("image") + "SAMPLE · not a real photo</span></figure>";
  };

  // ---------- page helpers ----------
  C.roBanner = function (bold, text) {
    return '<div class="ro-banner" role="note">' + D.icon("lock", 18) + "<span><b>" + bold + "</b> " + text + "</span></div>";
  };
  C.filterBtn = function (label, value, on) {
    return '<button class="btn btn-outline" style="height:42px;' + (on ? "background:var(--primary-soft);border-color:#b9c6ef;color:var(--primary-soft-foreground)" : "") + '" aria-haspopup="listbox">' +
      '<span class="muted" style="font-weight:500;' + (on ? "color:inherit" : "") + '">' + label + "</span><b>" + value + "</b>" + D.icon("chevron-down", 15, "color:var(--muted-foreground)") + "</button>";
  };
  C.tag = function (text) { D.tag(text + " · " + D.roleName); };
  C.switchHtml = function (on, label) {
    return '<button class="sw" role="switch" aria-checked="' + !!on + '" aria-label="' + label + '"><span class="sw-track"><span class="sw-thumb"></span></span>' +
      '<span class="sw-word ' + (on ? "" : "is-off") + '">' + D.icon(on ? "volume-2" : "volume-x") + (on ? "On" : "Off") + "</span></button>";
  };
  C.soundText = function (on) {
    return '<span class="sw-word ' + (on ? "" : "is-off") + '">' + D.icon(on ? "volume-2" : "volume-x") + (on ? "On" : "Off") + "</span>";
  };

  // ---------- shell: new nav group, links between gate C screens, role variants ----------
  C.patchShell = function (o) {
    o = o || {};
    const sidebar = document.getElementById("sidebar");
    const topbar = document.getElementById("topbar");
    const find = function (title) { return sidebar.querySelector('.sb-item[title="' + title + '"]'); };
    const remove = function (titles) { titles.forEach(function (t) { const el = find(t); if (el) el.remove(); }); };
    const active = document.body.dataset.active;

    // New "Attendance" group (M2): Punch log and Gate notices, after Overview
    const group = document.createElement("div");
    group.className = "sb-group";
    group.innerHTML = '<div class="sb-group-label">Attendance</div>' +
      '<a href="01-punch-log.html" class="sb-item" title="Punch log"' + (active === "punches" ? ' aria-current="page"' : "") + '><i data-lucide="history"></i><span class="sb-label">Punch log</span></a>' +
      '<a href="03-notices.html" class="sb-item" title="Gate notices"' + (active === "notices" ? ' aria-current="page"' : "") + '><i data-lucide="megaphone"></i><span class="sb-label">Gate notices</span></a>';
    const groups = sidebar.querySelectorAll(".sb-group");
    groups[0].after(group);

    const links = { Kiosks: "04-kiosks.html", Plants: "06-plant-detail.html", Settings: "05-settings.html", "QR cards": "../gate-a/01-qr-cards.html", Employees: "../../m1/gate-d/D1-employees.html" };
    Object.keys(links).forEach(function (t) { const el = find(t); if (el) el.setAttribute("href", links[t]); });

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
    // Super Admin / Corporate Head: optional plant chosen in the top-bar filter
    if (o.plant && D.role !== "ph") {
      const pf = topbar.querySelector(".plant-filter");
      pf.setAttribute("aria-label", "Plant filter: " + o.plant);
      pf.style.cssText = "background:var(--primary-soft);border-color:#b9c6ef";
      pf.querySelector("span").innerHTML = '<b class="code">' + o.plant + '</b> <span style="font-weight:500">' + (C.PLANT_NAMES[o.plant] || "") + "</span>";
    }
  };
})();
