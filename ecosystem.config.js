const NODE = '/root/.nvm/versions/node/v22.22.0/bin/node';

module.exports = {
  apps: [
    {
      name: 'personal-space',
      cwd: '/opt/personal-space',
      script: 'server.js',
      interpreter: NODE,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      out_file: '/root/.pm2/logs/personal-space-out.log',
      error_file: '/root/.pm2/logs/personal-space-error.log',
      autorestart: true,
      max_restarts: 10,
      kill_timeout: 5000,
      time: true,
    },
    {
      name: 'personal-space-sandbox',
      cwd: '/opt/personal-space-sandbox',
      script: 'server.js',
      interpreter: NODE,
      env: {
        NODE_ENV: 'sandbox',
        PORT: 3001,
      },
      out_file: '/root/.pm2/logs/personal-space-sandbox-out.log',
      error_file: '/root/.pm2/logs/personal-space-sandbox-error.log',
      autorestart: true,
      max_restarts: 10,
      kill_timeout: 5000,
      time: true,
    },
  ],
};
