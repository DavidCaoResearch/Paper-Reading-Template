// ===== State =====
let papers = [];
let classifications = [];
let currentUser = null;
let activeFilter = null;
let searchQuery = '';
let currentView = 'list';
let currentPaperId = null;

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const searchInput = $('#search-input');
const paperCount = $('#paper-count');
const classList = $('#class-list');
const paperGrid = $('#paper-grid');
const emptyState = $('#empty-state');
const listView = $('#list-view');
const detailView = $('#detail-view');
const detailContent = $('#detail-content');
const backBtn = $('#back-btn');
const clearFilterBtn = $('#clear-filter-btn');
const statsBtn = $('#stats-btn');
const statsModal = $('#stats-modal');
const statsBody = $('#stats-body');
const closeStatsBtn = $('#close-stats-btn');
const statsOverlay = statsModal.querySelector('.modal-overlay');
const watchdogBtn = $('#watchdog-btn');
const watchdogModal = $('#watchdog-modal');
const watchdogRunBtn = $('#watchdog-run-btn');
const watchdogStatus = $('#watchdog-status');
const watchdogLog = $('#watchdog-log');
const closeWatchdogBtn = $('#close-watchdog-btn');
const watchdogOverlay = watchdogModal.querySelector('.modal-overlay');
const resyncBtn = $('#resync-btn');
const adminBtn = $('#admin-btn');
const adminModal = $('#admin-modal');
const closeAdminBtn = $('#close-admin-btn');
const adminOverlay = adminModal.querySelector('.modal-overlay');
const userName = $('#user-name');
const logoutBtn = $('#logout-btn');
const confirmModal = $('#confirm-modal');
const confirmMsg = $('#confirm-msg');
const confirmYes = $('#confirm-yes');
const confirmNo = $('#confirm-no');
const confirmOverlay = confirmModal.querySelector('.modal-overlay');
const newClassInput = $('#new-class-input');
const newClassBtn = $('#new-class-btn');
const passwordBtn = $('#password-btn');
const passwordModal = $('#password-modal');
const passwordBody = $('#password-body');
const closePwBtn = $('#close-password-btn');
const pwOverlay = passwordModal.querySelector('.modal-overlay');

let watchdogRunning = false;
let confirmCallback = null;

// ===== Init =====
async function init() {
  // Check auth
  try {
    const res = await fetch('/api/me');
    if (res.status === 401 || !res.ok) {
      window.location.href = '/login.html';
      return;
    }
    const data = await res.json();
    if (!data.user) {
      window.location.href = '/login.html';
      return;
    }
    currentUser = data.user;
  } catch (e) {
    window.location.href = '/login.html';
    return;
  }

  userName.textContent = currentUser.username;
  if (currentUser.is_admin) adminBtn.classList.remove('hidden');

  await Promise.all([fetchPapers(), fetchClassifications()]);
  if (papers.length > 0) renderPaperList();
  else { emptyState.classList.remove('hidden'); emptyState.querySelector('p').textContent = '正在加载论文数据…'; }
  updateCountBadge();
}

// ===== Auth =====
logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ===== API =====
async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) { window.location.href = '/login.html'; throw new Error('Unauthorized'); }
  return res;
}

async function fetchPapers() {
  try {
    const res = await api('/api/papers');
    papers = await res.json();
  } catch (_) { papers = []; }
}

async function fetchClassifications() {
  try {
    const res = await api('/api/classifications');
    classifications = await res.json();
    renderClassList();
  } catch (_) { classifications = []; }
}

async function fetchPaperDetail(id) {
  try {
    const res = await api(`/api/papers/${id}`);
    if (!res.ok) throw new Error('Not found');
    return await res.json();
  } catch (_) { return null; }
}

async function fetchStats() {
  try {
    const res = await api('/api/stats');
    return await res.json();
  } catch (_) { return null; }
}

