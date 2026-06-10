// ══ DATA ══
var D = [/*INJECT_D*/][0];

// Fallback to local mock data engine if running standalone index_new.html locally
if (typeof D === "undefined" || D === null || !D.center_details) {
  if (window.DelhiveryMockDB) {
    if (window.DelhiveryMockDB.center_details && window.DelhiveryMockDB.raw) {
      D = window.DelhiveryMockDB;
      console.log("Pre-aggregated Spreadsheet Database Loaded successfully!", D);
    } else {
      // Reformat mock database structure to mimic buildDashboard output structure
      const rawData = window.DelhiveryMockDB;
      
      // Quick preprocessing
      const centerSpendMap = {};
      const categoriesTotals = {};
      const monthlyTotals = {};
      
      rawData.raw.forEach(t => {
        if (t.Status !== "Approved") return;
        const center = t["Center Name"];
        const cat = t.Category || "Miscellaneous Expenses";
        const amt = t["Total Bill Amount"] || 0;
        const billDate = new Date(t["Bill Date"]);
        const m = billDate.getMonth() + 1;
        categoriesTotals[cat] = (categoriesTotals[cat] || 0) + amt;
        monthlyTotals[m] = (monthlyTotals[m] || 0) + amt;
        if (!centerSpendMap[center]) centerSpendMap[center] = {};
        centerSpendMap[center][cat] = (centerSpendMap[center][cat] || 0) + amt;
      });

      const getCapForMockLocal = (center, cat) => {
        const dev = rawData.deviations.find(d => d.HQ === center);
        if (dev) {
          const devMap = {
            "Electricity Expenses": dev.Benchmark,
            "Office Maintenance Expenses": dev["Benchmark.1"],
            "Water Expenses": dev["Benchmark.2"],
            "Internet Expenses": dev["Benchmark.3"],
            "Staff Welfare Expenses": dev["Benchmark.4"]
          };
          if (devMap[cat] !== undefined) return devMap[cat];
        }
        const standardCaps = {
          "Electricity Expenses": 65000,
          "Staff Welfare Expenses": 8000,
          "Water Expenses": 5000,
          "Internet Expenses": 1770,
          "Office Maintenance Expenses": 5000,
          "Labourer Charges": 15000,
          "Office consumables": 5000,
          "Power & Fuel Expense": 3000,
          "Repair AND Maintanance Expenses": 3000,
          "Printing AND Stationery": 2000,
          "Miscellaneous Expenses": 6500,
          "Parking Charges": 1500,
          "Conveyance Expenses": 2000,
          "Travelling Expenses": 3000,
          "Adhoc Vehicle Hire Expense": 5000
        };
        return standardCaps[cat] !== undefined ? standardCaps[cat] : 99999;
      };

      const centerDetails = {};
      let totalSpend = 0, totalOverspend = 0, activeCentersCount = 0, overCentersCount = 0;

      for (const centerName in centerSpendMap) {
        const catsList = [];
        let centerTotal = 0, centerOver = 0, exceeded = 0;
        for (const cat in centerSpendMap[centerName]) {
          const actual = centerSpendMap[centerName][cat];
          const cap = getCapForMockLocal(centerName, cat);
          const over = Math.max(0, actual - cap);
          catsList.push({ cat: cat, spend: actual, cap: cap, over: over });
          centerTotal += actual;
          centerOver += over;
          if (over > 0) exceeded++;
        }
        catsList.sort((a,b) => b.spend - a.spend);
        centerDetails[centerName] = { cats: catsList, total: centerTotal, over: centerOver, over_cats: exceeded };
        totalSpend += centerTotal;
        totalOverspend += centerOver;
        activeCentersCount++;
        if (centerOver > 0) overCentersCount++;
      }

      const topOver = [];
      for (const name in centerDetails) {
        if (centerDetails[name].over > 0) {
          const hc = rawData.allCenters.find(a => a["HQ Name"] === name) || { SD: "Unknown", D: "Unknown", SM: "Unknown", STM: "Unknown" };
          const dev = rawData.deviations.find(d => d.HQ === name) || {};
          topOver.push({
            name: name, sd: hc.SD, d: hc.D, sm: hc.SM, stm: hc.STM,
            total: centerDetails[name].total, over: centerDetails[name].over, over_cats: centerDetails[name].over_cats,
            lat: dev.Latitude || null, lng: dev.Longitude || null
          });
        }
      }
      topOver.sort((a,b) => b.over - a.over);

      D = {
        raw: rawData.raw,
        deviations: rawData.deviations,
        allCenters: rawData.allCenters,
        total: Math.round(totalSpend * 100) / 100,
        total_overspend: Math.round(totalOverspend * 100) / 100,
        total_capped: Math.round((totalSpend - totalOverspend) * 100) / 100,
        active_centers: activeCentersCount,
        over_centers: overCentersCount,
        rejected_total: 0,
        monthly: monthlyTotals,
        categories: categoriesTotals,
        center_details: centerDetails,
        top_over_centers: topOver,
        caps: {},
        hist: rawData.historical || {}
      };
      console.log("Mock Database Loaded successfully in new design!", D);
    }
  } else {
    console.error("Critical: No dataset available.");
  }
}

// ══ STATE ══
let showMap = false;
let activePage = "overview";
let currentMonth = 5; // Default to May 2026 (Live month 5)
let isHistoricalMode = false;
let activeHistMonthKey = null; // "jan", "feb", etc.
// Chart & Map Instance management
let unifiedChartInstance = null;
let categoryTrendChart = null;
let leafletMap = null;
let leafletMarkersGroup = null;
let activeCategoryFilter = "all";
let activeFraudFilters = new Set(['all']);
let fraudSearchQuery = "";
let centersSearchQuery = "";
let activeModalCenterName = null;
let selectedAor = { sd: "", d: "", sm: "", stm: "" };
let selectedRiskAor = { sd: "", d: "", sm: "", stm: "", center: "" };

const CHART_COLORS = {
  red: "#E8341C",
  redLight: "rgba(232, 52, 28, 0.2)",
  blue: "#2563EB",
  green: "#16A34A",
  amber: "#D97706",
  gray: "#9CA3AF"
};

const BENCHMARK_CATS = {
  "Electricity Expenses": true,
  "Office Maintenance Expenses": true,
  "Water Expenses": true,
  "Internet Expenses": true,
  "Staff Welfare Expenses": true
};

// ── INITIALIZATION ──
document.addEventListener("DOMContentLoaded", () => {
  if (!D) return;

  // Build Month Picker options
  populateMonthDropdown();

  // Populate AOR Selects
  populateAorSelects();
  populateRiskAorSelects();

  // Load and apply data build
  refreshDashboard();

  // Global click handlers to close monthly dropdown
  document.addEventListener("click", (e) => {
    const drop = document.getElementById("month-dropdown");
    const chip = document.getElementById("month-chip");
    if (drop && chip && !chip.contains(e.target) && !drop.contains(e.target)) {
      chip.classList.remove("open");
      drop.classList.remove("on");
    }
  });
});

// ── PAGE SWAPPER ──
function nav(pageId, element) {
  activePage = pageId;
  document.querySelectorAll(".pg").forEach(pg => pg.classList.remove("active"));
  document.getElementById("pg-" + pageId).classList.add("active");

  document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
  element.classList.add("active");

  const titles = { overview: "Overview", risk: "Anomaly Alert" };
  document.getElementById("tb-page").innerText = titles[pageId];

  if (pageId === "overview") {
    if (showMap) setTimeout(initLeafletMap, 150);
    renderUnifiedChart();
  } else if (pageId === "risk") {
    renderFraudSection();
  }
}

// ── MONTH PICKER DROPDOWN ──
function toggleMonthDrop(e) {
  e.stopPropagation();
  const drop = document.getElementById("month-dropdown");
  const chip = document.getElementById("month-chip");
  chip.classList.toggle("open");
  drop.classList.toggle("on");
}

function populateMonthDropdown() {
  const mContainer = document.getElementById("mdd-months");
  mContainer.innerHTML = "";

  const months = [
    { label: "Jan 26", val: 1 },
    { label: "Feb 26", val: 2 },
    { label: "Mar 26", val: 3 },
    { label: "Apr 26", val: 4 },
    { label: "May 26", val: 5 }
  ];

  months.forEach(m => {
    const btn = document.createElement("div");
    const isActive = (!isHistoricalMode && currentMonth === m.val);
    btn.className = `mdd-month ${isActive ? 'active' : ''}`;
    btn.innerText = m.label;
    btn.onclick = () => selectGovernanceMonth(m.val);
    mContainer.appendChild(btn);
  });
}

function selectGovernanceMonth(month) {
  currentMonth = month;
  isHistoricalMode = false;
  activeHistMonthKey = null;

  const labels = { 1: "January 2026", 2: "February 2026", 3: "March 2026", 4: "April 2026", 5: "May 2026" };
  document.getElementById("month-chip-label").innerText = labels[month] || month;
  document.getElementById("sb-month-tag").innerText = (labels[month] || month) + " · Live";
  
  document.getElementById("month-chip").classList.remove("open");
  document.getElementById("month-dropdown").classList.remove("on");

  document.getElementById("trend-banner").classList.remove("on");
  document.getElementById("hier-trend-view").style.display = "none";
  document.getElementById("hier-month-view").style.display = "block";

  populateMonthDropdown();
  refreshDashboard();
}

