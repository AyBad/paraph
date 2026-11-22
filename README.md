# Paraph – Remplir & signer

Application pour remplir des formulaires PDF et Word, puis les signer.

- **Branche `android`** : application Android (Capacitor). Chaque push construit un APK : <https://github.com/AyBad/paraph/releases/latest/download/Paraph.apk>
- **Branche `ios`** : application web installable sur iPhone (Safari → Partager → « Sur l'écran d'accueil ») : <https://aybad.github.io/paraph/>

## Fonctions
- Ouverture PDF, Word (.docx, converti en PDF) et photos
- Détection des champs de formulaire PDF + remplissage automatique depuis le profil
- Texte, coche, croix, barrer, stylo libre, date, infos du profil, signature et paraphe (taille et couleur ajustables)
- Plusieurs profils (nom, prénom, date et lieu de naissance, adresse, e-mail, téléphone, couleur, signature, paraphe) ; changement de profil en cours de remplissage
- Enregistrement avec renommage, téléchargement, partage (e-mail, WhatsApp, Messenger…)
- 39 langues, langue du téléphone par défaut, arabe/persan/ourdou en RTL
- 100 % local : aucun envoi sur un serveur

## Développement sur PC (Windows)

### Installation (une seule fois)
1. Installer **Git** : <https://git-scm.com/download/win> (options par défaut).
2. Installer **Node.js 22 LTS** : <https://nodejs.org/>.
3. Installer **Visual Studio Code** : <https://code.visualstudio.com/>.
4. Dans VS Code : `Ctrl+Maj+P` → « Git: Clone » → `https://github.com/AyBad/paraph` → choisir un dossier (par ex. `C:\Dev`). Se connecter à GitHub quand VS Code le demande.
5. Ouvrir le dossier cloné, accepter « Installer les extensions recommandées » (Playwright, GitHub, GitLens, EditorConfig).
6. Terminal de VS Code (`Ctrl+ù`) :
   ```
   git checkout android
   npm install
   npm run test:install
   ```

### Au quotidien
| Commande | Rôle |
|---|---|
| `npm run dev` | Lance l'application dans le navigateur (rechargée à chaque modification) |
| `npm test` | Tous les tests automatiques (≈ 5 min) |
| `npm run test:ui` | Fenêtre de test : choisir un test, le voir s'exécuter pas à pas |
| `npm run test:voir` | Tests un par un dans une fenêtre de téléphone visible, ralentis et filmés (vidéos dans le rapport) |
| `npm run test:apk` | Tests de la vraie application Android dans un émulateur (voir `maestro/README.md`) |
| `npm run test:report` | Rapport des derniers tests (captures, traces des échecs) |
| `npx playwright test profiles` | Seulement les tests dont le fichier contient « profiles » |

Dans VS Code, l'onglet **Tests** (fiole) liste aussi chaque test avec un bouton ▶.

### Tests automatiques (`tests/`)
- `startup.spec.js` : animation de démarrage, délai de 10 min, menu.
- `profiles.spec.js` : nom unique, nom vide, 5 profils gratuits.
- `forms.spec.js` : chaque formulaire de `samples/formulaires/` est ouvert, rempli, enregistré et téléchargé ; le fichier produit est vérifié. Les minimums de zones détectées sont dans `MIN`.
- `languages.spec.js` : les 39 langues (aucun texte manquant, sens d'écriture).

Les tests tournent aussi sur GitHub à chaque envoi (workflow « Tests automatiques ») ; le rapport est téléchargeable dans l'onglet Actions.

### Branches et publication
- Travailler sur **`android`**, puis reporter le commit sur **`ios`** (`git checkout ios` puis `git cherry-pick <commit>`).
- Un envoi sur `android` construit l'APK (Releases) ; un envoi sur `ios` met à jour la version iPhone.
- Les fichiers propres à Android (`android/`, `capacitor.config.json`) n'existent que sur la branche `android`.

### Application Android sur le PC (facultatif)
Pour construire l'APK localement ou lancer l'application sur un téléphone branché en USB : installer **Android Studio**, puis
```
npm run build
npx cap sync android
npx cap open android
```
