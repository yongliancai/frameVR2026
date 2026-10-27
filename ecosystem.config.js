// PM2 設定：pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [
    {
      name: 'framevr-tracker',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,            // SQLite 單一寫入者，維持 1 個程序
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      time: true,
    },
  ],
};
