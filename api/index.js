const fs = require('node:fs');
const path = require('node:path');

// Recursively copy directory
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      try { fs.copyFileSync(srcPath, destPath); } catch (e) {}
    }
  }
}

const { createApplication } = require('../server/app.js');

let systemPromise;

module.exports = async (req, res) => {
  if (!systemPromise) {
    // Setup for Vercel Serverless
    process.env.DATA_DIR = '/tmp/data';
    process.env.UPLOADS_DIR = '/tmp/data/uploads';
    process.env.DB_FILE = '/tmp/data/eventtracker.sqlite';
    process.env.NODE_ENV = 'development';
    process.env.COOKIE_SECURE = 'true';
    
    // Set origins for CORS if we know it or allow all in development
    process.env.CORS_ORIGINS = req.headers.origin || `https://${req.headers.host}`;
    
    // Copy the seeded database and uploads from the deployment to /tmp
    const sourceData = path.join(__dirname, '../data');
    if (fs.existsSync(sourceData)) {
      copyDirSync(sourceData, '/tmp/data');
    }

    systemPromise = createApplication({
      env: process.env
    });
  }
  
  try {
    const system = await systemPromise;
    return system.app(req, res);
  } catch (error) {
    console.error('Failed to initialize app:', error);
    res.status(500).send('Internal Server Error');
  }
};
