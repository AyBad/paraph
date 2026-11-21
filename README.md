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

## Développement
```
npm install
npm run dev      # navigateur
npm run build
```
