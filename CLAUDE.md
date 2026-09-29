# CLAUDE.md

## À qui tu parles
Cliente **non-développeuse**. Français simple, court. Pas de jargon. Tests = trajets dans le navigateur (« clique sur l'icône, va dans Configuration, remplis X »), jamais de commande shell. Détails techniques : entre toi et le code.

## Ce que fait le plugin (v2)
Extension Chrome Manifest V3. Convertit un export **Sage 50** (fichier .txt de la liste des pièces clients) en 2 fichiers prêts à déposer sur **pro.douane** :
- **ERTVA** (`.ods`) → « Saisie et Gestion de l'état récapitulatif TVA à l'expédition »
- **DEB statistique** (`.csv`) → « Saisie et Gestion de la réponse statistique à l'expédition et à l'introduction »

Vérification VIES intégrée sur les NII des clients avant génération. **Politique tout-ou-rien** : la moindre anomalie bloque l'export et affiche toutes les corrections à faire.

Usage réel : préparer la DEB / ERTVA mensuelle à partir du logiciel de facturation Sage 50.

## Repo GitHub
- **Public** : https://github.com/Gnaris/vies-vat-checker-chrome
- Compte `Gnaris`, branche `main`
- Licence MIT

## Structure
```
manifest.json                MV3, permission "storage", host VIES
background.js                chrome.action.onClicked → ouvre popup.html en onglet
popup.html                   3 onglets : Déclaration / Articles / Configuration
popup.css                    Styles
popup.js                     Orchestration (nav onglets, flow analyse)
lib/
  xlsx.full.min.js           SheetJS full (MIT), lecture Excel + écriture ODS
  eu.js                      Constantes UE, mapping ISO3→ISO2, prefixes VAT (EL≠GR, XI)
  storage.js                 Wrapper chrome.storage.local (declarant + articles)
  vies.js                    Parse NII, appels VIES, retry, concurrency
  sage.js                    Parse TXT Sage 50 (encodage Windows-1252, format TSV)
  validators.js              Grille garde-fous, filtres par période, détection LIC
  generators.js              Génération ERTVA (.ods) et DEB stat (.csv)
icons/{16,48,128}.png        Icône : coche blanche sur fond bleu #2563eb
README.md                    Docs utilisateur
```

Pas de build. Pas de package.json. Pas de node_modules. Tout est statique. Chaque `lib/*.js` expose son API via `window.NomModule` :
- `window.EU` (`eu.js`) — codes pays, préfixes VAT, `getIgnoredVatPrefix` (IS/GB/CHE)
- `window.Vies` (`vies.js`) — `parseVat`, appels VIES avec retry, concurrency
- `window.Sage` (`sage.js`) — `parseSageTxt`, détection avoir/facture, clés de période
- `window.Validators` (`validators.js`) — `classifyFactures` (blockers/ignored/toDeclare), `collectCandidateNiis`, `detectPeriods`
- `window.Generators` (`generators.js`) — `generateErtvaOds`, `generateDebCsv`, `triggerDownload`
- `window.Storage` (`storage.js`) — wrapper `chrome.storage.local` (declarant + articles)

## Données stockées (`chrome.storage.local`)

- `declarant` : `{ nomEntreprise, nii, departement }`
- `articles` : `{ [codeArticle]: { description, codeSH, paysOrigine, poidsNet } }`

## Flux utilisateur

1. **Onglet Configuration** (une fois) : renseigner Nom entreprise + NII français + département.
2. **Onglet Articles** : ajouter les codes articles Sage avec leur code SH8, pays d'origine, poids net unitaire. Import Excel possible pour la 1re fois.
3. **Onglet Déclaration** :
   - Glisser le TXT Sage 50 (menu Sage : *Fichier → Liste → Pièces clients → Exporter*)
   - L'extension détecte la ou les périodes présentes dans le fichier
   - Si plusieurs mois → dropdown pour choisir. Sinon → auto-sélection
   - Cliquer « Analyser » : parcourt les factures UE hors FR à 0 % de TVA, vérifie chaque NII sur VIES
   - Si **anomalie** → écran rouge listant toutes les corrections à faire dans Sage/mapping
   - Si **OK** → 2 boutons de téléchargement (ERTVA + DEB) + tableau récapitulatif des factures déclarées

## Logique de filtrage

Une facture est **candidate LIC** (à déclarer) si :
- Pays client ∈ UE **hors France**
- Toutes ses lignes ont un **taux TVA = 0 %**
- Un **NII** client est renseigné
- Le NII est **valide sur VIES**
- Le préfixe pays du NII correspond au pays du client (ex. facture BE → NII commence par BE)

Sont **ignorées silencieusement** (pas une erreur) :
- Factures France
- Factures pays hors UE
- Factures BtoC en UE (TVA > 0 %, pas de NII)
- Factures dont le NII commence par `IS`, `GB` ou `CHE` (Islande, Royaume-Uni, Suisse — hors VIES). Voir `IGNORED_VAT_PREFIXES` dans `lib/eu.js`.

Sont **bloquantes** (l'export est refusé, la cliente doit corriger) :
- Pays UE + TVA 0 % + NII manquant
- Pays UE + NII présent + TVA ≠ 0 % (incohérence, à vérifier dans Sage)
- Lignes de facture mixtes (certaines à 0 %, d'autres non)
- NII commence par FR sur une facture pays UE (autoconsommation)
- NII d'un pays différent du pays client
- NII refusé par VIES
- VIES injoignable (après 3 retries)
- Code SH ou pays d'origine manquant pour un article présent sur une facture LIC
- Poids net unitaire = 0 dans le mapping article

**Politique tout-ou-rien** : dès qu'une facture candidate a une anomalie, l'export est bloqué. Voir `memory/feedback_strict_validation.md`.

## Format des fichiers générés

### ERTVA (`.ods`)
3 colonnes sans en-tête :
- A : code régime — `21` pour une facture (LIC exonérée), `25` pour un avoir (minoration de valeur)
- B : montant HT arrondi entier — **négatif** pour les lignes avoir (convention pro.douane de minoration)
- C : NII client (préfixe pays)

**1 ligne facture (+, régime 21) et 1 ligne avoir (−, régime 25) séparées par NII.** Un client peut donc apparaître sur 1 ou 2 lignes.

### DEB statistique (`.csv`)
21 colonnes séparées par `;`, en-tête inclus.

| # | Colonne | Valeur |
|---|---|---|
| 1 | Code flux | `2` (expédition) |
| 2 | N° déclaration | vide (pro.douane attribue) |
| 3 | N° ligne | 1, 2, 3… |
| 4 | Numéro TVA | NII déclarant (config) |
| 5 | Département | département déclarant (config) |
| 6 | Mode transport | `3` (route) |
| 7 | Pays destination | ISO2 |
| 8 | Nature transaction | `11` (facture) / `21` (avoir = retour) |
| 9 | Valeur fiscale | vide |
| 10 | Régime | `21` (facture) / `29` (avoir = retour) |
| 11 | Niveau obligations | `1` |
| 12 | Nomenclature | code SH8 (mapping article) |
| 13 | NGP | vide |
| 14 | Masse nette (kg) | Σ qté × poids unitaire, arrondi entier |
| 15 | Valeur statistique | Σ qté × PU HT, arrondi entier |
| 16 | Unités supplémentaires | Σ quantité, arrondi entier |
| 17 | Pays origine | ISO2 (mapping article) |
| 18 | NII partenaire | NII client |
| 19 | Code PMNA | vide |
| 20 | Ref interne | vide |
| 21 | Période | MMYYYY |

**Agrégation par (NII × code SH × pays origine × rôle facture|avoir).** Les avoirs sont sur des lignes séparées avec valeurs négatives.

## Valeurs figées (constantes en tête de `generators.js`)

- `REGIME_LIC_FACTURE = 21` (facture, ERTVA et DEB)
- `REGIME_LIC_AVOIR_DEB = 29` (avoir de retour, DEB stat)
- `REGIME_LIC_AVOIR_ERTVA = 25` (avoir = minoration de valeur, ERTVA)
- `CODE_FLUX_EXPEDITION = 2`
- `MODE_TRANSPORT_ROUTE = 3`
- `NATURE_TRANSACTION_VENTE = 11` (facture)
- `NATURE_TRANSACTION_RETOUR = 21` (avoir de retour, DEB stat)
- `NIVEAU_OBLIGATION = 1`

**Hypothèse** : tous les avoirs sont traités comme des **retours** (régime DEB 29, nature 21). Si un jour la cliente émet des avoirs qui ne sont pas des retours (remise commerciale, correction de prix…), il faut adapter le code régime selon la doc douanière — voir email conseiller douane du 2026-09-28.

## Parser Sage 50

- Encodage détecté auto : BOM UTF-8 → utf-8, sinon Windows-1252 (par défaut Sage)
- Format tabulé (TSV), une ligne `E` (entête pièce) suivie de N lignes `L` (articles)
- Colonnes détectées par pattern (insensible aux accents), pas par index — robuste aux variations d'export
- Colonnes obligatoires : `Type de Ligne`, `Type de pièce`, `N° pièce`, `Date pièce`, `Code pays`, `Taux TVA`, `Code article`, `Quantité`, `PU HT`
- Détection avoirs : regex `/avoir/i` sur `Type de pièce`

## Pays

- **27 UE** en ISO2 + `EL` (Grèce en VAT) + `XI` (Irlande du Nord)
- Sage utilise ISO3 (`FRA`, `BEL`, `ITA`…) → conversion via `EU.iso3ToIso2`
- Grèce : Sage code `GRC`/`GR`, VIES exige `EL`
- Ne PAS ajouter `GB` : VIES ne couvre plus la Grande-Bretagne. `XI` (Irlande du Nord) OK.

## API VIES (inchangée)

- **Endpoint** : `POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number`
- `CONCURRENCY = 4`, `RETRY_DELAYS_MS = [600, 1800, 4500]`
- Autorisé via `host_permissions: ["https://ec.europa.eu/*"]`

## Contraintes techniques

- **Manifest V3** : pas de CDN pour les scripts → SheetJS bundlé dans `lib/`
- Pas d'`innerHTML` avec contenu dynamique. Utiliser `document.createElement` + `textContent`. `clearNode()` helper pour vider.
- Service worker `background.js` uniquement pour le clic action
- Pas de framework : vanilla JS, chaque module expose son API via `window.NomModule`
- Icônes : PNG (Chrome ne charge pas les SVG en `action.default_icon`)

## Tâches courantes

- **Ajouter un pays UE** (peu probable) : `EU_COUNTRIES_ISO2` + `VALID_VAT_PREFIXES` + `ISO3_TO_ISO2` dans `lib/eu.js`
- **Ajouter une règle de validation** : `classifyFactures` dans `lib/validators.js`, ajouter un `blockers.push(...)` avec un `code` et un `message` clair
- **Changer un code figé DEB** (régime, transport, nature) : constantes en tête de `lib/generators.js`
- **Changer la vitesse VIES** : `CONCURRENCY` ou `RETRY_DELAYS_MS` dans `lib/vies.js`
- **Ajouter un code d'erreur VIES connu** : `viesErrorLabel` dans `lib/vies.js`
- **Bumper la version** : `manifest.json` → `"version": "2.x.y"`. La cliente doit recharger l'extension dans `chrome://extensions` (bouton 🔄)

## Debug & test local

Pas de tests automatisés. Toute validation se fait dans le navigateur, sur un vrai export Sage 50 fourni par la cliente.

- **Charger l'extension** : `chrome://extensions` → activer « Mode développeur » (coin haut-droit) → « Charger l'extension non empaquetée » → sélectionner le dossier racine (celui contenant `manifest.json`).
- **Recharger après modif** : bouton 🔄 sur la carte de l'extension dans `chrome://extensions`. Recharger l'onglet popup ensuite.
- **Console popup** : F12 dans l'onglet ouvert par l'icône. C'est ici que remontent les erreurs de `popup.js` et des modules `lib/*.js`.
- **Console service worker** : `chrome://extensions` → sur la carte de l'extension, lien « service worker ». Pour débugger `background.js` (peu utile ici, il ne fait qu'ouvrir le popup).
- **Fichier de test** : la cliente en fournit sur demande. Ne pas committer d'exports Sage dans le repo (données clients réelles).

## Workflow modif → push

1. Modifier local.
2. Prévenir la cliente + rappel : recharger l'extension dans `chrome://extensions`.
3. Elle valide dans le navigateur.
4. Commit + `git push origin main`. Pas de PR, pas de CI.

## À éviter
- Ne PAS ajouter de télémétrie / analytics / hébergement externe (argument marketing du README).
- Ne PAS toucher au fichier Sage source (lecture seule).
- Ne PAS générer de fichiers partiels si anomalies : politique tout-ou-rien (voir memory).
- Ne PAS supporter GB (Brexit). `XI` uniquement.
- Ne PAS assouplir les garde-fous « pour laisser passer » : la cliente préfère corriger la source que déposer un fichier rejeté.
