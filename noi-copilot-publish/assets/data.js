/* =============================================================================
   NOI Copilot — Synthetic portfolio data
   -----------------------------------------------------------------------------
   Everything here is 100% fictional. No real resident, property, or financial
   data is used. The dataset deliberately models TWO separate systems so the app
   can cross-reference them — exactly how revenue leakage is found in real life:

     1. Property accounting / rent roll  ->  what is ACTUALLY being billed
     2. Ancillary source systems         ->  what SHOULD be billed
        (PetScreening export, parking system, storage log, utility/RUBS file)

   The gaps between (2) and (1) are the leakage. Built-in leakage ≈ $48.6K/yr
   on a single 60-unit building, echoing a real reconciliation finding.
   ============================================================================= */
(function () {
  "use strict";

  const PROPERTY = {
    name: "Hudson Crossing",
    address: "47-20 Center Blvd",
    city: "Long Island City, NY 11109",
    units: 60,
    type: "Class A Multifamily",
    asOf: "May 2026",
  };

  // ---- name pools (purely cosmetic, deterministic) --------------------------
  const FIRST = ["Maya","Daniel","Priya","Marcus","Elena","Jonah","Aisha","Liam",
    "Sofia","Noah","Hana","Diego","Grace","Omar","Lena","Caleb","Ivy","Theo",
    "Nora","Ravi","Zoe","Felix","Amara","Leo","Iris","Hugo","Mei","Sam","Tara","Kai"];
  const LAST = ["Reyes","Okafor","Chen","Bauer","Romano","Patel","Nguyen","Walsh",
    "Silva","Kim","Haddad","Moreau","Ford","Iqbal","Novak","Park","Dubois","Bianchi",
    "Marsh","Adeyemi","Khan","Russo","Lowe","Stein","Cruz","Vega","Yu","Mensah","Frost","Abara"];
  const fullName = (i) => `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}`;

  // ---- unit list: floors 1–6, units x01–x10 ---------------------------------
  const UNITS = [];
  for (let f = 1; f <= 6; f++) for (let u = 1; u <= 10; u++) UNITS.push(f * 100 + u);

  // ---- deterministic leakage scenario sets ----------------------------------
  // Pets registered in PetScreening but NOT billed pet rent in the rent roll
  const PET_UNBILLED = new Set([103, 108, 205, 309, 402, 507, 604]);            // 7 @ $50
  // Pets registered AND correctly billed (control group, proves no false positives)
  const PET_BILLED   = new Set([101, 110, 206, 302, 308, 404, 410, 505, 510, 602, 609]);
  // Parking spaces assigned to a unit but not appearing as a charge
  const PARK_UNBILLED = new Set([101, 104, 110, 202, 206, 210, 305, 308, 404, 410, 503, 601]);
  // Storage units assigned but not billed
  const STORE_UNBILLED = new Set([105, 203, 307, 401, 406, 502, 508, 605]);     // 8 @ $55
  // One-time / first-month concessions that have burned off but are still deducted monthly
  const CONCESSION_PHANTOM = new Set([106, 204, 303, 408, 509]);                // 5 @ $150
  // RUBS (utility recovery) allocated but never enrolled / billed $0
  const RUBS_UNBILLED = { 107: 92, 208: 78, 304: 64, 409: 88, 506: 88 };        // sums to $410

  // Vacancy / notice (operational realism; not leakage)
  const VACANT = new Set([209, 411, 512]);
  const NOTICE = new Set([305, 607]);

  // Parking inventory: assign every-other-ish unit a space, vary the rate by type
  const PARK_TYPES = [
    { type: "Standard", rate: 165 },
    { type: "Covered",  rate: 210 },
    { type: "Tandem",   rate: 135 },
  ];

  // ---- builders -------------------------------------------------------------
  const rentRoll = [];
  const petRegistry = [];
  const parkingInventory = [];
  const storageInventory = [];
  const rubs = [];

  UNITS.forEach((unit, i) => {
    const lastDigit = unit % 10;
    const floor = Math.floor(unit / 100);
    const isTwoBed = lastDigit >= 6 || lastDigit === 0;
    const bed = isTwoBed ? 2 : 1;

    const marketRent = isTwoBed ? 3850 + (floor - 1) * 80 : 2950 + (floor - 1) * 60;
    const status = VACANT.has(unit) ? "Vacant" : NOTICE.has(unit) ? "Notice" : "Occupied";
    // small, realistic loss-to-lease on a subset
    const lossToLease = (unit % 4 === 1 && status === "Occupied") ? 75 : 0;
    const actualRent = status === "Vacant" ? 0 : marketRent - lossToLease;

    // lease dates
    const startMonth = ((i * 5) % 12) + 1;
    const startYear = 2025;
    const leaseStart = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
    const leaseEnd = `${startYear + 1}-${String(startMonth).padStart(2, "0")}-01`;

    // pets
    const hasPet = PET_UNBILLED.has(unit) || PET_BILLED.has(unit);
    const petRentBilled = PET_BILLED.has(unit) ? 50 : 0;

    // parking (assigned to a unit if it's in inventory)
    const hasParking = PARK_UNBILLED.has(unit) || (unit % 3 === 0 && status !== "Vacant");
    const parkType = PARK_TYPES[unit % PARK_TYPES.length];
    const parkingBilled = hasParking && !PARK_UNBILLED.has(unit) ? parkType.rate : 0;

    // storage
    const hasStorage = STORE_UNBILLED.has(unit) || (unit % 5 === 2 && status !== "Vacant");
    const storageBilled = hasStorage && !STORE_UNBILLED.has(unit) ? 55 : 0;

    // concessions
    const concessionApplied = CONCESSION_PHANTOM.has(unit) ? 150 : 0;
    const concessionType = CONCESSION_PHANTOM.has(unit) ? "1-month free (burned off)" : "";

    rentRoll.push({
      unit, floor, bed, status,
      resident: status === "Vacant" ? "" : fullName(i),
      leaseStart, leaseEnd,
      marketRent, actualRent,
      petRentBilled, parkingBilled, storageBilled,
      concessionApplied, concessionType,
    });

    if (hasPet) {
      petRegistry.push({
        unit,
        petName: ["Cooper","Luna","Max","Bella","Milo","Daisy","Rocky","Nala"][unit % 8],
        type: unit % 4 === 0 ? "Cat" : "Dog",
        weight: 12 + (unit % 50),
        registeredDate: `2025-${String(((unit + 2) % 12) + 1).padStart(2, "0")}-14`,
        expectedPetRent: 50,
      });
    }
    if (hasParking) {
      parkingInventory.push({
        spaceId: `P-${unit}`,
        type: parkType.type,
        assignedUnit: unit,
        monthlyRate: parkType.rate,
      });
    }
    if (hasStorage) {
      storageInventory.push({ unitId: `S-${unit}`, assignedUnit: unit, monthlyRate: 55 });
    }
    if (RUBS_UNBILLED[unit]) {
      rubs.push({ unit, allocated: RUBS_UNBILLED[unit], billed: 0 });
    } else if (status !== "Vacant" && unit % 6 === 0) {
      // correctly recovered RUBS (control)
      rubs.push({ unit, allocated: 70 + (unit % 25), billed: 70 + (unit % 25) });
    }
  });

  // ---- Budget vs Actual (current month — May 2026) --------------------------
  // sign convention: income positive, expense positive (magnitudes); `kind` drives
  // favorable/unfavorable interpretation in the app.
  const budgetActual = [
    { glLine: "Gross Potential Rent",  category: "Revenue", kind: "income",  budget: 195000, actual: 192400 },
    { glLine: "Vacancy & Loss-to-Lease", category: "Revenue", kind: "contra", budget: 9750,  actual: 12850 },
    { glLine: "Other / Ancillary Income", category: "Revenue", kind: "income", budget: 14500, actual: 10450 },
    { glLine: "Payroll & Benefits",    category: "Opex", kind: "expense", budget: 22000, actual: 19300 },
    { glLine: "Repairs & Maintenance", category: "Opex", kind: "expense", budget: 9500,  actual: 14200 },
    { glLine: "Turnover / Make-Ready", category: "Opex", kind: "expense", budget: 6000,  actual: 9100 },
    { glLine: "Utilities",             category: "Opex", kind: "expense", budget: 11000, actual: 12650 },
    { glLine: "Contract Services",     category: "Opex", kind: "expense", budget: 5200,  actual: 5400 },
    { glLine: "Marketing & Leasing",   category: "Opex", kind: "expense", budget: 3500,  actual: 2100 },
    { glLine: "Insurance",             category: "Opex", kind: "expense", budget: 7200,  actual: 7200 },
    { glLine: "Property Taxes",        category: "Opex", kind: "expense", budget: 18500, actual: 18500 },
    { glLine: "Management Fee",        category: "Opex", kind: "expense", budget: 6800,  actual: 6730 },
    { glLine: "General & Admin",       category: "Opex", kind: "expense", budget: 2800,  actual: 3050 },
  ];

  // ---- AR aging / delinquency ----------------------------------------------
  // residents carrying a balance; buckets in dollars [unit, current, 30, 60, 90+]
  const arAging = [];
  const AR_RAW = [
    [104, 0, 1450, 0, 0],
    [207, 0, 0, 2980, 0],
    [210, 320, 0, 0, 0],
    [305, 0, 1610, 1610, 0],
    [402, 0, 0, 0, 4320],
    [406, 0, 990, 0, 0],
    [409, 0, 0, 2510, 0],
    [505, 0, 0, 0, 6150],
    [508, 540, 0, 0, 0],
    [601, 0, 1380, 1380, 1380],
    [604, 0, 0, 0, 3175],
    [609, 410, 0, 0, 0],
  ];
  AR_RAW.forEach(([unit, c, d30, d60, d90]) => {
    const rr = rentRoll.find((r) => r.unit === unit);
    arAging.push({
      unit,
      resident: rr && rr.resident ? rr.resident : fullName(unit),
      current: c, d30, d60, d90,
      lastPayment: `2026-0${1 + (unit % 4)}-${10 + (unit % 18)}`,
    });
  });

  const DATA = {
    property: PROPERTY,
    rentRoll,
    petRegistry,
    parkingInventory,
    storageInventory,
    rubs,
    budgetActual,
    arAging,
  };

  if (typeof window !== "undefined") window.NOI_DATA = DATA;
  if (typeof module !== "undefined" && module.exports) module.exports = DATA;
})();