// ===== Render: Sidebar =====
function renderClassList() {
  classList.innerHTML = '';
  for (const cls of classifications) {
    const div = document.createElement('div');
    div.className = 'class-item';
    div.dataset.classname = cls.name;
    div.dataset.classid = cls.id;
    div.innerHTML = `<span>${cls.name}</span><span class="count">${cls.count}</span>${cls.count === 0 ? `<button class="btn-del-class" title="删除空分类">×</button>` : ''}`;
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-del-class')) return;
      handleFilterClick(cls.name);
    });
    if (activeFilter === cls.name) div.classList.add('active');
    // Delete button handler
    const delBtn = div.querySelector('.btn-del-class');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteClassification(cls.id, cls.name);
      });
    }
    classList.appendChild(div);
  }
}

function updateClassActive() {
  for (const el of $$('.class-item')) {
    el.classList.toggle('active', el.dataset.classname === activeFilter);
  }
}

// Create new classification
async function handleNewClass() {
  const name = newClassInput.value.trim();
  if (!name) return;
  try {
    const res = await api('/api/classifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      newClassInput.value = '';
      await fetchClassifications();
    } else {
      const data = await res.json();
      alert(data.error || '创建失败');
    }
  } catch (_) {}
}

async function deleteClassification(id, name) {
  showConfirm(`删除分类「${name}」？`, async () => {
    await api(`/api/classifications/${id}`, { method: 'DELETE' });
    await fetchClassifications();
    if (activeFilter === name) { activeFilter = null; renderPaperList(); }
  });
}

newClassBtn.addEventListener('click', handleNewClass);
newClassInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleNewClass(); });

// ===== Render: Paper Cards =====
function renderPaperList() {
  let filtered = getFilteredPapers();
  if (filtered.length === 0) {
    paperGrid.innerHTML = '';
    emptyState.classList.remove('hidden');
    emptyState.querySelector('p').textContent = searchQuery
      ? `没有找到匹配 "${searchQuery}" 的论文`
      : activeFilter ? `分类 "${activeFilter}" 下没有论文` : '没有论文';
    return;
  }
  emptyState.classList.add('hidden');
  paperGrid.innerHTML = '';
  for (const paper of filtered) {
    const card = document.createElement('div');
    card.className = 'paper-card';
    card.addEventListener('click', () => showDetail(paper.id));
    const tagsHTML = (paper.classifications || []).map(c => `<span class="card-tag">${c}</span>`).join('');
    let titleHTML = paper.title, descHTML = paper.description || '';
    if (searchQuery) {
      titleHTML = highlightText(paper.title, searchQuery);
      descHTML = highlightText(paper.description || '', searchQuery);
    }
    card.innerHTML = `<h3>${titleHTML}</h3><p class="card-desc">${descHTML}</p><div class="card-tags">${tagsHTML}</div>`;
    paperGrid.appendChild(card);
  }
  updateCountBadge(filtered.length);
}

function getFilteredPapers() {
  let result = papers;
  if (activeFilter) result = result.filter(p => (p.classifications || []).includes(activeFilter));
  if (searchQuery) {
    const q = searchQuery;
    result = result.filter(p =>
      p.title.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.classifications || []).some(c => c.toLowerCase().includes(q))
    );
  }
  return result;
}

function highlightText(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark class="search-highlight">$1</mark>');
}

function updateCountBadge(filteredCount) {
  const total = papers.length;
  const shown = filteredCount !== undefined ? filteredCount : getFilteredPapers().length;
  paperCount.textContent = shown === total ? `${total} 篇论文` : `${shown} / ${total} 篇`;
}

// ===== View: Detail =====
async function showDetail(paperId) {
  currentPaperId = paperId;
  currentView = 'detail';
  listView.classList.add('hidden');
  detailView.classList.remove('hidden');
  detailContent.innerHTML = '<div class="loading"><div class="spinner"></div>加载中…</div>';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const paper = await fetchPaperDetail(paperId);
  if (!paper) { detailContent.innerHTML = '<p class="empty-state">论文详情加载失败</p>'; return; }
  renderDetail(paper);
}

