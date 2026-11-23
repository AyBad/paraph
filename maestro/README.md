# Tests de l'APK sur un émulateur Android (Maestro)

Ces tests pilotent **la vraie application Android** dans un téléphone virtuel : on voit chaque appui à l'écran, et des captures sont enregistrées dans `maestro/captures/`.

## Installation (une seule fois)
1. **Android Studio** : <https://developer.android.com/studio> (installation par défaut).
2. Android Studio → *More Actions* → **Virtual Device Manager** → *Create device* → **Pixel 8** → image système **API 35** (télécharger) → *Finish* → ▶ pour démarrer l'émulateur.
3. Dans l'émulateur : *Paramètres → Système → Langues* → **Français** (les tests cherchent les textes français).
4. **Java et Maestro** : dans le terminal de VS Code (dossier paraph) :
   ```
   powershell -ExecutionPolicy Bypass -File scripts\install-maestro.ps1
   ```
   Le script règle Java (celui d'Android Studio), installe Maestro dans `C:\maestro` et met à jour le PATH. Ensuite, **fermer complètement VS Code et le rouvrir**.
5. Vérifier : `maestro --version` et `adb devices` (l'émulateur doit apparaître comme `device`).
6. Installer l'APK : télécharger <https://github.com/AyBad/paraph/releases/latest/download/Paraph.apk> et le **glisser sur la fenêtre de l'émulateur**.
7. Pour le test du formulaire, glisser aussi `samples/formulaires/pdf-sans-champs-attestation-domicile-pointilles.pdf` sur l'émulateur.

## Lancer les tests
L'émulateur doit être démarré.
```
npm run test:apk                       # tous les scénarios
maestro test maestro/02-profils.yaml   # un seul scénario
maestro studio                         # outil visuel : cliquer sur un élément pour écrire un test
```
Captures : `maestro/captures/`. Rapport : `maestro/rapport.xml`.

## Scénarios
| Fichier | Contenu |
|---|---|
| `01-demarrage.yaml` | animation, présentation, accueil |
| `02-profils.yaml` | nom de profil en double refusé, 5 profils gratuits |
| `03-menu.yaml` | menu, paramètres, retour au menu |
| `04-formulaire.yaml` | ouvrir un PDF, remplissage auto, enregistrer, télécharger |

Le sélecteur de fichiers d'Android change selon les versions : si `04-formulaire` bloque à l'ouverture du fichier, lancer `maestro studio` pour voir les textes affichés et ajuster le fichier.
