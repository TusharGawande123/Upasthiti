/*
  Upasthiti - M4b design gate P3: shared fake data and small widgets for the admin phone-attendance mockups.
  MOCKUP ONLY, not app code. Needs shell.js first (ic, dialog, field, sel, USERS ...). Fake people, fake codes, no photo of any person.
  Words for people: "attendance device", never "kiosk". Today in the mockups is Saturday 31/10/2026, about 09:20 IST.
*/

/* ---------- Who is looking ---------- */
window.roleOf = function (S, chStates, phStates) {
  if ((chStates || ["corporate-head"]).indexOf(S) >= 0) return "ch";
  if ((phStates || ["plant-head"]).indexOf(S) >= 0) return "ph";
  return "sa";
};

/* ---------- Small widgets ---------- */
window.sw = function (on, label, o) {
  o = o || {};
  return `<button class="sw" role="switch" aria-checked="${on}" aria-label="${label}" ${o.disabled ? "disabled" : ""}><span class="track"></span><span class="word">${on ? ic("check") + "On" : ic("minus") + "Off"}</span></button>`;
};
window.stateWord = function (on, wordOn, wordOff) {
  return `<span class="pa-state ${on ? "on" : "off"}">${ic(on ? "smartphone" : "smartphone-nfc")}${on ? wordOn : wordOff}</span>`;
};
window.countBadge = function (n) { return `<span class="badge badge-neutral count">${n}</span>`; };
window.channelBadge = {
  phone: `<span class="badge badge-phone">${ic("smartphone")}Phone</span>`,
  device: `<span class="badge badge-device">${ic("tablet-smartphone")}Attendance device</span>`,
};
window.methodBadge = {
  face: `<span class="badge badge-method-face">${ic("scan-face")}Face</span>`,
  card: `<span class="badge badge-method-card">${ic("id-card")}Card</span>`,
  phonecode: `<span class="badge badge-method-phonecode">${ic("qr-code")}Phone code</span>`,
};
window.outsideBadge = `<span class="badge badge-outside">${ic("map-pin-off")}Outside plant</span>`;

/* ---------- Employees used in all mockups ---------- */
window.EMP = {
  face: { name: "Sunita Jadhav", code: "EMP-0312", plant: "K134", plantFull: "Sheet Shapers (K-134)", type: "Permanent", method: "face", cat: "Operator" },
  qr: { name: "Santosh Gaikwad", code: "T-2041", plant: "K134", plantFull: "Sheet Shapers (K-134)", type: "Temporary", method: "qr", cat: "Helper", contractor: "Shree Manpower" },
};

