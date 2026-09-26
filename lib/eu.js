"use strict";

const EU_COUNTRIES_ISO2 = new Set([
  "AT","BE","BG","CY","CZ","DE","DK","EE","ES","FI","FR","GR","HR","HU",
  "IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK"
]);

const ISO3_TO_ISO2 = {
  AUT:"AT", BEL:"BE", BGR:"BG", CYP:"CY", CZE:"CZ", DEU:"DE", DNK:"DK",
  EST:"EE", ESP:"ES", FIN:"FI", FRA:"FR", GRC:"GR", HRV:"HR", HUN:"HU",
  IRL:"IE", ITA:"IT", LTU:"LT", LUX:"LU", LVA:"LV", MLT:"MT", NLD:"NL",
  POL:"PL", PRT:"PT", ROU:"RO", SWE:"SE", SVN:"SI", SVK:"SK",
  GBR:"GB"
};

function iso3ToIso2(code) {
  if (!code) return null;
  const c = String(code).toUpperCase().trim();
  if (c.length === 2) return c;
  return ISO3_TO_ISO2[c] || null;
}

function isEuCountry(iso2) {
  return !!iso2 && EU_COUNTRIES_ISO2.has(iso2);
}

function isFrance(iso2) {
  return iso2 === "FR";
}

function countryToVatPrefix(iso2) {
  if (iso2 === "GR") return "EL";
  return iso2;
}

function vatPrefixToCountry(prefix) {
  if (prefix === "EL") return "GR";
  if (prefix === "XI") return "GB";
  return prefix;
}

const VALID_VAT_PREFIXES = new Set([
  "AT","BE","BG","CY","CZ","DE","DK","EE","EL","ES","FI","FR","HR","HU",
  "IE","IT","LT","LU","LV","MT","NL","PL","PT","RO","SE","SI","SK","XI"
]);

function isValidVatPrefix(prefix) {
  return VALID_VAT_PREFIXES.has(prefix);
}

window.EU = {
  EU_COUNTRIES_ISO2,
  iso3ToIso2,
  isEuCountry,
  isFrance,
  countryToVatPrefix,
  vatPrefixToCountry,
  isValidVatPrefix
};
