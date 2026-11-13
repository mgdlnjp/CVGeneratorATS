# CV Generator ATS

Génère un CV adapté à une annonce (lien ou texte), optimisé pour les ATS, avec ton abonnement Claude (CLI `claude`, pas de clé API).

## Lancer
- Double-clic sur **Lancer CV Generator.command**, ou `npm start` puis http://localhost:3456

## Utilisation
1. Colle ton profil complet (une seule fois, il est sauvegardé dans `data/profil.txt`).
2. Colle le lien de l'annonce → **Générer le CV adapté**.
3. Relis/corrige directement dans l'aperçu, puis exporte en PDF / Word / texte.

Chaque génération est archivée dans `data/historique/`.
Modèle : `CV_MODEL=opus npm start` (par défaut : modèle par défaut de Claude Code).
Si un site bloque la lecture (LinkedIn connecté, etc.), colle le texte de l'annonce dans la case prévue.
