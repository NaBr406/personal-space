const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || (process.env.NODE_ENV === 'sandbox' ? 3001 : 3000));
const envName = process.env.APP_ENV || process.env.NODE_ENV || (port === 3001 ? 'sandbox' : 'production');
const publicDir = path.join(rootDir, 'public');
const uploadDir = path.join(publicDir, 'uploads');
const dbPath = path.join(rootDir, 'data.db');

module.exports = {
  rootDir,
  port,
  envName,
  publicDir,
  uploadDir,
  dbPath,
};
