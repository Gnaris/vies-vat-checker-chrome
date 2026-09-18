"use strict";

const VIES_ENDPOINT = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const CONCURRENCY = 4;
const RETRY_DELAYS_MS = [600, 1800, 4500];

const EU_COUNTRIES = new Set([
  "AT","BE","BG","CY","CZ","DE","DK","EE","EL","ES","FI","FR","HR","HU",
  "IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","XI"
]);

const els = {
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  stepUpload: document.getElementById("stepUpload"),
  stepColumn: document.getElementById("stepColumn"),
  stepProgress: document.getElementById("stepProgress"),
  stepResults: document.getElementById("stepResults"),
  fileName: document.getElementById("fileName"),
  sheetSelect: document.getElementById("sheetSelect"),
  columnSelect: document.getElementById("columnSelect"),
  hasHeader: document.getElementById("hasHeader"),
  preview: document.getElementById("preview"),
  checkBtn: document.getElementById("checkBtn"),
  checkCount: document.getElementById("checkCount"),
  resetBtn: document.getElementById("resetBtn"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),
  cancelBtn: document.getElementById("cancelBtn"),
  statOk: document.getElementById("statOk"),
  statKo: document.getElementById("statKo"),
  statErr: document.getElementById("statErr"),
  resultsTable: document.getElementById("resultsTable").querySelector("tbody"),
  filterOnlyProblems: document.getElementById("filterOnlyProblems"),
  retryBtn: document.getElementById("retryBtn"),
  copyBtn: document.getElementById("copyBtn"),
  restartBtn: document.getElementById("restartBtn"),
};

let workbook = null;
let currentFileName = "";
let currentSheetName = "";
let sheetRows = [];
let cancelRequested = false;
let lastResults = [];

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function showStep(name) {
  ["stepUpload", "stepColumn", "stepProgress", "stepResults"].forEach(k => {
    els[k].classList.toggle("hidden", k !== name);
  });
}

els.dropZone.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", e => {
  if (e.target.files.length) loadFile(e.target.files[0]);
});

