const db = require('./db');
const SESSION_SECRET = 'paper-reading-secret-' + require('crypto').randomBytes(4).toString('hex');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db.getUserById(req.session.userId);
    if (user) {
      req.user = user;
      return next();
    }
  }
  // API requests get 401, page requests get redirect
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.redirect('/login.html');
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Admin only' });
  }
  return res.status(403).send('Admin only');
}

module.exports = { SESSION_SECRET, requireAuth, requireAdmin };
