const Database = require('better-sqlite3');
const path = require('path');
const config = require('../config');

// Main DB — always used for users/auth
let mainDb;
// Paper DB cache — for per_user mode, one per userId
const paperDbs = {};

function getMainDb() {
  if (!mainDb) {
    mainDb = new Database(config.DB_PATH);
    mainDb.pragma('journal_mode = WAL');
    mainDb.pragma('foreign_keys = ON');
    initSchema(mainDb);
    ensureDefaultAdmin(mainDb);
  }
  return mainDb;
}

// Alias — getDb always returns the main DB (for users/auth)
function getDb() { return getMainDb(); }

// Get paper DB: in shared mode = main DB; in per_user mode = user-specific DB
function getPaperDb(userId) {
  if (config.DB_MODE !== 'per_user' || !userId) return getMainDb();
  const dbPath = config.getDbPathForUser(userId);
  if (!paperDbs[dbPath]) {
    paperDbs[dbPath] = new Database(dbPath);
    paperDbs[dbPath].pragma('journal_mode = WAL');
    paperDbs[dbPath].pragma('foreign_keys = ON');
    initSchema(paperDbs[dbPath]);
  }
  return paperDbs[dbPath];
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      folder_name TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      authors TEXT DEFAULT '',
      journal TEXT DEFAULT '',
      doi TEXT DEFAULT '',
      doi_url TEXT DEFAULT '',
      data_url TEXT DEFAULT '',
      keywords TEXT DEFAULT '',
      notes_raw TEXT DEFAULT '',
      notes_html TEXT DEFAULT '',
      has_notes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS classifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_classifications (
      paper_id INTEGER NOT NULL,
      classification_id INTEGER NOT NULL,
      PRIMARY KEY (paper_id, classification_id),
      FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
      FOREIGN KEY (classification_id) REFERENCES classifications(id) ON DELETE CASCADE
    );
  `);
}

function ensureDefaultAdmin(db) {
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!row) {
    const bcrypt = require('bcrypt');
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hash);
  }
}

// ---- Password (always uses main DB) ----
function hashPassword(password) {
  const bcrypt = require('bcrypt');
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  const bcrypt = require('bcrypt');
  return bcrypt.compareSync(password, hash);
}

// ---- Users (always uses main DB) ----
function getUserByUsername(username) {
  return getMainDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return getMainDb().prepare('SELECT id, username, is_admin, created_at FROM users WHERE id = ?').get(id);
}

function listUsers() {
  return getMainDb().prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY id').all();
}

function createUser(username, password, isAdmin = 0) {
  const hash = hashPassword(password);
  return getMainDb().prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)').run(username, hash, isAdmin);
}

function deleteUser(id) {
  return getMainDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}

function changePassword(userId, newPassword) {
  const hash = hashPassword(newPassword);
  return getMainDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
}

// ---- Papers (uses paper DB based on mode) ----
function _db(userId) { return getPaperDb(userId); }

function listPapers(userId) {
  const db = _db(userId);
  const papers = db.prepare(`
    SELECT p.*, GROUP_CONCAT(c.name) AS class_names
    FROM papers p
    LEFT JOIN paper_classifications pc ON p.id = pc.paper_id
    LEFT JOIN classifications c ON pc.classification_id = c.id
    GROUP BY p.id
    ORDER BY p.title
  `).all();

  return papers.map(p => ({
    ...p,
    classifications: p.class_names ? p.class_names.split(',') : [],
    class_names: undefined,
  }));
}

function getPaper(id, userId) {
  const db = _db(userId);
  const paper = db.prepare(`
    SELECT p.*, GROUP_CONCAT(c.name) AS class_names
    FROM papers p
    LEFT JOIN paper_classifications pc ON p.id = pc.paper_id
    LEFT JOIN classifications c ON pc.classification_id = c.id
    WHERE p.id = ?
    GROUP BY p.id
  `).get(id);

  if (!paper) return null;
  paper.classifications = paper.class_names ? paper.class_names.split(',') : [];
  delete paper.class_names;
  return paper;
}

function getPaperByFolder(folderName, userId) {
  const db = _db(userId);
  const paper = db.prepare(`
    SELECT p.*, GROUP_CONCAT(c.name) AS class_names
    FROM papers p
    LEFT JOIN paper_classifications pc ON p.id = pc.paper_id
    LEFT JOIN classifications c ON pc.classification_id = c.id
    WHERE p.folder_name = ?
    GROUP BY p.id
  `).get(folderName);

  if (!paper) return null;
  paper.classifications = paper.class_names ? paper.class_names.split(',') : [];
  delete paper.class_names;
  return paper;
}

function updatePaperNotes(folderName, notesRaw, notesHtml, meta, userId) {
  const db = _db(userId);
  return db.prepare(`
    UPDATE papers SET
      notes_raw = ?, notes_html = ?, has_notes = 1,
      authors = COALESCE(NULLIF(?, ''), authors),
      journal = COALESCE(NULLIF(?, ''), journal),
      doi = COALESCE(NULLIF(?, ''), doi),
      doi_url = COALESCE(NULLIF(?, ''), doi_url),
      data_url = COALESCE(NULLIF(?, ''), data_url),
      keywords = COALESCE(NULLIF(?, ''), keywords),
      updated_at = datetime('now')
    WHERE folder_name = ?
  `).run(notesRaw, notesHtml, meta.authors || '', meta.journal || '',
    meta.doi || '', meta.doiUrl || '', meta.dataUrl || '',
    meta.keywords || '', folderName);
}

function deletePaper(id, userId) {
  const db = _db(userId);
  return db.prepare('DELETE FROM papers WHERE id = ?').run(id);
}

function searchPapers(query, userId, limit = 30) {
  const db = _db(userId);
  const q = `%${query}%`;
  return db.prepare(`
    SELECT p.*, GROUP_CONCAT(c.name) AS class_names
    FROM papers p
    LEFT JOIN paper_classifications pc ON p.id = pc.paper_id
    LEFT JOIN classifications c ON pc.classification_id = c.id
    WHERE p.title LIKE ? OR p.description LIKE ? OR p.keywords LIKE ?
       OR p.authors LIKE ? OR p.notes_raw LIKE ?
    GROUP BY p.id
    ORDER BY p.title
    LIMIT ?
  `).all(q, q, q, q, q, limit).map(p => ({
    ...p,
    classifications: p.class_names ? p.class_names.split(',') : [],
    class_names: undefined,
  }));
}

// ---- Classifications ----
function listClassifications(userId) {
  const db = _db(userId);
  return db.prepare(`
    SELECT c.id, c.name, COUNT(pc.paper_id) AS count
    FROM classifications c
    LEFT JOIN paper_classifications pc ON c.id = pc.classification_id
    GROUP BY c.id
    ORDER BY c.name
  `).all();
}

function getOrCreateClassification(name, userId) {
  const db = _db(userId);
  const trimmed = name.trim();
  if (!trimmed) return null;
  let row = db.prepare('SELECT id, name FROM classifications WHERE name = ?').get(trimmed);
  if (!row) {
    const result = db.prepare('INSERT INTO classifications (name) VALUES (?)').run(trimmed);
    row = { id: result.lastInsertRowid, name: trimmed };
  }
  return row;
}

function createClassification(name, userId) {
  const db = _db(userId);
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = db.prepare('SELECT id FROM classifications WHERE name = ?').get(trimmed);
  if (existing) return null;
  const result = db.prepare('INSERT INTO classifications (name) VALUES (?)').run(trimmed);
  return { id: result.lastInsertRowid, name: trimmed };
}

function deleteClassification(id, userId) {
  const db = _db(userId);
  db.prepare('DELETE FROM paper_classifications WHERE classification_id = ?').run(id);
  return db.prepare('DELETE FROM classifications WHERE id = ?').run(id);
}

function addPaperClassification(paperId, classificationName, userId) {
  const db = _db(userId);
  const cls = getOrCreateClassification(classificationName, userId);
  if (!cls) return;
  try {
    db.prepare('INSERT OR IGNORE INTO paper_classifications (paper_id, classification_id) VALUES (?, ?)').run(paperId, cls.id);
  } catch (_) {}
}

function removePaperClassification(paperId, classificationName, userId) {
  const db = _db(userId);
  const cls = db.prepare('SELECT id FROM classifications WHERE name = ?').get(classificationName);
  if (!cls) return;
  db.prepare('DELETE FROM paper_classifications WHERE paper_id = ? AND classification_id = ?').run(paperId, cls.id);
}

function setPaperClassifications(paperId, classNames, userId) {
  const db = _db(userId);
  db.prepare('DELETE FROM paper_classifications WHERE paper_id = ?').run(paperId);
  for (const name of classNames) {
    addPaperClassification(paperId, name, userId);
  }
}

function updatePaper(id, fields, userId) {
  const db = _db(userId);
  const allowed = ['title', 'authors', 'journal', 'doi', 'doi_url', 'data_url', 'keywords', 'description'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if (sets.length === 0) return null;
  vals.push(id);
  sets.push("updated_at = datetime('now')");
  return db.prepare(`UPDATE papers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

// ---- Stats ----
function getStats(userId) {
  const db = _db(userId);
  const totalPapers = db.prepare('SELECT COUNT(*) AS c FROM papers').get().c;
  const withNotes = db.prepare('SELECT COUNT(*) AS c FROM papers WHERE has_notes = 1').get().c;
  const totalClasses = db.prepare('SELECT COUNT(*) AS c FROM classifications').get().c;
  const topClasses = db.prepare(`
    SELECT c.name, COUNT(pc.paper_id) AS count
    FROM classifications c
    JOIN paper_classifications pc ON c.id = pc.classification_id
    GROUP BY c.id
    ORDER BY count DESC
    LIMIT 10
  `).all();

  return { totalPapers, totalClassifications: totalClasses, papersWithNotes: withNotes, topClassifications: topClasses };
}

// ---- Seed / Bootstrap ----
function seedPaper(paper, userId) {
  const db = _db(userId);
  const existing = db.prepare('SELECT id FROM papers WHERE folder_name = ?').get(paper.folderName);
  if (existing) return existing.id;

  const result = db.prepare(`
    INSERT INTO papers (title, folder_name, description, has_notes)
    VALUES (?, ?, ?, ?)
  `).run(paper.title, paper.folderName, paper.description || '', 0);

  for (const cls of paper.classifications || []) {
    addPaperClassification(result.lastInsertRowid, cls, userId);
  }
  return result.lastInsertRowid;
}

module.exports = {
  getDb, getMainDb, getPaperDb,
  hashPassword, verifyPassword,
  getUserByUsername, getUserById, listUsers, createUser, deleteUser, changePassword,
  listPapers, getPaper, getPaperByFolder, updatePaperNotes, deletePaper, searchPapers,
  listClassifications, getOrCreateClassification, createClassification, deleteClassification,
  addPaperClassification, removePaperClassification, setPaperClassifications,
  updatePaper, getStats, seedPaper,
};
