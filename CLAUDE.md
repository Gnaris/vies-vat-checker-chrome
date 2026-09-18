# CLAUDE.md

## À qui tu parles
Cliente **non-développeuse**. Français simple, court. Pas de jargon. Tests = trajets dans le navigateur (« clique sur l'icône, glisse le fichier X »), jamais de commande shell. Détails techniques : entre toi et le code.

## Ce que fait le plugin
Extension Chrome Manifest V3. La cliente glisse un fichier Excel/ODS/CSV, l'extension lit une colonne de numéros de TVA intracommunautaire et interroge **VIES** (Commission européenne) pour chacun. Résultat filtré, fichier d'origine **jamais modifié**.

Usage réel : préparer la déclaration DEB / état récapitulatif TVA sans saisir 30 numéros à la main sur le site VIES.

## Repo GitHub
- **Public** : https://github.com/Gnaris/vies-vat-checker-chrome
- Compte `Gnaris`, branche `main`
- Licence MIT

## Structure
```
manifest.json              MV3, action.default_icon uniquement (pas de default_popup)
background.js              chrome.action.onClicked → ouvre popup.html dans un nouvel onglet
popup.html + popup.css     UI (drag zone → sélecteur colonne → progrès → résultats)
popup.js                   Toute la logique (~350 lignes, pas de framework)
lib/xlsx.mini.min.js       SheetJS (MIT), bundlé local car CSP MV3 interdit CDN
icons/{16,48,128}.png      Icône : coche blanche sur fond bleu #2563eb, coins arrondis
README.md                  Docs utilisateur (installation, statuts, confidentialité)
```

Pas de build. Pas de package.json. Pas de node_modules. Tout est statique.

## API VIES

- **Endpoint** : `POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number`
- **Body** :
  ```json
  {
    "countryCode": "BE", "vatNumber": "0819015540",
    "requesterMemberStateCode": "", "requesterNumber": "",
    "traderName": "", "traderStreet": "", "traderPostalCode": "",
    "traderCity": "", "traderCompanyType": ""
  }
  ```
- **Réponse OK** : `{ valid: true, traderName: "…", …, actionSucceed: true }`
- **Réponse KO** : `valid: false` ou `actionSucceed: false` + `userError: "MS_UNAVAILABLE" | "MS_MAX_CONCURRENT_REQ" | "SERVER_BUSY" | "TIMEOUT" | …`
- Autorisé via `host_permissions: ["https://ec.europa.eu/*"]` dans `manifest.json`.

**Pays** : les 27 UE + `EL` (Grèce, pas `GR`) + `XI` (Irlande du Nord post-Brexit). Ne pas ajouter `GB` : VIES ne couvre plus la Grande-Bretagne.

## Détails d'implémentation

- **Parsing fichier** : `XLSX.read(arrayBuffer, { type: "array" })` → `XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" })`. Marche pour xlsx/xls/ods/csv (SheetJS gère tout).
- **Détection colonne** :
  1. Regex sur l'en-tête : `/tva|vat|vies/i`
  2. Fallback : cherche une cellule qui matche `/^[A-Z]{2}[A-Z0-9]{6,14}$/` dans les 5 premières lignes
- **Nettoyage TVA** : `.toUpperCase().replace(/[\s.\-/]/g, "")` — retire espaces, points, tirets, slashes. Puis regex `^([A-Z]{2})([A-Z0-9]+)$`. `GR` → `EL`.
- **Parallélisme** : `CONCURRENCY = 4` (constant en tête de fichier). Bon compromis vitesse ↔ éviter `MS_MAX_CONCURRENT_REQ`.
- **Retry** : `RETRY_DELAYS_MS = [600, 1800, 4500]` — 3 essais après le 1er échec réseau, backoff exponentiel. Ne retry PAS sur `invalid` (numéro vraiment non reconnu) ni `invalid-format`.
- **Progression** : mise à jour incrémentale via un compteur partagé `done` dans la closure de `runWithConcurrency`.

## Contraintes techniques

- **Manifest V3** :
  - Pas de CDN pour les scripts → SheetJS bundlé dans `lib/`.
  - Pas d'`innerHTML` avec contenu dynamique (hook de sécurité local le bloque). Utiliser `document.createElement` + `textContent`. `clearNode()` helper pour vider.
  - Service worker `background.js` uniquement pour le clic action.
- **Pas de framework** : vanilla JS. Ne pas introduire React/Vue/bundler — casserait l'installation « télécharger le ZIP → charger non empaquetée ».
- **Icônes** : PNG (Chrome ne charge pas les SVG en `action.default_icon`). Générées avec PIL, script inline si besoin de régénérer.

## Tâches courantes

- **Ajouter un nouveau statut** : `statusLabel()` + classe CSS `badge-*` + condition dans `renderResults()` pour la couleur de ligne (`row-ok` / `row-ko` / `row-err`).
- **Ajouter un code d'erreur VIES connu** : `viesErrorLabel()` — juste une entrée dans le dictionnaire `map`.
- **Changer la vitesse** : `CONCURRENCY` (parallélisme) ou `RETRY_DELAYS_MS` (agressivité du retry). Ne pas descendre en dessous de 300 ms de délai entre bursts.
- **Bumper la version** : `manifest.json` → `"version": "1.x.y"`. Chrome ne met pas à jour l'extension non empaquetée automatiquement — la cliente doit recharger via `chrome://extensions` (bouton 🔄).

## Workflow modif → push

1. Modifier local.
2. Prévenir la cliente + rappel : recharger l'extension dans `chrome://extensions`.
3. Elle valide.
4. Commit + `git push origin main`. Pas de PR, pas de CI. Le repo est un simple partage.

## À éviter
- Ne PAS ajouter de télémétrie / analytics / hébergement externe. La confidentialité (« aucun envoi vers un tiers ») est un argument marketing du README.
- Ne PAS toucher au fichier source de la cliente — l'extension est en lecture seule sur le fichier. Si un jour on ajoute un export, faire un NOUVEAU fichier (jamais overwrite).
- Ne PAS supporter GB (Grande-Bretagne) — VIES ne la couvre plus depuis le Brexit. Ajouter `XI` (Irlande du Nord) seulement.
