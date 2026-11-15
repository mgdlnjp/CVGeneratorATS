// CV Generator ATS — serveur local sans dépendance.
// Utilise le CLI `claude` (ton abonnement Claude) en mode headless.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFile } = require("child_process");

const PORT = process.env.PORT || 3456;
const DATA_DIR = path.join(__dirname, "data");
const PROFILE_FILE = path.join(DATA_DIR, "profil.txt");
const HISTORY_DIR = path.join(DATA_DIR, "historique");
const LAST_FILE = path.join(DATA_DIR, "dernier-cv.json"); // dernier CV affiché (avec corrections manuelles)
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const MODEL = process.env.CV_MODEL || ""; // ex: "opus" ou "sonnet" ; vide = modèle par défaut

fs.mkdirSync(HISTORY_DIR, { recursive: true });

// ---------- Récupération de l'annonce ----------
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

// Beaucoup de sites (Indeed, WTTJ, LinkedIn public, APEC…) exposent un JSON-LD JobPosting.
function extractJobPosting(html) {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    try {
      const data = JSON.parse(b[1].trim());
      const items = Array.isArray(data) ? data : data["@graph"] || [data];
      for (const it of items) {
        if (it && /JobPosting/i.test(String(it["@type"]))) {
          const parts = [
            it.title && `Intitulé : ${it.title}`,
            it.hiringOrganization?.name && `Entreprise : ${it.hiringOrganization.name}`,
            it.jobLocation && `Lieu : ${JSON.stringify(it.jobLocation?.address || it.jobLocation)}`,
            it.employmentType && `Contrat : ${it.employmentType}`,
            it.description && `Description :\n${htmlToText(decodeEntities(it.description))}`,
            it.qualifications && `Qualifications : ${htmlToText(String(it.qualifications))}`,
            it.skills && `Compétences : ${htmlToText(String(it.skills))}`,
            it.responsibilities && `Responsabilités : ${htmlToText(String(it.responsibilities))}`,
          ].filter(Boolean);
          if (parts.length) return parts.join("\n");
        }
      }
    } catch (_) { /* JSON invalide, on ignore */ }
  }
  return null;
}

async function fetchJobAd(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`le site a répondu ${res.status}`);
  const html = await res.text();
  const structured = extractJobPosting(html);
  const text = structured || htmlToText(html);
  return text.slice(0, 25000);
}

// ---------- Extraction du texte d'un fichier déposé (PDF, Word…) ----------
// Outils intégrés à macOS, aucune dépendance : PDFKit (via JXA) et textutil.
const MAX_UPLOAD = 15 * 1024 * 1024;
const TEXTUTIL_EXT = new Set([".doc", ".docx", ".rtf", ".rtfd", ".odt", ".html", ".htm", ".webarchive", ".wordml"]);
const PDF_JXA = 'function run(a){ObjC.import("PDFKit");var d=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(a[0]));return d.isNil()?"":d.string.js}';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 20 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().slice(0, 300)));
      resolve(stdout);
    });
  });
}

