const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { marked } = require('marked');
const config = require('./config');
const db = require('./lib/db');
const { SESSION_SECRET, requireAuth, requireAdmin } = require('./lib/auth');

const app = express();

// Helper: get userId from session
const uid = (req) => req.session?.userId || null;

// Aliases from config
const BASE_DIR = config.PROJECT_ROOT;
const PAPERS_DIR = config.PAPERS_DIR;
const CLASS_DIR = config.CLASS_DIR;
const CHANGELOG_FILE = config.CHANGELOG_FILE;
const PORT = config.PORT;

// ---- Middleware ----
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days
}));

// ---- Serve static files (public/) ----
app.use(express.static(path.join(BASE_DIR, 'public')));

// ---- Auth Routes (no auth required) ----
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = db.getUserByUsername(username);
  if (!user || !db.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.userId = user.id;
  res.json({ ok: true, user: { id: user.id, username: user.username, is_admin: user.is_admin } });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.getUserById(req.session.userId);
  res.json({ user });
});

// ---- Auth-protected API routes ----
app.use('/api/papers', requireAuth);
app.use('/api/classifications', requireAuth);
app.use('/api/stats', requireAuth);
app.use('/api/changelog', requireAuth);
app.use('/api/watchdog', requireAuth);
app.use('/api/users', requireAuth);
app.use('/api/users', requireAdmin);

// ========== Papers ==========

// GET /api/papers
app.get('/api/papers', (req, res) => {
  const papers = db.listPapers(uid(req));
  res.json(papers);
});

// GET /api/papers/:id
app.get('/api/papers/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const paper = db.getPaper(id, uid(req));
  if (!paper) return res.status(404).json({ error: 'Paper not found' });
  res.json(paper);
});

// DELETE /api/papers/:id
app.delete('/api/papers/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const paper = db.getPaper(id, uid(req));
  if (!paper) return res.status(404).json({ error: 'Paper not found' });

  db.deletePaper(id, uid(req));

  // Optionally remove classification folder links
  try {
    for (const cls of paper.classifications || []) {
      const linkPath = path.join(CLASS_DIR, cls, `${paper.title}.pdf`);
      if (fs.existsSync(linkPath)) fs.unlinkSync(linkPath);
    }
  } catch (_) {}

  res.json({ ok: true });
});

// PUT /api/papers/:id/classifications — update paper classifications
app.put('/api/papers/:id/classifications', (req, res) => {
  const id = parseInt(req.params.id);
  const { classifications } = req.body;
  if (!Array.isArray(classifications)) {
    return res.status(400).json({ error: 'classifications must be an array' });
  }
  const paper = db.getPaper(id, uid(req));
  if (!paper) return res.status(404).json({ error: 'Paper not found' });

  // Update DB
  db.setPaperClassifications(id, classifications, uid(req));

  // Update filesystem symlinks
  syncClassificationLinks(paper.folder_name, paper.title, classifications);

  const updated = db.getPaper(id, uid(req));
  res.json(updated);
});

// POST /api/papers/:id/update-crossrefs — regenerate literature connections via Claude
app.post('/api/papers/:id/update-crossrefs', (req, res) => {
  const id = parseInt(req.params.id);
  const paper = db.getPaper(id, uid(req));
  if (!paper) return res.status(404).json({ error: 'Paper not found' });

  // SSE response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('status', { phase: 'starting', message: `正在为 "${paper.title}" 更新文献关联…` });

  // Build prompt for Claude to update cross-references
  const allPapers = db.listPapers(uid(req));
  const otherPapers = allPapers.filter(p => p.id !== paper.id);
  const paperList = otherPapers.map(p =>
    `- ${p.title} [${p.classifications.join(', ')}] — ${p.description}`
  ).join('\n');

  const prompt = `更新这篇论文的文献关联部分。当前笔记内容如下，请在"文献关联"章节中增加与以下论文的对比/关联分析。

当前笔记内容：
${paper.notes_raw || '(暂无笔记)'}

其他可关联论文列表：
${paperList}

请输出更新后完整的"文献关联"章节内容（仅输出这个章节，用中文写，不要改动笔记的其他部分）。`;

  // Invoke Claude
  const proc = spawn('claude', ['-p', prompt, '--permission-mode', 'bypassPermissions', '--output-format', 'text'], {
    cwd: BASE_DIR,
    shell: true,
    windowsHide: true,
  });

  let output = '';
  proc.stdout.on('data', (chunk) => {
    output += chunk.toString();
    send('log', { message: chunk.toString().trim() });
  });
  proc.stderr.on('data', (chunk) => {
    send('log', { message: chunk.toString().trim(), stream: 'stderr' });
  });
  proc.on('close', (code) => {
    if (code === 0 && output.trim()) {
      // Update the 文献关联 section in notes
      const updatedNotes = updateCrossRefSection(paper.notes_raw || '', output.trim());
      const html = marked.parse(updatedNotes);
      db.updatePaperNotes(paper.folder_name, updatedNotes, html, {}, uid(req));
      send('status', { phase: 'done', message: '文献关联更新完成 ✅', code: 0 });
    } else {
      send('status', { phase: 'error', message: `更新失败 (code: ${code})`, code });
    }
    res.end();
  });
  proc.on('error', (err) => {
    send('status', { phase: 'error', message: `无法启动 Claude: ${err.message}` });
    res.end();
  });
  req.on('close', () => proc.kill());
});

