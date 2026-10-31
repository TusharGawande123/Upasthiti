/*
  Upasthiti - M5 design gate A: fake data shared by dashboard.html and muster.html. MOCKUP ONLY.
  "Today" is Wednesday 28/10/2026, the live numbers are from 09:02:15 IST.
  All names are invented. Words for people: "attendance device", never "kiosk".
*/

window.TODAY = "Wednesday 28/10/2026";

/* One row per plant, as the "All plants" table shows it. */
window.PLANTS = [
  { code: "K134", name: "Sheet Shapers K-134", inside: 214, temp: 98, expected: 236, arrived: 221, late: 12, notArrived: 9, leave: 8, off: 14, exceptions: 11, started: true },
  { code: "K135", name: "Sheet Shapers K-135", inside: 168, temp: 71, expected: 182, arrived: 171, late: 7, notArrived: 5, leave: 6, off: 9, exceptions: 4, started: true },
  { code: "PC1", name: "Press shop 1", inside: 96, temp: 38, expected: 104, arrived: 99, late: 5, notArrived: 3, leave: 2, off: 5, exceptions: 1, started: true },
  { code: "PC2", name: "Press shop 2", inside: 88, temp: 33, expected: 97, arrived: 90, late: 3, notArrived: 4, leave: 3, off: 6, exceptions: 0, started: true },
  { code: "SPI", name: "Spinning unit", inside: 74, temp: 30, expected: 81, arrived: 76, late: 2, notArrived: 2, leave: 3, off: 4, exceptions: 2, started: true },
  { code: "TP1", name: "Tool plant 1", inside: 52, temp: 19, expected: 60, arrived: 53, late: 6, notArrived: 5, leave: 2, off: 3, exceptions: 3, started: true },
  { code: "X280", name: "Sheet Shapers X-280", started: false },
];
window.DEMO_PLANT = { code: "DEMO", name: "Demo plant", inside: 12, temp: 5, expected: 14, arrived: 12, late: 1, notArrived: 1, leave: 1, off: 0, exceptions: 0, started: true, demo: true };

window.CONTRACTORS = [["Shree Manpower", 34], ["Omkar Staffing", 27], ["Bhagyashree Services", 19], ["Sai Labour Contractors", 11], ["No contractor", 7]];

window.sumPlants = function (list) {
  const keys = ["inside", "temp", "expected", "arrived", "late", "notArrived", "leave", "off", "exceptions"];
  const t = {};
  keys.forEach((k) => { t[k] = list.filter((p) => p.started).reduce((s, p) => s + p[k], 0); });
  return t;
};

/* Indian number grouping (1,00,000) */
window.inr = function (n) { return new Intl.NumberFormat("en-IN").format(n); };

/* ---------- Muster rows: a seeded generator, so every run draws the same people ---------- */
function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const FIRST = ["Ajay", "Amit", "Anil", "Arun", "Bhavesh", "Deepak", "Ganesh", "Girish", "Harish", "Jayesh", "Kiran", "Mahesh", "Nitin", "Pramod", "Rahul", "Sachin", "Santosh", "Sunil", "Vikas", "Yogesh", "Sandeep", "Dinesh", "Rakesh", "Anita", "Kavita", "Lata", "Meena", "Pooja", "Rekha", "Sunita", "Vaishali", "Smita", "Archana"];
const LAST = ["Patil", "Jadhav", "Shinde", "More", "Pawar", "Gaikwad", "Kale", "Deshmukh", "Chavan", "Sonawane", "Bhosale", "Wagh", "Thorat", "Kharat", "Mhaske", "Ingle", "Dange", "Salve", "Waghmare", "Borade"];
const DEPTS = ["Press shop", "Press shop", "Welding", "Welding", "Assembly", "Assembly", "Assembly", "Stores", "Quality", "Maintenance", "Dispatch"];
window.DEPT_ORDER = ["Assembly", "Dispatch", "Maintenance", "Press shop", "Quality", "Stores", "Welding"];

window.makeRows = function (seed, count, tempCount, devices, contractorSplit) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const contractors = [];
  (contractorSplit || window.CONTRACTORS).forEach(([n, c]) => { for (let i = 0; i < c; i++) contractors.push(n); });
  const rows = [];
  for (let i = 0; i < count; i++) {
    const temp = i < tempCount;
    const mins = 6 * 60 + 38 + Math.floor(r() * 144); /* IN between 06:38 and 09:01 */
    rows.push({
      code: (temp ? "T" : "E") + String(temp ? 3000 + Math.floor(r() * 900) : 1000 + Math.floor(r() * 900) + i),
      name: pick(FIRST) + " " + pick(LAST),
      type: temp ? "Temporary" : "Permanent",
      category: temp ? pick(["Operator", "Helper", "Helper"]) : pick(["Staff", "Worker", "Worker", "Operator"]),
      dept: pick(DEPTS),
      contractor: temp ? contractors[i] || "No contractor" : "",
      inTime: String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0"),
      device: pick(devices),
    });
  }
  rows.sort((a, b) => window.DEPT_ORDER.indexOf(a.dept) - window.DEPT_ORDER.indexOf(b.dept) || a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  return rows;
};
