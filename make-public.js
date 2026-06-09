// Generate a clean public distribution (tool only, no papers)
// Usage: node make-public.js
// Output: ../Paper-Reading-Public/ (ready to push to a separate public repo)

const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const DST = path.join(__dirname, '..', 'Paper-Reading-Public');

// Files/dirs to EXCLUDE (personal data)
const EXCLUDE = new Set([
  '原始文献', '文献分类', '更新日志',
  'papers.db', 'papers.db-wal', 'papers.db-shm',
  'papers_user1.db', 'papers_user2.db',
  '.env', '.processed_papers.json', 'watchdog.log',
  'node_modules', '.git', '.claude', '.vscode', '.idea',
  'public-dist', 'Paper-Reading-Public',
]);

// Files/dirs to include even if they'd normally be excluded
const INCLUDE_EMPTY_DIRS = ['原始文献', '文献分类', '更新日志'];

function copyDir(src, dst) {
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });

  for (const entry of fs.readdirSync(src)) {
    if (entry.startsWith('.') && entry !== '.gitignore' && entry !== '.env.example') continue;
    if (EXCLUDE.has(entry)) continue;

    const srcPath = path.join(src, entry);
    const dstPath = path.join(dst, entry);

    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// ---- Main ----
console.log('Generating public distribution...');

// Clean destination
if (fs.existsSync(DST)) {
  fs.rmSync(DST, { recursive: true, force: true });
}

// Copy all source files (excluding personal data)
copyDir(SRC, DST);

// Create empty data directories with README placeholders
for (const dir of INCLUDE_EMPTY_DIRS) {
  const dirPath = path.join(DST, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

// Create 原始文献/README.md template
const readmePath = path.join(DST, '原始文献', 'README.md');
fs.writeFileSync(readmePath, `# 原始文献总目录

> 将 PDF 论文拖入本文件夹，然后运行 Watchdog（网页右上角 🔄 按钮）自动处理。

---
（暂无论文）
`);

// Create 更新日志/changelog.md template
const changelogPath = path.join(DST, '更新日志', 'changelog.md');
fs.writeFileSync(changelogPath, `# 更新日志

`);

// Update public .gitignore to keep data dirs but not their contents
const gitignorePath = path.join(DST, '.gitignore');
let gitignore = fs.readFileSync(gitignorePath, 'utf-8');
// Add rules: keep directory structure, ignore contents
gitignore += `
# Keep empty data directories for new users
!原始文献/README.md
原始文献/*
!文献分类/
文献分类/*
!更新日志/changelog.md
更新日志/*
`;
fs.writeFileSync(gitignorePath, gitignore);

console.log(`Done: ${DST}`);
console.log('');
console.log('Next steps:');
console.log('  cd ../Paper-Reading-Public');
console.log('  git init');
console.log('  git add -A');
console.log('  git commit -m "Initial public release"');
console.log('  git remote add origin <your-public-repo-url>');
console.log('  git push -u origin main');
console.log('');
console.log('Friends then:');
console.log('  git clone <public-repo-url>');
console.log('  double-click 启动文献管理.bat');
console.log('  add their own PDFs → run watchdog');