function toggleTrendView() {
  const banner = document.getElementById("trend-banner");
  const chipLabel = document.getElementById("month-chip-label");
  const drop = document.getElementById("month-dropdown");
  const chip = document.getElementById("month-chip");

  chip.classList.remove("open");
  drop.classList.remove("on");

  isHistoricalMode = true;
  activeHistMonthKey = "trend";

  chipLabel.innerText = "5-Month Trend";
  document.getElementById("sb-month-tag").innerText = "Jan-May Trend";

  banner.classList.add("on");
  document.getElementById("hier-trend-view").style.display = "block";
  document.getElementById("hier-month-view").style.display = "none";

  renderTrend6Chart();
  renderTrend6Table();
}

// ── DATA ENGINE ──
function refreshDashboard() {
  if (isHistoricalMode) return;

  // Aggregate based on month
  let totalSpend = 0, totalOver = 0, totalCapped = 0, overCentersCount = 0, activeCentersCount = 0;
  const categoriesTotals = {};
  const monthlyTotals = {};
  const centerDetails = {};

  // Resolve transactions
  const transactions = D.raw.filter(t => {
    const m = parseInt(t["Bill Date"].split("-")[1], 10);
    if (m !== currentMonth) return false;

    // Filter AOR
    const hc = D.allCenters.find(ac => ac["HQ Name"] === t["Center Name"]);
    if (hc) {
      if (selectedAor.sd && hc.SD !== selectedAor.sd) return false;
      if (selectedAor.d && hc.D !== selectedAor.d) return false;
      if (selectedAor.sm && hc.SM !== selectedAor.sm) return false;
      if (selectedAor.stm && hc.STM !== selectedAor.stm) return false;
    } else if (selectedAor.sd || selectedAor.d || selectedAor.sm || selectedAor.stm) {
      return false;
    }
    return t.Status === "Approved";
  });

  transactions.forEach(t => {
    const center = t["Center Name"];
    const cat = t.Category || "Miscellaneous Expenses";
    const amt = t["Total Bill Amount"] || 0;

    categoriesTotals[cat] = (categoriesTotals[cat] || 0) + amt;
    monthlyTotals[currentMonth] = (monthlyTotals[currentMonth] || 0) + amt;

    if (!centerSpendMapLocal(center, cat, amt, centerDetails)) {
      // First transaction for this category at this center
    }
  });

  // Calculate Caps and savings
  const finalCenterDetails = {};
  for (const name in centerDetails) {
    const catsList = [];
    let centerTotal = 0, centerOver = 0, exceeded = 0;
    
    for (const cat in centerDetails[name]) {
      const actual = centerDetails[name][cat];
      const cap = getCapLocal(name, cat);
      const over = Math.max(0, actual - cap);
      catsList.push({ cat: cat, spend: actual, cap: cap, over: over });
      centerTotal += actual;
      centerOver += over;
      if (over > 0) exceeded++;
    }

    catsList.sort((a, b) => b.spend - a.spend);
    finalCenterDetails[name] = { name: name, cats: catsList, total: centerTotal, over: centerOver, over_cats: exceeded };

    totalSpend += centerTotal;
    totalOver += centerOver;
    activeCentersCount++;
    if (centerOver > 0) overCentersCount++;
  }

  filteredData = {
    totalSpend: Math.round(totalSpend * 100) / 100,
    totalOverspend: Math.round(totalOver * 100) / 100,
    totalCapped: Math.round((totalSpend - totalOver) * 100) / 100,
    activeCenters: activeCentersCount,
    overCenters: overCentersCount,
    categories: categoriesTotals,
    centerDetails: finalCenterDetails
  };

  // Update UI Elements
  updateUI();
}

function centerSpendMapLocal(center, cat, amt, map) {
  if (!map[center]) map[center] = {};
  map[center][cat] = (map[center][cat] || 0) + amt;
  return true;
}

function getCapLocal(center, cat) {
  const currentKey = isHistoricalMode ? activeHistMonthKey : currentMonth;
  const keyMap = { 1: "jan", 2: "feb", 3: "mar", 4: "apr", 5: "may", "jan": "jan", "feb": "feb", "mar": "mar", "apr": "apr", "may": "may" };
  const monthKey = keyMap[currentKey];
  
  if (monthKey && D.capsByMonth && D.capsByMonth[monthKey]) {
    const k = `${center}||${cat}`;
    if (D.capsByMonth[monthKey][k] !== undefined) {
      return D.capsByMonth[monthKey][k];
    }
  }

  // Standard caps configuration fallback
  const standardCaps = {
    "Electricity Expenses": 65000,
    "Staff Welfare Expenses": 8000,
    "Water Expenses": 5000,
    "Internet Expenses": 1770,
    "Office Maintenance Expenses": 5000,
    "Labourer Charges": 15000,
    "Office consumables": 5000,
    "Power & Fuel Expense": 3000,
    "Repair AND Maintanance Expenses": 3000,
    "Printing AND Stationery": 2000,
    "Miscellaneous Expenses": 6500,
    "Parking Charges": 1500,
    "Conveyance Expenses": 2000,
    "Travelling Expenses": 3000,
    "Adhoc Vehicle Hire Expense": 5000
  };
  return standardCaps[cat] !== undefined ? standardCaps[cat] : 99999;
}

function updateUI() {
  // Update Overview Page Titles
  const mNames = { 
    1: "January 2026",
    2: "February 2026",
    3: "March 2026",
    4: "April 2026",
    5: "May 2026"
  };
  const currentKey = isHistoricalMode ? activeHistMonthKey : currentMonth;
  const label = mNames[currentKey] || "5-Month Trend";
  
  document.getElementById("ov-month").innerText = label.replace(" 2025", "").replace(" 2026", "");
  document.getElementById("ano-month").innerText = label;

  const rankingBadge = document.getElementById("sd-ranking-badge");
  if (rankingBadge) {
    rankingBadge.innerText = label;
  }

  // KPIs
  document.getElementById("kpi-spend").innerText = formatCurrency(filteredData.totalSpend);
  document.getElementById("kpi-over").innerText = formatCurrency(filteredData.totalOverspend);
  document.getElementById("kpi-cap").innerText = formatCurrency(filteredData.totalCapped);
  document.getElementById("kpi-centers").innerText = filteredData.overCenters;
  
  const pct = filteredData.activeCenters > 0 ? Math.round((filteredData.overCenters / filteredData.activeCenters) * 1000) / 10 : 0;
  document.getElementById("kpi-centers-meta").innerText = `${pct}% of ${filteredData.activeCenters} active centers`;

  // Render Visual Panels
  if (activePage === "overview") {
    renderUnifiedChart();
    renderCategoryOverviewGrid();
    renderHierarchyMonthlyView();
    if (showMap) updateLeafletMap();
  } else if (activePage === "risk") {
    renderFraudSection();
  }

  // Update Anomaly alert sidebar badge counts
  const riskScores = computeFraudRiskScores();
  const highCount = riskScores.filter(r => r.score >= 40).length;
  document.getElementById("fraud-nav-badge").innerText = highCount;
}

// ── UNIFIED EXPENSE ANALYTICS CHART ──
function renderUnifiedChart() {
  const canvas = document.getElementById("unifiedChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (unifiedChart) unifiedChart.destroy();

  // Stacked chart displaying approved within-cap vs leakage spend per category
  const list = Object.keys(filteredData.categories).map(k => ({ name: k, total: filteredData.categories[k] }));
  list.sort((a,b) => b.total - a.total);
  const top6 = list.slice(0, 6);

  const labels = top6.map(c => c.name.replace(" Expenses","").replace(" Expense", ""));
  const capped = [], overspent = [];

  top6.forEach(item => {
    let cappedSum = 0, overspentSum = 0;
    for (const cName in filteredData.centerDetails) {
      const c = filteredData.centerDetails[cName];
      if (c.cats && !Array.isArray(c.cats)) {
        c.cats = [c.cats];
      }
      if (!c.cats) c.cats = [];
      const match = c.cats.find(cat => cat.cat === item.name);
      if (match) {
        cappedSum += Math.min(match.spend, match.cap);
        overspentSum += match.over;
      }
    }
    capped.push(Math.round(cappedSum));
    overspent.push(Math.round(overspentSum));
  });

  unifiedChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        { label: "Approved (Within Cap)", data: capped, backgroundColor: "#3B82F6", borderRadius: 4 },
        { label: "Benchmark Leakage", data: overspent, backgroundColor: CHART_COLORS.red, borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { stacked: true }, y: { stacked: true } },
      plugins: { legend: { position: "top" } }
    }
  });
}

