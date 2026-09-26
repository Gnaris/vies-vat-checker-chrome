"use strict";

function normalizeHeader(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findColumnIndex(headersNorm, patterns) {
  for (const p of patterns) {
    const idx = headersNorm.findIndex(h => h === p);
    if (idx >= 0) return idx;
  }
  for (const p of patterns) {
    const idx = headersNorm.findIndex(h => h.includes(p));
    if (idx >= 0) return idx;
  }
  return -1;
}

function decodeArrayBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  const hasHighBytes = bytes.some(b => b >= 0x80 && b <= 0xff);
  const decoder = hasHighBytes ? new TextDecoder("windows-1252") : new TextDecoder("utf-8");
  return decoder.decode(bytes);
}

function parseNumberFR(v) {
  if (v == null || v === "") return 0;
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function parseDateFR(v) {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  const date = new Date(y, mo - 1, d);
  if (isNaN(date.getTime())) return null;
  return date;
}

function parseSageTxt(buffer) {
  const text = decodeArrayBuffer(buffer);
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) {
    return { factures: [], warnings: ["Fichier vide ou incomplet."] };
  }
  const headers = lines[0].split("\t");
  const headersNorm = headers.map(normalizeHeader);

  const col = {
    typeLigne: findColumnIndex(headersNorm, ["type de ligne"]),
    typePiece: findColumnIndex(headersNorm, ["type de piece"]),
    numero: findColumnIndex(headersNorm, ["n° piece", "no piece", "n piece", "numero piece"]),
    date: findColumnIndex(headersNorm, ["date piece"]),
    codeClient: findColumnIndex(headersNorm, ["code client"]),
    nomClient: findColumnIndex(headersNorm, ["nom client"]),
    codePostal: findColumnIndex(headersNorm, ["code postal"]),
    ville: findColumnIndex(headersNorm, ["ville"]),
    paysCode: findColumnIndex(headersNorm, ["code pays"]),
    pays: findColumnIndex(headersNorm, ["pays"]),
    nii: findColumnIndex(headersNorm, ["nii", "n° tva intracom", "numero tva intracom"]),
    mtTTC: findColumnIndex(headersNorm, ["mt total ttc"]),
    codeArticle: findColumnIndex(headersNorm, ["code article"]),
    quantite: findColumnIndex(headersNorm, ["quantite"]),
    puHT: findColumnIndex(headersNorm, ["pu ht"]),
    puTTC: findColumnIndex(headersNorm, ["pu ttc"]),
    tauxTVA: findColumnIndex(headersNorm, ["taux tva"]),
    description: findColumnIndex(headersNorm, ["description"]),
    pdsNet: findColumnIndex(headersNorm, ["pds unit. net", "pds unit net", "poids unit net"]),
    pdsBrut: findColumnIndex(headersNorm, ["pds unit. brut", "pds unit brut", "poids unit brut"])
  };

  const missing = [];
  ["typeLigne","typePiece","numero","date","paysCode","tauxTVA","codeArticle","quantite","puHT"].forEach(k => {
    if (col[k] < 0) missing.push(k);
  });
  if (missing.length) {
    return {
      factures: [],
      warnings: [`Colonnes introuvables dans l'export Sage : ${missing.join(", ")}. Vérifier que l'export inclut bien toutes les colonnes standards.`]
    };
  }

  const factures = [];
  let current = null;

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    const typeLigne = (cells[col.typeLigne] || "").trim().toUpperCase();

    if (typeLigne === "E") {
      if (current) factures.push(current);
      current = {
        typePiece: (cells[col.typePiece] || "").trim(),
        numero: (cells[col.numero] || "").trim(),
        date: parseDateFR(cells[col.date]),
        dateRaw: (cells[col.date] || "").trim(),
        codeClient: (cells[col.codeClient] || "").trim(),
        nomClient: (cells[col.nomClient] || "").trim(),
        codePostal: col.codePostal >= 0 ? (cells[col.codePostal] || "").trim() : "",
        ville: col.ville >= 0 ? (cells[col.ville] || "").trim() : "",
        paysCodeRaw: (cells[col.paysCode] || "").trim(),
        pays: col.pays >= 0 ? (cells[col.pays] || "").trim() : "",
        nii: col.nii >= 0 ? (cells[col.nii] || "").trim() : "",
        mtTTC: col.mtTTC >= 0 ? parseNumberFR(cells[col.mtTTC]) : 0,
        lignes: [],
        sourceRow: i + 1
      };
    } else if (typeLigne === "L") {
      if (!current) continue;
      const codeArticle = (cells[col.codeArticle] || "").trim();
      if (!codeArticle) continue;
      current.lignes.push({
        codeArticle,
        description: col.description >= 0 ? (cells[col.description] || "").trim() : "",
        quantite: parseNumberFR(cells[col.quantite]),
        puHT: parseNumberFR(cells[col.puHT]),
        puTTC: col.puTTC >= 0 ? parseNumberFR(cells[col.puTTC]) : 0,
        tauxTVA: parseNumberFR(cells[col.tauxTVA]),
        pdsNet: col.pdsNet >= 0 ? parseNumberFR(cells[col.pdsNet]) : 0,
        pdsBrut: col.pdsBrut >= 0 ? parseNumberFR(cells[col.pdsBrut]) : 0,
        sourceRow: i + 1
      });
    }
  }
  if (current) factures.push(current);

  return { factures, warnings: [] };
}

function isAvoir(typePiece) {
  return /avoir/i.test(String(typePiece || ""));
}

function isFacture(typePiece) {
  return /facture/i.test(String(typePiece || "")) && !isAvoir(typePiece);
}

function facturePeriodKey(date) {
  if (!date) return null;
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = String(date.getFullYear());
  return m + y;
}

function periodLabel(key) {
  if (!key || key.length !== 6) return key || "";
  const m = key.slice(0, 2);
  const y = key.slice(2);
  const names = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const idx = parseInt(m, 10) - 1;
  return `${names[idx] || m} ${y}`;
}

window.Sage = {
  parseSageTxt,
  isAvoir,
  isFacture,
  facturePeriodKey,
  periodLabel
};