function cleanText(t) {
  return t.replace(/\r\n?/g, "\n").replace(/[ \t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractText(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  if ([".txt", ".md", ".markdown", ".csv"].includes(ext)) return cleanText(buffer.toString("utf8"));
  if (ext !== ".pdf" && !TEXTUTIL_EXT.has(ext)) {
    throw new Error(`format ${ext || "inconnu"} non pris en charge (PDF, Word, RTF, ODT ou texte)`);
  }
  const tmp = path.join(os.tmpdir(), `cvgen-${process.pid}-${Date.now()}${ext}`);
  fs.writeFileSync(tmp, buffer);
  try {
    const out = ext === ".pdf"
      ? await run("osascript", ["-l", "JavaScript", "-e", PDF_JXA, tmp])
      : await run("textutil", ["-convert", "txt", "-stdout", tmp]);
    return cleanText(out);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > limit) { reject(new Error("Fichier trop lourd (15 Mo max).")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------- Appel à Claude ----------
const GENERATE_RULES = `Tu es un expert en recrutement, en rédaction de CV et en optimisation pour les ATS (Applicant Tracking Systems : Workday, Taleo, SmartRecruiters, Greenhouse, Lever, Teamtailor, Welcome Kit, etc.).
Ta mission : à partir du PROFIL du candidat et d'une ANNONCE, produire le CV le plus pertinent possible pour cette annonce.

Règles absolues :
1. N'INVENTE JAMAIS d'expérience, de diplôme, d'entreprise, de date, de chiffre ou de compétence absente du profil. Tu peux reformuler, réordonner, mettre en avant, regrouper, et utiliser le vocabulaire exact de l'annonce quand il décrit fidèlement ce que le candidat a réellement fait.
2. Les compétences demandées par l'annonce mais absentes du profil vont UNIQUEMENT dans "mots_cles_manquants" (avec un conseil), jamais dans le CV.
3. Reprends les mots-clés de l'annonce à l'identique (même orthographe, même forme, sigle + forme longue, ex. "Gestion de projet (PMO)") car les ATS font du matching littéral.
4. Le titre du CV reprend l'intitulé exact du poste de l'annonce (si cohérent avec le profil).
5. Rédige dans la langue de l'annonce.
6. Puces d'expérience : verbe d'action + tâche + résultat chiffré quand le profil fournit le chiffre. 3 à 6 puces par poste récent, moins pour les anciens. Priorise ce qui correspond à l'annonce.
7. Sections standard reconnues par les ATS uniquement. Pas de tableaux, pas d'icônes, pas de jauges de niveau.
8. Le CV doit tenir sur UNE SEULE page A4, sans exception (police 10 pt, marges 15 mm, une colonne). Budget à respecter :
   - environ 450 à 550 mots au total ;
   - accroche : 2 à 3 lignes maximum ;
   - compétences : 3 à 5 catégories, une ligne chacune ;
   - 3 à 4 expériences détaillées maximum (les plus pertinentes pour l'annonce), 2 à 4 puces chacune, une puce = une ligne (deux au plus) ;
   - expériences plus anciennes ou peu pertinentes : regroupées en une ligne chacune sans puce, ou omises ;
   - formation : une ligne par diplôme, seulement les plus pertinents ;
   - "autres" seulement s'il reste de la place.
   Mieux vaut couper du contenu peu pertinent que de déborder sur une deuxième page.`;

// Format de réponse commun à la génération et à l'intégration de mots-clés
const JSON_FORMAT = `Réponds UNIQUEMENT avec un objet JSON valide (pas de texte autour, pas de bloc markdown), au format :
{
  "langue": "fr" | "en" | ...,
  "poste_cible": "intitulé exact de l'annonce",
  "entreprise": "nom de l'entreprise si connu",
  "cv": {
    "nom": "", "titre": "",
    "contact": { "email": "", "telephone": "", "localisation": "", "linkedin": "", "site": "" },
    "resume": "accroche de 3-4 lignes ciblée sur l'annonce",
    "competences": [ { "categorie": "", "elements": ["", ""] } ],
    "experiences": [ { "poste": "", "entreprise": "", "lieu": "", "debut": "", "fin": "", "puces": [""] } ],
    "formation": [ { "diplome": "", "etablissement": "", "lieu": "", "annee": "", "details": "" } ],
    "certifications": [""],
    "langues": [ { "langue": "", "niveau": "" } ],
    "autres": [ { "titre": "", "elements": [""] } ]
  },
  "analyse_ats": {
    "score_estime": 0-100,
    "mots_cles_annonce": [""],
    "mots_cles_couverts": [""],
    "mots_cles_manquants": [ { "mot_cle": "", "conseil": "" } ],
    "conseils": [""]
  }
}
Les titres des sections du CV seront générés par l'application selon "langue". Laisse vides ("" ou []) les champs sans information.`;

const SYSTEM_PROMPT = `${GENERATE_RULES}\n\n${JSON_FORMAT}`;

// Intégration de mots-clés que le candidat a cochés (il confirme les maîtriser)
const INTEGRATE_PROMPT = `Tu es un expert en rédaction de CV et en optimisation pour les ATS.
On te donne le CV ACTUEL d'un candidat (déjà adapté à une annonce, et peut-être corrigé à la main par lui), son PROFIL complet, l'ANNONCE, et une liste de MOTS-CLÉS de l'annonce que le candidat a cochés : il confirme les maîtriser réellement.
Ta mission : renvoyer le CV mis à jour avec ces mots-clés intégrés.

Règles absolues :
1. Pars du CV ACTUEL et conserve-le au maximum (contenu, formulations, ordre, corrections du candidat). Ne modifie que ce qui est nécessaire pour intégrer les mots-clés.
2. Reprends chaque mot-clé coché à l'identique (même orthographe que l'annonce), au moins une fois dans le CV.
3. Place chaque mot-clé à l'endroit le plus naturel : dans "competences" (catégorie adaptée) en priorité, et dans l'accroche s'il est central pour le poste.
4. Ne l'insère dans une puce d'expérience que si la précision du candidat ou le profil indique clairement où il l'a utilisé. N'invente JAMAIS d'expérience, de chiffre, de résultat ni de contexte.
5. Le CV doit toujours tenir sur UNE page A4 : si tu ajoutes, raccourcis ailleurs le contenu le moins pertinent.
6. Mets à jour "analyse_ats" : les mots-clés intégrés passent dans "mots_cles_couverts" et sortent de "mots_cles_manquants" ; recalcule "score_estime" ; garde les autres mots-clés manquants et adapte les conseils.
7. Garde la langue, le "poste_cible" et l'"entreprise" du CV actuel.

${JSON_FORMAT}`;

function runClaude(userPrompt, systemPrompt = SYSTEM_PROMPT) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--output-format", "json",
      "--tools", "",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--system-prompt", systemPrompt,
    ];
    if (MODEL) args.push("--model", MODEL);
    const child = spawn(CLAUDE_BIN, args, { cwd: os.tmpdir(), env: process.env });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Délai dépassé (5 min)")); }, 300000);
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("error", e => { clearTimeout(timer); reject(new Error(`Impossible de lancer "claude" : ${e.message}`)); });
    child.on("close", code => {
      clearTimeout(timer);
      let envelope;
      try { envelope = JSON.parse(out); } catch (_) {
        return reject(new Error(`Réponse illisible de claude (code ${code}). ${err || out}`.slice(0, 1500)));
      }
      if (envelope.is_error) return reject(new Error(`Erreur Claude : ${envelope.result || err}`.slice(0, 1500)));
      resolve(String(envelope.result || ""));
    });
    child.stdin.end(userPrompt);
  });
}

function parseModelJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error("Claude n'a pas renvoyé de JSON exploitable.");
}

// ---------- HTTP ----------
function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 2e6) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return send(res, 200, fs.readFileSync(path.join(__dirname, "public", "index.html")), "text/html; charset=utf-8");
    }

    if (url.pathname === "/api/profile") {
      if (req.method === "GET") {
        const profile = fs.existsSync(PROFILE_FILE) ? fs.readFileSync(PROFILE_FILE, "utf8") : "";
        return send(res, 200, { profile });
      }
      if (req.method === "POST") {
        const { profile = "" } = await readBody(req);
        fs.writeFileSync(PROFILE_FILE, profile);
        return send(res, 200, { ok: true });
      }
    }

    if (url.pathname === "/api/last") {
      if (req.method === "GET") {
        let last = {};
        try { last = JSON.parse(fs.readFileSync(LAST_FILE, "utf8")); } catch (_) { /* pas encore de CV */ }
        return send(res, 200, last);
      }
      if (req.method === "POST") {
        const last = await readBody(req);
        if (!last || typeof last.result !== "object") return send(res, 400, { error: "CV manquant." });
        fs.writeFileSync(LAST_FILE, JSON.stringify(last, null, 2));
        return send(res, 200, { ok: true });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/extract") {
      const filename = decodeURIComponent(req.headers["x-filename"] || "");
      try {
        const buffer = await readRaw(req, MAX_UPLOAD);
        if (!buffer.length) throw new Error("fichier vide");
        const text = await extractText(buffer, filename);
        if (text.length < 20) {
          throw new Error("aucun texte trouvé : le PDF est sans doute une image scannée");
        }
        return send(res, 200, { text, chars: text.length });
      } catch (e) {
        return send(res, 422, { error: `Lecture impossible de « ${filename || "fichier"} » (${e.message}).` });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/fetch-job") {
      const { url: jobUrl = "" } = await readBody(req);
      if (!/^https?:\/\//i.test(jobUrl)) return send(res, 400, { error: "Lien invalide (doit commencer par http:// ou https://)." });
      try {
        const text = await fetchJobAd(jobUrl);
        if (text.length < 200) throw new Error("page quasi vide, sans doute protégée ou chargée en JavaScript");
        return send(res, 200, { text });
      } catch (e) {
        return send(res, 422, { error: `Impossible de lire l'annonce (${e.message}). Copie-colle son texte dans la case prévue.` });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const { jobText = "", profile = "", instructions = "" } = await readBody(req);
      if (!profile.trim()) return send(res, 400, { error: "Ton profil / CV de base est vide." });
      if (jobText.trim().length < 80) return send(res, 400, { error: "Le texte de l'annonce est vide ou trop court." });

      const prompt = `=== PROFIL DU CANDIDAT (source de vérité, ne rien inventer au-delà) ===
${profile}

=== ANNONCE ===
${jobText}
${instructions.trim() ? `\n=== CONSIGNES SUPPLÉMENTAIRES DU CANDIDAT ===\n${instructions}\n` : ""}
Produis maintenant le JSON demandé.`;

      const raw = await runClaude(prompt);
      const result = parseModelJson(raw);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.writeFileSync(path.join(HISTORY_DIR, `${stamp}.json`), JSON.stringify({ jobText, result }, null, 2));
      return send(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/integrate") {
      const { profile = "", jobText = "", cvText = "", current = null, keywords = [] } = await readBody(req);
      const picks = (Array.isArray(keywords) ? keywords : [])
        .map(k => ({ mot_cle: String(k?.mot_cle || "").trim(), note: String(k?.note || "").trim() }))
        .filter(k => k.mot_cle);
      if (!picks.length) return send(res, 400, { error: "Coche au moins un mot-clé." });
      if (!current || typeof current !== "object") return send(res, 400, { error: "Aucun CV à modifier : génère d'abord un CV." });

      const prompt = `=== PROFIL DU CANDIDAT ===
${profile}

=== ANNONCE ===
${jobText}

=== CV ACTUEL (JSON) ===
${JSON.stringify(current)}
${cvText.trim() ? `\n=== CV ACTUEL TEL QU'AFFICHÉ (texte, avec les corrections manuelles du candidat ; il fait foi s'il diffère du JSON) ===\n${cvText}\n` : ""}
=== MOTS-CLÉS À INTÉGRER (le candidat confirme les maîtriser) ===
${picks.map(k => `- ${k.mot_cle}${k.note ? ` — précision du candidat : ${k.note}` : ""}`).join("\n")}

Produis maintenant le JSON demandé.`;

      const raw = await runClaude(prompt, INTEGRATE_PROMPT);
      const result = parseModelJson(raw);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.writeFileSync(path.join(HISTORY_DIR, `${stamp}-integration.json`), JSON.stringify({ jobText, keywords: picks, result }, null, 2));
      return send(res, 200, result);
    }

    send(res, 404, { error: "Introuvable" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message || String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  CV Generator ATS prêt → http://localhost:${PORT}\n`);
});