// ── CATEGORY SPEND QUICK VIEW ──
function renderCategoryOverviewGrid() {
  const grid = document.getElementById("cat-ov-grid");
  grid.innerHTML = "";

  const list = Object.keys(filteredData.categories).map(k => {
    let over = 0;
    for (const name in filteredData.centerDetails) {
      const c = filteredData.centerDetails[name];
      if (c.cats && !Array.isArray(c.cats)) {
        c.cats = [c.cats];
      }
      if (!c.cats) c.cats = [];
      const match = c.cats.find(cat => cat.cat === k);
      if (match) over += match.over;
    }
    return { name: k, total: filteredData.categories[k], over: over };
  });
  list.sort((a,b) => b.total - a.total);
  const top4 = list.slice(0, 4);

  top4.forEach(cat => {
    const card = document.createElement("div");
    card.className = "cat-ov-card";
    card.onclick = () => openCategoryTrend(cat.name);

    const overText = cat.over > 0 ? `<div class="cat-ov-over">₹${Math.round(cat.over / 1000) / 10}L overspend</div>` : `<div style="font-size:10.5px;color:var(--green);font-weight:700;margin-top:3px;">Compliant</div>`;
    const pct = Math.min(100, Math.round(((cat.total - cat.over) / Math.max(1, cat.total)) * 100));

    card.innerHTML = `
      <div class="cat-ov-name" title="${cat.name}">${cat.name.replace(" Expenses", "")}</div>
      <div class="cat-ov-val">${formatCurrency(cat.total)}</div>
      ${overText}
      <div class="cat-ov-bar"><div class="cat-ov-fill" style="width:${pct}%;background-color:${cat.over > 0 ? 'var(--red)' : 'var(--green)'}"></div></div>
    `;
    grid.appendChild(card);
  });
}

function openCategoryTrend(catName) {
  document.getElementById("cat-trend-panel").style.display = "block";
  document.getElementById("cat-trend-title").innerText = `${catName} — Last 5 Months`;

  const canvas = document.getElementById("cat-trend-chart");
  const ctx = canvas.getContext("2d");
  if (categoryTrendChart) categoryTrendChart.destroy();

  const months = ["jan", "feb", "mar", "apr", "may"];
  const labels = ["Jan", "Feb", "Mar", "Apr", "May"];
  const data = [];

  months.forEach(m => {
    const dataSet = D.hist && D.hist[m] ? D.hist[m] : null;
    let sum = 0;
    if (dataSet && dataSet.categories && dataSet.categories[catName]) {
      sum = dataSet.categories[catName];
    }
    data.push(Math.round(sum));
  });

  // Append current month data
  labels.push(currentMonth === 4 ? "Apr" : "May");
  data.push(Math.round(filteredData.categories[catName] || 0));

  categoryTrendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: "Expenditure (INR)",
        data: data,
        borderColor: CHART_COLORS.red,
        borderWidth: 2,
        tension: 0.15,
        fill: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

function closeCatTrend() {
  document.getElementById("cat-trend-panel").style.display = "none";
}

// ── LEAFLET MAP PANEL ──
function toggleMap() {
  showMap = !showMap;
  const panel = document.getElementById("map-panel");
  const btn = document.getElementById("map-toggle-btn");
  if (showMap) {
    panel.classList.add("on");
    btn.innerText = "✕ Close Map";
    setTimeout(initLeafletMap, 150);
  } else {
    panel.classList.remove("on");
    btn.innerText = "🗺 View Map";
  }
}

function initLeafletMap() {
  if (!leafletMap) {
    leafletMap = L.map("map", { center: [21.0, 78.0], zoom: 5, scrollWheelZoom: false });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }).addTo(leafletMap);
    leafletMarkersGroup = L.featureGroup().addTo(leafletMap);
  }
  updateLeafletMap();
}

function updateLeafletMap() {
  if (!leafletMap || !leafletMarkersGroup) return;
  leafletMarkersGroup.clearLayers();
  const bounds = [];

  for (const name in filteredData.centerDetails) {
    const center = filteredData.centerDetails[name];
    const hc = D.allCenters.find(ac => ac["HQ Name"] === name);
    if (!hc) continue;

    const lat = parseFloat(hc.Latitude);
    const lng = parseFloat(hc.Longitude);
    if (isNaN(lat) || isNaN(lng)) continue;

    let markerColor = CHART_COLORS.green;
    let radius = 6;
    if (center.over > 500000) { markerColor = CHART_COLORS.red; radius = 11; }
    else if (center.over > 0) { markerColor = CHART_COLORS.amber; radius = 8; }

    const marker = L.circleMarker([lat, lng], {
      radius: radius,
      fillColor: markerColor,
      color: "#FFF",
      weight: 1.5,
      fillOpacity: 0.9
    });

    const popupHtml = `
      <div style="font-family:sans-serif;padding:3px;">
        <h4 style="margin:0 0 4px;font-weight:700;">${name}</h4>
        <div style="font-size:11px;color:#4B5563;margin-bottom:6px;">Spend: <strong>${formatCurrency(center.total)}</strong></div>
        <div style="font-size:11px;color:${center.over > 0 ? 'red' : '#4B5563'};">Overspend: <strong>${formatCurrency(center.over)}</strong></div>
        <button class="view-detail-btn" onclick="openCenterModal('${name}')" style="width:100%;margin-top:8px;padding:3px 0;font-size:10px;height:auto;">View Audit</button>
      </div>
    `;

    marker.bindPopup(popupHtml);
    marker.addTo(leafletMarkersGroup);
    bounds.push([lat, lng]);
  }

  if (bounds.length > 0 && selectedAor.sd) {
    leafletMap.fitBounds(bounds, { padding: [40, 40] });
  } else {
    leafletMap.setView([21.0, 78.0], 5);
  }
}

// ── HIERARCHY TREE MODULE ──
function renderHierarchyMonthlyView() {
  const body = document.getElementById("hier-body");
  body.innerHTML = "";

  const mNames = { 
    4: "April 2026", 
    5: "May 2026", 
    nov: "November 2025", 
    dec: "December 2025", 
    jan: "January 2026", 
    feb: "February 2026", 
    mar: "March 2026" 
  };
  const currentKey = isHistoricalMode ? activeHistMonthKey : currentMonth;
  const label = mNames[currentKey] || "Selected Month";

  const mHead = document.getElementById("hier-month-head");
  if (mHead) {
    mHead.innerText = `SD → Director → SM → STM → Center (${label})`;
  }

  const tree = {};
  for (const name in filteredData.centerDetails) {
    const c = filteredData.centerDetails[name];
    const hc = D.allCenters.find(a => a["HQ Name"] === name) || { SD: "Unknown SD", D: "Unknown Div", SM: "Unknown SM", STM: "Unknown STM" };
    
    if (!tree[hc.SD]) tree[hc.SD] = {};
    if (!tree[hc.SD][hc.D]) tree[hc.SD][hc.D] = {};
    if (!tree[hc.SD][hc.D][hc.SM]) tree[hc.SD][hc.D][hc.SM] = {};
    if (!tree[hc.SD][hc.D][hc.SM][hc.STM]) tree[hc.SD][hc.D][hc.SM][hc.STM] = [];
    tree[hc.SD][hc.D][hc.SM][hc.STM].push(c);
  }

  function sum(list) {
    let s = 0, o = 0, a = 0, ol = 0;
    list.forEach(c => { s += c.total; o += c.over; a++; if (c.over > 0) ol++; });
    return { spend: s, over: o, centers: a, overCap: ol };
  }

  function getFlat(branch) {
    let list = [];
    if (Array.isArray(branch)) return branch;
    for (const k in branch) list = list.concat(getFlat(branch[k]));
    return list;
  }

  const sortedSds = Object.keys(tree).sort((a, b) => {
    const aggA = sum(getFlat(tree[a]));
    const aggB = sum(getFlat(tree[b]));
    if (aggB.over !== aggA.over) return aggB.over - aggA.over;
    return aggB.spend - aggA.spend;
  });

  let index = 0;
  sortedSds.forEach((sd, sdIdx) => {
    const sdId = `sd-${index++}`;
    const sdAgg = sum(getFlat(tree[sd]));
    
    // Premium Rank Pill
    const rankBg = sdIdx < 3 ? 'var(--red)' : '#FEE2E2';
    const rankColor = sdIdx < 3 ? '#fff' : '#B91C1C';
    const rankPill = `<span style="display:inline-flex;align-items:center;justify-content:center;background:${rankBg};color:${rankColor};font-size:10px;font-weight:800;border-radius:6px;padding:2px 6px;margin-right:8px;font-family:var(--mono);">#${sdIdx + 1}</span>`;
    const sdDisplayName = `${rankPill}${sd}`;

    body.appendChild(createHierarchyRow(sdDisplayName, sdId, "sd", sdAgg, "sd-row"));

    const sdContainer = document.createElement("div");
    sdContainer.id = `${sdId}-container`;
    sdContainer.className = "nest";

    const sortedDirs = Object.keys(tree[sd]).sort((a, b) => {
      const aggA = sum(getFlat(tree[sd][a]));
      const aggB = sum(getFlat(tree[sd][b]));
      if (aggB.over !== aggA.over) return aggB.over - aggA.over;
      return aggB.spend - aggA.spend;
    });

    sortedDirs.forEach(d => {
      const dId = `d-${index++}`;
      const dAgg = sum(getFlat(tree[sd][d]));
      sdContainer.appendChild(createHierarchyRow(d, dId, "dir", dAgg, "d-row"));

      const dContainer = document.createElement("div");
      dContainer.id = `${dId}-container`;
      dContainer.className = "nest";

      const sortedSms = Object.keys(tree[sd][d]).sort((a, b) => {
        const aggA = sum(getFlat(tree[sd][d][a]));
        const aggB = sum(getFlat(tree[sd][d][b]));
        if (aggB.over !== aggA.over) return aggB.over - aggA.over;
        return aggB.spend - aggA.spend;
      });

      sortedSms.forEach(sm => {
        const smId = `sm-${index++}`;
        const smAgg = sum(getFlat(tree[sd][d][sm]));
        dContainer.appendChild(createHierarchyRow(sm, smId, "sm", smAgg, "sm-row"));

        const smContainer = document.createElement("div");
        smContainer.id = `${smId}-container`;
        smContainer.className = "nest";

        const sortedStms = Object.keys(tree[sd][d][sm]).sort((a, b) => {
          const aggA = sum(tree[sd][d][sm][a]);
          const aggB = sum(tree[sd][d][sm][b]);
          if (aggB.over !== aggA.over) return aggB.over - aggA.over;
          return aggB.spend - aggA.spend;
        });

        sortedStms.forEach(stm => {
          const stmId = `stm-${index++}`;
          const stmAgg = sum(tree[sd][d][sm][stm]);
          smContainer.appendChild(createHierarchyRow(stm, stmId, "stm", stmAgg, "stm-row"));

          const stmContainer = document.createElement("div");
          stmContainer.id = `${stmId}-container`;
          stmContainer.className = "nest";

          // Sort centers inside STM branch by overspend leakage
          const sortedCens = tree[sd][d][sm][stm].slice().sort((a,b) => b.over - a.over);
          sortedCens.forEach(c => {
            const tr = document.createElement("div");
            tr.className = `cen-row ${c.over > 10000 ? 'cen-critical' : ''}`;
            tr.innerHTML = `
              <div></div>
              <div class="tn"><span class="lp lp-c">Center</span> ${c.name}</div>
              <div class="num">${formatCurrency(c.total)}</div>
              <div class="num" style="color:${c.over > 0 ? 'var(--red)' : 'inherit'};font-weight:700;">${formatCurrency(c.over)}</div>
              <div style="text-align:center;">—</div>
              <div style="text-align:center;"><span class="lp ${c.over > 0 ? 'lp-sd' : 'lp-c'}">${c.over > 0 ? 'Over' : 'Compliant'}</span></div>
              <div style="text-align:center;"><button class="view-detail-btn" onclick="openCenterModal('${c.name}')">Audit</button></div>
            `;
            stmContainer.appendChild(tr);
          });
          smContainer.appendChild(stmContainer);
        });
        dContainer.appendChild(smContainer);
      });
      sdContainer.appendChild(dContainer);
    });
    body.appendChild(sdContainer);
  });
}


