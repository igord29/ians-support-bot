module.exports = {
  apps: [
    {
      name: "ian-agent",
      script: "src/index.js",
      node_args: "--experimental-vm-modules",
      watch: false,
      autorestart: true,
      max_restarts: 15,        // Give up after 15 rapid restarts (prevents infinite loops)
      min_uptime: "10s",       // Must run 10s+ to count as a "successful" start
      restart_delay: 3000,     // Wait 3s between restarts
      exp_backoff_restart_delay: 1000, // Exponential backoff starting at 1s
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production"
      },
      // Log management
      error_file: "logs/error.log",
      out_file: "logs/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    }
  ]
};