function renderDetail(paper) {
  // Classification edit
  const editHTML = `
    <div class="class-edit-section">
      <h4>🏷️ 分类编辑</h4>
      <div class="class-edit-tags" id="class-edit-tags">
        ${(paper.classifications || []).map(c => `
          <span class="class-edit-tag">${c}<span class="tag-remove" data-class="${c}">×</span></span>
        `).join('')}
      </div>
      <div class="class-edit-add">
        <input type="text" id="class-add-input" placeholder="添加分类…" autocomplete="off">
        <button id="class-add-btn" class="btn-sm">+ 添加</button>
      </div>
      <div class="class-suggestions" id="class-suggestions">
        ${getUnusedClasses(paper).slice(0, 15).map(c =>
          `<span class="class-suggestion" data-class="${c}">+ ${c}</span>`
        ).join('')}
      </div>
    </div>
  `;

  // Meta
  let metaHTML = '';
  const items = [];
  if (paper.authors) items.push(`<span class="meta-item"><strong>作者:</strong> ${escapeHTML(paper.authors)}</span>`);
  if (paper.journal) items.push(`<span class="meta-item"><strong>期刊:</strong> ${escapeHTML(paper.journal)}</span>`);
  if (paper.doi_url) items.push(`<span class="meta-item"><strong>DOI:</strong> <a href="${paper.doi_url}" target="_blank" rel="noopener">🔗 链接</a></span>`);
  if (paper.data_url) items.push(`<span class="meta-item"><strong>数据:</strong> <a href="${paper.data_url}" target="_blank" rel="noopener">📦 仓库</a></span>`);
  if (paper.keywords) items.push(`<span class="meta-item"><strong>关键词:</strong> ${escapeHTML(paper.keywords)}</span>`);
  if (items.length > 0) metaHTML = `<div class="meta-box">${items.join('')}</div>`;

  // Metadata edit form
  const metaEditHTML = `
    <details class="meta-edit-section">
      <summary>✏️ 编辑论文信息</summary>
      <div class="meta-edit-grid">
        <div class="full-width"><label>标题</label><input type="text" id="edit-title" value="${escapeHTML(paper.title || '')}"></div>
        <div class="full-width"><label>作者</label><input type="text" id="edit-authors" value="${escapeHTML(paper.authors || '')}"></div>
        <div><label>期刊</label><input type="text" id="edit-journal" value="${escapeHTML(paper.journal || '')}"></div>
        <div><label>DOI</label><input type="text" id="edit-doi" value="${escapeHTML(paper.doi || '')}"></div>
        <div><label>DOI URL</label><input type="text" id="edit-doi-url" value="${escapeHTML(paper.doi_url || '')}"></div>
        <div><label>数据URL</label><input type="text" id="edit-data-url" value="${escapeHTML(paper.data_url || '')}"></div>
        <div class="full-width"><label>关键词</label><input type="text" id="edit-keywords" value="${escapeHTML(paper.keywords || '')}"></div>
        <div class="full-width"><label>描述</label><textarea id="edit-desc" rows="2">${escapeHTML(paper.description || '')}</textarea></div>
      </div>
      <button id="save-meta-btn" class="btn-accent" style="margin-top:8px;">💾 保存信息</button>
      <span id="meta-save-status" style="font-size:0.82rem;margin-left:8px;"></span>
    </details>
  `;

  // File path
  const folderName = paper.folder_name || '';
  const pathHTML = `
    <div class="paper-path">
      📁 <code>原始文献\\${escapeHTML(folderName)}</code>
      <button class="btn-open-folder" id="open-folder-btn">📂 打开文件夹</button>
    </div>
  `;

  const notesHTML = paper.notes_html || '<p style="color:var(--text-muted)">暂无笔记</p>';

  detailContent.innerHTML = `
    <h1>${escapeHTML(paper.title)}</h1>
    ${pathHTML}
    ${metaHTML}
    ${editHTML}
    ${metaEditHTML}
    <div class="detail-actions">
      <button id="crossref-btn" class="btn-accent" title="用 Claude 自动更新文献关联">🤖 更新文献关联</button>
      <button id="delete-btn" class="btn-danger">🗑 删除这篇论文</button>
    </div>
    <div class="notes-body">${notesHTML}</div>
  `;

  // Attach handlers
  attachClassEditHandlers(paper);
  attachMetaEditHandlers(paper);
  attachDetailActionHandlers(paper);
  renderKaTeX(detailContent);

  // Open folder button
  $('#open-folder-btn').addEventListener('click', async () => {
    const res = await api(`/api/papers/${paper.id}/open-folder`, { method: 'POST' });
    const data = await res.json();
    if (!data.ok) alert('无法打开文件夹: ' + (data.path || ''));
  });
}

