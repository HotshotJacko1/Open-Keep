// Settings for a self-hosted Open Keep. The Docker image rewrites this file from
// environment variables each time the container starts (docker/40-open-keep-config.sh);
// everywhere else it stays empty. Read by src/lib/runtime-config.ts.
window.__OPEN_KEEP_CONFIG__ = {};
