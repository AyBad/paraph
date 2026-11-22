# Tests de l'APK sur un émulateur Android (Maestro)

Ces tests pilotent **la vraie application Android** dans un téléphone virtuel : on voit chaque appui à l'écran, et des captures sont enregistrées dans `maestro/captures/`.

## Installation (une seule fois)
1. **Android Studio** : <https://developer.android.com/studio> (installation par défaut).
2. Android Studio → *More Actions* → **Virtual Device Manager** → *Create device* → **Pixel 8** → image système **API 35** (télécharger) → *Finish* → ▶ pour démarrer l'émulateur.
3. Dans l'émulateur : *Paramètres → Système → Langues* → **Français** (les tests cherchent les textes français).
4. **Java 17 ou plus** : déjà fourni par Android Studio. Dans PowerShell :
   ```
   setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
   setx PATH "%PATH%;%LOCALAPPDATA%\Android\Sdk\platform-tools"
   ```
   puis fermer et rouvrir VS Code.
5. **Maestro** : suivre <https://docs.maestro.dev/getting-started/installing-maestro/windows> (télécharger, décompresser dans `C:\maestro`, ajouter `C:\maestro\bin` au PATH).
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
