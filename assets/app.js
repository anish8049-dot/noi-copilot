/* =============================================================================
   NOI Copilot — application logic
   -----------------------------------------------------------------------------
   Three modules, one shared synthetic dataset (assets/data.js):
     1. Revenue Leakage Detector  — cross-references billed vs. owed, unit by unit
     2. Variance / Board-Package  — budget vs. actual + auto-written commentary
     3. AR / Delinquency Triage   — aging buckets, risk tiers, drafted notices

   Pure compute functions are exported for Node so the math can be unit-tested
   (see test.mjs). DOM rendering only runs in the browser.
   ============================================================================= */

// ---------- formatting helpers ----------------------------------------------
const usd  = (n) => "$" + Math.round(n).toLocaleString("en-US");
const usd2 = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct  = (n) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";

// ============================================================================
// MODULE 1 — Revenue Leakage Detector
// ============================================================================

// Flatten the structured dataset into one reconciliation row per unit. This is
// the single source of truth the detector consumes — the sample data and any
// uploaded CSV both become rows of this shape, so there is ONE code path.
function buildReconRows(data) {
  const reg  = Object.fromEntries(data.petRegistry.map((p) => [p.unit, p]));
  const park = Object.fromEntries(data.parkingInventory.map((p) => [p.assignedUnit, p]));
  const stor = Object.fromEntries(data.storageInventory.map((s) => [s.assignedUnit, s]));
  const rubs = Object.fromEntries(data.rubs.map((r) => [r.unit, r]));

  return data.rentRoll.map((r) => ({
    unit: r.unit,
    status: r.status,
    resident: r.resident,
    pet_expected:   reg[r.unit] ? reg[r.unit].expectedPetRent : 0,
    pet_billed:     r.petRentBilled,
    parking_rate:   park[r.unit] ? park[r.unit].monthlyRate : 0,
    parking_billed: r.parkingBilled,
    storage_rate:   stor[r.unit] ? stor[r.unit].monthlyRate : 0,
    storage_billed: r.storageBilled,
    concession_recoverable: /burned off/i.test(r.concessionType) ? r.concessionApplied : 0,
    rubs_allocated: rubs[r.unit] ? rubs[r.unit].allocated : 0,
    rubs_billed:    rubs[r.unit] ? rubs[r.unit].billed : 0,
  }));
}

const LEAK_RULES = [
  { cat: "Pet rent",   src: "PetScreening",      conf: "High",
    monthly: (r) => Math.max(0, r.pet_expected - r.pet_billed),
    action: (m) => `Add ${usd(m)}/mo pet rent to ledger; backbill from registration date per lease addendum.` },
  { cat: "Parking",    src: "Parking system",    conf: "High",
    monthly: (r) => Math.max(0, r.parking_rate - r.parking_billed),
    action: (m) => `Add ${usd(m)}/mo parking charge; confirm assigned space on the lease.` },
  { cat: "Storage",    src: "Storage log",       conf: "High",
    monthly: (r) => Math.max(0, r.storage_rate - r.storage_billed),
    action: (m) => `Add ${usd(m)}/mo storage charge; confirm unit assignment.` },
  { cat: "Concession", src: "Lease abstract",    conf: "Medium",
    monthly: (r) => Math.max(0, r.concession_recoverable),
    action: (m) => `Remove ${usd(m)}/mo burned-off concession credit; verify burn-off date in lease.` },
  { cat: "RUBS / utility", src: "Utility file",  conf: "High",
    monthly: (r) => Math.max(0, r.rubs_allocated - r.rubs_billed),
    action: (m) => `Enroll unit in RUBS; backbill ${usd(m)}/mo allocated recovery.` },
];

function computeLeakage(rows) {
  const exceptions = [];
  for (const r of rows) {
    for (const rule of LEAK_RULES) {
      const m = rule.monthly(r);
      if (m > 0) {
        exceptions.push({
          unit: r.unit,
          resident: r.resident || "(vacant)",
          category: rule.cat,
          source: rule.src,
          confidence: rule.conf,
          monthly: m,
          annual: m * 12,
          action: rule.action(m),
        });
      }
    }
  }
  const byCategory = {};
  for (const e of exceptions) {
    byCategory[e.category] = byCategory[e.category] || { count: 0, annual: 0 };
    byCategory[e.category].count += 1;
    byCategory[e.category].annual += e.annual;
  }
  exceptions.sort((a, b) => b.annual - a.annual);
  return {
    exceptions,
    byCategory,
    totalAnnual: exceptions.reduce((s, e) => s + e.annual, 0),
    totalMonthly: exceptions.reduce((s, e) => s + e.monthly, 0),
    unitsAffected: new Set(exceptions.map((e) => e.unit)).size,
  };
}

