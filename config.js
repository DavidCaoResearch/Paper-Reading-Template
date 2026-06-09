// Paper Reading Configuration
// Override via environment variables or .env file
// Priority: env var > .env value > default

const path = require('path');
const fs = require('fs');

// Try to load .env file (simple key=value parser)
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

// Load .env from project root
loadEnvFile(path.join(__dirname, '.env'));

// Base directory — where all data lives
const PROJECT_ROOT = __dirname;
const PAPERS_HOME = process.env.PAPERS_HOME || PROJECT_ROOT;

// Database mode: 'shared' = one DB for all users; 'per_user' = each user has own DB
const DB_MODE = process.env.PAPERS_DB_MODE || 'shared';

// Database path
const DB_PATH = process.env.PAPERS_DB_PATH || path.join(PAPERS_HOME, 'papers.db');

// Papers directory (original PDFs + notes)
const PAPERS_DIR = process.env.PAPERS_DIR || path.join(PAPERS_HOME, '原始文献');

// Classification links directory
const CLASS_DIR = process.env.PAPERS_CLASS_DIR || path.join(PAPERS_HOME, '文献分类');

// Changelog
const CHANGELOG_FILE = path.join(PAPERS_HOME, '更新日志', 'changelog.md');

// Server port
const PORT = parseInt(process.env.PAPERS_PORT || '3000', 10);

// Get database path for a specific user (per_user mode)
function getDbPathForUser(userId) {
  if (DB_MODE === 'per_user' && userId) {
    const dir = path.dirname(DB_PATH);
    const ext = path.extname(DB_PATH);
    const base = path.basename(DB_PATH, ext);
    return path.join(dir, `${base}_user${userId}${ext}`);
  }
  return DB_PATH;
}

// Check if config has been customized
function isCustomized() {
  return !!process.env.PAPERS_HOME || !!process.env.PAPERS_DB_PATH || !!process.env.PAPERS_DIR;
}

function printConfig() {
  console.log('[Config]');
  console.log(`  PAPERS_HOME = ${PAPERS_HOME}`);
  console.log(`  DB_MODE     = ${DB_MODE}`);
  console.log(`  DB_PATH     = ${DB_PATH}`);
  console.log(`  PAPERS_DIR  = ${PAPERS_DIR}`);
  console.log(`  CLASS_DIR   = ${CLASS_DIR}`);
  console.log(`  PORT        = ${PORT}`);
}

module.exports = {
  PROJECT_ROOT,
  PAPERS_HOME,
  DB_MODE,
  DB_PATH,
  PAPERS_DIR,
  CLASS_DIR,
  CHANGELOG_FILE,
  PORT,
  getDbPathForUser,
  isCustomized,
  printConfig,
};
