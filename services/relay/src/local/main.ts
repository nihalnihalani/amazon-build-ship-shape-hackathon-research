import { ConfigError, loadLocalConfig } from './config.js';
import { createLocalServer } from './server.js';

function main(): void {
  let config;
  try {
    config = loadLocalConfig(process.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`relay: configuration error: ${e.message}\n`);
      process.exit(2);
    }
    throw e;
  }

  if (config.insecureLocalhostOnly) {
    process.stderr.write(
      'WARNING: ATR_INSECURE_LOCALHOST_ONLY=1. Serving plain HTTP/WS on loopback only. ' +
        'A phone cannot use this (no TLS, not reachable from the LAN, and http://<LAN-IP> is never a valid microphone origin). ' +
        'It exists for same-Mac development and tests only.\n',
    );
  }

  const server = createLocalServer({ config });
  server
    .start()
    .then(({ port, host }) => {
      const scheme = config.tls ? 'https' : 'http';
      process.stdout.write(`relay: listening on ${scheme}://${host}:${port} (phone page at /, WebSocket at /ws, health at /healthz)\n`);
      process.stdout.write(`relay: static files from ${config.staticDir}\n`);
      process.stdout.write(`relay: allowed browser origins: ${config.allowedOrigins.join(', ')}\n`);
      if (config.disabled) process.stdout.write('relay: kill switch is ON (RELAY_DISABLED): connections are refused with 4503\n');
      process.stdout.write('relay: send SIGUSR2 to toggle the kill switch; SIGINT/SIGTERM to stop\n');
    })
    .catch((e: unknown) => {
      process.stderr.write(`relay: failed to start: ${e instanceof Error ? e.message : 'unknown error'}\n`);
      process.exit(1);
    });

  let disabled = config.disabled;
  process.on('SIGUSR2', () => {
    disabled = !disabled;
    server.setDisabled(disabled);
    process.stdout.write(`relay: kill switch ${disabled ? 'ON' : 'OFF'}\n`);
  });
  const shutdown = (): void => {
    server.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
