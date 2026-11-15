# CV Generator ATS

Génère un CV adapté à une annonce (lien ou texte), optimisé pour les ATS, avec ton abonnement Claude (CLI `claude`, pas de clé API).

## Lancer
- Double-clic sur **Lancer CV Generator.command** : l'app s'ouvre dans sa propre fenêtre (sans onglets ni barre d'adresse) et s'arrête quand tu la fermes.
- Ou `npm start` puis http://localhost:3456

## Utilisation
1. Glisse ton CV (PDF, Word .docx/.doc, RTF, ODT ou .txt) dans l'étape 1, ou colle son texte. Il est sauvegardé dans `data/profil.txt`.
2. Colle le lien de l'annonce, ou dépose le PDF / Word de l'offre → **Générer le CV adapté** (ou ⌘↵).
3. Relis/corrige directement dans l'aperçu, puis exporte en PDF / Word / texte.

Chaque génération est archivée dans `data/historique/`.
Modèle : `CV_MODEL=opus npm start` (par défaut : modèle par défaut de Claude Code).
Si un site bloque la lecture (LinkedIn connecté, etc.), colle le texte de l'annonce ou dépose-la en PDF.
La lecture des fichiers utilise les outils intégrés à macOS (PDFKit, textutil) : aucune dépendance à installer. Les PDF scannés (images) ne contiennent pas de texte et ne peuvent pas être lus.