["dragenter", "dragover"].forEach(ev => {
  els.dropZone.addEventListener(ev, e => {
    e.preventDefault();
    els.dropZone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach(ev => {
  els.dropZone.addEventListener(ev, e => {
    e.preventDefault();
    els.dropZone.classList.remove("dragover");
  });
});
els.dropZone.addEventListener("drop", e => {
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

async function loadFile(file) {
  try {
    currentFileName = file.name;
    const buf = await file.arrayBuffer();
    workbook = XLSX.read(buf, { type: "array" });
    if (!workbook.SheetNames.length) throw new Error("Fichier vide.");
    els.fileName.textContent = file.name;
    populateSheetSelect();
    onSheetChange();
    showStep("stepColumn");
  } catch (err) {
    alert("Impossible de lire le fichier : " + err.message);
    console.error(err);
  }
}

function populateSheetSelect() {
  clearNode(els.sheetSelect);
  workbook.SheetNames.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    els.sheetSelect.appendChild(opt);
  });
}

els.sheetSelect.addEventListener("change", onSheetChange);
els.hasHeader.addEventListener("change", refreshPreview);
els.columnSelect.addEventListener("change", refreshPreview);
els.resetBtn.addEventListener("click", resetAll);
els.restartBtn.addEventListener("click", resetAll);

function onSheetChange() {
  currentSheetName = els.sheetSelect.value;
  const sheet = workbook.Sheets[currentSheetName];
  sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
  populateColumnSelect();
  refreshPreview();
}

function columnLetter(index) {
  let s = "";
  let n = index;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function populateColumnSelect() {
  clearNode(els.columnSelect);
  const width = sheetRows.reduce((m, r) => Math.max(m, r.length), 0);
  const header = sheetRows[0] || [];
  let guessed = -1;
  for (let i = 0; i < width; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    const headText = (header[i] || "").toString().trim();
    opt.textContent = headText
      ? `${columnLetter(i)} — ${headText}`
      : `Colonne ${columnLetter(i)}`;
    els.columnSelect.appendChild(opt);
    if (guessed < 0 && /tva|vat|vies/i.test(headText)) guessed = i;
  }
  if (guessed < 0) {
    for (let i = 0; i < width && guessed < 0; i++) {
      for (let r = 1; r < Math.min(sheetRows.length, 6); r++) {
        const cell = (sheetRows[r][i] || "").toString().trim().toUpperCase();
        if (/^[A-Z]{2}[A-Z0-9]{6,14}$/.test(cell)) { guessed = i; break; }
      }
    }
  }
  els.columnSelect.value = String(guessed >= 0 ? guessed : 0);
}

function refreshPreview() {
  const colIdx = parseInt(els.columnSelect.value, 10);
  const startRow = els.hasHeader.checked ? 1 : 0;
  const values = [];
  for (let r = startRow; r < sheetRows.length && values.length < 5; r++) {
    const v = (sheetRows[r][colIdx] || "").toString().trim();
    if (v) values.push({ row: r + 1, val: v });
  }
  clearNode(els.preview);
  if (!values.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "(colonne vide)";
    els.preview.appendChild(li);
    els.checkBtn.disabled = true;
    els.checkCount.textContent = "";
    return;
  }
  values.forEach(({ row, val }) => {
    const li = document.createElement("li");
    li.textContent = `Ligne ${row} : ${val}`;
    els.preview.appendChild(li);
  });
  const total = countTargets(colIdx, startRow);
  els.checkCount.textContent = `(${total})`;
  els.checkBtn.disabled = total === 0;
}

function countTargets(colIdx, startRow) {
  let n = 0;
  for (let r = startRow; r < sheetRows.length; r++) {
    const v = (sheetRows[r][colIdx] || "").toString().trim();
    if (v) n++;
  }
  return n;
}

els.checkBtn.addEventListener("click", startCheck);
els.cancelBtn.addEventListener("click", () => { cancelRequested = true; });

async function startCheck() {
  const colIdx = parseInt(els.columnSelect.value, 10);
  const startRow = els.hasHeader.checked ? 1 : 0;
  const targets = [];
  for (let r = startRow; r < sheetRows.length; r++) {
    const v = (sheetRows[r][colIdx] || "").toString().trim();
    if (v) targets.push({ excelRow: r + 1, raw: v });
  }
  if (!targets.length) return;

  cancelRequested = false;
  showStep("stepProgress");
  els.progressBar.style.width = "0%";
  els.progressText.textContent = `0 / ${targets.length}`;

  const results = new Array(targets.length);
  let done = 0;

  async function processOne(i) {
    if (cancelRequested) return;
    const t = targets[i];
    const parsed = parseVat(t.raw);
    let r;
    if (!parsed) {
      r = { ...t, status: "invalid-format", detail: "Format inconnu (attendu : 2 lettres pays + chiffres)" };
    } else {
      r = { ...t, country: parsed.country, number: parsed.number };
      const remote = await checkViesWithRetry(parsed.country, parsed.number);
      Object.assign(r, remote);
    }
    results[i] = r;
    done++;
    const pct = Math.round((done / targets.length) * 100);
    els.progressBar.style.width = pct + "%";
    els.progressText.textContent = `${done} / ${targets.length}`;
  }

  await runWithConcurrency(targets.length, CONCURRENCY, processOne);

  lastResults = results.filter(Boolean);
  renderResults();
  showStep("stepResults");
}

function parseVat(raw) {
  const cleaned = raw.toUpperCase().replace(/[\s.\-/]/g, "");
  const m = cleaned.match(/^([A-Z]{2})([A-Z0-9]+)$/);
  if (!m) return null;
  const country = m[1] === "GR" ? "EL" : m[1];
  return { country, number: m[2] };
}

async function runWithConcurrency(total, limit, worker) {
  let next = 0;
  async function runner() {
    while (next < total && !cancelRequested) {
      const i = next++;
      await worker(i);
    }
  }
  const runners = [];
  for (let k = 0; k < Math.min(limit, total); k++) runners.push(runner());
  await Promise.all(runners);
}

async function checkViesWithRetry(country, number) {
  let last = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (cancelRequested) return { status: "network-error", detail: "Annulé" };
    last = await checkVies(country, number);
    if (last.status !== "network-error") return last;
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  return {
    ...last,
    detail: `${last.detail} — 3 essais échoués, vérifier manuellement sur VIES`
  };
}

async function checkVies(country, number) {
  if (!EU_COUNTRIES.has(country)) {
    return { status: "invalid-country", detail: `Code pays "${country}" non couvert par VIES` };
  }
  try {
    const resp = await fetch(VIES_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        countryCode: country,
        vatNumber: number,
        requesterMemberStateCode: "",
        requesterNumber: "",
        traderName: "",
        traderStreet: "",
        traderPostalCode: "",
        traderCity: "",
        traderCompanyType: ""
      })
    });
    if (!resp.ok) {
      return { status: "network-error", detail: `HTTP ${resp.status}` };
    }
    const data = await resp.json();
    const errCode = data.userError || data.errorWrappers?.[0]?.error || data.actionSucceed === false && "SERVICE_ERROR";
    if (errCode) {
      return { status: "network-error", detail: viesErrorLabel(errCode) };
    }
    if (data.valid === true) {
      const name = (data.traderName || data.name || "").toString().trim();
      return { status: "valid", detail: name || "Numéro valide" };
    }
    return { status: "invalid", detail: "Numéro non reconnu par VIES" };
  } catch (err) {
    return { status: "network-error", detail: err.message || "Erreur réseau" };
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

els.filterOnlyProblems.addEventListener("change", renderResults);
els.copyBtn.addEventListener("click", copyProblems);
els.retryBtn.addEventListener("click", retryFailed);

async function retryFailed() {
  const failedIndexes = lastResults
    .map((r, i) => (r.status === "network-error" ? i : -1))
    .filter(i => i >= 0);
  if (!failedIndexes.length) {
    els.retryBtn.textContent = "Aucun échec";
    setTimeout(() => els.retryBtn.textContent = "Réessayer les échecs", 1500);
    return;
  }
  els.retryBtn.disabled = true;
  const originalLabel = "Réessayer les échecs";
  let done = 0;
  cancelRequested = false;
  await runWithConcurrency(failedIndexes.length, CONCURRENCY, async (k) => {
    const i = failedIndexes[k];
    const r = lastResults[i];
    const parsed = parseVat(r.raw);
    if (parsed) {
      const remote = await checkViesWithRetry(parsed.country, parsed.number);
      lastResults[i] = { ...r, ...remote, country: parsed.country, number: parsed.number };
    }
    done++;
    els.retryBtn.textContent = `Réessai ${done} / ${failedIndexes.length}…`;
    renderResults();
  });
  els.retryBtn.disabled = false;
  els.retryBtn.textContent = originalLabel;
}

function renderResults() {
  const onlyProblems = els.filterOnlyProblems.checked;
  const okCount = lastResults.filter(r => r.status === "valid").length;
  const koCount = lastResults.filter(r => r.status === "invalid" || r.status === "invalid-format" || r.status === "invalid-country").length;
  const errCount = lastResults.filter(r => r.status === "network-error").length;
  els.statOk.textContent = okCount;
  els.statKo.textContent = koCount;
  els.statErr.textContent = errCount;

  clearNode(els.resultsTable);
  const shown = onlyProblems ? lastResults.filter(r => r.status !== "valid") : lastResults;
  if (!shown.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "muted";
    td.style.textAlign = "center";
    td.style.padding = "24px";
    td.textContent = onlyProblems
      ? "Aucun problème détecté. Tous les numéros de TVA sont valides."
      : "Aucun résultat.";
    tr.appendChild(td);
    els.resultsTable.appendChild(tr);
    return;
  }
  shown.forEach(r => {
    const tr = document.createElement("tr");
    if (r.status === "valid") tr.classList.add("row-ok");
    else if (r.status === "network-error") tr.classList.add("row-err");
    else tr.classList.add("row-ko");

    const c1 = document.createElement("td");
    c1.textContent = r.excelRow;
    tr.appendChild(c1);

    const c2 = document.createElement("td");
    c2.className = "mono";
    c2.textContent = r.raw;
    tr.appendChild(c2);

    const c3 = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge " + (r.status === "valid" ? "badge-ok" : r.status === "network-error" ? "badge-warn" : "badge-ko");
    badge.textContent = statusLabel(r.status);
    c3.appendChild(badge);
    tr.appendChild(c3);

    const c4 = document.createElement("td");
    c4.textContent = r.detail || "";
    tr.appendChild(c4);

    els.resultsTable.appendChild(tr);
  });
}

function viesErrorLabel(code) {
  const map = {
    MS_UNAVAILABLE: "Service fiscal du pays indisponible — réessayer plus tard",
    MS_MAX_CONCURRENT_REQ: "Trop de requêtes vers ce pays — réessayer dans quelques minutes",
    SERVER_BUSY: "Serveur VIES surchargé — réessayer",
    TIMEOUT: "Délai dépassé côté VIES — réessayer",
    SERVICE_UNAVAILABLE: "Service VIES indisponible — réessayer",
    SERVICE_ERROR: "VIES a renvoyé une erreur sans détail — réessayer",
    GLOBAL_MAX_CONCURRENT_REQ: "Limite globale VIES atteinte — réessayer",
    INVALID_INPUT: "Format refusé par VIES",
    INVALID_REQUESTER_INFO: "Informations demandeur invalides"
  };
  return map[code] || `VIES : ${code}`;
}

function statusLabel(s) {
  switch (s) {
    case "valid": return "Valide";
    case "invalid": return "Non reconnu";
    case "invalid-format": return "Format invalide";
    case "invalid-country": return "Pays inconnu";
    case "network-error": return "Erreur réseau";
    default: return s;
  }
}

async function copyProblems() {
  const problems = lastResults.filter(r => r.status !== "valid");
  if (!problems.length) {
    els.copyBtn.textContent = "Rien à copier";
    setTimeout(() => els.copyBtn.textContent = "Copier la liste", 1500);
    return;
  }
  const lines = ["Ligne\tNuméro TVA\tStatut\tDétail"];
  problems.forEach(r => {
    lines.push([r.excelRow, r.raw, statusLabel(r.status), r.detail].join("\t"));
  });
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    els.copyBtn.textContent = "Copié !";
    setTimeout(() => els.copyBtn.textContent = "Copier la liste", 1500);
  } catch {
    els.copyBtn.textContent = "Erreur copie";
    setTimeout(() => els.copyBtn.textContent = "Copier la liste", 1500);
  }
}

function resetAll() {
  workbook = null;
  sheetRows = [];
  lastResults = [];
  els.fileInput.value = "";
  clearNode(els.resultsTable);
  showStep("stepUpload");
}