function createHierarchyRow(name, nodeId, levelKey, agg, className) {
  const row = document.createElement("div");
  row.className = className;
  row.onclick = (e) => {
    // Prevent triggering if details button clicked
    if (e.target.tagName === "BUTTON") return;
    toggleTree(nodeId);
  };
  const levelLabels = { sd: "SD", dir: "DIR", sm: "SM", stm: "STM" };
  const badgeClasses = { sd: "lp-sd", dir: "lp-d", sm: "lp-sm", stm: "lp-stm" };

  row.innerHTML = `
    <div><div class="xbtn" id="${nodeId}-btn">+</div></div>
    <div class="tn"><span class="lp ${badgeClasses[levelKey]}">${levelLabels[levelKey]}</span> ${name}</div>
    <div class="num">${formatCurrency(agg.spend)}</div>
    <div class="num" style="color:${agg.over > 0 ? 'var(--red)' : 'inherit'};font-weight:700;">${formatCurrency(agg.over)}</div>
    <div class="num" style="text-align:center;">${agg.centers}</div>
    <div style="text-align:center;"><span class="bdg ${agg.overCap > 0 ? 'critical' : 'normal'}">${agg.overCap} over</span></div>
    <div style="text-align:center;">—</div>
  `;
  return row;
}

function toggleTree(nodeId) {
  const container = document.getElementById(`${nodeId}-container`);
  const btn = document.getElementById(`${nodeId}-btn`);
  const row = btn ? btn.parentElement.parentElement : null;
  if (container.classList.contains("on")) {
    container.classList.remove("on");
    btn.innerText = "+";
    btn.classList.remove("op");
    if (row) row.classList.remove("open");
  } else {
    container.classList.add("on");
    btn.innerText = "-";
    btn.classList.add("op");
    if (row) row.classList.add("open");
  }
}

function toggleAllHierarchy(expand) {
  document.querySelectorAll(".nest").forEach(el => {
    if (expand) el.classList.add("on");
    else el.classList.remove("on");
  });
  document.querySelectorAll(".xbtn").forEach(btn => {
    btn.innerText = expand ? "-" : "+";
    if (expand) btn.classList.add("op");
    else btn.classList.remove("op");
    const row = btn.parentElement.parentElement;
    if (row) {
      if (expand) row.classList.add("open");
      else row.classList.remove("open");
    }
  });
}

