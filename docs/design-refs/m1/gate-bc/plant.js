/*
  Upasthiti – M1 gates B/C mockup helpers: the plant detail header + tabs, and the
  "Plant Head" read-only view (changes the shared gate A shell). MOCKUP ONLY, not app code.
  Load after ../gate-a/shell.js; call from window.onMockState.
*/

// One fake-but-plausible plant: TP2 (a real plant code/name from client_plants.py; the counts are fake).
const PLANT = {
  code: "TP2",
  name: "Tirupati Pressco, Unit 2",
  address: "9/1, S.L.U.Y., MIDC, Waluj, Aurangabad 431136",
};

const PLANT_TABS = [
  { id: "overview", text: "Overview", icon: "layout-grid", href: "B3-plant-detail.html" },
  { id: "geofence", text: "Geofence", icon: "map-pinned", href: "B4-geofence.html", mark: "ok" },
  { id: "departments", text: "Departments", icon: "network", href: "B3-plant-detail.html#departments", count: 3 },
  { id: "shifts", text: "Shifts", icon: "clock-3", href: "B5-shifts.html", count: 2 },
  { id: "categories", text: "Categories", icon: "tags", href: "B3-plant-detail.html#categories", count: 4 },
  { id: "kiosks", text: "Kiosks", icon: "tablet-smartphone", href: "B3-plant-detail.html#kiosks", count: 0 },
];

window.renderPlantHeader = function (activeTab, readOnly) {
  const tabs = PLANT_TABS.map(function (tab) {
    const selected = tab.id === activeTab ? "true" : "false";
    const count = tab.count !== undefined ? `<span class="tab-count tnum">${tab.count}</span>` : "";
    const mark = tab.mark === "ok"
      ? `<i data-lucide="circle-check" class="tab-mark" style="color:var(--success)" aria-label="set"></i>` : "";
    return `<a class="tab" role="tab" aria-selected="${selected}" href="${tab.href}"><i data-lucide="${tab.icon}"></i>${tab.text}${count}${mark}</a>`;
  }).join("");

  const actions = readOnly ? "" : `
    <div class="flex gap-2" data-edit>
      <button class="btn btn-outline"><i data-lucide="pencil" style="width:16px;height:16px"></i>Edit details</button>
      <button class="btn btn-ghost btn-icon" aria-label="More actions for ${PLANT.code}"><i data-lucide="ellipsis" style="width:18px;height:18px"></i></button>
    </div>`;

  return `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="B2-plants.html" style="color:inherit">Plants</a><i data-lucide="chevron-right" style="width:14px;height:14px"></i><span aria-current="page">${PLANT.code}</span></nav>
    <div class="page-head" style="margin-bottom:0">
      <div class="plant-title-row">
        <span class="code-tile code" aria-hidden="true">${PLANT.code}</span>
        <div>
          <div class="flex items-center gap-3 flex-wrap">
            <h1 class="page-title">${PLANT.name}</h1>
            <span class="badge badge-success"><i data-lucide="circle-check"></i>Active</span>
          </div>
          <p class="page-desc" style="margin-top:4px"><i data-lucide="map-pin" style="width:15px;height:15px;display:inline;vertical-align:-2px"></i> ${PLANT.address}</p>
        </div>
      </div>
      ${actions}
    </div>
    <div class="tabs" role="tablist" aria-label="Plant sections">${tabs}</div>`;
};

// Switch the shared shell to a Plant Head (read-only for plant setup, own plant only).
window.applyPlantHeadView = function () {
  const hiddenForPlantHead = ["Setup wizard", "Approvals", "Users"];
  document.querySelectorAll(".sb-item").forEach(function (item) {
    if (hiddenForPlantHead.includes(item.getAttribute("title"))) item.remove();
  });
  const filter = document.querySelector(".plant-filter");
  if (filter) {
    filter.outerHTML = `<span class="badge badge-outline" style="height:40px;padding:0 14px;border-radius:10px;font-size:14px" aria-label="Your plant: ${PLANT.code}, fixed">
      <i data-lucide="factory" style="width:17px;height:17px;color:var(--muted-foreground)"></i><b class="code">${PLANT.code}</b><span style="font-weight:500">${PLANT.name}</span>
      <i data-lucide="lock" style="width:14px;height:14px;color:var(--subtle-foreground)"></i></span>`;
  }
  const user = document.querySelector(".user-trigger");
  if (user) {
    user.setAttribute("aria-label", "Account menu for Sunil More");
    user.querySelector(".avatar").textContent = "SM";
    user.querySelector(".user-meta").innerHTML = "<b>Sunil More</b><span>Plant Head · TP2</span>";
  }
  document.querySelectorAll("[data-edit]").forEach(function (el) { el.remove(); });
  document.querySelectorAll("[data-readonly-only]").forEach(function (el) { el.hidden = false; });
};

window.readOnlyBanner = function (text) {
  return `<div class="ro-banner" role="note"><i data-lucide="lock"></i><span><b>Read-only.</b> ${text}</span></div>`;
};
