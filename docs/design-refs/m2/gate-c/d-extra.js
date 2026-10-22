/*
  Upasthiti – M1 design gate D: more shared mockup helpers (form fields, selects, request kinds and
  statuses, page head, shared dialogs). Load AFTER d.js. MOCKUP ONLY, not app code.
*/
(function () {
  const D = window.D;

  // ---------- today in the mockups: Wed 14/10/2026 ----------
  D.TODAY = "14/10/2026";

  // ---------- page head ----------
  D.pageHead = function (o) {
    return '<div class="page-head anim-fade-up"><div>' + (o.crumbs ? '<nav class="crumbs" aria-label="Breadcrumb">' + o.crumbs + "</nav>" : "") +
      '<h1 class="page-title">' + o.title + "</h1>" + (o.desc ? '<p class="page-desc">' + o.desc + "</p>" : "") + "</div>" +
      (o.actions ? '<div class="flex gap-2 items-center">' + o.actions + "</div>" : "") + "</div>";
  };
  D.crumb = function (items) {
    return items.map(function (item, i) {
      const last = i === items.length - 1;
      return (item.href && !last ? '<a class="link" style="font-weight:500;text-decoration:none" href="' + item.href + '">' + item.text + "</a>" : '<span' + (last ? ' aria-current="page" style="color:var(--foreground);font-weight:600"' : "") + ">" + item.text + "</span>") + (last ? "" : D.icon("chevron-right", 14, "color:var(--subtle-foreground)"));
    }).join("");
  };

  // ---------- form fields ----------
  D.select = function (id, options, selected, extra) {
    return '<select id="' + id + '" class="input select"' + (extra || "") + ">" + options.map(function (o) {
      return "<option" + (o === selected ? " selected" : "") + ">" + o + "</option>";
    }).join("") + "</select>";
  };
  // o: { id, label, control (html), req, opt, help, error, hintIcon }
  D.field = function (o) {
    return "<div>" + '<label class="label" for="' + o.id + '">' + o.label + (o.req ? '<span class="req" aria-hidden="true">*</span><span class="sr-only"> (required)</span>' : "") + (o.opt ? '<span class="opt">optional</span>' : "") + "</label>" +
      o.control +
      (o.error ? '<div class="field-error" id="' + o.id + '-err" role="alert">' + D.icon("circle-alert", 15) + "<span>" + o.error + "</span></div>" : "") +
      (o.help ? '<div class="field-hint">' + D.icon(o.hintIcon || "info") + "<span>" + o.help + "</span></div>" : "") + "</div>";
  };

  // ---------- change-request kinds and statuses (icon + word, never colour alone) ----------
  D.KINDS = {
    create: { icon: "user-plus", label: "New employee" },
    edit: { icon: "pencil", label: "Edit" },
    transfer: { icon: "arrow-left-right", label: "Transfer" },
    bulk: { icon: "layers", label: "Bulk change" },
    import: { icon: "file-spreadsheet", label: "Import" },
  };
  D.kindBadge = function (kind) {
    const k = D.KINDS[kind];
    return '<span class="kind"><i data-lucide="' + k.icon + '"></i>' + k.label + "</span>";
  };
  D.reqStatus = function (status) {
    const map = {
      pending: ["badge-warning", "hourglass", "Waiting"],
      approved: ["badge-success", "circle-check", "Approved"],
      rejected: ["badge-danger", "circle-x", "Rejected"],
      withdrawn: ["badge-neutral", "undo-2", "Withdrawn"],
      failed: ["badge-danger", "triangle-alert", "Could not apply"],
    }[status];
    return '<span class="badge ' + map[0] + '"><i data-lucide="' + map[1] + '"></i>' + map[2] + "</span>";
  };

  // ---------- notes that repeat on many screens ----------
  D.waitNote = function (text) {
    return '<div class="alert alert-info" role="note">' + D.icon("shield-check", 20) + "<div><b>This change will wait for the Super Admin.</b> " + (text || "Nothing changes until it is approved.") + "</div></div>";
  };
  D.fieldChange = function (label, before, after) {
    return '<div class="diff-row"><div class="diff-field">' + label + '</div><div class="diff-vals"><div class="val val-before">' + D.icon("minus") + '<span><span class="val-label">Before</span><span class="v">' + before + '</span></span></div>' + D.icon("arrow-right", 16, "color:var(--subtle-foreground)") + '<div class="val val-after">' + D.icon("plus") + '<span><span class="val-label">After</span>' + after + "</span></div></div></div>";
  };
  D.newValue = function (label, value) {
    return '<div class="diff-row"><div class="diff-field">' + label + '</div><div class="diff-vals"><div class="val val-new">' + D.icon("plus") + '<span><span class="val-label">New</span>' + value + "</span></div></div></div>";
  };

  // dim the page behind an overlay (static mockups)
  D.dim = function () { const page = document.getElementById("page"); if (page) page.classList.add("is-dimmed"); };

  // a few buttons used on many screens
  D.spinner = '<svg class="spin" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>';
})();
