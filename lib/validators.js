"use strict";

function classifyFactures(factures, articlesMapping, viesResults) {
  const toDeclare = [];
  const ignored = [];
  const blockers = [];

  for (const f of factures) {
    const iso2 = window.EU.iso3ToIso2(f.paysCodeRaw);
    const numeroLabel = f.numero || `ligne ${f.sourceRow}`;

    if (!f.paysCodeRaw) {
      blockers.push({
        facture: f,
        code: "NO_COUNTRY",
        message: `Facture ${numeroLabel} : aucun code pays renseigné dans Sage.`
      });
      continue;
    }
    if (!iso2) {
      if (/^[A-Z]{3}$/.test(f.paysCodeRaw.toUpperCase())) {
        ignored.push({ facture: f, reason: `Pays hors UE (${f.paysCodeRaw}) — ignoré` });
        continue;
      }
      blockers.push({
        facture: f,
        code: "UNKNOWN_COUNTRY",
        message: `Facture ${numeroLabel} : code pays "${f.paysCodeRaw}" invalide (attendu 3 lettres ISO, ex. BEL, ITA).`
      });
      continue;
    }
    if (window.EU.isFrance(iso2)) {
      ignored.push({ facture: f, reason: "Facture France (non concernée par DEB/ERTVA)" });
      continue;
    }
    if (!window.EU.isEuCountry(iso2)) {
      ignored.push({ facture: f, reason: `Pays hors UE (${iso2}) — ignoré` });
      continue;
    }

    if (!f.lignes || f.lignes.length === 0) {
      blockers.push({
        facture: f,
        code: "NO_LINES",
        message: `Facture ${numeroLabel} : aucune ligne d'article détectée.`
      });
      continue;
    }

    const rates = f.lignes.map(l => l.tauxTVA);
    const allZero = rates.every(r => r === 0);
    const allNonZero = rates.every(r => r > 0);

    if (!allZero && !allNonZero) {
      blockers.push({
        facture: f,
        code: "MIXED_TVA",
        message: `Facture ${numeroLabel} (${iso2}) : taux de TVA mélangés sur les lignes (certaines à 0 %, d'autres non). À corriger dans Sage.`
      });
      continue;
    }

    if (allNonZero) {
      if (f.nii) {
        blockers.push({
          facture: f,
          code: "TVA_NON_ZERO_WITH_NII",
          message: `Facture ${numeroLabel} (${iso2}) : NII client "${f.nii}" renseigné mais TVA à ${rates[0]} %. Devrait être 0 % pour une LIC. Vérifier la facture dans Sage.`
        });
      } else {
        ignored.push({ facture: f, reason: `Facture BtoC ${iso2} avec TVA à ${rates[0]} % — non concernée par DEB/ERTVA` });
      }
      continue;
    }

    if (!f.nii) {
      blockers.push({
        facture: f,
        code: "MISSING_NII",
        message: `Facture ${numeroLabel} (${iso2}) : TVA à 0 % mais aucun NII client renseigné dans Sage. Impossible de déclarer sans NII — compléter la fiche client.`
      });
      continue;
    }

    const parsed = window.Vies.parseVat(f.nii);
    if (!parsed) {
      blockers.push({
        facture: f,
        code: "BAD_NII_FORMAT",
        message: `Facture ${numeroLabel} : NII "${f.nii}" au format incorrect (attendu 2 lettres de pays + chiffres).`
      });
      continue;
    }

    if (parsed.country === "FR") {
      blockers.push({
        facture: f,
        code: "NII_FR",
        message: `Facture ${numeroLabel} (${iso2}) : NII français "${f.nii}" sur une facture pays ${iso2}. Aucun sens pour une LIC — vérifier dans Sage.`
      });
      continue;
    }

    if (parsed.country === "GB") {
      blockers.push({
        facture: f,
        code: "NII_GB",
        message: `Facture ${numeroLabel} : NII britannique "${f.nii}". Le Royaume-Uni ne fait plus partie de VIES depuis le Brexit. Utiliser XI (Irlande du Nord) si applicable.`
      });
      continue;
    }

    const expectedPrefix = window.EU.countryToVatPrefix(iso2);
    if (parsed.country !== expectedPrefix && parsed.country !== "XI") {
      blockers.push({
        facture: f,
        code: "NII_COUNTRY_MISMATCH",
        message: `Facture ${numeroLabel} : pays client ${iso2} mais NII commence par ${parsed.country}. Corriger le pays ou le NII dans Sage.`
      });
      continue;
    }

    const viesKey = parsed.country + parsed.number;
    const viesRes = viesResults && viesResults[viesKey];
    if (!viesRes) {
      blockers.push({
        facture: f,
        code: "VIES_NOT_CHECKED",
        message: `Facture ${numeroLabel} : NII ${f.nii} non vérifié sur VIES (erreur interne).`
      });
      continue;
    }
    if (viesRes.status === "invalid") {
      blockers.push({
        facture: f,
        code: "VIES_INVALID",
        message: `Facture ${numeroLabel} : NII ${f.nii} refusé par VIES ("non reconnu"). Vérifier avec le client.`
      });
      continue;
    }
    if (viesRes.status === "network-error") {
      blockers.push({
        facture: f,
        code: "VIES_NETWORK",
        message: `Facture ${numeroLabel} : impossible de joindre VIES pour vérifier "${f.nii}" (${viesRes.detail}). Réessayer plus tard.`
      });
      continue;
    }
    if (viesRes.status !== "valid") {
      blockers.push({
        facture: f,
        code: "VIES_OTHER",
        message: `Facture ${numeroLabel} : NII ${f.nii} — statut VIES inattendu (${viesRes.status}).`
      });
      continue;
    }

    const missingArticles = [];
    const badWeight = [];
    for (const ligne of f.lignes) {
      const art = articlesMapping[ligne.codeArticle];
      if (!art || !art.codeSH || !art.paysOrigine) {
        missingArticles.push(ligne.codeArticle);
        continue;
      }
      const poids = parseFloat(art.poidsNet);
      if (!isFinite(poids) || poids <= 0) {
        badWeight.push(ligne.codeArticle);
      }
    }
    if (missingArticles.length) {
      const unique = [...new Set(missingArticles)];
      blockers.push({
        facture: f,
        code: "MISSING_MAPPING",
        message: `Facture ${numeroLabel} : article(s) sans mapping SH/pays d'origine : ${unique.join(", ")}. Compléter l'onglet "Articles".`
      });
      continue;
    }
    if (badWeight.length) {
      const unique = [...new Set(badWeight)];
      blockers.push({
        facture: f,
        code: "BAD_WEIGHT",
        message: `Facture ${numeroLabel} : poids net unitaire manquant ou nul pour : ${unique.join(", ")}. Compléter dans l'onglet "Articles".`
      });
      continue;
    }

    toDeclare.push({
      facture: f,
      iso2Client: iso2,
      niiClient: f.nii,
      role: window.Sage.isAvoir(f.typePiece) ? "avoir" : "facture",
      traderName: viesRes.traderName || ""
    });
  }

  return { toDeclare, ignored, blockers };
}

