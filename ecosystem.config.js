module.exports = {
  apps: [
    {
      name: 'openwa-backend',
      cwd: './',
      script: 'npm',
      args: 'start',
      interpreter: 'none',
      env: {
        NODE_ENV: 'development',
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: 'openwa-dashboard',
      cwd: './dashboard',
      script: 'npm',
      args: 'run dev -- --host',
      interpreter: 'none',
      env: {
        NODE_ENV: 'development',
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
