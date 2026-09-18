# Vérification Numéro TVA — Extension Chrome

Extension Chrome qui vérifie en masse les numéros de TVA intracommunautaire d'un fichier Excel / ODS / CSV via le service officiel **VIES** de la Commission européenne.

Idéale pour préparer une déclaration DEB / DES / état récapitulatif de TVA sans avoir à saisir chaque numéro à la main sur le site de la Commission.

## Fonctionnement

1. Glissez votre fichier (`.xlsx`, `.xls`, `.ods`, `.csv`)
2. L'extension détecte automatiquement la feuille et la colonne TVA (en cherchant « TVA », « VAT » ou un motif `AB12345678`)
3. Chaque numéro est vérifié en parallèle (4 requêtes simultanées) sur [VIES](https://ec.europa.eu/taxation_customs/vies/)
4. Retry automatique jusqu'à 3 fois si le service fiscal du pays est temporairement indisponible
5. Résultat filtré : ne s'affichent que les numéros à corriger (valides masqués par défaut)

**Le fichier d'origine n'est jamais modifié.** L'extension ne fait que lire et signaler.

## Capacités

- Formats acceptés : `.xlsx`, `.xls`, `.ods`, `.csv` (séparateur `;` ou `,`)
- Codes pays UE reconnus (+ Grèce `EL`, Irlande du Nord `XI`)
- Nettoyage automatique des espaces, tirets et points dans les numéros
- Retry sur erreur `MS_UNAVAILABLE`, `MS_MAX_CONCURRENT_REQ`, `SERVER_BUSY`, `TIMEOUT`
- Export copier-coller (TSV) des lignes en problème pour recherche rapide dans Excel

## Installation

1. Télécharger le repo (bouton **Code → Download ZIP**) et extraire
2. Ouvrir Chrome à l'adresse `chrome://extensions`
3. Activer le **Mode développeur** (en haut à droite)
4. Cliquer **Charger l'extension non empaquetée**
5. Sélectionner le dossier `Vérification Numéo TVA` (celui contenant `manifest.json`)
6. Épingler l'icône ✓ bleue dans la barre Chrome

## Utilisation

- Cliquer sur l'icône dans la barre Chrome → un nouvel onglet s'ouvre
- Glisser le fichier
- Cliquer **Vérifier**

## Statuts affichés

| Badge | Signification |
|---|---|
| 🟢 **Valide** | TVA reconnue par le service fiscal du pays |
| 🔴 **Non reconnu** | TVA rejetée par VIES — numéro à corriger |
| 🔴 **Format invalide** | Chaîne qui ne ressemble pas à un numéro TVA (2 lettres + chiffres) |
| 🔴 **Pays inconnu** | Code pays non couvert par VIES (hors UE) |
| 🟡 **Erreur réseau** | VIES ou le service du pays indisponible après 3 essais — à vérifier manuellement sur [VIES](https://ec.europa.eu/taxation_customs/vies/) |

## Confidentialité

- Aucun envoi vers un tiers autre que `ec.europa.eu` (VIES officiel)
- Aucune télémétrie, aucun stockage, aucune connexion externe supplémentaire
- Le code source complet est dans ce repo (250 lignes de JS lisibles)

## Structure

```
manifest.json          Manifest V3
background.js          Ouvre popup.html dans un nouvel onglet au clic
popup.html + popup.css + popup.js
lib/xlsx.mini.min.js   SheetJS (parsing xlsx/xls/ods/csv, MIT)
icons/                 3 tailles (16/48/128 px)
```

## Dépendances

- [SheetJS Community Edition](https://sheetjs.com/) (MIT) — lecture des fichiers tableur
- Aucune autre — pas de framework, pas de bundler, pas de build

## Licence

MIT — utilisez, modifiez, redistribuez librement.

## Contribuer

Les issues et pull requests sont les bienvenues. Idées d'améliorations :

- Support d'autres services de vérification hors UE (UK HMRC, Suisse UID)
- Export du rapport en PDF ou Excel
- Historique des vérifications
