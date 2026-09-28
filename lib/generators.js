"use strict";

const REGIME_LIC_FACTURE = 21;
const REGIME_LIC_AVOIR_DEB = 29;
const REGIME_LIC_AVOIR_ERTVA = 25;
const CODE_FLUX_EXPEDITION = 2;
const MODE_TRANSPORT_ROUTE = 3;
const NATURE_TRANSACTION_VENTE = 11;
const NATURE_TRANSACTION_RETOUR = 21;
const NIVEAU_OBLIGATION = 1;

function aggregateErtvaLines(entries) {
  const buckets = new Map();
  for (const e of entries) {
    const key = e.niiClient + "|" + e.role;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { nii: e.niiClient, role: e.role, totalHT: 0 };
      buckets.set(key, bucket);
    }
    let facHT = 0;
    for (const ligne of e.facture.lignes) {
      facHT += ligne.quantite * ligne.puHT;
    }
    if (e.role === "avoir") facHT = -Math.abs(facHT);
    bucket.totalHT += facHT;
  }
  const rows = [];
  const sortedNiis = [...new Set([...buckets.values()].map(b => b.nii))].sort();
  for (const nii of sortedNiis) {
    const fac = buckets.get(nii + "|facture");
    const avo = buckets.get(nii + "|avoir");
    if (fac && Math.round(fac.totalHT) !== 0) {
      rows.push({ regime: REGIME_LIC_FACTURE, montant: Math.round(fac.totalHT), nii });
    }
    if (avo && Math.round(avo.totalHT) !== 0) {
      rows.push({ regime: REGIME_LIC_AVOIR_ERTVA, montant: Math.round(avo.totalHT), nii });
    }
  }
  return rows;
}

function generateErtvaOds(entries, periodKey) {
  const rows = aggregateErtvaLines(entries);
  const aoa = rows.map(r => [r.regime, r.montant, r.nii]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Feuille1");
  const bytes = XLSX.write(wb, { bookType: "ods", type: "array" });
  return {
    blob: new Blob([bytes], { type: "application/vnd.oasis.opendocument.spreadsheet" }),
    filename: `ERTVA_${periodKey}.ods`,
    rowCount: rows.length
  };
}

function aggregateDebLines(entries, articlesMapping) {
  const buckets = new Map();
  for (const e of entries) {
    const iso2Dest = e.iso2Client;
    for (const ligne of e.facture.lignes) {
      const art = articlesMapping[ligne.codeArticle];
      const codeSH = art.codeSH;
      const paysOrigine = art.paysOrigine;
      const poidsNet = parseFloat(art.poidsNet) || 0;

      const key = [
        iso2Dest,
        codeSH,
        paysOrigine,
        e.niiClient,
        e.role
      ].join("|");

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          iso2Dest, codeSH, paysOrigine,
          niiPartenaire: e.niiClient,
          role: e.role,
          quantite: 0,
          masseNette: 0,
          valeur: 0
        };
        buckets.set(key, bucket);
      }
      const sign = e.role === "avoir" ? -1 : 1;
      const qty = Math.abs(ligne.quantite) * sign;
      bucket.quantite += qty;
      bucket.masseNette += qty * poidsNet;
      bucket.valeur += qty * ligne.puHT;
    }
  }
  return [...buckets.values()].filter(b => Math.round(b.valeur) !== 0);
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CP1252_EXTRA = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F
};

function encodeWindows1252(str) {
  const bytes = new Uint8Array(str.length * 2);
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0xFF) {
      bytes[len++] = code;
    } else if (CP1252_EXTRA[code] !== undefined) {
      bytes[len++] = CP1252_EXTRA[code];
    } else {
      bytes[len++] = 0x3F;
    }
  }
  return bytes.subarray(0, len);
}

function generateDebCsv(entries, declarant, articlesMapping, periodKey) {
  const buckets = aggregateDebLines(entries, articlesMapping);
  buckets.sort((a, b) => {
    if (a.role !== b.role) return a.role === "facture" ? -1 : 1;
    if (a.iso2Dest !== b.iso2Dest) return a.iso2Dest.localeCompare(b.iso2Dest);
    if (a.niiPartenaire !== b.niiPartenaire) return a.niiPartenaire.localeCompare(b.niiPartenaire);
    return a.codeSH.localeCompare(b.codeSH);
  });

  const niiDeclarant = declarant.nii.replace(/\s/g, "").toUpperCase();
  const departement = String(declarant.departement).trim();

  const header = [
    "Code flux","Numéro de déclaration","Numéro de ligne","Numéro TVA","Département",
    "Mode de transport à la frontière","Pays de prov./dest.","Nature de la transaction",
    "Valeur fiscale","Régime","Niveau d'obligations","Nomenclature",
    "Développement statistique national NGP","Masse nette","Valeur statistique de l'article",
    "Unités supplémentaires","Pays d'origine à l'introduction ou de destination finale à l'expédition",
    "Code TVA du partenaire étranger","Code complémentaire pour les assujetis français pluriactifs ou PMNA",
    "Réference interne","Période de référence"
  ].join(";");

  const lines = [header];
  buckets.forEach((b, i) => {
    const numLigne = i + 1;
    const masse = Math.round(b.masseNette);
    const valeur = Math.round(b.valeur);
    const unitesSup = Math.round(b.quantite);
    const isAvoir = b.role === "avoir";
    const row = [
      CODE_FLUX_EXPEDITION,
      "",
      numLigne,
      niiDeclarant,
      departement,
      MODE_TRANSPORT_ROUTE,
      b.iso2Dest,
      isAvoir ? NATURE_TRANSACTION_RETOUR : NATURE_TRANSACTION_VENTE,
      "",
      isAvoir ? REGIME_LIC_AVOIR_DEB : REGIME_LIC_FACTURE,
      NIVEAU_OBLIGATION,
      b.codeSH,
      "",
      masse,
      valeur,
      unitesSup,
      b.paysOrigine,
      b.niiPartenaire,
      "",
      "",
      periodKey
    ].map(csvEscape).join(";");
    lines.push(row);
  });

  const content = lines.join("\r\n") + "\r\n";
  const bytes = encodeWindows1252(content);
  return {
    blob: new Blob([bytes], { type: "text/csv;charset=windows-1252" }),
    filename: `DEB_stat_${periodKey}.csv`,
    rowCount: buckets.length
  };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

window.Generators = {
  generateErtvaOds,
  generateDebCsv,
  triggerDownload,
  aggregateErtvaLines,
  aggregateDebLines
};