// ========== Classifications ==========

app.get('/api/classifications', (req, res) => {
  res.json(db.listClassifications(uid(req)));
});

// ========== Classification Management ==========

// POST /api/classifications — create new classification
app.post('/api/classifications', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const result = db.createClassification(name.trim(), uid(req));
  if (!result) return res.status(409).json({ error: 'Classification already exists' });
  res.json(result);
});

// DELETE /api/classifications/:id
app.delete('/api/classifications/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.deleteClassification(id, uid(req));
  res.json({ ok: true });
});

// ========== Paper Metadata Update ==========

// PUT /api/papers/:id — update paper metadata
app.put('/api/papers/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const paper = db.getPaper(id, uid(req));
  if (!paper) return res.status(404).json({ error: 'Paper not found' });
  const { title, authors, journal, doi, doi_url, data_url, keywords, description } = req.body;
  db.updatePaper(id, { title, authors, journal, doi, doi_url, data_url, keywords, description }, uid(req));
  const updated = db.getPaper(id, uid(req));
  res.json(updated);
});

// POST /api/papers/:id/open-folder — open paper folder in Explorer
app.post('/api/papers/:id/open-folder', (req, res) => {
  const id = parseInt(req.params.id);
  const paper = db.getPaper(id, uid(req));
  if (!paper) return res.status(404).json({ error: 'Paper not found' });

  const folderPath = path.join(PAPERS_DIR, paper.folder_name);
  if (!fs.existsSync(folderPath)) {
    return res.status(404).json({ error: 'Folder not found', path: folderPath });
  }

  // Open in Explorer
  const { exec } = require('child_process');
  exec(`explorer "${folderPath}"`, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to open folder' });
    res.json({ ok: true, path: folderPath });
  });
});

// ========== Password Management ==========

// PUT /api/me/password — change own password
app.put('/api/me/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  const user = db.getUserByUsername(req.user.username); // full record with hash
  if (!db.verifyPassword(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.changePassword(req.user.id, newPassword);
  res.json({ ok: true });
});

// PUT /api/users/:id/password — admin change user password
app.put('/api/users/:id/password', (req, res) => {
  const id = parseInt(req.params.id);
  const { password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  db.changePassword(id, password);
  res.json({ ok: true });
});

// ========== Stats ==========

app.get('/api/stats', (req, res) => {
  res.json(db.getStats(uid(req)));
});

// ========== Changelog ==========

app.get('/api/changelog', (req, res) => {
  try {
    const content = fs.readFileSync(CHANGELOG_FILE, 'utf-8');
    res.json({ content: content.slice(0, 5000) });
  } catch (_) {
    res.json({ content: '暂无更新日志' });
  }
});

// ========== Search ==========

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json(db.searchPapers(q, uid(req), 30));
});

// ========== PDF Serving ==========

app.get('/api/paper-pdf/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const paper = db.getPaper(id, uid(req));
  if (!paper) return res.json({ pdfUrl: null });
  const pdfPath = path.join(PAPERS_DIR, paper.folder_name, `${paper.folder_name}.pdf`);
  res.json({ pdfUrl: fs.existsSync(pdfPath) ? `/papers/${encodeURIComponent(paper.folder_name)}/${encodeURIComponent(paper.folder_name)}.pdf` : null });
});

app.get('/papers/:folder/:file', (req, res) => {
  const pdfPath = path.join(PAPERS_DIR, decodeURIComponent(req.params.folder), decodeURIComponent(req.params.file));
  if (fs.existsSync(pdfPath)) return res.sendFile(pdfPath);
  res.status(404).send('PDF not found');
});

// ========== User Management (admin only) ==========

app.get('/api/users', (req, res) => {
  res.json(db.listUsers());
});

