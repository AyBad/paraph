# Fiche Play Store – Paraph

**Nom** : Paraph – Remplir & Signer PDF
**Description courte (80 car.)** : Remplissez et signez vos formulaires PDF et Word en quelques secondes.

**Description longue**
Paraph remplit et signe vos formulaires administratifs (cerfa, contrats, attestations) directement sur votre téléphone.

- Ouvrez un PDF, un Word (.docx) ou une photo, ou scannez un document papier avec l'appareil photo
- Détection automatique des champs et remplissage en un geste depuis vos profils (nom, date et lieu de naissance, adresse décomposée…)
- Signature et paraphe dessinés ou importés, taille et couleur ajustables, déplaçables sur toutes les pages
- Texte, coche, croix, barrer, stylo libre, date
- Plusieurs profils, changement de profil en cours de remplissage
- Dossiers, recherche, renommage, partage par e-mail, WhatsApp, Messenger…
- 39 langues, thème sombre, verrouillage par code
- 100 % local : vos documents restent sur votre téléphone

**Catégorie** : Productivité · **Classification** : Tout public
**Politique de confidentialité** : https://aybad.github.io/paraph/privacy.html

## Étapes de publication
1. Créer un compte Google Play Console (25 $ une fois).
2. Créer l'application « Paraph », package `com.aybad.paraph`.
3. Remplacer la clé de test `android/app/paraph-test.keystore` par une vraie clé d'upload (secrets GitHub).
4. Créer un compte AdMob, remplacer les identifiants de test (`src/ads.js`, `AndroidManifest.xml`), activer le message de consentement RGPD.
5. Créer les produits d'abonnement (mensuel 1,99 €, annuel 11,99 €) et l'achat unique (18,99 €), puis brancher Google Play Billing.
6. Envoyer `Paraph.aab` (publié à chaque build dans les Releases) en test interne, puis en production.
