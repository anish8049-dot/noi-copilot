/* Sanity checks for the NOI Copilot compute layer.  Run: node test.cjs */
const DATA = require("./assets/data.js");
const { buildReconRows, computeLeakage, computeVariance, computeAR, computeEstimate } = require("./assets/app.js");

let fails = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${got}${ok ? "" : `  (expected ${want})`}`);
};

console.log("— Leakage —");
const L = computeLeakage(buildReconRows(DATA));
eq("total annual recoverable", L.totalAnnual, 45000);
eq("total monthly run-rate", L.totalMonthly, 3750);
eq("exception count", L.exceptions.length, 37);
eq("units affected", L.unitsAffected, 37);

console.log("— Variance —");
const V = computeVariance(DATA);
eq("NOI actual", V.noiActual, 91770);
eq("NOI budget", V.noiBudget, 107250);
eq("NOI variance", V.noiVar, -15480);

console.log("— AR —");
const A = computeAR(DATA);
eq("total AR", A.totalAR, 30205);
eq("at risk (60+)", A.atRisk, 23505);
eq("delinquent accounts", A.delinquentCount, 9);

console.log("— Estimator —");
const E = computeEstimate({ units: 300, assetClass: "Class B (workforce)", market: "Sunbelt (TX/FL/GA/NC)", maturity: 50 });
eq("categories", E.categories.length, 5);
eq("total estimate", E.total, 48042);
eq("per-unit/yr", E.perUnit, 160);
// maturity sanity: best-in-class must recover less than no-program
const eLow = computeEstimate({ units: 300, assetClass: "Class B (workforce)", market: "Sunbelt (TX/FL/GA/NC)", maturity: 100 });
const eHigh = computeEstimate({ units: 300, assetClass: "Class B (workforce)", market: "Sunbelt (TX/FL/GA/NC)", maturity: 0 });
eq("maturity reduces leakage", eLow.total < E.total && E.total < eHigh.total, true);

console.log(fails === 0 ? "\nAll checks passed." : `\n${fails} check(s) FAILED.`);
process.exit(fails ? 1 : 0);