// ── HISTORICAL 6-MONTH TREND BANNER & TABLE ──
function renderTrend6Chart() {
  const canvas = document.getElementById("trend6Chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (window.trendChartInstance) window.trendChartInstance.destroy();

  const labels = ["Jan", "Feb", "Mar", "Apr", "May"];
  const monthsKeys = ["jan", "feb", "mar", "apr", "may"];
  const spendData = [];
  const overData = [];

  monthsKeys.forEach(m => {
    const h = D.hist && D.hist[m] ? D.hist[m] : { totalSpend: 0, totalOverspend: 0 };
    spendData.push(Math.round(h.totalSpend));
    overData.push(Math.round(h.totalOverspend));
  });

  window.trendChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        { label: "Approved spend", data: spendData, borderColor: "#3B82F6", borderWidth: 3, fill: false },
        { label: "Leakage overspend", data: overData, borderColor: CHART_COLORS.red, borderWidth: 3, fill: false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

function renderTrend6Table() {
  const body = document.getElementById("hier-trend-body");
  body.innerHTML = "";

  const sds = [...new Set(D.allCenters.map(c => c.SD))].filter(Boolean);
  const mKeys = ["jan", "feb", "mar", "apr", "may"];

  const sdStats = sds.map((sd, idx) => {
    const monthlySum = { jan: 0, feb: 0, mar: 0, apr: 0, may: 0 };
    
    mKeys.forEach(m => {
      const set = D.hist && D.hist[m] ? D.hist[m] : null;
      if (set && set.sds && set.sds[sd]) {
        monthlySum[m] = set.sds[sd];
      }
    });

    const total5 = monthlySum.jan + monthlySum.feb + monthlySum.mar + monthlySum.apr + monthlySum.may;
    return { name: sd, monthly: monthlySum, total: total5 };
  });

  sdStats.sort((a,b) => b.total - a.total);

  sdStats.forEach((sd, index) => {
    const row = document.createElement("div");
    row.className = "trend-sd-row";
    row.onclick = () => toggleTrendSD(sd.name);

    const maxVal = Math.max(sd.monthly.jan, sd.monthly.feb, sd.monthly.mar, sd.monthly.apr, sd.monthly.may);
    const renderBar = (val) => {
      const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
      return `<div class="spark-bar" style="height:${pct}%"></div>`;
    };

    row.innerHTML = `
      <div><span class="rank-pill ${index < 3 ? 'top3' : ''}">${index + 1}</span></div>
      <div class="tn" style="font-weight:700;">${sd.name}</div>
      <div class="trend-cell">${formatLakh(sd.monthly.jan)}</div>
      <div class="trend-cell">${formatLakh(sd.monthly.feb)}</div>
      <div class="trend-cell">${formatLakh(sd.monthly.mar)}</div>
      <div class="trend-cell">${formatLakh(sd.monthly.apr)}</div>
      <div class="trend-cell hi">${formatLakh(sd.monthly.may)}</div>
      <div>
        <div class="spark">
          ${renderBar(sd.monthly.jan)}
          ${renderBar(sd.monthly.feb)}
          ${renderBar(sd.monthly.mar)}
          ${renderBar(sd.monthly.apr)}
          ${renderBar(sd.monthly.may)}
        </div>
      </div>
    `;
    body.appendChild(row);

    const detailDiv = document.createElement("div");
    detailDiv.id = `trend-${sd.name.replace(/\s+/g, '')}-container`;
    detailDiv.className = "nest";
    body.appendChild(detailDiv);
  });
}

function formatLakh(val) {
  return `₹${Math.round(val / 100000)}L`;
}

function toggleTrendSD(sdName) {
  const id = `trend-${sdName.replace(/\s+/g, '')}-container`;
  const container = document.getElementById(id);
  if (container.classList.contains("on")) {
    container.classList.remove("on");
    return;
  }
  container.classList.add("on");

  container.innerHTML = "";
  const directors = [...new Set(D.allCenters.filter(c => c.SD === sdName).map(c => c.D))].filter(Boolean);
  const mKeys = ["jan", "feb", "mar", "apr", "may"];

  directors.forEach(dir => {
    const monthlySum = { jan: 0, feb: 0, mar: 0, apr: 0, may: 0 };
    
    mKeys.forEach(m => {
      const set = D.hist && D.hist[m] ? D.hist[m] : null;
      if (set && set.centers) {
        const censUnderDir = D.allCenters.filter(c => c.D === dir).map(c => c["HQ Name"]);
        censUnderDir.forEach(cName => {
          if (set.centers[cName]) monthlySum[m] += set.centers[cName];
        });
      }
    });

    const row = document.createElement("div");
    row.className = "trend-dir-row";
    row.innerHTML = `
      <div></div>
      <div class="tn" style="font-size:12.5px;"><span class="lp lp-d">DIR</span> ${dir}</div>
      <div class="trend-cell">${formatLakh(monthlySum.jan)}</div>
      <div class="trend-cell">${formatLakh(monthlySum.feb)}</div>
      <div class="trend-cell">${formatLakh(monthlySum.mar)}</div>
      <div class="trend-cell">${formatLakh(monthlySum.apr)}</div>
      <div class="trend-cell hi">${formatLakh(monthlySum.may)}</div>
      <div style="font-size:11.5px;color:var(--t2);font-weight:700;text-align:right;padding-right:12px;">
        ${formatLakh(monthlySum.jan + monthlySum.feb + monthlySum.mar + monthlySum.apr + monthlySum.may)}
      </div>
    `;
    container.appendChild(row);
  });
}

// ── AOR SELECT DROPDOWN LOGIC ──
function populateAorSelects() {
  const sdSelect = document.getElementById("aor-sd");
  const sds = [...new Set(D.allCenters.map(c => c.SD))].filter(Boolean);
  sdSelect.innerHTML = `<option value="">— All SDs —</option>`;
  sds.forEach(sd => sdSelect.innerHTML += `<option value="${sd}">${sd}</option>`);
}

function onAorChange(level) {
  const sdVal = document.getElementById("aor-sd").value;
  const dSelect = document.getElementById("aor-dir");
  const smSelect = document.getElementById("aor-sm");
  const stmSelect = document.getElementById("aor-stm");

  if (level === "sd") {
    selectedAor.sd = sdVal; selectedAor.d = ""; selectedAor.sm = ""; selectedAor.stm = "";
    dSelect.value = ""; smSelect.value = ""; stmSelect.value = "";
    if (sdVal) {
      dSelect.disabled = false;
      const divs = [...new Set(D.allCenters.filter(c => c.SD === sdVal).map(c => c.D))].filter(Boolean);
      dSelect.innerHTML = `<option value="">— All Directors —</option>`;
      divs.forEach(d => dSelect.innerHTML += `<option value="${d}">${d}</option>`);
      smSelect.innerHTML = `<option value="">— All SMs —</option>`; smSelect.disabled = true;
      stmSelect.innerHTML = `<option value="">— All STMs —</option>`; stmSelect.disabled = true;
    } else {
      dSelect.disabled = true; dSelect.innerHTML = `<option value="">— All Directors —</option>`;
      smSelect.disabled = true; smSelect.innerHTML = `<option value="">— All SMs —</option>`;
      stmSelect.disabled = true; stmSelect.innerHTML = `<option value="">— All STMs —</option>`;
    }
  } else if (level === "dir") {
    const dVal = dSelect.value;
    selectedAor.d = dVal; selectedAor.sm = ""; selectedAor.stm = "";
    smSelect.value = ""; stmSelect.value = "";
    if (dVal) {
      smSelect.disabled = false;
      const sms = [...new Set(D.allCenters.filter(c => c.D === dVal).map(c => c.SM))].filter(Boolean);
      smSelect.innerHTML = `<option value="">— All SMs —</option>`;
      sms.forEach(sm => smSelect.innerHTML += `<option value="${sm}">${sm}</option>`);
      stmSelect.innerHTML = `<option value="">— All STMs —</option>`; stmSelect.disabled = true;
    } else {
      smSelect.disabled = true; smSelect.innerHTML = `<option value="">— All SMs —</option>`;
      stmSelect.disabled = true; stmSelect.innerHTML = `<option value="">— All STMs —</option>`;
    }
  } else if (level === "sm") {
    const smVal = smSelect.value;
    selectedAor.sm = smVal; selectedAor.stm = "";
    stmSelect.value = "";
    if (smVal) {
      stmSelect.disabled = false;
      const stms = [...new Set(D.allCenters.filter(c => c.SM === smVal).map(c => c.STM))].filter(Boolean);
      stmSelect.innerHTML = `<option value="">— All STMs —</option>`;
      stms.forEach(stm => stmSelect.innerHTML += `<option value="${stm}">${stm}</option>`);
    } else {
      stmSelect.disabled = true; stmSelect.innerHTML = `<option value="">— All STMs —</option>`;
    }
  } else if (level === "stm") {
    selectedAor.stm = stmSelect.value;
  }

  // Render info banner
  updateAorInfoStrip();
  refreshDashboard();
}

function updateAorInfoStrip() {
  const strip = document.getElementById("aor-info-strip");
  if (!selectedAor.sd) {
    strip.classList.remove("on");
    return;
  }
  strip.classList.add("on");

  let activeRole = "SD";
  let activeName = selectedAor.sd;
  if (selectedAor.stm) { activeRole = "STM"; activeName = selectedAor.stm; }
  else if (selectedAor.sm) { activeRole = "SM"; activeName = selectedAor.sm; }
  else if (selectedAor.d) { activeRole = "DIR"; activeName = selectedAor.d; }

  document.getElementById("aor-info-role").innerText = activeRole;
  document.getElementById("aor-info-name").innerText = activeName;

  // Breadcrumbs
  const breadcrumb = document.getElementById("aor-breadcrumb");
  breadcrumb.innerHTML = "";
  const trail = [];
  if (selectedAor.sd) trail.push({ label: selectedAor.sd, key: "sd" });
  if (selectedAor.d) trail.push({ label: selectedAor.d, key: "dir" });
  if (selectedAor.sm) trail.push({ label: selectedAor.sm, key: "sm" });
  if (selectedAor.stm) trail.push({ label: selectedAor.stm, key: "stm" });

  trail.forEach((item, idx) => {
    const isLast = idx === trail.length - 1;
    breadcrumb.innerHTML += `
      <span class="aor-bc-item ${isLast ? 'active' : ''}" onclick="drillUpAor('${item.key}')">${item.label}</span>
      ${!isLast ? '<span class="aor-bc-sep">/</span>' : ''}
    `;
  });

  // KPI container inside AOR strip
  setTimeout(() => {
    const kpis = document.getElementById("aor-info-kpis");
    kpis.innerHTML = `
      <div class="aor-info-kpi"><div class="aor-info-kpi-val">${formatCurrency(filteredData.totalSpend)}</div><div class="aor-info-kpi-lbl">AOR Spend</div></div>
      <div class="aor-info-kpi"><div class="aor-info-kpi-val" style="color:var(--red);">${formatCurrency(filteredData.totalOverspend)}</div><div class="aor-info-kpi-lbl">AOR Leakage</div></div>
      <div class="aor-info-kpi"><div class="aor-info-kpi-val" style="color:var(--blue);">${filteredData.activeCenters}</div><div class="aor-info-kpi-lbl">Governed Centers</div></div>
    `;

    // Show over-cap centers inside AOR strip if any
    const listDiv = document.getElementById("aor-overcap-centers");
    const container = document.getElementById("overcap-center-list");
    container.innerHTML = "";
    
    const overCens = [];
    for (const name in filteredData.centerDetails) {
      if (filteredData.centerDetails[name].over > 0) overCens.push(filteredData.centerDetails[name]);
    }
    overCens.sort((a,b) => b.over - a.over);

    if (overCens.length > 0) {
      listDiv.style.display = "block";
      overCens.forEach(c => {
        const card = document.createElement("div");
        card.className = "overcap-center-card";
        card.onclick = () => openCenterModal(c.name);
        card.innerHTML = `
          <div style="font-weight:700;font-size:12.5px;">${c.name}</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="overcap-cats-badge">${c.over_cats} Categories Over</span>
            <span class="num" style="color:var(--red);font-weight:700;">${formatCurrency(c.over)}</span>
            <button class="view-detail-btn" style="padding:4px 10px;">Audit</button>
          </div>
        `;
        container.appendChild(card);
      });
    } else {
      listDiv.style.display = "none";
    }
  }, 60);
}

function drillUpAor(key) {
  if (key === "sd") {
    document.getElementById("aor-dir").value = "";
    onAorChange("dir");
  } else if (key === "dir") {
    document.getElementById("aor-sm").value = "";
    onAorChange("sm");
  } else if (key === "sm") {
    document.getElementById("aor-stm").value = "";
    onAorChange("stm");
  }
}

function clearAorFilter() {
  document.getElementById("aor-sd").value = "";
  onAorChange("sd");
}

// ── ANOMALY AOR SELECT DROPDOWN LOGIC ──
function populateRiskAorSelects() {
  const sdSelect = document.getElementById("risk-sd");
  if (!sdSelect) return;
  const sds = [...new Set(D.allCenters.map(c => c.SD))].filter(Boolean);
  sdSelect.innerHTML = `<option value="">— All SDs —</option>`;
  sds.forEach(sd => sdSelect.innerHTML += `<option value="${sd}">${sd}</option>`);
}

function onRiskAorChange(level) {
  const sdVal = document.getElementById("risk-sd").value;
  const dSelect = document.getElementById("risk-dir");
  const smSelect = document.getElementById("risk-sm");
  const stmSelect = document.getElementById("risk-stm");
  const cSelect = document.getElementById("risk-center");

  if (level === "sd") {
    selectedRiskAor.sd = sdVal; selectedRiskAor.d = ""; selectedRiskAor.sm = ""; selectedRiskAor.stm = ""; selectedRiskAor.center = "";
    dSelect.value = ""; smSelect.value = ""; stmSelect.value = ""; cSelect.value = "";
    
    if (sdVal) {
      dSelect.disabled = false;
      const divs = [...new Set(D.allCenters.filter(c => c.SD === sdVal).map(c => c.D))].filter(Boolean);
      dSelect.innerHTML = `<option value="">— All Directors —</option>`;
      divs.forEach(d => dSelect.innerHTML += `<option value="${d}">${d}</option>`);
      
      smSelect.innerHTML = `<option value="">— All SMs —</option>`; smSelect.disabled = true;
      stmSelect.innerHTML = `<option value="">— All STMs —</option>`; stmSelect.disabled = true;
      cSelect.innerHTML = `<option value="">— All Centers —</option>`; cSelect.disabled = true;
    } else {
      dSelect.disabled = true; dSelect.innerHTML = `<option value="">— All Directors —</option>`;
      smSelect.disabled = true; smSelect.innerHTML = `<option value="">— All SMs —</option>`;
      stmSelect.disabled = true; stmSelect.innerHTML = `<option value="">— All STMs —</option>`;
      cSelect.disabled = true; cSelect.innerHTML = `<option value="">— All Centers —</option>`;
    }
  } else if (level === "dir") {
    const dVal = dSelect.value;
    selectedRiskAor.d = dVal; selectedRiskAor.sm = ""; selectedRiskAor.stm = ""; selectedRiskAor.center = "";
    smSelect.value = ""; stmSelect.value = ""; cSelect.value = "";
    
    if (dVal) {
      smSelect.disabled = false;
      const sms = [...new Set(D.allCenters.filter(c => c.D === dVal).map(c => c.SM))].filter(Boolean);
      smSelect.innerHTML = `<option value="">— All SMs —</option>`;
      sms.forEach(sm => smSelect.innerHTML += `<option value="${sm}">${sm}</option>`);
      
      stmSelect.innerHTML = `<option value="">— All STMs —</option>`; stmSelect.disabled = true;
      cSelect.innerHTML = `<option value="">— All Centers —</option>`; cSelect.disabled = true;
    } else {
      smSelect.disabled = true; smSelect.innerHTML = `<option value="">— All SMs —</option>`;
      stmSelect.disabled = true; stmSelect.innerHTML = `<option value="">— All STMs —</option>`;
      cSelect.disabled = true; cSelect.innerHTML = `<option value="">— All Centers —</option>`;
    }
  } else if (level === "sm") {
    const smVal = smSelect.value;
    selectedRiskAor.sm = smVal; selectedRiskAor.stm = ""; selectedRiskAor.center = "";
    stmSelect.value = ""; cSelect.value = "";
    
    if (smVal) {
      stmSelect.disabled = false;
      const stms = [...new Set(D.allCenters.filter(c => c.SM === smVal).map(c => c.STM))].filter(Boolean);
      stmSelect.innerHTML = `<option value="">— All STMs —</option>`;
      stms.forEach(stm => stmSelect.innerHTML += `<option value="${stm}">${stm}</option>`);
      
      cSelect.innerHTML = `<option value="">— All Centers —</option>`; cSelect.disabled = true;
    } else {
      stmSelect.disabled = true; stmSelect.innerHTML = `<option value="">— All STMs —</option>`;
      cSelect.disabled = true; cSelect.innerHTML = `<option value="">— All Centers —</option>`;
    }
  } else if (level === "stm") {
    const stmVal = stmSelect.value;
    selectedRiskAor.stm = stmVal; selectedRiskAor.center = "";
    cSelect.value = "";
    
    if (stmVal) {
      cSelect.disabled = false;
      const cens = [...new Set(D.allCenters.filter(c => c.STM === stmVal).map(c => c["HQ Name"]))].filter(Boolean);
      cSelect.innerHTML = `<option value="">— All Centers —</option>`;
      cens.forEach(c => cSelect.innerHTML += `<option value="${c}">${c}</option>`);
    } else {
      cSelect.disabled = true; cSelect.innerHTML = `<option value="">— All Centers —</option>`;
    }
  } else if (level === "center") {
    selectedRiskAor.center = cSelect.value;
  }
  
  renderFraudSection();
}

function clearRiskAorFilter() {
  const sd = document.getElementById("risk-sd");
  if (sd) {
    sd.value = "";
    onRiskAorChange("sd");
  }
}

// ── ANOMALY DETECTIONS & FRAUD SECTION ──
function computeFraudRiskScores() {
  const riskScores = [];
  
  // Pre-group approved staff welfare transactions by center name to optimize double-invoicing check
  const welfareTxByCenter = {};
  if (D && D.raw) {
    D.raw.forEach(r => {
      if (r.Status === "Approved" && r.Category === "Staff Welfare Expenses") {
        const cName = r["Center Name"];
        if (!welfareTxByCenter[cName]) welfareTxByCenter[cName] = [];
        welfareTxByCenter[cName].push(r);
      }
    });
  }

  for (const name in filteredData.centerDetails) {
    const center = filteredData.centerDetails[name];
    let score = 0, triggers = [];

    // Ensure cats is always formatted as an array (handles single-item serialization cases)
    if (center.cats && !Array.isArray(center.cats)) {
      center.cats = [center.cats];
    }

    const elec = center.cats.find(c => c.cat === "Electricity Expenses");
    if (elec && elec.over > 0 && elec.spend > elec.cap * 1.5) {
      score += 35;
      triggers.push({ cat: "Electricity Expenses", type: "electricity", desc: "Electricity spend exceeded custom cap by +50× threshold." });
    }

    const water = center.cats.find(c => c.cat === "Water Expenses");
    if (water && water.over > 0 && water.spend > water.cap * 1.8) {
      score += 25;
      triggers.push({ cat: "Water Expenses", type: "water", desc: "Abnormal Water invoice with no can-count approval." });
    }

    //staff welfare fake invoicing check (Fraud Pattern: Staff Welfare > 100x)
    const welfare = center.cats.find(c => c.cat === "Staff Welfare Expenses");
    if (welfare && welfare.over > 0 && welfare.spend > welfare.cap * 2.0) {
      score += 45;
      triggers.push({ cat: "Staff Welfare Expenses", type: "welfare", desc: "Abnormal welfare claim flagging possible fake mandays or ghost hires." });
    }

    // Check for double welfare invoices (duplicate bill dates and values)
    const matches = welfareTxByCenter[name] || [];
    const datesAmounts = {};
    let isDuplicated = false;
    matches.forEach(m => {
      const key = `${m["Bill Date"]}||${m["Total Bill Amount"]}`;
      datesAmounts[key] = (datesAmounts[key] || 0) + 1;
      if (datesAmounts[key] > 1) isDuplicated = true;
    });

    if (isDuplicated) {
      score += 40;
      triggers.push({ cat: "Staff Welfare Expenses", type: "multi", desc: "System flagged identical invoice duplicate files on same billing cycle." });
    }

    // Single month spike detection (10x benchmark deviation)
    let isSpiked = false;
    center.cats.forEach(c => {
      if (c.over > 0 && c.spend > c.cap * 3) isSpiked = true;
    });
    if (isSpiked) {
      score += 30;
      triggers.push({ cat: "Benchmark Hike", type: "spike", desc: "Large transaction spike exceeding standard limit by 3×." });
    }

    if (center.over_cats >= 4) {
      score += 20;
      triggers.push({ cat: "Multi-Category Breach", type: "multi", desc: `Violated caps simultaneously across ${center.over_cats} benchmark categories.` });
    }

    if (score > 0) {
      riskScores.push({
        name: name,
        score: Math.min(100, score),
        triggers: triggers,
        total: center.total,
        over: center.over
      });
    }
  }
  return riskScores.sort((a,b) => b.score - a.score);
}

function renderFraudSection() {
  const grid = document.getElementById("fraud-grid");
  const countBadge = document.getElementById("fraud-nav-badge");
  grid.innerHTML = "";

  if (isHistoricalMode && activeHistMonthKey === "trend") {
    grid.innerHTML = `<div style="grid-column: span 3; text-align:center; padding:32px; color:var(--t3);">Anomaly Alerts are disabled in Trend mode.</div>`;
    document.getElementById("kpi-critical-risk-count").innerText = "—";
    document.getElementById("kpi-high-risk-count").innerText = "—";
    
    const tbody = document.getElementById("centers-table");
    tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--t3);">Anomaly Alerts are disabled in Trend mode.</td></tr>`;
    document.getElementById("overspend-total-badge").innerText = "₹0 total";
    return;
  }

  const riskScores = computeFraudRiskScores();
  
  // 1. Filter by Hierarchical AOR
  let hierarchyFiltered = riskScores;
  if (selectedRiskAor.sd) {
    hierarchyFiltered = hierarchyFiltered.filter(r => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === r.name);
      return hc && hc.SD === selectedRiskAor.sd;
    });
  }
  if (selectedRiskAor.d) {
    hierarchyFiltered = hierarchyFiltered.filter(r => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === r.name);
      return hc && hc.D === selectedRiskAor.d;
    });
  }
  if (selectedRiskAor.sm) {
    hierarchyFiltered = hierarchyFiltered.filter(r => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === r.name);
      return hc && hc.SM === selectedRiskAor.sm;
    });
  }
  if (selectedRiskAor.stm) {
    hierarchyFiltered = hierarchyFiltered.filter(r => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === r.name);
      return hc && hc.STM === selectedRiskAor.stm;
    });
  }
  if (selectedRiskAor.center) {
    hierarchyFiltered = hierarchyFiltered.filter(r => r.name === selectedRiskAor.center);
  }

  // Update Badge Counts based on hierarchy filtered list
  const criticalCount = hierarchyFiltered.filter(r => r.score >= 60).length;
  const highCount = hierarchyFiltered.filter(r => r.score >= 40 && r.score < 60).length;
  document.getElementById("kpi-critical-risk-count").innerText = criticalCount;
  document.getElementById("kpi-high-risk-count").innerText = highCount;

  if (countBadge) {
    countBadge.innerText = criticalCount + highCount;
  }

  // 2. Filter by category multi-select (merged categories)
  let list = hierarchyFiltered;
  if (!activeFraudFilters.has("all")) {
    list = list.filter(r => {
      return r.triggers.some(t => activeFraudFilters.has(t.type));
    });
  }

  // Search filter
  if (fraudSearchQuery) {
    const q = fraudSearchQuery.toLowerCase();
    list = list.filter(r => r.name.toLowerCase().includes(q));
  }

  if (list.length === 0) {
    grid.innerHTML = `<div style="grid-column: span 3; text-align:center; padding:32px; color:var(--t3);">No risk alerts detected in this category.</div>`;
    return;
  }

  list.forEach(risk => {
    let riskClass = "risk-medium";
    if (risk.score >= 60) riskClass = "risk-critical";
    else if (risk.score >= 40) riskClass = "risk-high";

    const card = document.createElement("div");
    card.className = `fraud-card ${riskClass}`;
    card.onclick = () => openCenterModal(risk.name);

    let badges = "";
    risk.triggers.forEach(t => {
      const typeClass = t.type;
      badges += `<span class="signal-tag ${typeClass}">${t.cat.replace(" Expenses","")}</span>`;
    });

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
        <div>
          <div style="font-weight:800;font-size:14.5px;color:var(--text);">${risk.name}</div>
          <div style="font-size:11px;color:var(--t2);margin-top:2px;">${risk.triggers.length} indicators flagged</div>
        </div>
        <span style="font-size:13px;font-weight:800;font-family:var(--mono);color:var(--red);">${risk.score} Pts</span>
      </div>
      <div class="fraud-score-bar">
        <div class="fsb-track"><div class="fsb-fill" style="width:${risk.score}%;background-color:${risk.score >= 60 ? '#7F1D1D' : (risk.score >= 40 ? 'var(--red)' : 'var(--amber)')}"></div></div>
      </div>
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:4px;">${badges}</div>
    `;
    grid.appendChild(card);
  });

  // Populate Centers Table
  renderCentersTable();
}

function filterFraud(category, btn) {
  if (category === "all") {
    activeFraudFilters.clear();
    activeFraudFilters.add("all");
    document.querySelectorAll(".fraud-filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  } else {
    activeFraudFilters.delete("all");
    const allBtn = document.querySelector(".fraud-filter-btn[onclick*=\"'all'\"]");
    if (allBtn) allBtn.classList.remove("active");

    if (activeFraudFilters.has(category)) {
      activeFraudFilters.delete(category);
      btn.classList.remove("active");
    } else {
      activeFraudFilters.add(category);
      btn.classList.add("active");
    }

    if (activeFraudFilters.size === 0) {
      activeFraudFilters.add("all");
      if (allBtn) allBtn.classList.add("active");
    }
  }
  renderFraudSection();
}

function filterFraudSearch(val) {
  fraudSearchQuery = val;
  renderFraudSection();
}

function toggleKpiCentersPanel(level) {
  const panel = document.getElementById("kpi-centers-panel-ano");
  const grid = document.getElementById("kcp-ano-grid");
  const title = document.getElementById("kcp-ano-title");

  panel.classList.add("on");
  grid.innerHTML = "";

  const riskScores = computeFraudRiskScores();
  let list = [];
  if (level === "critical") {
    list = riskScores.filter(r => r.score >= 60);
    title.innerText = "🔴 Critical Risk Centers — Needs immediate freeze & audit";
  } else {
    list = riskScores.filter(r => r.score >= 40 && r.score < 60);
    title.innerText = "🟡 High Risk Centers — Needs immediate invoice review";
  }

  // Filter by Risk AOR Hierarchy
  if (selectedRiskAor.sd) {
    list = list.filter(r => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === r.name);
      return hc && hc.SD === selectedRiskAor.sd;
    });
  }
  if (selectedRiskAor.d) {
    list = list.filter(r => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === r.name);
      return hc && hc.D === selectedRiskAor.d;
    });
  }
  if (selectedRiskAor.sm) {
    list = list.filter(r => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === r.name);
      return hc && hc.SM === selectedRiskAor.sm;
    });
  }
  if (selectedRiskAor.stm) {
    list = list.filter(r => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === r.name);
      return hc && hc.STM === selectedRiskAor.stm;
    });
  }
  if (selectedRiskAor.center) {
    list = list.filter(r => r.name === selectedRiskAor.center);
  }

  if (list.length === 0) {
    grid.innerHTML = `<div style="grid-column:span 3;text-align:center;padding:24px;color:var(--t3);">No centers flagged.</div>`;
    return;
  }

  list.forEach((c, idx) => {
    const hc = D.allCenters.find(a => a["HQ Name"] === c.name) || { SD: "Unknown", D: "Unknown", SM: "Unknown" };
    const card = document.createElement("div");
    card.className = `kcp-card ${level === 'critical' ? 'critical-card' : 'high-card'}`;
    card.onclick = () => openCenterModal(c.name);

    card.innerHTML = `
      <div class="kcp-rank ${level === 'critical' ? 'r' : 'a'}">Rank #${idx + 1} &bull; Score: ${c.score}</div>
      <div class="kcp-name">${c.name}</div>
      <div class="kcp-path">${hc.SD} &bull; ${hc.D} &bull; SM: ${hc.SM}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <span class="kcp-over">${formatCurrency(c.over)}</span>
        <button class="view-detail-btn">Audit Center</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderCentersTable() {
  const tbody = document.getElementById("centers-table");
  tbody.innerHTML = "";

  const list = [];
  for (const name in filteredData.centerDetails) {
    const c = filteredData.centerDetails[name];
    if (c.over > 0) list.push(c);
  }
  list.sort((a,b) => b.over - a.over);

  let filtered = list;

  // Filter by Risk AOR Hierarchy
  if (selectedRiskAor.sd) {
    filtered = filtered.filter(c => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === c.name);
      return hc && hc.SD === selectedRiskAor.sd;
    });
  }
  if (selectedRiskAor.d) {
    filtered = filtered.filter(c => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === c.name);
      return hc && hc.D === selectedRiskAor.d;
    });
  }
  if (selectedRiskAor.sm) {
    filtered = filtered.filter(c => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === c.name);
      return hc && hc.SM === selectedRiskAor.sm;
    });
  }
  if (selectedRiskAor.stm) {
    filtered = filtered.filter(c => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === c.name);
      return hc && hc.STM === selectedRiskAor.stm;
    });
  }
  if (selectedRiskAor.center) {
    filtered = filtered.filter(c => c.name === selectedRiskAor.center);
  }

  // Filter by category multi-select (merged categories)
  const rScores = computeFraudRiskScores();
  if (!activeFraudFilters.has("all")) {
    filtered = filtered.filter(c => {
      const risk = rScores.find(r => r.name === c.name);
      return risk && risk.triggers.some(t => activeFraudFilters.has(t.type));
    });
  }

  // Search filter
  if (centersSearchQuery) {
    const q = centersSearchQuery.toLowerCase();
    filtered = filtered.filter(c => {
      const hc = D.allCenters.find(ac => ac["HQ Name"] === c.name) || { SD: "", SM: "" };
      return c.name.toLowerCase().includes(q) || hc.SD.toLowerCase().includes(q) || hc.SM.toLowerCase().includes(q);
    });
  }

  const totalOverFiltered = filtered.reduce((acc, c) => acc + c.over, 0);
  document.getElementById("overspend-total-badge").innerText = `${formatCurrency(totalOverFiltered)} total`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--t3);">No centers found.</td></tr>`;
    return;
  }

  // Pre-calculate risk scores once to avoid nested O(N*M*K) layout freezes
  const rScores = computeFraudRiskScores();

  filtered.forEach((c, idx) => {
    const hc = D.allCenters.find(ac => ac["HQ Name"] === c.name) || { SD: "Unknown", D: "Unknown", SM: "Unknown" };
    const risk = rScores.find(r => r.name === c.name) || { score: 0 };
    
    let badgeClass = "normal";
    if (risk.score >= 60) badgeClass = "critical";
    else if (risk.score >= 30) badgeClass = "high";

    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.onclick = () => openCenterModal(c.name);

    tr.innerHTML = `
      <td class="num">${idx + 1}</td>
      <td class="tn">${c.name}</td>
      <td>${hc.SD}</td>
      <td>${hc.SM}</td>
      <td class="num">${formatCurrency(c.total)}</td>
      <td class="num" style="color:var(--red);font-weight:700;">${formatCurrency(c.over)}</td>
      <td class="num" style="text-align:center;">${risk.score}</td>
      <td style="text-align:center;"><span class="bdg ${badgeClass}">${risk.score >= 60 ? 'Critical' : (risk.score >= 30 ? 'High' : 'Low')}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function filterCenters(val) {
  centersSearchQuery = val;
  renderCentersTable();
}

function toggleDrop(id, header) {
  const body = document.getElementById(id);
  body.classList.toggle("on");
  header.classList.toggle("open");
}

// ── DRILL DOWN MODAL AND CHARTS ──
function openCenterModal(centerName) {
  activeModalCenterName = centerName;
  const center = filteredData.centerDetails[centerName];
  if (!center) return;

  const hc = D.allCenters.find(a => a["HQ Name"] === centerName) || { SD: "Unknown SD", D: "Unknown Div", SM: "Unknown SM", STM: "Unknown STM" };
  const rScores = computeFraudRiskScores();
  const risk = rScores.find(r => r.name === centerName) || { score: 0 };

  document.getElementById("modal-title").innerText = centerName;
  document.getElementById("modal-meta").innerText = `${hc.SD} ➔ ${hc.D} ➔ SM: ${hc.SM} ➔ STM: ${hc.STM}`;

  const kpis = document.getElementById("modal-kpis");
  kpis.innerHTML = `
    <div class="mk"><div class="mk-l">Total Spend</div><div class="mk-v">${formatCurrency(center.total)}</div></div>
    <div class="mk"><div class="mk-l" style="color:var(--red);">Leakage Overspend</div><div class="mk-v" style="color:var(--red);">${formatCurrency(center.over)}</div></div>
    <div class="mk"><div class="mk-l" style="color:var(--green);">Capped Portions</div><div class="mk-v" style="color:var(--green);">${formatCurrency(center.total - center.over)}</div></div>
    <div class="mk"><div class="mk-l">Risk Audit Rating</div><div class="mk-v" style="color:${risk.score >= 50 ? 'var(--red)' : 'var(--green)'};">${risk.score >= 60 ? 'CRITICAL' : (risk.score >= 40 ? 'HIGH' : 'LOW')} (${risk.score} Pts)</div></div>
  `;

  // Dynamic details cards
  const cardsContainer = document.getElementById("modal-cat-cards-container");
  cardsContainer.innerHTML = "";

  if (center.cats && !Array.isArray(center.cats)) {
    center.cats = [center.cats];
  }
  if (!center.cats) center.cats = [];
  center.cats.forEach(cat => {
    const isOver = cat.over > 0;
    const pct = Math.min(100, Math.round((cat.spend / Math.max(1, cat.cap)) * 100));
    const card = document.createElement("div");
    card.className = `cat-card ${isOver ? 'over' : ''}`;

    card.innerHTML = `
      <div class="cat-card-top">
        <div class="cat-card-name">${cat.cat.replace(" Expenses","")}</div>
        <div style="font-size:11.5px;color:var(--t2);font-weight:700;">
          ${formatCurrency(cat.spend)} <span style="font-weight:400;color:var(--t3);">/ ${formatCurrency(cat.cap)} limit</span>
        </div>
      </div>
      <div class="cat-bar">
        <div class="cat-bg">
          <div class="cat-fill ${isOver ? 'over' : ''}" style="width:${pct}%"></div>
        </div>
      </div>
    `;
    cardsContainer.appendChild(card);
  });

  // Render Charts
  setTimeout(() => renderModalCharts(centerName, center), 150);

  document.getElementById("modal-overlay").classList.add("on");
}

function renderModalCharts(centerName, center) {
  const line = document.getElementById("modal-monthly");
  if (!line) return;
  const ctx = line.getContext("2d");
  if (modalMonthlyChart) modalMonthlyChart.destroy();

  const monthlySums = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  D.raw.forEach(t => {
    if (t["Center Name"] === centerName && t.Status === "Approved") {
      const m = parseInt(t["Bill Date"].split("-")[1], 10);
      if (monthlySums[m] !== undefined) {
        monthlySums[m] += t["Total Bill Amount"];
      }
    }
  });

  modalMonthlyChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: ["Jan 26", "Feb 26", "Mar 26", "Apr 26", "May 26"],
      datasets: [
        {
          label: "Expenditure Trend (INR)",
          data: [
            Math.round(monthlySums[1]),
            Math.round(monthlySums[2]),
            Math.round(monthlySums[3]),
            Math.round(monthlySums[4]),
            Math.round(monthlySums[5])
          ],
          borderColor: CHART_COLORS.blue,
          borderWidth: 3,
          tension: 0.1,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

function closeModal() {
  document.getElementById("modal-overlay").classList.remove("on");
}

function downloadCenterData() {
  if (!activeModalCenterName) return;
  const center = filteredData.centerDetails[activeModalCenterName];
  if (!center) return;

  let csv = "Category,Spend,Limit Cap,Overspend\r\n";
  center.cats.forEach(c => {
    csv += `"${c.cat}","${c.spend}","${c.cap}","${c.over}"\r\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const monthNames = { 1: "January", 2: "February", 3: "March", 4: "April", 5: "May" };
  const mName = monthNames[currentMonth] || "Month";
  link.setAttribute("download", `${activeModalCenterName}_audit_${mName}_2026.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ── UTILITY HELPERS ──
function formatCurrency(val) {
  const format = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Math.abs(val));
  return val < 0 ? `-${format}` : format;
}

function scrollToElement(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

// ── HISTORICAL INDIVIDUAL MONTH DASHBOARDS ──
function refreshHistoricalDashboard(monthKey) {
  const hData = D.hist && D.hist[monthKey] ? D.hist[monthKey] : null;
  if (!hData) return;

  filteredData = hData;
  updateUI();
}

function renderHistoricalUnifiedChart(cats) {
  const canvas = document.getElementById("unifiedChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (unifiedChart) unifiedChart.destroy();

  const list = Object.keys(cats).map(k => ({ name: k, total: cats[k] }));
  list.sort((a,b) => b.total - a.total);
  const top6 = list.slice(0, 6);

  const labels = top6.map(c => c.name.replace(" Expenses","").replace(" Expense", ""));
  const spends = top6.map(c => Math.round(c.total));

  unifiedChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        { label: "Approved Spend (INR)", data: spends, backgroundColor: "#3B82F6", borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { position: "top" } }
    }
  });
}

function renderHistoricalCategoryOverviewGrid(cats) {
  const grid = document.getElementById("cat-ov-grid");
  grid.innerHTML = "";

  const list = Object.keys(cats).map(k => ({ name: k, total: cats[k] }));
  list.sort((a,b) => b.total - a.total);
  const top4 = list.slice(0, 4);

  top4.forEach(cat => {
    const card = document.createElement("div");
    card.className = "cat-ov-card";
    card.style.cursor = "default";

    card.innerHTML = `
      <div class="cat-ov-name" title="${cat.name}">${cat.name.replace(" Expenses", "")}</div>
      <div class="cat-ov-val">${formatCurrency(cat.total)}</div>
      <div style="font-size:10.5px;color:var(--t3);margin-top:3px;">Historical Spend</div>
      <div class="cat-ov-bar"><div class="cat-ov-fill" style="width:100%;background-color:var(--blue)"></div></div>
    `;
    grid.appendChild(card);
  });
}

function renderHistoricalSDView(sds) {
  const body = document.getElementById("hier-body");
  body.innerHTML = "";
  
  document.getElementById("hier-month-head").innerText = "Senior Director Performance Summary";
  document.getElementById("hier-month-subhead").innerText = "Pre-aggregated SD total expenditures for the selected historical month";

  const list = Object.keys(sds).map(k => ({ name: k, total: sds[k] }));
  list.sort((a,b) => b.total - a.total);

  list.forEach((sd, idx) => {
    const row = document.createElement("div");
    row.className = "sd-row";
    row.style.cursor = "default";
    
    row.innerHTML = `
      <div></div>
      <div class="tn"><span class="lp lp-sd">SD</span> ${sd.name}</div>
      <div class="num">${formatCurrency(sd.total)}</div>
      <div class="num">—</div>
      <div class="num">—</div>
      <div style="text-align:center;">—</div>
      <div style="text-align:center;"><span class="lp lp-c">Historical</span></div>
    `;
    body.appendChild(row);
  });
}