app.post('/api/users', (req, res) => {
  const { username, password, is_admin } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    db.createUser(username, password, is_admin ? 1 : 0);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

app.delete('/api/users/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.deleteUser(id);
  res.json({ ok: true });
});

app.put('/api/users/:id/password', (req, res) => {
  const id = parseInt(req.params.id);
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  db.changePassword(id, password);
  res.json({ ok: true });
});

// ========== Watchdog (SSE) ==========

app.get('/api/watchdog/run', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send('status', { phase: 'starting', message: '正在启动 Watchdog…' });

  const proc = spawn('D:\\anaconda3\\envs\\opt\\python.exe', ['watchdog.py'], {
    cwd: BASE_DIR,
    windowsHide: true,
  });

  streamProcOutput(proc, send, res);
  req.on('close', () => { proc.kill(); res.end(); });
});

// ========== Login Page Redirect ==========

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'public', 'login.html'));
});

// ========== SPA fallback (protected) ==========

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'public', 'index.html'));
});

// ========== Helper: sync classification links ==========

function parseNotesMeta(raw) {
  const meta = {};
  const lines = raw.split('\n');
  const patterns = {
    authors: /^\*\*(Authors?|作者)\*\*[：:]\s*(.+)/,
    journal: /^\*\*(Journal|期刊)\*\*[：:]\s*(.+)/,
    doi: /^\*\*(DOI)\*\*[：:]\s*(.+)/,
    data: /^\*\*(Data|数据)\*\*[：:]\s*(.+)/,
    keywords: /^\*\*(Keywords?|关键词)\*\*[：:]\s*(.+)/,
  };
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i].trim();
    let m;
    if ((m = line.match(patterns.authors))) meta.authors = m[2].trim();
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

function syncClassificationLinks(folderName, title, newClasses) {
  const pdfPath = path.join(PAPERS_DIR, folderName, `${folderName}.pdf`);
  if (!fs.existsSync(pdfPath)) return;

  // Remove old links
  if (fs.existsSync(CLASS_DIR)) {
    for (const cls of fs.readdirSync(CLASS_DIR)) {
      const clsPath = path.join(CLASS_DIR, cls);
      if (!fs.statSync(clsPath).isDirectory()) continue;
      const linkPath = path.join(clsPath, `${title}.pdf`);
      if (fs.existsSync(linkPath)) fs.unlinkSync(linkPath);
    }
  }

  // Create new links
  for (const cls of newClasses) {
    const clsPath = path.join(CLASS_DIR, cls);
    if (!fs.existsSync(clsPath)) fs.mkdirSync(clsPath, { recursive: true });
    const linkPath = path.join(clsPath, `${title}.pdf`);
    if (!fs.existsSync(linkPath)) {
      try {
        fs.linkSync(pdfPath, linkPath);
      } catch (e) {
        // Fallback: copy
        fs.copyFileSync(pdfPath, linkPath);
      }
    }
  }
}

// ========== Helper: update cross-reference section ==========

function updateCrossRefSection(currentNotes, newContent) {
  // Find the 文献关联 section and replace it
  const marker = /^## .*文献关联|^### .*文献关联|^\*\*文献关联\*\*/m;
  const match = currentNotes.match(marker);
  if (match) {
    // Find the next section header after the match
    const startIdx = match.index;
    const rest = currentNotes.slice(startIdx);
    const nextSection = rest.slice(match[0].length).search(/^## /m);
    if (nextSection >= 0) {
      return currentNotes.slice(0, startIdx) + match[0] + '\n\n' + newContent + '\n\n' + rest.slice(match[0].length + nextSection);
    }
    return currentNotes.slice(0, startIdx) + match[0] + '\n\n' + newContent;
  }
  // Append at end
  return currentNotes + '\n\n## 文献关联\n\n' + newContent;
}

// ========== Resync ==========

// POST /api/resync — scan 原始文献/ for new folders, import into DB
app.post('/api/resync', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send('status', { phase: 'scanning', message: '正在扫描原始文献目录…' });

  let newCount = 0, skipCount = 0;
  try {
    const folders = fs.readdirSync(PAPERS_DIR).filter(f => {
      const full = path.join(PAPERS_DIR, f);
      return fs.statSync(full).isDirectory() && f !== 'README.md';
    });

    for (const folder of folders) {
      const existing = db.getPaperByFolder(folder, uid(req));
      if (existing) {
        skipCount++;
        continue;
      }

      // Found new paper — import it
      const indexContent = fs.readFileSync(path.join(PAPERS_DIR, 'README.md'), 'utf-8');
      // Try to find description from README
      let description = '';
      const descMatch = indexContent.match(new RegExp(`- \\[.+?\\]\\(\\.\\/${encodeURIComponent(folder).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/notes\\.md\\)\\s*—\\s*(.+)`));
      if (descMatch) description = descMatch[1].trim();

      // Try to read notes
      const notesPath = path.join(PAPERS_DIR, folder, 'notes.md');
      let notesRaw = null, notesHtml = null, meta = {};
      if (fs.existsSync(notesPath)) {
        notesRaw = fs.readFileSync(notesPath, 'utf-8');
        notesHtml = marked.parse(notesRaw);
        meta = parseNotesMeta(notesRaw);
      }

      const paperId = db.seedPaper({
        title: folder,
        folderName: folder,
        description: description,
        classifications: [],
      }, uid(req));

      if (notesRaw) {
        db.updatePaperNotes(folder, notesRaw, notesHtml, meta, uid(req));
      }

      newCount++;
      send('log', { message: `✓ 导入: ${folder}` });
    }

    send('status', { phase: 'done', message: `同步完成：新增 ${newCount} 篇，跳过 ${skipCount} 篇`, newCount, skipCount });
  } catch (err) {
    send('status', { phase: 'error', message: `同步出错: ${err.message}` });
  }
  res.end();
});