function attachMetaEditHandlers(paper) {
  $('#save-meta-btn').addEventListener('click', async () => {
    const fields = {
      title: $('#edit-title').value.trim(),
      authors: $('#edit-authors').value.trim(),
      journal: $('#edit-journal').value.trim(),
      doi: $('#edit-doi').value.trim(),
      doi_url: $('#edit-doi-url').value.trim(),
      data_url: $('#edit-data-url').value.trim(),
      keywords: $('#edit-keywords').value.trim(),
      description: $('#edit-desc').value.trim(),
    };
    if (!fields.title) return alert('标题不能为空');

    const status = $('#meta-save-status');
    status.textContent = '保存中…';
    status.style.color = '';

    try {
      const res = await api(`/api/papers/${paper.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (res.ok) {
        status.textContent = '✅ 已保存';
        // Update in-memory paper, re-render
        Object.assign(paper, fields);
        renderDetail(paper);
        refreshAll();
      } else {
        const data = await res.json();
        status.textContent = '❌ ' + (data.error || '保存失败');
        status.style.color = '#dc2626';
      }
    } catch (_) {
      status.textContent = '❌ 网络错误';
      status.style.color = '#dc2626';
    }
  });
}

function getUnusedClasses(paper) {
  const used = new Set(paper.classifications || []);
  return classifications.map(c => c.name).filter(n => !used.has(n));
}

function attachClassEditHandlers(paper) {
  // Remove tag
  for (const el of detailContent.querySelectorAll('.tag-remove')) {
    el.addEventListener('click', async () => {
      const cls = el.dataset.class;
      const newClasses = (paper.classifications || []).filter(c => c !== cls);
      await saveClassifications(paper.id, newClasses);
      paper.classifications = newClasses;
      renderDetail(paper);
      refreshAll();
    });
  }

  // Add button
  $('#class-add-btn').addEventListener('click', async () => {
    const input = $('#class-add-input');
    const val = input.value.trim();
    if (!val) return;
    const newClasses = [...new Set([...(paper.classifications || []), val])];
    await saveClassifications(paper.id, newClasses);
    paper.classifications = newClasses;
    renderDetail(paper);
    refreshAll();
  });

  // Suggestion clicks
  for (const el of detailContent.querySelectorAll('.class-suggestion')) {
    el.addEventListener('click', async () => {
      const cls = el.dataset.class;
      const newClasses = [...new Set([...(paper.classifications || []), cls])];
      await saveClassifications(paper.id, newClasses);
      paper.classifications = newClasses;
      renderDetail(paper);
      refreshAll();
    });
  }
}

function attachDetailActionHandlers(paper) {
  // Delete
  $('#delete-btn').addEventListener('click', () => {
    showConfirm(`确定要删除「${paper.title}」吗？此操作不可撤销。`, async () => {
      await api(`/api/papers/${paper.id}`, { method: 'DELETE' });
      showList();
      await fetchPapers();
      await fetchClassifications();
      renderPaperList();
    });
  });

  // Crossref update
  $('#crossref-btn').addEventListener('click', () => runCrossrefUpdate(paper));
}

async function saveClassifications(paperId, classNames) {
  await api(`/api/papers/${paperId}/classifications`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classifications: classNames }),
  });
}

async function refreshAll() {
  await fetchPapers();
  await fetchClassifications();
}

// ===== Crossref Update (SSE) =====
function runCrossrefUpdate(paper) {
  const btn = $('#crossref-btn');
  btn.disabled = true;
  btn.textContent = '⏳ 更新中…';

  const outputArea = document.createElement('pre');
  outputArea.className = 'watchdog-log';
  outputArea.style.cssText = 'margin-top:12px; max-height:300px;';
  btn.parentElement.after(outputArea);

  const appendLog = (msg, cls) => {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = msg + '\n';
    outputArea.appendChild(span);
    outputArea.scrollTop = outputArea.scrollHeight;
  };

  const es = new EventSource(`/api/papers/${paper.id}/update-crossrefs`);

  es.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    if (data.phase === 'done') {
      appendLog(data.message, 'done');
      btn.disabled = false;
      btn.textContent = '🤖 更新文献关联';
      es.close();
      // Reload paper to see updated notes
      showDetail(paper.id);
    } else if (data.phase === 'error') {
      appendLog(data.message, 'error');
      btn.disabled = false;
      btn.textContent = '🤖 更新文献关联';
      es.close();
    } else {
      appendLog(data.message);
    }
  });

  es.addEventListener('log', (e) => {
    const data = JSON.parse(e.data);
    appendLog(data.message, data.stream === 'stderr' ? 'stderr' : '');
  });

  es.onerror = () => { es.close(); };
}

// ===== View: List =====
function showList() {
  currentView = 'list';
  currentPaperId = null;
  detailView.classList.add('hidden');
  listView.classList.remove('hidden');
  renderPaperList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

backBtn.addEventListener('click', showList);

// ===== Handlers =====
function handleFilterClick(className) {
  activeFilter = activeFilter === className ? null : className;
  updateClassActive();
  renderPaperList();
}

function handleSearch() {
  searchQuery = searchInput.value.toLowerCase().trim();
  activeFilter = null;
  updateClassActive();
  renderPaperList();
}

searchInput.addEventListener('input', debounce(handleSearch, 250));
clearFilterBtn.addEventListener('click', () => {
  activeFilter = null; searchQuery = ''; searchInput.value = '';
  updateClassActive(); renderPaperList();
});

// ===== Stats =====
statsBtn.addEventListener('click', async () => {
  const stats = await fetchStats();
  if (!stats) return;
  statsBody.innerHTML = `
    <div class="stat-row"><span class="stat-label">论文总数</span><span class="stat-value">${stats.totalPapers}</span></div>
    <div class="stat-row"><span class="stat-label">分类数量</span><span class="stat-value">${stats.totalClassifications}</span></div>
    <div class="stat-row"><span class="stat-label">含笔记论文</span><span class="stat-value">${stats.papersWithNotes}</span></div>
    <div style="margin-top:16px;font-weight:600;font-size:0.85rem;color:var(--text-secondary);">Top 分类</div>
    ${stats.topClassifications.map((c, i) => `
      <div class="stat-row"><span class="stat-label">${i + 1}. ${c.name}</span><span class="stat-value">${c.count}</span></div>
    `).join('')}
  `;
  statsModal.classList.remove('hidden');
});
closeStatsBtn.addEventListener('click', () => statsModal.classList.add('hidden'));
statsOverlay.addEventListener('click', () => statsModal.classList.add('hidden'));

// ===== Watchdog =====
watchdogBtn.addEventListener('click', () => watchdogModal.classList.remove('hidden'));
closeWatchdogBtn.addEventListener('click', () => {
  if (watchdogRunning && !confirm('Watchdog 正在运行，确定要关闭吗？')) return;
  watchdogRunning = false;
  watchdogModal.classList.add('hidden');
});
watchdogOverlay.addEventListener('click', () => {
  if (!watchdogRunning) watchdogModal.classList.add('hidden');
});

watchdogRunBtn.addEventListener('click', () => {
  if (watchdogRunning) return;
  watchdogRunning = true;
  watchdogRunBtn.disabled = true;
  watchdogRunBtn.textContent = '⏳ 运行中…';
  watchdogStatus.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> 运行中…';
  watchdogLog.textContent = '';

  const appendLog = (msg, cls) => {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = msg + '\n';
    watchdogLog.appendChild(span);
    watchdogLog.scrollTop = watchdogLog.scrollHeight;
  };

  const es = new EventSource('/api/watchdog/run');
  es.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    if (data.phase === 'done') {
      appendLog(data.message, 'done');
      watchdogStatus.innerHTML = '✅ 完成！';
      watchdogRunBtn.disabled = false;
      watchdogRunBtn.textContent = '▶ 运行 Watchdog';
      watchdogRunning = false;
      es.close();
      fetchPapers().then(() => { fetchClassifications(); renderPaperList(); });
    } else if (data.phase === 'error') {
      appendLog(data.message, 'error');
      watchdogStatus.innerHTML = '❌ 出错';
      watchdogRunBtn.disabled = false;
      watchdogRunBtn.textContent = '▶ 运行 Watchdog';
      watchdogRunning = false;
      es.close();
    } else { appendLog(data.message); }
  });
  es.addEventListener('log', (e) => {
    const data = JSON.parse(e.data);
    appendLog(data.message, data.stream === 'stderr' ? 'stderr' : '');
  });
  es.onerror = () => {
    if (watchdogRunning) {
      appendLog('⚠️ 连接中断', 'error');
      watchdogStatus.innerHTML = '⚠️ 连接中断';
      watchdogRunBtn.disabled = false;
      watchdogRunBtn.textContent = '▶ 运行 Watchdog';
      watchdogRunning = false;
    }
    es.close();
  };
});

// ===== Resync =====
resyncBtn.addEventListener('click', () => {
  if (watchdogRunning) return;
  watchdogRunning = true;
  watchdogRunBtn.disabled = true;
  resyncBtn.disabled = true;
  watchdogRunBtn.textContent = '⏳ 同步中…';
  watchdogStatus.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> 从磁盘同步…';
  watchdogLog.textContent = '';

  const appendLog = (msg, cls) => {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = msg + '\n';
    watchdogLog.appendChild(span);
    watchdogLog.scrollTop = watchdogLog.scrollHeight;
  };

  fetch('/api/resync', { method: 'POST' }).then(async (res) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        const event = line.slice(0, colon).trim();
        const data = line.slice(colon + 1).trim();
        // Remove "data: " prefix if present
        const json = data.startsWith('data: ') ? data.slice(6) : data;
        try {
          const parsed = JSON.parse(json);
          if (event === 'event: status' || event === 'status') {
            if (parsed.phase === 'done') {
              appendLog(parsed.message, 'done');
              watchdogStatus.innerHTML = `✅ 新增 ${parsed.newCount} 篇`;
              finishResync();
            } else if (parsed.phase === 'error') {
              appendLog(parsed.message, 'error');
              finishResync();
            } else {
              appendLog(parsed.message);
            }
          } else if (event === 'event: log' || event === 'log') {
            appendLog(parsed.message);
          }
        } catch (_) {}
      }
    }
    finishResync();
  }).catch(() => finishResync());

  function finishResync() {
    watchdogRunning = false;
    watchdogRunBtn.disabled = false;
    resyncBtn.disabled = false;
    watchdogRunBtn.textContent = '▶ 运行 Watchdog';
    fetchPapers().then(() => { fetchClassifications(); renderPaperList(); });
  }
});

// ===== Admin =====
adminBtn.addEventListener('click', () => { adminModal.classList.remove('hidden'); loadUsers(); });
closeAdminBtn.addEventListener('click', () => adminModal.classList.add('hidden'));
adminOverlay.addEventListener('click', () => adminModal.classList.add('hidden'));

async function loadUsers() {
  try {
    const res = await api('/api/users');
    const users = await res.json();
    const tbody = $('#user-tbody');
    tbody.innerHTML = users.map(u => `
      <tr>
        <td>${u.id}</td>
        <td>${u.username}</td>
        <td>${u.is_admin ? '✅' : ''}</td>
        <td>${u.created_at || ''}</td>
        <td style="display:flex;gap:4px;flex-wrap:wrap;">
          <button class="btn-sm btn-reset-pw" data-id="${u.id}" data-name="${u.username}">重置密码</button>
          ${u.id !== currentUser.id ? `<button class="btn-sm btn-del-user" data-id="${u.id}">删除</button>` : ''}
        </td>
      </tr>
    `).join('');
    for (const btn of tbody.querySelectorAll('.btn-del-user')) {
      btn.addEventListener('click', async () => {
        const uid = parseInt(btn.dataset.id);
        showConfirm('确定要删除该用户吗？', async () => {
          await api(`/api/users/${uid}`, { method: 'DELETE' });
          loadUsers();
        });
      });
    }
    for (const btn of tbody.querySelectorAll('.btn-reset-pw')) {
      btn.addEventListener('click', () => {
        const uid = parseInt(btn.dataset.id);
        const uname = btn.dataset.name;
        const newPw = prompt(`为「${uname}」设置新密码（至少4位）：`);
        if (!newPw) return;
        if (newPw.length < 4) { alert('密码至少4位'); return; }
        api(`/api/users/${uid}/password`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: newPw }),
        }).then(r => r.json()).then(d => {
          if (d.ok) alert('密码已重置');
          else alert(d.error || '重置失败');
        });
      });
    }
  } catch (_) {}
}

$('#add-user-btn').addEventListener('click', async () => {
  const username = $('#new-username').value.trim();
  const password = $('#new-password').value;
  const is_admin = $('#new-is-admin').checked;
  if (!username || !password) return alert('用户名和密码不能为空');
  try {
    const res = await api('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, is_admin }),
    });
    const data = await res.json();
    if (data.ok) { $('#new-username').value = ''; $('#new-password').value = ''; loadUsers(); }
    else alert(data.error);
  } catch (_) {}
});

// ===== Confirm Dialog =====
function showConfirm(msg, cb) {
  confirmMsg.textContent = msg;
  confirmCallback = cb;
  confirmModal.classList.remove('hidden');
}
confirmYes.addEventListener('click', async () => {
  confirmModal.classList.add('hidden');
  if (confirmCallback) await confirmCallback();
  confirmCallback = null;
});
confirmNo.addEventListener('click', () => { confirmModal.classList.add('hidden'); confirmCallback = null; });
confirmOverlay.addEventListener('click', () => { confirmModal.classList.add('hidden'); confirmCallback = null; });

// ===== KaTeX Rendering =====
function renderKaTeX(el) {
  // First pass: render display math $$...$$ and inline math $...$
  try {
    renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ],
      throwOnError: false,
      strict: false,
    });
  } catch (e) {
    console.warn('KaTeX render error:', e);
  }
}

// ===== Utilities =====
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ===== Password Change =====
passwordBtn.addEventListener('click', showPasswordModal);
closePwBtn.addEventListener('click', hidePasswordModal);
pwOverlay.addEventListener('click', hidePasswordModal);

function showPasswordModal() {
  passwordBody.innerHTML = `
    <div class="password-form">
      <input type="password" id="pw-current" placeholder="当前密码" autocomplete="current-password">
      <input type="password" id="pw-new" placeholder="新密码（至少4位）" autocomplete="new-password">
      <input type="password" id="pw-confirm" placeholder="确认新密码">
      <button id="pw-save-btn" class="btn-primary">修改密码</button>
      <div class="password-error" id="pw-error"></div>
      <div class="password-success" id="pw-success"></div>
    </div>
  `;
  passwordModal.classList.remove('hidden');

  $('#pw-save-btn').addEventListener('click', async () => {
    const current = $('#pw-current').value;
    const newPw = $('#pw-new').value;
    const confirm = $('#pw-confirm').value;
    const errEl = $('#pw-error');
    const okEl = $('#pw-success');
    errEl.textContent = '';
    okEl.textContent = '';

    if (newPw !== confirm) { errEl.textContent = '两次新密码不一致'; return; }
    if (newPw.length < 4) { errEl.textContent = '密码至少4位'; return; }

    try {
      const res = await api('/api/me/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
      });
      const data = await res.json();
      if (data.ok) {
        okEl.textContent = '✅ 密码已修改';
        setTimeout(hidePasswordModal, 1500);
      } else {
        errEl.textContent = data.error || '修改失败';
      }
    } catch (_) { errEl.textContent = '网络错误'; }
  });
}

function hidePasswordModal() {
  passwordModal.classList.add('hidden');
}

// ===== Keyboard (updated for password modal) =====
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (currentView === 'detail') showList();
    statsModal.classList.add('hidden');
    watchdogModal.classList.add('hidden');
    adminModal.classList.add('hidden');
    confirmModal.classList.add('hidden');
    passwordModal.classList.add('hidden');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
  }
});

// ===== Boot =====
init();