// ============================================================================
// MODULE 2 — Variance / Board-Package Generator
// ============================================================================

const DRIVERS = {
  "Gross Potential Rent|unfavorable": "reflecting loss-to-lease on renewals and slower lease-up on the vacant units.",
  "Vacancy & Loss-to-Lease|unfavorable": "as units turned over mid-month and re-leased below the prior in-place rent.",
  "Other / Ancillary Income|unfavorable": "driven by uncaptured pet, parking, storage, and utility (RUBS) charges — the Leakage Detector isolates the specific units and the recoverable run-rate.",
  "Payroll & Benefits|favorable": "primarily an open maintenance-technician position held vacant during the period.",
  "Repairs & Maintenance|unfavorable": "elevated emergency work orders, including an unbudgeted HVAC compressor replacement and plumbing call-outs.",
  "Turnover / Make-Ready|unfavorable": "above-plan unit turns and higher flooring and paint cost per make-ready.",
  "Utilities|unfavorable": "higher common-area electric and a mid-period rate increase; a portion is recoverable via RUBS.",
  "Marketing & Leasing|favorable": "reduced paid-advertising spend as referral and organic traffic carried leasing demand.",
};

function computeVariance(data, opts = {}) {
  const dollarThresh = opts.dollarThresh ?? 2000;
  const pctThresh = opts.pctThresh ?? 10;

  const lines = data.budgetActual.map((l) => {
    // variance in "performance" terms: positive = favorable to NOI
    let perf;
    if (l.kind === "income") perf = l.actual - l.budget;       // more income = good
    else perf = l.budget - l.actual;                           // less expense/contra = good
    const favorable = perf >= 0;
    const absVar = Math.abs(l.actual - l.budget);
    const pctVar = l.budget ? ((l.actual - l.budget) / l.budget) * 100 : 0;
    const material = absVar >= dollarThresh || (Math.abs(pctVar) >= pctThresh && absVar >= 750);

    let narrative = "";
    if (material) {
      const key = `${l.glLine}|${favorable ? "favorable" : "unfavorable"}`;
      const driver = DRIVERS[key] || (favorable ? "running favorably for the period." : "running over plan for the period.");
      narrative = `${l.glLine} came in ${favorable ? "favorable" : "unfavorable"} by ${usd(absVar)} (${pct(pctVar)}), ${driver}`;
    }
    return { ...l, perf, favorable, absVar, pctVar, material, narrative };
  });

  // NOI roll-up
  const sum = (pred, field) => lines.filter(pred).reduce((s, l) => s + l[field], 0);
  const revBudget = data.budgetActual.filter((l) => l.category === "Revenue")
    .reduce((s, l) => s + (l.kind === "contra" ? -l.budget : l.budget), 0);
  const revActual = data.budgetActual.filter((l) => l.category === "Revenue")
    .reduce((s, l) => s + (l.kind === "contra" ? -l.actual : l.actual), 0);
  const opexBudget = sum((l) => l.category === "Opex", "budget");
  const opexActual = sum((l) => l.category === "Opex", "actual");
  const noiBudget = revBudget - opexBudget;
  const noiActual = revActual - opexActual;
  const noiVar = noiActual - noiBudget;
  const noiPct = noiBudget ? (noiVar / noiBudget) * 100 : 0;

  // executive summary
  const topUnfav = lines.filter((l) => l.material && !l.favorable)
    .sort((a, b) => b.absVar - a.absVar).slice(0, 2).map((l) => l.glLine);
  const summary =
    `NOI of ${usd(noiActual)} finished ${noiVar >= 0 ? "above" : "below"} budget by ${usd(Math.abs(noiVar))} (${pct(noiPct)}). ` +
    (topUnfav.length ? `The miss is concentrated in ${topUnfav.join(" and ")}. ` : "") +
    `Ancillary income ran under plan; the Leakage Detector flags a recoverable run-rate that closes a meaningful share of the gap.`;

  return { lines, noiBudget, noiActual, noiVar, noiPct, revBudget, revActual, opexBudget, opexActual, summary };
}

