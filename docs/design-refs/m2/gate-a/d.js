/*
  Upasthiti – M1 design gate D: shared mockup helpers (fake data, badges, table rows, dialogs,
  role variants of the gate A shell). MOCKUP ONLY, not app code.
  Load AFTER ../gate-a/shell.js. State comes from the URL hash; tokens are joined with "+",
  e.g. #selected+ch  (ch = Corporate Head view, ph = Plant Head view, none = Super Admin).
*/
(function () {
  const D = (window.D = {});

  // ---------- state from the URL hash ----------
  D.tokens = location.hash.replace("#", "").split("+").filter(Boolean);
  D.has = function (token) { return D.tokens.indexOf(token) !== -1; };
  D.role = D.has("ch") ? "ch" : D.has("ph") ? "ph" : "sa";
  D.roleName = { sa: "Super Admin", ch: "Corporate Head", ph: "Plant Head" }[D.role];

  // ---------- fake data (all people, contractors and numbers are invented) ----------
  D.PLANTS = [
    { code: "K134", name: "Sheet Shapers India Pvt Ltd (K-134)", count: 142 },
    { code: "X280", name: "Sheet Shapers India Pvt Ltd (X-280)", count: 118 },
    { code: "PC1", name: "Precise Cuts India Pvt Ltd, Unit 1", count: 96 },
    { code: "PC2", name: "Precise Cuts India Pvt Ltd, Unit 2", count: 74 },
    { code: "SPI", name: "Siddharth Pressings India Pvt Ltd", count: 88 },
    { code: "TP1", name: "Tirupati Pressco, Unit 1", count: 130 },
    { code: "TP2", name: "Tirupati Pressco, Unit 2", count: 0 },
  ];
  D.CONTRACTORS = [
    "Shree Samarth Manpower", "Omkar Labour Services", "Gajanan Workforce Pvt Ltd", "Sai Krupa Enterprises", "Jai Hind Staffing",
  ];
  // code, name, type, plant, category, department, shift, contractor, otRate (null = missing), status, pending, leftOn
  D.EMP = [
    ["1001", "Ramesh Kulkarni", "permanent", "K134", "Staff", "Accounts", "General", null, 220, "active"],
    ["1018", "Anjali Deshpande", "permanent", "K134", "Staff", "Stores", "General", null, null, "active"],
    ["1042", "Pradeep Jadhav", "permanent", "K134", "Operator", "Press shop", "General", null, 185, "active", true],
    ["1055", "Kavita More", "permanent", "X280", "Worker", "Assembly", "General", null, 160, "active"],
    ["1063", "Nilesh Bhosale", "permanent", "X280", "Operator", "Laser cutting", "Night", null, 175, "active"],
    ["1077", "Meena Shinde", "permanent", "K134", "Worker", "Press shop", "General", null, 150, "left", false, "10/10/2026"],
    ["1090", "Swati Kamble", "permanent", "PC1", "Staff", "Quality", "General", null, 200, "active"],
    ["2041", "Ravi Patil", "temporary", "TP1", "Helper", "Fabrication", "Night", "Shree Samarth Manpower", 120, "active"],
    ["2042", "Sagar Pawar", "temporary", "TP1", "Operator", "Fabrication", "General", "Omkar Labour Services", 140, "active"],
    ["2057", "Ganesh Thorat", "temporary", "SPI", "Helper", "Packing", "General", "Gajanan Workforce Pvt Ltd", null, "active"],
    ["2063", "Pooja Wagh", "temporary", "PC2", "Helper", "Packing", "General", "Sai Krupa Enterprises", 110, "active"],
    ["2071", "Santosh Chavan", "temporary", "K134", "Operator", "Press shop", "Night", "Shree Samarth Manpower", 140, "active"],
    ["2088", "Rutuja Salunkhe", "temporary", "X280", "Helper", "Assembly", "General", null, 110, "active"],
    ["2094", "Amol Dange", "temporary", "TP1", "Helper", "Stores", "General", "Jai Hind Staffing", 110, "left", false, "30/09/2026"],
    ["A-310", "Yogesh Mhaske", "temporary", "PC1", "Operator", "Laser cutting", "General", "Omkar Labour Services", 140, "active"],
  ];

  // ---------- small helpers ----------
  D.esc = function (text) { return String(text).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  D.icon = function (name, size, style) { return '<i data-lucide="' + name + '" style="width:' + (size || 16) + "px;height:" + (size || 16) + "px;" + (style || "") + '"></i>'; };
  D.initials = function (name) { return name.split(" ").map(function (p) { return p[0]; }).slice(0, 2).join(""); };
  D.rs = function (n) { return "₹" + Number(n).toLocaleString("en-IN"); };
  D.tag = function (text) {
    let el = document.getElementById("state-tag");
    if (!el) { el = document.createElement("div"); el.id = "state-tag"; el.className = "state-tag"; document.body.appendChild(el); }
    el.textContent = "State: " + text;
  };

  D.typeBadge = function (type) {
    return type === "permanent"
      ? '<span class="badge badge-info"><i data-lucide="scan-face"></i>Permanent</span>'
      : '<span class="badge badge-warning"><i data-lucide="qr-code"></i>Temporary</span>';
  };
  D.statusBadge = function (status) {
    if (status === "left") return '<span class="badge badge-neutral"><i data-lucide="log-out"></i>Left</span>';
    return '<span class="badge badge-success"><i data-lucide="circle-check"></i>Active</span>';
  };

  // ---------- one employee table row ----------
  D.empRow = function (e, opts) {
    opts = opts || {};
    const hide = opts.hide || [];
    const isLeft = e[9] === "left";
    const checked = opts.selected && opts.selected.indexOf(e[0]) !== -1;
    const cb = opts.selectable
      ? '<td class="cb-cell" style="width:44px;padding-left:16px"><input type="checkbox" class="cb" aria-label="Select ' + e[1] + '"' + (checked ? " checked" : "") + " /></td>"
      : "";
    const ot = e[8] === null
      ? '<span class="miss"><i data-lucide="triangle-alert"></i>Missing</span>'
      : '<span class="tnum">' + D.rs(e[8]) + "/h</span>";
    const status = D.statusBadge(e[9]) +
      (isLeft && opts.showLeftOn !== false ? '<div class="muted tnum" style="font-size:12px;margin-top:3px">on ' + e[11] + "</div>" : "") +
      "";
    const cell = function (col, html, extra) { return hide.indexOf(col) === -1 ? "<td " + (extra || "") + ">" + html + "</td>" : ""; };
    return '<tr class="' + (isLeft ? "is-left " : "") + (checked ? "is-selected" : "") + '" style="cursor:pointer">' + cb +
      cell("code", '<b class="code" style="font-size:14px">' + D.esc(e[0]) + "</b>", 'class="hide-m"') +
      '<td class="full"><div class="emp-name"><span class="avatar" style="width:34px;height:34px">' + D.initials(e[1]) + '</span><span style="min-width:0"><b class="trunc" style="max-width:170px">' + e[1] + '</b><small class="m-only code" style="display:none">' + e[0] + "</small>" + (e[10] ? '<span class="pending-note"><i data-lucide="hourglass"></i>Change waiting</span>' : "") + "</span></div></td>" +
      cell("type", D.typeBadge(e[2]), 'data-label="Type"') +
      cell("plant", '<b class="code">' + e[3] + "</b>", 'data-label="Plant"') +
      cell("category", e[4], 'data-label="Category"') +
      cell("department", '<span class="trunc" style="max-width:120px">' + e[5] + "</span>", 'class="hide-m"') +
      cell("shift", e[6], 'class="hide-m"') +
      cell("contractor", e[7] ? '<span class="trunc" style="max-width:130px" title="' + e[7] + '">' + e[7] + "</span>" : '<span class="muted">—</span>', 'class="hide-m"') +
      cell("ot", ot, 'class="num hide-m"') +
      cell("status", status, 'data-label="Status"') +
      "</tr>";
  };

  D.empTableHead = function (opts) {
    opts = opts || {};
    const hide = opts.hide || [];
    const th = function (col, label, extra) { return hide.indexOf(col) === -1 ? '<th scope="col" ' + (extra || "") + ">" + label + "</th>" : ""; };
    const all = opts.selectable
      ? '<th scope="col" style="width:44px;padding-left:16px"><input type="checkbox" class="cb" aria-label="Select all 50 on this page"' + (opts.allChecked ? " checked" : "") + "/></th>"
      : "";
    return "<thead><tr>" + all + th("code", "Code") + th("name", "Name") + th("type", "Type") + th("plant", "Plant") + th("category", "Category") +
      th("department", "Department") + th("shift", "Shift") + th("contractor", "Contractor") + th("ot", "OT rate", 'class="num"') + th("status", "Status") + "</tr></thead>";
  };

  D.skeletonRows = function (n, selectable) {
    const widths = [48, 170, 92, 40, 70, 100, 64, 130, 56, 80];
    const one = "<tr>" + (selectable ? '<td style="width:44px;padding-left:16px"><div class="skeleton" style="height:18px;width:18px"></div></td>' : "") +
      widths.map(function (w) { return '<td><div class="skeleton" style="height:14px;width:' + w + 'px"></div></td>'; }).join("") + "</tr>";
    return new Array(n + 1).join(one);
  };

  // ---------- shell: role variants + the new nav items ----------
  D.patchShell = function () {
    const sidebar = document.getElementById("sidebar");
    const topbar = document.getElementById("topbar");
    const find = function (title) { return sidebar.querySelector('.sb-item[title="' + title + '"]'); };
    const active = document.body.dataset.active;

    // links between the gate D screens
    const links = { Employees: "D1-employees.html", Contractors: "D4-contractors.html", Approvals: "D5-approvals.html" };
    Object.keys(links).forEach(function (title) { const el = find(title); if (el) el.setAttribute("href", links[title]); });

    // new nav item: Import (Super Admin, Corporate Head)
    const employees = find("Employees");
    const importItem = document.createElement("a");
    importItem.href = "D6-import.html";
    importItem.className = "sb-item";
    importItem.title = "Import";
    importItem.innerHTML = '<i data-lucide="file-spreadsheet"></i><span class="sb-label">Import</span>';
    employees.after(importItem);
    if (active === "import") {
      sidebar.querySelectorAll(".sb-item[aria-current]").forEach(function (el) { el.removeAttribute("aria-current"); });
      importItem.setAttribute("aria-current", "page");
    }

    // Approvals badge: the Super Admin sees how many requests wait
    const approvals = find("Approvals");
    const badge = approvals && approvals.querySelector(".sb-count");
    if (badge && D.role === "sa") { badge.textContent = window.D_PENDING_COUNT === 0 ? "" : String(window.D_PENDING_COUNT || 4); badge.setAttribute("aria-label", (window.D_PENDING_COUNT || 4) + " waiting"); if (window.D_PENDING_COUNT === 0) badge.remove(); }

    if (D.role === "ch") {
      // Corporate Head: "My requests" instead of Approvals; no Setup wizard, no Users
      ["Setup wizard", "Users"].forEach(function (title) { const el = find(title); if (el) el.remove(); });
      if (approvals) {
        approvals.title = "My requests";
        approvals.querySelector(".sb-label").textContent = "My requests";
        approvals.querySelector("i").setAttribute("data-lucide", "send");
        if (badge) { badge.textContent = "1"; badge.setAttribute("aria-label", "1 waiting"); }
      }
      const user = topbar.querySelector(".user-trigger");
      user.setAttribute("aria-label", "Account menu for Vikram Deshmukh");
      user.querySelector(".avatar").textContent = "VD";
      user.querySelector(".user-meta").innerHTML = "<b>Vikram Deshmukh</b><span>Corporate Head</span>";
    }

    if (D.role === "ph") {
      ["Setup wizard", "Approvals", "Users", "Import"].forEach(function (title) { const el = find(title); if (el) el.remove(); });
      const filter = topbar.querySelector(".plant-filter");
      filter.outerHTML = '<span class="badge badge-outline" style="height:40px;padding:0 14px;border-radius:10px;font-size:14px" aria-label="Your plant: X280, fixed">' +
        D.icon("factory", 17, "color:var(--muted-foreground)") + '<b class="code">X280</b><span class="pf-text" style="font-weight:500">Sheet Shapers (X-280)</span>' + D.icon("lock", 14, "color:var(--subtle-foreground)") + "</span>";
      const user = topbar.querySelector(".user-trigger");
      user.setAttribute("aria-label", "Account menu for Sameer Joshi");
      user.querySelector(".avatar").textContent = "SJ";
      user.querySelector(".user-meta").innerHTML = "<b>Sameer Joshi</b><span>Plant Head · X280</span>";
      const search = topbar.querySelector(".search-text");
      if (search) search.textContent = "Search your plant, X280…";
    }

    // Phone width: a menu button replaces the sidebar
    const menu = document.createElement("button");
    menu.className = "btn btn-outline btn-icon mobile-only";
    menu.setAttribute("aria-label", "Open menu");
    menu.innerHTML = D.icon("menu", 20);
    topbar.prepend(menu);
    const pf = topbar.querySelector(".plant-filter > span");
    if (pf) pf.classList.add("pf-text");
  };

  // ---------- dialogs and toast ----------
  D.dialog = function (o) {
    return '<div class="overlay"></div><div class="dialog anim-scale-in" role="' + (o.alert ? "alertdialog" : "dialog") + '" aria-modal="true" aria-labelledby="dlg-title" style="width:min(' + (o.width || 560) + 'px,calc(100vw - 32px))">' +
      '<div class="dlg-head" style="display:flex;gap:14px;align-items:flex-start"><span class="dlg-icon ' + (o.tone || "di-primary") + '"><i data-lucide="' + o.icon + '"></i></span>' +
      '<div style="flex:1;min-width:0"><h2 class="dlg-title" id="dlg-title">' + o.title + "</h2>" + (o.desc ? '<p class="muted" style="margin:6px 0 0;font-size:14px">' + o.desc + "</p>" : "") + "</div>" +
      '<button class="btn btn-ghost btn-icon btn-sm" aria-label="Close">' + D.icon("x", 18) + "</button></div>" +
      '<div class="dlg-body">' + o.body + '</div><div class="dlg-foot">' + o.foot + "</div></div>";
  };
  D.mount = function (html) {
    const holder = document.createElement("div");
    holder.id = "overlay-root";
    holder.innerHTML = html;
    document.body.appendChild(holder);
  };
  D.toast = function (text, link) {
    D.mount('<div class="toast" role="status"><span class="ti">' + D.icon("check", 16) + "</span><span>" + text + "</span>" + (link ? '<a href="#">' + link + "</a>" : "") + "</div>");
  };

})();
