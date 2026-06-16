# NOI Copilot

**Asset-management automation for multifamily — built by an analyst who does the work.**

> 👋 Built by an asset-management / real-estate finance analyst **currently seeking full-time roles in property management and real estate finance** (New York, NY · open to hybrid/remote). Contact details at the bottom.

A working demo of back-office automations that protect and recover **NOI**:

- **🎯 Firm Leakage Estimator** — size the likely uncaptured ancillary revenue for *any* portfolio (units × asset class × market × program maturity) from industry benchmarks, *before* you ever see their data. Every assumption is visible and adjustable, and it generates a copy/paste outreach line. The "walk in already holding their number" tool.
1. **Revenue Leakage Detector** — cross-references the rent roll against ancillary source systems (PetScreening, parking, storage, utility/RUBS, lease abstracts) and flags every charge that is *owed but not billed*, with a dollar run-rate.
2. **Variance / Board-Package Generator** — reads budget vs. actual, flags material variances, and auto-writes the commentary that goes into the monthly ownership/board package.
3. **AR / Delinquency Triage** — buckets the resident ledger by age, assigns each account a risk tier and the right collections action, and drafts the resident notice.

> 🔗 **Live demo:** _add your GitHub Pages URL here_
> 🧪 All data in the demo is **100% synthetic**. No real resident, property, or financial data is used.

---

## Why this exists

While reconciling Yardi against a PetScreening export at a 16-building multifamily portfolio, I found **~120 pets a month that were never billed pet rent — about $60K/year** the portfolio was leaving on the table.

With national rent growth flat, that kind of **ancillary leakage is where NOI is actually hiding** — and most of it is invisible because it lives in the *gap between two systems* (the accounting ledger and the source system that knows what *should* be billed). The Leakage Detector here is that reconciliation, automated. The other two modules attack the next two time-sinks every asset-management analyst knows: writing variance commentary and triaging delinquencies.

This isn't a generic "AI for real estate" wrapper. Every module maps to a task I've done by hand.

---

## The tools

### 🎯 Firm Leakage Estimator
Sizes the likely uncaptured ancillary revenue for *any* portfolio from its characteristics — units × asset class × market × ancillary-program maturity — using published industry benchmarks. Outputs a recoverable **range** plus a `$/unit/yr` figure, a category breakdown, a fully visible/adjustable assumptions table, and a copy/paste outreach line. Built for the conversation *before* you have a firm's data.

### ① Revenue Leakage Detector
For each unit it compares **what's billed** (rent roll) against **what's owed** (source systems) across five categories — pet rent, parking, storage, burned-off concessions still being credited, and RUBS/utility recovery — and produces an itemized, dollar-quantified exception list an analyst can action the same day. Includes a confidence flag and the source system for each finding, so it's auditable, not a black box.

**Bring your own data:** download the CSV template, drop in a reconciliation export, and the detector re-runs entirely in your browser — nothing is uploaded to a server.

### ② Variance / Board-Package Generator
Computes budget-vs-actual variance per GL line, applies a materiality threshold, classifies favorable/unfavorable, rolls up to NOI, and writes a board-ready narrative for each material line plus an executive summary. Turns the multi-hour monthly write-up into a review-and-edit task.

### ③ AR / Delinquency Triage
Ages the ledger into current / 30 / 60 / 90+ buckets, prioritizes accounts by severity, assigns the appropriate collections step per tier (reminder → late notice → demand/payment plan → escalation), and one-click drafts the resident notice.

---

## How it works

- **No backend, no build step, no dependencies.** Plain HTML/CSS/JS — open `index.html` and it runs.
- The compute layer (`assets/app.js`) is split into pure functions so the math is unit-tested in Node.
- The synthetic dataset (`assets/data.js`) deliberately models two separate systems so the cross-referencing is real, not faked.

```
noi-copilot/
├── index.html            # app shell + 3 module panes
├── assets/
│   ├── app.js            # compute layer (pure, tested) + browser rendering
│   ├── data.js           # synthetic 60-unit portfolio (dual-loads in Node)
│   └── styles.css
└── test.cjs              # sanity checks for leakage / variance / AR math
```

## Run it locally

```bash
# just open the file —
open index.html
# …or serve it
python3 -m http.server 4178   # then visit http://localhost:4178

# run the math checks
node test.cjs
```

## Tech

Vanilla JavaScript (zero dependencies), client-side CSV parsing, deterministic synthetic data. Deployable as a static site (GitHub Pages / Netlify / Vercel) with no configuration.

---

## About / open to opportunities

Built by **Anish Suriti** — asset-management / real-estate finance analyst (multifamily), MS Finance (May 2026), Fordham Gabelli. At LeFrak I reconciled Yardi against resident systems and recovered revenue others had missed; I build the tools I wished I'd had on the job.

**📣 Open to full-time roles in property management and real estate finance** — asset management, FP&A, valuation, or revenue/operations analytics. Based in New York, NY; open to hybrid/remote.

📧 as271@fordham.edu · [LinkedIn](https://www.linkedin.com/in/anishsuriti) · New York, NY

_Demo only. Not affiliated with any employer; all figures and names are fictional._
