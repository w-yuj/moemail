import { spawn } from 'node:child_process';
import { encryptReport } from './encrypt-report.mjs';

// Capture diagnostics privately; the public runner log receives status only.
const output = [];
const child = spawn('pnpm', ['exec', 'tsx', 'scripts/deploy/index.ts'], { stdio: ['ignore', 'pipe', 'pipe'] });
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => output.push(chunk));
const heartbeat = setInterval(() => console.log('Deployment is running; detailed diagnostics remain encrypted.'), 45000);
child.on('error', () => output.push(Buffer.from('Deployment process could not start.')));
child.on('close', code => {
  clearInterval(heartbeat);
  let log = Buffer.concat(output).toString();
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 4 && /TOKEN|SECRET|PASSWORD|AUTH_GITHUB_ID|AUTH_GOOGLE_ID|CLOUDFLARE_ACCOUNT_ID/.test(name)) log = log.split(value).join('[REDACTED]');
  }
  log = log.replace(/(Authorization[^\r\n]*?Bearer\s+)[A-Za-z0-9_.-]+/gi, '$1[REDACTED]');
  encryptReport('deployment.encrypted.json', { exitCode: code, log });
  console.log(code === 0 ? 'Application deployment completed.' : 'Application deployment failed; encrypted diagnostics are available.');
  process.exitCode = code === 0 ? 0 : 1;
});
