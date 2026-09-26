"use strict";

const state = {
  parsedSage: null,
  selectedPeriod: null,
  cancelRequested: false,
  lastClassification: null,
  lastEntries: [],
  lastPeriodKey: null,
  editingArticleCode: null
};

const $ = (id) => document.getElementById(id);
const clearNode = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };

document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupConfigTab();
  setupArticlesTab();
  setupDeclarationTab();
  await refreshConfigBanner();
  await renderArticlesTable();
});

// =====================================================================
// Tabs navigation
// =====================================================================
function setupTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
  document.querySelectorAll("[data-goto]").forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.goto));
  });
}

function activateTab(tabId) {
  document.querySelectorAll(".tab").forEach(t => {
    t.classList.toggle("active", t.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-panel").forEach(p => {
    p.classList.toggle("active", p.id === tabId);
  });
}

// =====================================================================
// Configuration tab
// =====================================================================
function setupConfigTab() {
  $("cfgSaveBtn").addEventListener("click", saveConfig);
  loadConfigIntoForm();
}

async function loadConfigIntoForm() {
  const d = await window.Store.getDeclarant();
  $("cfgNomEntreprise").value = d.nomEntreprise || "";
  $("cfgNii").value = d.nii || "";
  $("cfgDepartement").value = d.departement || "";
}

async function saveConfig() {
  const declarant = {
    nomEntreprise: $("cfgNomEntreprise").value.trim(),
    nii: $("cfgNii").value.trim().toUpperCase().replace(/\s/g, ""),
    departement: $("cfgDepartement").value.trim()
  };
  const errors = window.Validators.validateDeclarant(declarant);
  const errEl = $("cfgError");
  const okEl = $("cfgSaved");
  if (errors.length) {
    errEl.textContent = "⚠ " + errors.join(" · ");
    errEl.classList.remove("hidden");
    okEl.classList.add("hidden");
    return;
  }
  await window.Store.saveDeclarant(declarant);
  $("cfgNii").value = declarant.nii;
  errEl.classList.add("hidden");
  okEl.classList.remove("hidden");
  setTimeout(() => okEl.classList.add("hidden"), 2500);
  await refreshConfigBanner();
}

async function refreshConfigBanner() {
  const declarant = await window.Store.getDeclarant();
  const errors = window.Validators.validateDeclarant(declarant);
  const articles = await window.Store.getArticles();
  const nArticles = Object.keys(articles).length;

  const banner = $("declBanner");
  const detail = $("declBannerDetail");
  const missing = [];
  if (errors.length) missing.push("configuration déclarant (nom, NII, département)");
  if (nArticles === 0) missing.push("aucun article mappé");

  if (missing.length) {
    detail.textContent = " À compléter avant de pouvoir générer une déclaration : " + missing.join(" · ") + ".";
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

// =====================================================================
// Articles tab
// =====================================================================
function setupArticlesTab() {
  $("addArticleBtn").addEventListener("click", () => openArticleModal(null));
  $("articleCancelBtn").addEventListener("click", closeArticleModal);
  $("articleSaveBtn").addEventListener("click", saveArticleFromModal);
  $("importArticlesBtn").addEventListener("click", () => $("articlesFileInput").click());
  $("articlesFileInput").addEventListener("change", handleArticlesImport);
  $("exportArticlesBtn").addEventListener("click", exportArticlesExcel);
  $("articleSearch").addEventListener("input", renderArticlesTable);
}

async function renderArticlesTable() {
  const articles = await window.Store.getArticles();
  const tbody = $("articlesTable").querySelector("tbody");
  const empty = $("articlesEmpty");
  const filter = $("articleSearch").value.trim().toLowerCase();
  clearNode(tbody);

  const keys = Object.keys(articles).sort();
  if (keys.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const filtered = keys.filter(k => {
    if (!filter) return true;
    const a = articles[k];
    return (k.toLowerCase().includes(filter)
      || (a.description || "").toLowerCase().includes(filter)
      || (a.codeSH || "").toLowerCase().includes(filter)
      || (a.paysOrigine || "").toLowerCase().includes(filter));
  });

  filtered.forEach(code => {
    const a = articles[code];
    const tr = document.createElement("tr");
    [code, a.description || "", a.codeSH || "", a.paysOrigine || "", a.poidsNet || 0].forEach(v => {
      const td = document.createElement("td");
      td.textContent = String(v);
      if (v === code || a.codeSH === v) td.classList.add("mono");
      tr.appendChild(td);
    });
    const tdAct = document.createElement("td");
    const editBtn = document.createElement("button");
    editBtn.className = "btn-icon";
    editBtn.textContent = "Modifier";
    editBtn.addEventListener("click", () => openArticleModal(code));
    const delBtn = document.createElement("button");
    delBtn.className = "btn-icon danger";
    delBtn.textContent = "Supprimer";
    delBtn.addEventListener("click", () => deleteArticleWithConfirm(code));
    tdAct.appendChild(editBtn);
    tdAct.appendChild(delBtn);
    tr.appendChild(tdAct);
    tbody.appendChild(tr);
  });
}

async function openArticleModal(code) {
  state.editingArticleCode = code;
  $("articleFormError").classList.add("hidden");
  if (code) {
    const articles = await window.Store.getArticles();
    const a = articles[code] || {};
    $("articleModalTitle").textContent = `Modifier ${code}`;
    $("articleCode").value = code;
    $("articleCode").disabled = true;
    $("articleDescription").value = a.description || "";
    $("articleCodeSH").value = a.codeSH || "";
    $("articlePaysOrigine").value = a.paysOrigine || "";
    $("articlePoidsNet").value = a.poidsNet || "";
  } else {
    $("articleModalTitle").textContent = "Ajouter un article";
    $("articleCode").value = "";
    $("articleCode").disabled = false;
    $("articleDescription").value = "";
    $("articleCodeSH").value = "";
    $("articlePaysOrigine").value = "";
    $("articlePoidsNet").value = "";
  }
  $("articleModal").classList.remove("hidden");
}

function closeArticleModal() {
  $("articleModal").classList.add("hidden");
  state.editingArticleCode = null;
}

async function saveArticleFromModal() {
  const code = $("articleCode").value.trim();
  const description = $("articleDescription").value.trim();
  const codeSH = $("articleCodeSH").value.trim().replace(/\s/g, "");
  const paysOrigine = $("articlePaysOrigine").value.trim().toUpperCase();
  const poidsRaw = String($("articlePoidsNet").value).replace(",", ".").trim();
  const poidsNet = parseFloat(poidsRaw);

  const errs = [];
  if (!code) errs.push("Code article obligatoire");
  if (!codeSH) errs.push("Code SH8 obligatoire (8 chiffres, ex. 71171900)");
  else if (!/^\d{6,10}$/.test(codeSH)) errs.push(`Code SH8 invalide : "${codeSH}" — attendu 6 à 10 chiffres`);
  if (!paysOrigine) errs.push("Pays d'origine obligatoire (2 lettres, ex. IT)");
  else if (!/^[A-Z]{2}$/.test(paysOrigine)) errs.push(`Pays d'origine invalide : "${paysOrigine}" — attendu 2 lettres (ex. IT, DE, CN)`);
  if (!poidsRaw) errs.push("Poids net obligatoire (ex. 0.020 pour 20 grammes)");
  else if (!isFinite(poidsNet) || poidsNet <= 0) errs.push(`Poids net invalide : "${poidsRaw}" — attendu un nombre décimal avec point (ex. 0.020)`);

  const el = $("articleFormError");
  if (errs.length) {
    clearNode(el);
    const strong = document.createElement("strong");
    strong.textContent = "⚠ Impossible d'enregistrer :";
    el.appendChild(strong);
    const ul = document.createElement("ul");
    ul.style.margin = "6px 0 0 20px";
    errs.forEach(e => {
      const li = document.createElement("li");
      li.textContent = e;
      ul.appendChild(li);
    });
    el.appendChild(ul);
    el.classList.remove("hidden");
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  el.classList.add("hidden");

  await window.Store.upsertArticle(code, { description, codeSH, paysOrigine, poidsNet });
  closeArticleModal();
  await renderArticlesTable();
  await refreshConfigBanner();
}

async function deleteArticleWithConfirm(code) {
  if (!confirm(`Supprimer l'article "${code}" ?`)) return;
  await window.Store.deleteArticle(code);
  await renderArticlesTable();
  await refreshConfigBanner();
}

async function handleArticlesImport(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
    if (!rows.length) throw new Error("Fichier vide.");

    const headerRow = rows[0].map(h => String(h).toLowerCase().trim());
    const colCode = headerRow.findIndex(h => h.includes("code article") || h === "code");
    const colDesc = headerRow.findIndex(h => h.includes("description") || h.includes("libell"));
    const colSH = headerRow.findIndex(h => h.includes("sh") || h.includes("nomenclat"));
    const colPays = headerRow.findIndex(h => h.includes("origine") || h.includes("pays"));
    const colPoids = headerRow.findIndex(h => h.includes("poids") || h.includes("kg"));

    if (colCode < 0 || colSH < 0 || colPays < 0 || colPoids < 0) {
      throw new Error("Colonnes attendues : Code article, Description, Code SH, Pays origine, Poids net. Une ou plusieurs sont manquantes.");
    }

    const articles = await window.Store.getArticles();
    let imported = 0;
    let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const code = String(r[colCode] || "").trim();
      if (!code) continue;
      const codeSH = String(r[colSH] || "").trim().replace(/\s/g, "");
      const paysOrigine = String(r[colPays] || "").trim().toUpperCase();
      const poidsNet = parseFloat(String(r[colPoids] || "").replace(",", "."));
      const description = colDesc >= 0 ? String(r[colDesc] || "").trim() : "";
      if (!/^\d{6,10}$/.test(codeSH) || !/^[A-Z]{2}$/.test(paysOrigine) || !isFinite(poidsNet) || poidsNet <= 0) {
        skipped++;
        continue;
      }
      articles[code] = { description, codeSH, paysOrigine, poidsNet };
      imported++;
    }
    await window.Store.saveArticles(articles);
    await renderArticlesTable();
    await refreshConfigBanner();
    alert(`Import terminé : ${imported} article(s) enregistré(s), ${skipped} ligne(s) ignorée(s).`);
  } catch (err) {
    alert("Erreur import : " + err.message);
  } finally {
    ev.target.value = "";
  }
}

async function exportArticlesExcel() {
  const articles = await window.Store.getArticles();
  const keys = Object.keys(articles).sort();
  if (keys.length === 0) {
    alert("Aucun article à exporter.");
    return;
  }
  const aoa = [["Code article", "Description", "Code SH8", "Pays origine", "Poids net (kg)"]];
  keys.forEach(k => {
    const a = articles[k];
    aoa.push([k, a.description || "", a.codeSH, a.paysOrigine, a.poidsNet]);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Articles");
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  window.Generators.triggerDownload(blob, "articles_mapping.xlsx");
}

// =====================================================================
// Declaration tab
// =====================================================================
function setupDeclarationTab() {
  const dz = $("sageDropZone");
  const fi = $("sageFileInput");
  dz.addEventListener("click", () => fi.click());
  fi.addEventListener("change", e => { if (e.target.files.length) loadSageFile(e.target.files[0]); });
  ["dragenter", "dragover"].forEach(ev => {
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("dragover"); });
  });
  ["dragleave", "drop"].forEach(ev => {
    dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("dragover"); });
  });
  dz.addEventListener("drop", e => {
    const f = e.dataTransfer.files[0];
    if (f) loadSageFile(f);
  });
  $("sageResetBtn").addEventListener("click", resetSage);
  $("restartBtn").addEventListener("click", resetSage);
  $("restartBlockedBtn").addEventListener("click", resetSage);
  $("analyzeBtn").addEventListener("click", startAnalysis);
  $("cancelAnalyzeBtn").addEventListener("click", () => { state.cancelRequested = true; });
  $("periodShowAll").addEventListener("change", renderPeriodPreview);
  $("periodSelect").addEventListener("change", renderPeriodPreview);
  $("downloadErtvaBtn").addEventListener("click", downloadErtva);
  $("downloadDebBtn").addEventListener("click", downloadDeb);
  $("okShowIgnoredBtn").addEventListener("click", showIgnoredInline);
}

function showStep(stepId) {
  ["stepSageUpload","stepSagePeriod","stepAnalyze","stepResultOk","stepResultBlocked"].forEach(id => {
    $(id).classList.toggle("hidden", id !== stepId);
  });
}

function resetSage() {
  state.parsedSage = null;
  state.selectedPeriod = null;
  state.lastClassification = null;
  state.lastEntries = [];
  state.lastPeriodKey = null;
  $("sageFileInput").value = "";
  showStep("stepSageUpload");
}

async function loadSageFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const parsed = window.Sage.parseSageTxt(buf);
    if (parsed.warnings.length) {
      alert("Problèmes détectés dans le fichier :\n\n" + parsed.warnings.join("\n"));
      return;
    }
    if (!parsed.factures.length) {
      alert("Aucune facture détectée dans le fichier.");
      return;
    }
    state.parsedSage = parsed;
    $("sageFileName").textContent = file.name;
    populatePeriodSelect();
    updateSageSummary();
    renderPeriodPreview();
    showStep("stepSagePeriod");
  } catch (err) {
    alert("Impossible de lire le fichier : " + err.message);
    console.error(err);
  }
}

