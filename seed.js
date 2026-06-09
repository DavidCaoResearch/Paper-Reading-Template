// One-time script: import all existing papers from filesystem into SQLite
// Usage: node seed.js [userId]  — userId for per_user mode
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const config = require('./config');
const db = require('./lib/db');

db.getDb(); // init DB

const userId = parseInt(process.argv[2]) || null;
const PAPERS_DIR = config.PAPERS_DIR;
const CLASS_DIR = config.CLASS_DIR;
const INDEX_FILE = path.join(PAPERS_DIR, 'README.md');

// ---- Parse master index ----
function parseMasterIndex() {
  const content = fs.readFileSync(INDEX_FILE, 'utf-8');
  const result = {};
  let currentClass = null;
  for (const line of content.split('\n')) {
    const h2 = line.match(/^## (.+)/);
    if (h2) { currentClass = h2[1].trim(); if (!result[currentClass]) result[currentClass] = []; continue; }
    const li = line.match(/^- \[(.+?)\]\((.+?)\)\s*—\s*(.+)/);
    if (li && currentClass) {
      result[currentClass].push({ title: li[1].trim(), href: li[2].trim(), description: li[3].trim() });
    }
  }
  return result;
}

// ---- Scan classification folders ----
function scanClassLinks() {
  const map = {};
  if (!fs.existsSync(CLASS_DIR)) return map;
  for (const cls of fs.readdirSync(CLASS_DIR)) {
    const clsPath = path.join(CLASS_DIR, cls);
    if (!fs.statSync(clsPath).isDirectory()) continue;
    for (const file of fs.readdirSync(clsPath)) {
      if (file.endsWith('.pdf')) {
        const title = file.replace(/\.pdf$/i, '');
        if (!map[title]) map[title] = [];
        map[title].push(cls);
      }
    }
  }
  return map;
}

// ---- Parse notes.md metadata ----
function parseNotesMeta(raw) {
  const meta = {};
  const lines = raw.split('\n');
  const patterns = {
    title: /^# (.+)/,
    authors: /^\*\*(Authors?|作者)\*\*[：:]\s*(.+)/,
    journal: /^\*\*(Journal|期刊)\*\*[：:]\s*(.+)/,
    doi: /^\*\*(DOI)\*\*[：:]\s*(.+)/,
    data: /^\*\*(Data|数据)\*\*[：:]\s*(.+)/,
    keywords: /^\*\*(Keywords?|关键词)\*\*[：:]\s*(.+)/,
  };

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i].trim();
    let m;
    if ((m = line.match(patterns.title))) meta.title = m[1];
    else if ((m = line.match(patterns.authors))) meta.authors = m[2].trim();
    else if ((m = line.match(patterns.journal))) meta.journal = m[2].trim();
    else if ((m = line.match(patterns.doi))) {
      meta.doi = m[2].trim();
      const urlMatch = meta.doi.match(/https?:\/\/[^\s)]+/);
      meta.doiUrl = urlMatch ? urlMatch[0] : null;
    } else if ((m = line.match(patterns.data))) {
      meta.data = m[2].trim();
      const urlMatch = meta.data.match(/https?:\/\/[^\s)]+/);
      meta.dataUrl = urlMatch ? urlMatch[0] : null;
    } else if ((m = line.match(patterns.keywords))) meta.keywords = m[2].trim();
    else if (line.startsWith('---')) break;
  }
  return meta;
}

// ---- Main import ----
console.log('Importing papers into database...');

const indexData = parseMasterIndex();
const classLinks = scanClassLinks();
const seen = new Set();
let imported = 0, withNotes = 0;

for (const [classification, entries] of Object.entries(indexData)) {
  for (const entry of entries) {
    if (seen.has(entry.title)) continue;
    seen.add(entry.title);

    const rawFolder = decodeURIComponent(entry.href.replace('./', '').split('/')[0]);
    const folderPath = path.join(PAPERS_DIR, rawFolder);

    // Collect classifications
    const allClasses = classLinks[entry.title] || [];
    if (!allClasses.includes(classification)) allClasses.push(classification);

    // Try to read notes
    let notesRaw = null, notesHtml = null, meta = {};
    const notesPath = path.join(folderPath, 'notes.md');
    if (fs.existsSync(notesPath)) {
      notesRaw = fs.readFileSync(notesPath, 'utf-8');
      notesHtml = marked.parse(notesRaw);
      meta = parseNotesMeta(notesRaw);
      withNotes++;
    }

    // Insert paper
    const paperId = db.seedPaper({
      title: entry.title,
      folderName: rawFolder,
      description: entry.description,
      classifications: allClasses,
    }, userId);

    // Update with notes if available
    if (notesRaw) {
      db.updatePaperNotes(rawFolder, notesRaw, notesHtml, meta, userId);
    }

    imported++;
  }
}

console.log(`Done: ${imported} papers imported, ${withNotes} with notes`);
console.log(`Classifications: ${db.listClassifications(userId).length}`);

// Verify
const stats = db.getStats(userId);
console.log(`DB check: ${stats.totalPapers} papers, ${stats.totalClassifications} classes`);