// ============================================================================
// MODULE 3 — AR / Delinquency Triage
// ============================================================================

function computeAR(data) {
  const tiers = {
    "90+ / Critical": { risk: "High",   action: "Final notice — begin lease enforcement / legal referral; place renewal on hold." },
    "60 days":        { risk: "High",   action: "Formal demand + payment-plan offer; flag account for review." },
    "30 days":        { risk: "Medium", action: "Late notice + assess late fee per lease terms." },
    "Current":        { risk: "Low",    action: "Courtesy reminder; enroll in autopay." },
  };

  const accounts = data.arAging.map((a) => {
    const total = a.current + a.d30 + a.d60 + a.d90;
    let tier;
    if (a.d90 > 0) tier = "90+ / Critical";
    else if (a.d60 > 0) tier = "60 days";
    else if (a.d30 > 0) tier = "30 days";
    else tier = "Current";
    return { ...a, total, tier, risk: tiers[tier].risk, action: tiers[tier].action };
  });

  const order = { "90+ / Critical": 0, "60 days": 1, "30 days": 2, "Current": 3 };
  accounts.sort((a, b) => order[a.tier] - order[b.tier] || b.total - a.total);

  const buckets = {
    current: accounts.reduce((s, a) => s + a.current, 0),
    d30: accounts.reduce((s, a) => s + a.d30, 0),
    d60: accounts.reduce((s, a) => s + a.d60, 0),
    d90: accounts.reduce((s, a) => s + a.d90, 0),
  };
  const totalAR = buckets.current + buckets.d30 + buckets.d60 + buckets.d90;
  const atRisk = buckets.d60 + buckets.d90; // 60+ considered at-risk

  return { accounts, buckets, totalAR, atRisk, delinquentCount: accounts.filter((a) => a.tier !== "Current").length };
}

function draftNotice(acct, propertyName) {
  const tone = {
    "90+ / Critical": `This is a FINAL NOTICE. Your account is seriously past due. Immediate payment in full or contact with our office to arrange resolution is required to avoid lease-enforcement action.`,
    "60 days": `Your balance is now 60+ days past due. Please remit payment or contact us within 5 business days to arrange a payment plan and avoid further action.`,
    "30 days": `Our records show a past-due balance on your account. A late fee may apply per your lease. Please remit payment at your earliest convenience.`,
    "Current": `This is a friendly reminder of a balance on your account. Enrolling in autopay helps avoid future late fees.`,
  }[acct.tier];
  return `Re: Account balance — Unit ${acct.unit}, ${propertyName}\n\nDear ${acct.resident},\n\n${tone}\n\nCurrent balance due: ${usd2(acct.total)}\n  • 1–30 days:  ${usd2(acct.d30)}\n  • 31–60 days: ${usd2(acct.d60)}\n  • 61–90+ days: ${usd2(acct.d90)}\n\nPlease contact the management office with any questions.\n\nSincerely,\n${propertyName} Management`;
}

