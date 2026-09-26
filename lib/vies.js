"use strict";

const VIES_ENDPOINT = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
const CONCURRENCY = 4;
const RETRY_DELAYS_MS = [600, 1800, 4500];

function parseVat(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).toUpperCase().replace(/[\s.\-/]/g, "");
  const m = cleaned.match(/^([A-Z]{2})([A-Z0-9]+)$/);
  if (!m) return null;
  const country = m[1] === "GR" ? "EL" : m[1];
  return { country, number: m[2], full: country + m[2] };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runWithConcurrency(total, limit, worker, isCancelled) {
  let next = 0;
  const cancelled = isCancelled || (() => false);
  async function runner() {
    while (next < total && !cancelled()) {
      const i = next++;
      await worker(i);
    }
  }
  const runners = [];
  for (let k = 0; k < Math.min(limit, total); k++) runners.push(runner());
  await Promise.all(runners);
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

async function checkVies(country, number) {
  if (!window.EU.isValidVatPrefix(country)) {
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
    const errCode = data.userError || data.errorWrappers?.[0]?.error || (data.actionSucceed === false && "SERVICE_ERROR");
    if (errCode) {
      return { status: "network-error", detail: viesErrorLabel(errCode) };
    }
    if (data.valid === true) {
      const name = (data.traderName || data.name || "").toString().trim();
      return { status: "valid", detail: name || "Numéro valide", traderName: name };
    }
    return { status: "invalid", detail: "Numéro non reconnu par VIES" };
  } catch (err) {
    return { status: "network-error", detail: err.message || "Erreur réseau" };
  }
}

async function checkViesWithRetry(country, number, isCancelled) {
  const cancelled = isCancelled || (() => false);
  let last = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (cancelled()) return { status: "network-error", detail: "Annulé" };
    last = await checkVies(country, number);
    if (last.status !== "network-error") return last;
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  return { ...last, detail: `${last.detail} — 3 essais échoués, vérifier manuellement sur VIES` };
}

window.Vies = {
  CONCURRENCY,
  parseVat,
  checkVies,
  checkViesWithRetry,
  runWithConcurrency,
  viesErrorLabel
};
