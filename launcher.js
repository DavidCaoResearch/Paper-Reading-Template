// Paper Reading Launcher — starts server + opens browser
const { exec } = require('child_process');
const config = require('./config');

// ---- Print Config ----
config.printConfig();
console.log('');

// ---- Start Server ----
require('./server.js'); // server.js listens on config.PORT

// ---- Open Browser ----
const url = `http://localhost:${config.PORT}`;
const platform = process.platform;
let openCmd;
if (platform === 'win32') {
  openCmd = `start "" "${url}"`;
} else if (platform === 'darwin') {
  openCmd = `open "${url}"`;
} else {
  openCmd = `xdg-open "${url}"`;
}

setTimeout(() => {
  exec(openCmd, (err) => {
    if (err) console.error('Failed to open browser:', err.message);
  });
}, 800);

// ---- Friendly Console Message ----
setTimeout(() => {
  console.log('');
  console.log('  ============================================');
  console.log('    Paper Reading 文献阅读管理');
  console.log(`    Browser: ${url}`);
  console.log(`    Mode: ${config.DB_MODE}`);
  console.log('    Close this window to stop the server');
  console.log('  ============================================');
  console.log('');
}, 1200);

// Handle clean shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  process.exit(0);
});