// ============================================================================
// FIRM ESTIMATOR — size likely leakage from portfolio characteristics
// -----------------------------------------------------------------------------
// A benchmark sizing model (NOT the unit-level detector). Given a target firm's
// units / asset class / market, it projects probable uncaptured ancillary
// revenue using published industry ranges. Every assumption is exposed so an
// operator can challenge it. Output is a RANGE, not false precision.
// ============================================================================
const MARKETS = {
  "New York Metro":        { avgRent: 3400, parkingRate: 250, storageRate: 75, rubsGap: 7, petOwn: 0.25 },
  "Boston / Northeast":    { avgRent: 2900, parkingRate: 200, storageRate: 65, rubsGap: 6, petOwn: 0.27 },
  "DC / Mid-Atlantic":     { avgRent: 2400, parkingRate: 175, storageRate: 60, rubsGap: 6, petOwn: 0.30 },
  "West Coast":            { avgRent: 3000, parkingRate: 200, storageRate: 70, rubsGap: 6, petOwn: 0.28 },
  "Sunbelt (TX/FL/GA/NC)": { avgRent: 1650, parkingRate: 85,  storageRate: 50, rubsGap: 4, petOwn: 0.34 },
  "Mountain / Southwest":  { avgRent: 1800, parkingRate: 95,  storageRate: 55, rubsGap: 4, petOwn: 0.33 },
  "Midwest":               { avgRent: 1450, parkingRate: 65,  storageRate: 45, rubsGap: 3, petOwn: 0.31 },
};
const CLASSES = {
  "Class A (luxury / new)": { rentMult: 1.25, parkPen: 0.55, storePen: 0.22, petRate: 65, opsLeak: 0.75 },
  "Class B (workforce)":    { rentMult: 1.00, parkPen: 0.45, storePen: 0.18, petRate: 50, opsLeak: 1.00 },
  "Class C / value-add":    { rentMult: 0.78, parkPen: 0.35, storePen: 0.14, petRate: 40, opsLeak: 1.35 },
  "Affordable / LIHTC":     { rentMult: 0.70, parkPen: 0.30, storePen: 0.12, petRate: 30, opsLeak: 0.90 },
};
const BASE_LEAK = { pet: 0.12, parking: 0.10, storage: 0.11, concession: 0.03 };

function computeEstimate(p) {
  const m = MARKETS[p.market] || MARKETS["Sunbelt (TX/FL/GA/NC)"];
  const c = CLASSES[p.assetClass] || CLASSES["Class B (workforce)"];
  const units = Math.max(0, Math.round(p.units || 0));
  const maturity = Math.min(1, Math.max(0, (p.maturity ?? 50) / 100));
  const matMult = 1.6 - 1.2 * maturity;       // 1.6 (no program) → 0.4 (best-in-class)
  const leakMult = c.opsLeak * matMult;        // ops sophistication × program maturity
  const avgRent = Math.round(m.avgRent * c.rentMult);

  const row = (name, driver, penetration, rate, leakRate, annual) =>
    ({ name, driver, penetration, rate, leakRate, annual: Math.round(annual) });

  const concAmt = Math.round(avgRent * 0.05);
  const rubsPerUnit = +(m.rubsGap * matMult).toFixed(2); // program-driven, not class-driven

  const categories = [
    row("Pet rent", "Pets off-lease / unbilled", m.petOwn, c.petRate, BASE_LEAK.pet * leakMult,
      units * m.petOwn * c.petRate * (BASE_LEAK.pet * leakMult) * 12),
    row("Parking", "Unbundled / unbilled spaces", c.parkPen, m.parkingRate, BASE_LEAK.parking * leakMult,
      units * c.parkPen * m.parkingRate * (BASE_LEAK.parking * leakMult) * 12),
    row("Storage", "Assigned but not billed", c.storePen, m.storageRate, BASE_LEAK.storage * leakMult,
      units * c.storePen * m.storageRate * (BASE_LEAK.storage * leakMult) * 12),
    row("RUBS / utility", "Recovery shortfall", 0.9, rubsPerUnit, null,
      units * rubsPerUnit * 12),
    row("Concessions", "Stale / mis-keyed credits", BASE_LEAK.concession * leakMult, concAmt, null,
      units * (BASE_LEAK.concession * leakMult) * concAmt * 12),
  ];

  const total = categories.reduce((s, x) => s + x.annual, 0);
  const egi = units * avgRent * 12 * 0.94;
  return {
    categories, total, avgRent,
    low: Math.round(total * 0.78),
    high: Math.round(total * 1.22),
    perUnit: units ? Math.round(total / units) : 0,
    pctEGI: egi ? (total / egi) * 100 : 0,
  };
}

function maturityLabel(v) {
  return v < 20 ? "No program" : v < 40 ? "Early" : v < 60 ? "Developing" : v < 80 ? "Mature" : "Best-in-class";
}

// ============================================================================
// CSV helpers (upload your own rent roll → re-run the Leakage Detector)
// ============================================================================
const RECON_COLS = ["unit","status","pet_expected","pet_billed","parking_rate","parking_billed",
  "storage_rate","storage_billed","concession_recoverable","rubs_allocated","rubs_billed"];