// ---- Shared: stream process output with SSE ----
function streamProcOutput(proc, send, res, doneMsg = 'Watchdog 运行完成 ✅') {
  let buffer = '';
  let flushTimer = null;
  let lastProgress = ''; // track spinner line for dedup

  const flush = (forceAll = false) => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    // Strip ANSI escape codes
    const clean = trimmed.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    // Split into segments separated by \n or \r
    const segments = clean.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean);

    if (segments.length === 0) { buffer = ''; return; }

    // If it's a spinner line (starts with braille), send only the latest as progress
    const isSpinner = (s) => /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✔✗✘]/.test(s);

    for (const seg of segments) {
      if (isSpinner(seg)) {
        lastProgress = seg;
      } else {
        // Flush any pending progress before real log line
        if (lastProgress) { send('progress', { message: lastProgress }); lastProgress = ''; }
        send('log', { message: seg });
      }
    }
    buffer = '';
  };

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    if (buffer.includes('\n')) flush(); // \n = real line break, flush immediately
  });

  proc.stderr.on('data', (chunk) => {
    buffer += chunk.toString();
    if (buffer.includes('\n')) flush();
  });

  // Periodic flush for spinner updates (every 1s is good)
  flushTimer = setInterval(() => {
    if (buffer.trim() || lastProgress) {
      flush();
      if (lastProgress && !buffer.trim()) {
        send('progress', { message: lastProgress });
        lastProgress = '';
      }
    }
  }, 1000);

  proc.on('close', (code) => {
    clearInterval(flushTimer);
    flush(true);
    if (lastProgress) { send('progress', { message: lastProgress }); lastProgress = ''; }
    if (code === 0) {
      send('status', { phase: 'done', message: doneMsg, code: 0 });
    } else {
      send('status', { phase: 'error', message: `进程异常退出 (code: ${code})`, code });
    }
    res.end();
  });

  proc.on('error', (err) => {
    clearInterval(flushTimer);
    send('status', { phase: 'error', message: `无法启动进程: ${err.message}` });
    res.end();
  });
}

// ---- Auto-seed on first run ----
function autoSeedIfEmpty() {
  const stats = db.getStats(null);
  if (stats.totalPapers > 0) return; // already has papers

  // Check if 原始文献 has paper folders
  if (!fs.existsSync(PAPERS_DIR)) return;
  const folders = fs.readdirSync(PAPERS_DIR).filter(f => {
    const full = path.join(PAPERS_DIR, f);
    return fs.statSync(full).isDirectory() && f !== 'README.md';
  });
  if (folders.length === 0) return;

  console.log(`[Auto-seed] Found ${folders.length} paper folders, importing...`);
  try {
    require('./seed');
  } catch (e) {
    console.log('[Auto-seed] Import failed (may already be seeded):', e.message);
  }
}

// ---- Start ----
db.getDb(); // init DB
autoSeedIfEmpty();
app.listen(PORT, () => {
  const stats = db.getStats(null);
  console.log(`Paper Reading Server running at http://localhost:${PORT}`);
  console.log(`  ${stats.totalPapers} papers, ${stats.totalClassifications} classifications`);
  console.log(`  Login: admin / admin123`);
  console.log(`  Repository: git clone & run — auto-seeds on first start`);
  console.log(`  Open http://localhost:${PORT} in your browser`);
});