function collectCandidateNiis(factures) {
  const set = new Set();
  for (const f of factures) {
    const iso2 = window.EU.iso3ToIso2(f.paysCodeRaw);
    if (!iso2 || !window.EU.isEuCountry(iso2) || window.EU.isFrance(iso2)) continue;
    if (!f.nii) continue;
    if (!f.lignes || f.lignes.length === 0) continue;
    const allZero = f.lignes.every(l => l.tauxTVA === 0);
    if (!allZero) continue;
    const parsed = window.Vies.parseVat(f.nii);
    if (!parsed) continue;
    if (parsed.country === "FR" || parsed.country === "GB") continue;
    set.add(parsed.country + parsed.number);
  }
  return [...set];
}

function detectPeriods(factures) {
  const map = new Map();
  for (const f of factures) {
    const iso2 = window.EU.iso3ToIso2(f.paysCodeRaw);
    if (!iso2 || !window.EU.isEuCountry(iso2) || window.EU.isFrance(iso2)) continue;
    if (!f.date) continue;
    const key = window.Sage.facturePeriodKey(f.date);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function filterByPeriod(factures, periodKey) {
  return factures.filter(f => f.date && window.Sage.facturePeriodKey(f.date) === periodKey);
}

function validateDeclarant(declarant) {
  const errors = [];
  if (!declarant || !declarant.nomEntreprise) errors.push("Nom d'entreprise manquant");
  if (!declarant || !declarant.nii) {
    errors.push("NII déclarant manquant");
  } else {
    const parsed = window.Vies.parseVat(declarant.nii);
    if (!parsed || parsed.country !== "FR") {
      errors.push("NII déclarant doit commencer par FR");
    }
  }
  if (!declarant || !declarant.departement) {
    errors.push("Département manquant");
  } else if (!/^\d{2,3}$/.test(String(declarant.departement).trim())) {
    errors.push("Département : 2 chiffres attendus (ex. 93)");
  }
  return errors;
}

window.Validators = {
  classifyFactures,
  collectCandidateNiis,
  detectPeriods,
  filterByPeriod,
  validateDeclarant
};