function rowsToCsv(rows) {
  const head = RECON_COLS.join(",");
  const body = rows.map((r) => RECON_COLS.map((c) => r[c] ?? 0).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

function csvToRows(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(",");
    const row = {};
    head.forEach((h, i) => {
      const v = (cells[i] ?? "").trim();
      row[h] = (h === "unit" || h === "status" || h === "resident") ? v : (parseFloat(v) || 0);
    });
    row.resident = row.resident || "";
    return row;
  });
}

// ============================================================================
// Exports for Node-based testing
// ============================================================================
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildReconRows, computeLeakage, computeVariance, computeAR, rowsToCsv, csvToRows, draftNotice, computeEstimate, MARKETS, CLASSES };
}

// ============================================================================
// ---- everything below is browser-only rendering ----------------------------
// ============================================================================
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const DATA = window.NOI_DATA;
    let reconRows = buildReconRows(DATA); // mutable: replaced on CSV upload

    // ---- helpers ----
    const $ = (s) => document.querySelector(s);
    const kpi = (label, value, sub, accent) =>
      `<div class="kpi ${accent || ""}"><div class="kpi-val">${value}</div>
       <div class="kpi-label">${label}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ""}</div>`;
    const confBadge = (c) => `<span class="badge ${c === "High" ? "b-high" : "b-med"}">${c}</span>`;
    const riskBadge = (r) => `<span class="badge ${r === "High" ? "b-risk" : r === "Medium" ? "b-med" : "b-low"}">${r}</span>`;

    // header
    $("#prop-name").textContent = DATA.property.name;
    $("#prop-meta").textContent = `${DATA.property.units} units · ${DATA.property.city} · as of ${DATA.property.asOf}`;

    // ---------------------------------------------------------------- Leakage
    function renderLeakage() {
      const L = computeLeakage(reconRows);
      const cats = Object.entries(L.byCategory).sort((a, b) => b[1].annual - a[1].annual);
      $("#leak-kpis").innerHTML =
        kpi("Recoverable / year", usd(L.totalAnnual), `${usd(L.totalMonthly)}/mo run-rate`, "accent-green") +
        kpi("Exceptions found", L.exceptions.length, `${L.unitsAffected} units affected`) +
        kpi("Top category", cats[0] ? cats[0][0] : "—", cats[0] ? usd(cats[0][1].annual) + "/yr" : "") +
        kpi("Systems reconciled", "5", "Rent roll × ancillary sources");

      $("#leak-cats").innerHTML = cats.map(([c, v]) =>
        `<div class="catbar"><div class="catbar-top"><span>${c}</span><strong>${usd(v.annual)}/yr</strong></div>
         <div class="catbar-track"><div class="catbar-fill" style="width:${(v.annual / L.totalAnnual * 100).toFixed(0)}%"></div></div>
         <div class="catbar-sub">${v.count} exception${v.count > 1 ? "s" : ""}</div></div>`).join("");

      $("#leak-table").innerHTML = `
        <thead><tr><th>Unit</th><th>Resident</th><th>Category</th><th>Source system</th>
          <th>Confidence</th><th class="num">Monthly</th><th class="num">Annual</th><th>Recommended action</th></tr></thead>
        <tbody>${L.exceptions.map((e) => `
          <tr><td class="mono">${e.unit}</td><td>${e.resident}</td><td>${e.category}</td><td class="muted">${e.source}</td>
          <td>${confBadge(e.confidence)}</td><td class="num">${usd(e.monthly)}</td>
          <td class="num strong">${usd(e.annual)}</td><td class="action">${e.action}</td></tr>`).join("")}</tbody>`;
    }

    // --------------------------------------------------------------- Variance
    function renderVariance() {
      const V = computeVariance(DATA);
      $("#var-kpis").innerHTML =
        kpi("NOI — actual", usd(V.noiActual), "current month", V.noiVar >= 0 ? "accent-green" : "accent-red") +
        kpi("NOI vs budget", usd(V.noiVar), pct(V.noiPct), V.noiVar >= 0 ? "accent-green" : "accent-red") +
        kpi("Total revenue", usd(V.revActual), `budget ${usd(V.revBudget)}`) +
        kpi("Total opex", usd(V.opexActual), `budget ${usd(V.opexBudget)}`);

      $("#var-summary").innerHTML = `<div class="summary-card">
        <div class="summary-tag">Auto-generated executive summary</div><p>${V.summary}</p></div>`;

      $("#var-table").innerHTML = `
        <thead><tr><th>GL line</th><th class="num">Budget</th><th class="num">Actual</th>
          <th class="num">Variance</th><th class="num">%</th><th>Status</th></tr></thead>
        <tbody>${V.lines.map((l) => `
          <tr class="${l.material ? "" : "dim"}"><td>${l.glLine}</td>
          <td class="num">${usd(l.budget)}</td><td class="num">${usd(l.actual)}</td>
          <td class="num ${l.favorable ? "pos" : "neg"}">${(l.actual - l.budget) >= 0 ? "+" : "−"}${usd(l.absVar)}</td>
          <td class="num ${l.favorable ? "pos" : "neg"}">${pct(l.pctVar)}</td>
          <td>${l.material ? (l.favorable ? '<span class="badge b-low">Favorable</span>' : '<span class="badge b-risk">Unfavorable</span>') : '<span class="muted">—</span>'}</td></tr>`).join("")}</tbody>`;

      $("#var-narrative").innerHTML = `<h4>Variance commentary <span class="muted">(board-package ready)</span></h4>` +
        `<ul class="narrative">${V.lines.filter((l) => l.material)
          .sort((a, b) => b.absVar - a.absVar)
          .map((l) => `<li class="${l.favorable ? "pos-dot" : "neg-dot"}">${l.narrative}</li>`).join("")}</ul>`;
    }

    // --------------------------------------------------------------------- AR
    function renderAR() {
      const A = computeAR(DATA);
      $("#ar-kpis").innerHTML =
        kpi("Total AR", usd(A.totalAR), `${A.accounts.length} accounts`) +
        kpi("At risk (60+ days)", usd(A.atRisk), `${((A.atRisk / A.totalAR) * 100).toFixed(0)}% of AR`, "accent-red") +
        kpi("Delinquent accounts", A.delinquentCount, "30+ days past due") +
        kpi("90+ critical", usd(A.buckets.d90), "needs escalation", "accent-red");

      $("#ar-buckets").innerHTML = [
        ["Current", A.buckets.current, "b-low"], ["1–30 days", A.buckets.d30, "b-med"],
        ["31–60 days", A.buckets.d60, "b-risk"], ["61–90+ days", A.buckets.d90, "b-risk"],
      ].map(([lbl, val, cls]) =>
        `<div class="bucket"><div class="bucket-val">${usd(val)}</div><div class="bucket-lbl"><span class="badge ${cls}">${lbl}</span></div></div>`).join("");

      $("#ar-table").innerHTML = `
        <thead><tr><th>Unit</th><th>Resident</th><th>Tier</th><th>Risk</th>
          <th class="num">Balance</th><th>Recommended action</th><th></th></tr></thead>
        <tbody>${A.accounts.map((a, i) => `
          <tr><td class="mono">${a.unit}</td><td>${a.resident}</td><td>${a.tier}</td>
          <td>${riskBadge(a.risk)}</td><td class="num strong">${usd(a.total)}</td>
          <td class="action">${a.action}</td>
          <td>${a.tier !== "Current" ? `<button class="mini" data-notice="${i}">Draft notice</button>` : ""}</td></tr>`).join("")}</tbody>`;

      $("#ar-table").querySelectorAll("button[data-notice]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const acct = A.accounts[+btn.dataset.notice];
          $("#ar-draft").style.display = "block";
          $("#ar-draft-text").textContent = draftNotice(acct, DATA.property.name);
          $("#ar-draft").scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });
    }

    // ---- tabs ----
    document.querySelectorAll(".tab").forEach((t) => {
      t.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
        document.querySelectorAll(".pane").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        $("#pane-" + t.dataset.pane).classList.add("active");
      });
    });

    // ---- CSV upload / template ----
    $("#csv-template").addEventListener("click", (e) => {
      e.preventDefault();
      const blob = new Blob([rowsToCsv(reconRows)], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "noi-copilot-reconciliation-template.csv";
      a.click();
    });
    $("#csv-upload").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          reconRows = csvToRows(fr.result);
          renderLeakage();
          $("#csv-status").textContent = `Loaded ${reconRows.length} units from ${file.name} — detector re-run.`;
        } catch (err) {
          $("#csv-status").textContent = "Could not parse that CSV. Use the template format.";
        }
      };
      fr.readAsText(file);
    });
    $("#csv-reset").addEventListener("click", () => {
      reconRows = buildReconRows(DATA);
      renderLeakage();
      $("#csv-status").textContent = "Reset to sample portfolio.";
    });

    // ------------------------------------------------------------- Estimator
    Object.keys(CLASSES).forEach((k, i) => {
      const o = document.createElement("option"); o.value = k; o.textContent = k;
      if (i === 1) o.selected = true; $("#est-class").appendChild(o);  // default Class B
    });
    Object.keys(MARKETS).forEach((k) => {
      const o = document.createElement("option"); o.value = k; o.textContent = k;
      if (k.startsWith("Sunbelt")) o.selected = true; $("#est-market").appendChild(o);
    });
    const fpct = (n) => n == null ? '<span class="muted">—</span>' : (n * 100).toFixed(n < 0.1 ? 1 : 0) + "%";

    function renderEstimator() {
      const matV = +$("#est-maturity").value;
      const units = +$("#est-units").value || 0;
      $("#est-mat-val").textContent = maturityLabel(matV);
      const E = computeEstimate({ units, assetClass: $("#est-class").value, market: $("#est-market").value, maturity: matV });

      $("#est-headline").innerHTML =
        `<div class="est-range">${usd(E.low)} – ${usd(E.high)}<span class="est-yr"> / yr recoverable</span></div>
         <div class="est-mid">midpoint ≈ <strong>${usd(E.total)}</strong> · ${usd(E.perUnit)}/unit/yr · ${E.pctEGI.toFixed(2)}% of EGI</div>`;

      const maxA = Math.max(...E.categories.map((c) => c.annual), 1);
      $("#est-bars").innerHTML = E.categories.slice().sort((a, b) => b.annual - a.annual).map((c) =>
        `<div class="catbar"><div class="catbar-top"><span>${c.name}</span><strong>${usd(c.annual)}/yr</strong></div>
         <div class="catbar-track"><div class="catbar-fill" style="width:${(c.annual / maxA * 100).toFixed(0)}%"></div></div></div>`).join("");

      $("#est-table").innerHTML = `
        <thead><tr><th>Category</th><th>Driver</th><th class="num">Penetration</th><th class="num">Avg rate</th><th class="num">Leakage rate</th><th class="num">Est. $/yr</th></tr></thead>
        <tbody>${E.categories.map((c) => `<tr><td class="strong">${c.name}</td><td class="muted">${c.driver}</td>
          <td class="num">${fpct(c.penetration)}</td><td class="num">${usd(c.rate)}${c.name.startsWith("RUBS") ? "/unit" : "/mo"}</td>
          <td class="num">${fpct(c.leakRate)}</td><td class="num strong">${usd(c.annual)}</td></tr>`).join("")}
          <tr class="totalrow"><td colspan="5" class="strong">Estimated annual recoverable</td><td class="num strong">${usd(E.total)}</td></tr></tbody>`;

      const who = $("#est-name").value.trim() || "your";
      $("#est-outreach").innerHTML = `<div class="summary-card"><div class="summary-tag">Outreach line — copy/paste</div>
        <p>A ${units.toLocaleString()}-unit ${$("#est-class").value.replace(/ \(.*\)/, "")} portfolio in ${$("#est-market").value} is likely leaving <strong>${usd(E.low)}–${usd(E.high)}/yr</strong> (~${usd(E.perUnit)}/unit) in uncaptured ancillary revenue. I built a tool that pinpoints exactly which units and charges — happy to run it on ${who === "your" ? "your" : who + "'s"} actuals. Worth 15 minutes?</p></div>`;
    }
    [["est-units", "input"], ["est-class", "change"], ["est-market", "change"], ["est-maturity", "input"], ["est-name", "input"]]
      .forEach(([id, ev]) => $("#" + id).addEventListener(ev, renderEstimator));

    renderEstimator();
    renderLeakage();
    renderVariance();
    renderAR();
  });
}
