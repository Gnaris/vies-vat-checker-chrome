# Déclaration DEB / ERTVA depuis Sage 50 — Extension Chrome

Extension Chrome qui convertit un export **Sage 50** (liste des pièces clients) en deux fichiers prêts à déposer sur **pro.douane** :

- **ERTVA** (`.ods`) — État récapitulatif TVA à l'expédition
- **DEB statistique** (`.csv`) — Réponse statistique à l'expédition et à l'introduction

Chaque numéro de TVA client est vérifié en amont sur le service officiel **VIES** de la Commission européenne. Si la moindre anomalie est détectée, l'export est bloqué et l'extension liste toutes les corrections à faire dans Sage — **jamais de fichier partiel envoyé à pro.douane**.

## Installation

1. Télécharger le repo (bouton **Code → Download ZIP**) et extraire
2. Ouvrir Chrome à l'adresse `chrome://extensions`
3. Activer le **Mode développeur** (en haut à droite)
4. Cliquer **Charger l'extension non empaquetée**
5. Sélectionner le dossier extrait (celui contenant `manifest.json`)
6. Épingler l'icône ✓ bleue dans la barre Chrome

## Utilisation

L'extension a trois onglets, à remplir dans cet ordre :

### 1. Configuration (une fois)
- Nom d'entreprise
- NII français (commence par `FR`)
- Département (2 chiffres, ex. `93`)

### 2. Articles (une fois, puis mise à jour à chaque nouveau code Sage)
Pour chaque code article utilisé dans Sage :
- Code SH8 (nomenclature douanière)
- Pays d'origine (ISO2, ex. `FR`, `CN`)
- Poids net unitaire (kg)

Import Excel possible pour la première initialisation.

### 3. Déclaration (à chaque déclaration mensuelle)
1. Dans Sage : *Fichier → Liste → Pièces clients → Exporter* → fichier `.txt`
2. Glisser le fichier dans l'onglet Déclaration
3. Choisir la période (auto-sélectionnée s'il n'y a qu'un mois)
4. Cliquer **Analyser** — l'extension vérifie chaque NII sur VIES
5. Si tout est OK → 2 boutons de téléchargement (ERTVA + DEB) + tableau récapitulatif
6. Si anomalie → liste rouge des corrections à faire dans Sage ou dans l'onglet Articles

## Ce qui est déclaré, ignoré, ou bloquant

**Déclaré** : facture pays UE hors France, TVA à 0 %, NII valide sur VIES avec bon préfixe pays.

**Ignoré silencieusement** :
- Factures France
- Factures pays hors UE
- Factures BtoC en UE (TVA > 0 %, sans NII)
- Factures avec NII `IS`, `GB` ou `CHE` (Islande, Royaume-Uni, Suisse — hors VIES)

**Bloquant** (à corriger avant re-génération) :
- Pays UE + TVA 0 % + NII manquant
- Pays UE + NII présent + TVA ≠ 0 % (incohérence)
- Lignes de facture mixtes (certaines à 0 %, d'autres non)
- NII français sur une facture pays UE
- NII de pays différent du pays client
- NII refusé par VIES
- VIES injoignable après 3 essais
- Article sans code SH ou pays d'origine renseigné dans l'onglet Articles
- Poids net unitaire à 0 dans l'onglet Articles

## Confidentialité

- Aucun envoi vers un tiers autre que `ec.europa.eu` (VIES officiel)
- Aucune télémétrie, aucun compte, aucun serveur
- Les données déclarant et articles restent dans `chrome.storage.local` (ne quittent pas votre navigateur)
- Le fichier Sage source n'est jamais modifié ni transmis
- Code source complet et lisible dans ce repo

## Structure du code

```
manifest.json          Manifest V3
background.js          Ouvre popup.html dans un nouvel onglet au clic sur l'icône
popup.html/css/js      3 onglets : Déclaration / Articles / Configuration
lib/
  xlsx.full.min.js     SheetJS (MIT) — lecture Excel, écriture ODS
  eu.js                Codes pays UE, préfixes VAT
  storage.js           Wrapper chrome.storage.local
  vies.js              Appels VIES + retry
  sage.js              Parser export Sage 50 (TSV, Windows-1252)
  validators.js        Grille de validation, détection LIC
  generators.js        Génération ERTVA (.ods) et DEB stat (.csv)
icons/                 16/48/128 px
```

Aucun build. Pas de `package.json`, pas de `node_modules`. Vanilla JS.

## Dépendances

- [SheetJS Community Edition](https://sheetjs.com/) (MIT) — lecture Excel et écriture ODS

## Licence

MIT — utilisez, modifiez, redistribuez librement.