function populatePeriodSelect() {
  const periods = window.Validators.detectPeriods(state.parsedSage.factures);
  const sel = $("periodSelect");
  clearNode(sel);
  if (periods.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(aucune facture UE datée)";
    sel.appendChild(opt);
    sel.disabled = true;
    $("analyzeBtn").disabled = true;
    return;
  }
  sel.disabled = false;
  $("analyzeBtn").disabled = false;
  periods.forEach(([key, count]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${window.Sage.periodLabel(key)} — ${count} facture(s) UE`;
    sel.appendChild(opt);
  });
  sel.value = periods[0][0];
}

function updateSageSummary() {
  const all = state.parsedSage.factures;
  const dated = all.filter(f => f.date);
  const dates = dated.map(f => f.date.getTime()).sort();
  const first = dates[0] ? new Date(dates[0]) : null;
  const last = dates[dates.length - 1] ? new Date(dates[dates.length - 1]) : null;
  const rangeTxt = (first && last)
    ? `du ${first.toLocaleDateString("fr-FR")} au ${last.toLocaleDateString("fr-FR")}`
    : "";
  $("sageSummary").textContent = `${all.length} pièce(s) détectée(s) ${rangeTxt}.`;
}

function renderPeriodPreview() {
  const showAll = $("periodShowAll").checked;
  const key = $("periodSelect").value;
  const pv = $("periodPreview");
  clearNode(pv);
  if (!showAll) {
    pv.classList.add("hidden");
    return;
  }
  pv.classList.remove("hidden");
  const factures = key
    ? window.Validators.filterByPeriod(state.parsedSage.factures, key)
    : state.parsedSage.factures;
  factures.forEach(f => {
    const iso2 = window.EU.iso3ToIso2(f.paysCodeRaw);
    const div = document.createElement("div");
    div.textContent = `${f.typePiece} ${f.numero} — ${f.dateRaw} — ${f.nomClient} (${iso2 || f.paysCodeRaw}) — NII ${f.nii || "(vide)"} — ${f.mtTTC.toFixed(2)}€ TTC`;
    pv.appendChild(div);
  });
}

async function startAnalysis() {
  const declarant = await window.Store.getDeclarant();
  const declErrors = window.Validators.validateDeclarant(declarant);
  if (declErrors.length) {
    alert("Configuration déclarant incomplète :\n\n" + declErrors.join("\n") + "\n\nAllez dans l'onglet Configuration.");
    activateTab("tabConfig");
    return;
  }
  const articles = await window.Store.getArticles();
  if (Object.keys(articles).length === 0) {
    alert("Aucun article mappé. Allez dans l'onglet Articles pour ajouter au moins un code SH avant de continuer.");
    activateTab("tabArticles");
    return;
  }

  const periodKey = $("periodSelect").value;
  if (!periodKey) {
    alert("Aucune période à déclarer.");
    return;
  }
  state.selectedPeriod = periodKey;
  state.cancelRequested = false;

  const facturesPeriode = window.Validators.filterByPeriod(state.parsedSage.factures, periodKey);
  const niis = window.Validators.collectCandidateNiis(facturesPeriode);

  showStep("stepAnalyze");
  $("analyzeTitle").textContent = niis.length
    ? "Vérification des NII sur VIES…"
    : "Analyse des factures…";
  $("analyzeBar").style.width = "0%";
  $("analyzeText").textContent = `0 / ${niis.length}`;

  const viesResults = {};
  if (niis.length > 0) {
    let done = 0;
    await window.Vies.runWithConcurrency(niis.length, window.Vies.CONCURRENCY, async (i) => {
      const full = niis[i];
      const country = full.slice(0, 2);
      const number = full.slice(2);
      const r = await window.Vies.checkViesWithRetry(country, number, () => state.cancelRequested);
      viesResults[full] = r;
      done++;
      const pct = Math.round(done / niis.length * 100);
      $("analyzeBar").style.width = pct + "%";
      $("analyzeText").textContent = `${done} / ${niis.length}`;
    }, () => state.cancelRequested);
  }

  if (state.cancelRequested) {
    resetSage();
    return;
  }

  const classification = window.Validators.classifyFactures(facturesPeriode, articles, viesResults);
  state.lastClassification = classification;
  state.lastEntries = classification.toDeclare;
  state.lastPeriodKey = periodKey;

  if (classification.blockers.length > 0) {
    renderBlocked(classification);
    showStep("stepResultBlocked");
  } else if (classification.toDeclare.length === 0) {
    renderBlocked({
      blockers: [{ message: "Aucune facture éligible à la déclaration LIC sur cette période (ni facture, ni avoir intracom valide)." }],
      ignored: classification.ignored
    });
    showStep("stepResultBlocked");
  } else {
    renderOk(classification, periodKey);
    showStep("stepResultOk");
  }
}

function renderOk(cls, periodKey) {
  const uniqueNiis = new Set(cls.toDeclare.map(e => e.niiClient));
  $("okDeclared").textContent = cls.toDeclare.length;
  $("okIgnored").textContent = cls.ignored.length;
  $("okNiiCount").textContent = uniqueNiis.size;
  $("okPeriodLabel").textContent = window.Sage.periodLabel(periodKey);

  const tbody = $("declaredTable").querySelector("tbody");
  clearNode(tbody);
  cls.toDeclare
    .slice()
    .sort((a, b) => (a.facture.date?.getTime() || 0) - (b.facture.date?.getTime() || 0))
    .forEach(e => {
      const f = e.facture;
      const tr = document.createElement("tr");
      if (e.role === "avoir") tr.classList.add("row-avoir");
      const ht = f.lignes.reduce((s, l) => s + l.quantite * l.puHT, 0);
      const signedHt = e.role === "avoir" ? -Math.abs(ht) : ht;
      const cells = [
        f.numero,
        e.role === "avoir" ? "Avoir" : "Facture",
        f.dateRaw,
        f.nomClient,
        e.iso2Client,
        f.nii,
        signedHt.toFixed(2) + " €"
      ];
      cells.forEach((v, i) => {
        const td = document.createElement("td");
        td.textContent = v;
        if (i === 0 || i === 5) td.classList.add("mono");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
}

function renderBlocked(cls) {
  $("blockedCount").textContent = cls.blockers.length;
  const ul = $("blockersList");
  clearNode(ul);
  cls.blockers.forEach(b => {
    const li = document.createElement("li");
    li.textContent = b.message;
    ul.appendChild(li);
  });
  const igEl = $("ignoredList");
  clearNode(igEl);
  const ignored = cls.ignored || [];
  $("ignoredCount").textContent = ignored.length ? `(${ignored.length})` : "";
  $("ignoredCard").classList.toggle("hidden", ignored.length === 0);
  ignored.forEach(i => {
    const li = document.createElement("li");
    const f = i.facture;
    li.textContent = `${f.typePiece} ${f.numero} — ${f.nomClient} — ${i.reason}`;
    igEl.appendChild(li);
  });
}

function showIgnoredInline() {
  const cls = state.lastClassification;
  if (!cls || !cls.ignored.length) {
    alert("Aucune facture ignorée sur cette période.");
    return;
  }
  const lines = cls.ignored.map(i => `${i.facture.typePiece} ${i.facture.numero} — ${i.facture.nomClient} — ${i.reason}`);
  alert("Factures ignorées :\n\n" + lines.join("\n"));
}

async function downloadErtva() {
  const out = window.Generators.generateErtvaOds(state.lastEntries, state.lastPeriodKey);
  window.Generators.triggerDownload(out.blob, out.filename);
}

async function downloadDeb() {
  const declarant = await window.Store.getDeclarant();
  const articles = await window.Store.getArticles();
  const out = window.Generators.generateDebCsv(state.lastEntries, declarant, articles, state.lastPeriodKey);
  window.Generators.triggerDownload(out.blob, out.filename);
}
