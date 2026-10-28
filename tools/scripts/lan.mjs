// Serve ai-lecturer on all network interfaces so another machine on the same
// network (e.g. a hotspot) can open it. Usage:
//   npm run dev:lan [-- --port 3000]      next dev
//   npm run start:lan [-- --port 3000]    next start (needs `npm run build`)
// There is no auth in the app: anyone who can reach this port can use your
// Claude login and read/write your courses. Use only on networks you trust.
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const mode = args[0] === 'start' ? 'start' : 'dev';
const pi = args.indexOf('--port');
const port = pi >= 0 ? args[pi + 1] : process.env.PORT || '3000';

const urls = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => `http://${n.address}:${port}`);

console.log(`\nai-lecturer (${mode}) listening on 0.0.0.0:${port}`);
console.log('Open from another device on this network:');
for (const u of urls) console.log(`  ${u}`);
console.log('');

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(
  process.execPath,
  [nextBin, mode, '-H', '0.0.0.0', '-p', port],
  { stdio: 'inherit', env: { ...process.env, AI_LECTURER_LAN: '1' } },
);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