/* ---------- Drawn maps (a drawing here, Leaflet + OpenStreetMap in the build; not a real place) ---------- */
function mapBaseP3(sat) {
  if (!sat) return `<rect width="520" height="300" fill="#eceff3"/>
    <rect x="20" y="20" width="60" height="50" fill="#dde2ea"/><rect x="470" y="30" width="36" height="80" fill="#dde2ea"/><rect x="190" y="248" width="120" height="40" fill="#dde2ea"/><rect x="330" y="200" width="90" height="40" fill="#dde2ea"/><rect x="20" y="200" width="46" height="60" fill="#dde2ea"/>
    <rect x="420" y="215" width="60" height="70" fill="#dbe9d8"/><rect x="170" y="8" width="90" height="26" fill="#dbe9d8"/>
    <path d="M0 262 L520 244" stroke="#fff" stroke-width="14"/><path d="M70 0 L92 300" stroke="#fff" stroke-width="10"/><path d="M0 28 L520 40" stroke="#fff" stroke-width="8"/><path d="M300 0 L286 300" stroke="#fff" stroke-width="9"/>`;
  return `<rect width="520" height="300" fill="#3d4b3c"/><rect x="20" y="20" width="60" height="50" fill="#566352"/><rect x="470" y="30" width="36" height="80" fill="#6b6a62"/><rect x="190" y="248" width="120" height="40" fill="#6f6e66"/><rect x="420" y="215" width="60" height="70" fill="#2f4630"/><rect x="170" y="8" width="90" height="26" fill="#2f4630"/>
    <path d="M0 262 L520 244" stroke="#8a8a80" stroke-width="12"/><path d="M70 0 L92 300" stroke="#8a8a80" stroke-width="8"/><path d="M0 28 L520 40" stroke="#8a8a80" stroke-width="6"/><path d="M300 0 L286 300" stroke="#8a8a80" stroke-width="8"/>`;
}
function pillP3(x, y, w, text) {
  return `<g transform="translate(${x} ${y})"><rect x="0" y="-15" width="${w}" height="22" rx="11" fill="#fff" stroke="#0e1726" stroke-width="1.2"/><text x="${w / 2}" y="0" text-anchor="middle" font-size="13" font-weight="700" fill="#0e1726" font-family="Inter,sans-serif">${text}</text></g>`;
}
/* The phone's position, far from the plant fence. o: sat, dist (text), acc (text), time, plant */
window.outsideMap = function (o) {
  const sat = !!o.sat;
  const stroke = sat ? "#9fb6ff" : "#1f3a93";
  const FENCE = "70,90 170,76 210,120 200,190 90,200 56,140";
  return `<div class="mapbox"><div class="map-bar"><span class="map-ver">${ic("history")}Fence of ${o.plant || "K134"} as drawn on 12/10/2026</span>
    <div class="seg" role="group" aria-label="Map type"><button aria-pressed="${!sat}">${ic("map")}Map</button><button aria-pressed="${sat}">${ic("satellite")}Satellite</button></div></div>
    <svg class="map-svg" viewBox="0 0 520 300" role="img" aria-label="Map: the phone was ${o.dist} from the ${o.plant || "K134"} fence at ${o.time}. The fence is drawn on the left, the phone position on the right.">
      ${mapBaseP3(sat)}
      <polygon points="${FENCE}" fill="rgba(31,58,147,.18)" stroke="${stroke}" stroke-width="3.5" stroke-linejoin="round"/>
      <text x="132" y="150" text-anchor="middle" font-size="14" font-weight="700" fill="${sat ? "#fff" : "#1a3282"}" font-family="Inter,sans-serif">Plant ${o.plant || "K134"}</text>
      <line x1="210" y1="150" x2="400" y2="132" stroke="#b42318" stroke-width="2.5" stroke-dasharray="9 6"/>
      <circle cx="412" cy="130" r="26" fill="rgba(180,35,24,.16)" stroke="#b42318" stroke-width="2" stroke-dasharray="2 3"/>
      <circle cx="412" cy="130" r="8" fill="#b42318" stroke="#fff" stroke-width="2.5"/>
      ${pillP3(372, 92, 80, o.time)}
      ${pillP3(250, 192, 112, o.dist)}
      <g transform="translate(24 284)"><rect x="-6" y="-16" width="108" height="24" rx="6" fill="rgba(255,255,255,.86)"/><path d="M0 0 H80 M0 -5 V5 M80 -5 V5" stroke="#0e1726" stroke-width="2"/><text x="88" y="4" font-size="12" font-weight="700" fill="#0e1726" font-family="Inter,sans-serif">not to scale</text></g>
    </svg>
    <div class="map-attr">${sat ? "Imagery © Esri World Imagery" : "© OpenStreetMap contributors"} · drawing for the mockup</div>
    <div class="map-cap2">${ic("map-pin-off")}<div>${o.dist} from the fence<small>Location accuracy ${o.acc}. Position shown to the Super Admin only.</small></div></div>
    <div class="map-legend2"><span><i style="border:3px solid var(--primary);background:rgba(31,58,147,.18)"></i>Fence of the own plant</span><span><i style="border-radius:99px;background:#b42318"></i>Phone position</span><span><i style="border-radius:99px;border:2px dotted #b42318;background:rgba(180,35,24,.15)"></i>Accuracy</span><span><i style="height:0;border-top:3px dashed #b42318;margin-top:2px"></i>Distance</span></div></div>`;
};

/* ---------- Reason field used by every dialog ---------- */
window.reasonField = function (value, err) {
  const n = value ? value.length : 0;
  return `<div class="fld" style="margin-bottom:0"><label class="label" for="why">Reason (required)</label>
    <textarea class="input" id="why" ${err ? `aria-invalid="true" aria-describedby="why-e"` : ""} placeholder="For example: she asked at the plant office">${value || ""}</textarea>
    ${err ? `<p class="errline" id="why-e">${ic("circle-alert")}${err}</p>` : ""}
    <div class="rsn-hint"><span>3 to 300 characters. It is saved in the audit log.</span><span class="counter tnum">${n} / 300</span></div></div>`;
};
window.REASON_ERR = "The reason needs 3 to 300 characters.";

window.dlgFoot = function (confirmIcon, confirmText, o) {
  o = o || {};
  const cls = o.danger ? "btn btn-danger btn-lg" : "btn btn-primary btn-lg";
  const inner = o.saving ? `<span class="spinner-row">${spinner()}Saving…</span>` : `${ic(confirmIcon)}${confirmText}`;
  return `<button class="btn btn-outline btn-lg" ${o.saving ? "disabled" : ""}>Cancel</button><button class="${cls}" ${o.saving ? "disabled aria-busy=\"true\"" : ""}>${inner}</button>`;
};

/* ---------- Texts that appear in more than one page ---------- */
window.PHONE_MANY_TEXT = "An employee signed in on 3 phones in 30 days. Check the signed-in phones.";
