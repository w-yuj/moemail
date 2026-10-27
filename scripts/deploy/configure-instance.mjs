import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const domain = process.env.EMAIL_DOMAIN;
const owner = process.env.BOOTSTRAP_GITHUB_ID;
const config = JSON.parse(readFileSync('wrangler.json', 'utf8'));
const namespace = config.kv_namespaces.find(entry => entry.binding === 'SITE_CONFIG').id;
const database = config.d1_databases.find(entry => entry.binding === 'DB').database_id;
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;

async function api(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Instance configuration request failed (${response.status}).`);
  const data = await response.json();
  if (!data.success) throw new Error('Instance configuration API reported a failure.');
  return data.result;
}

if (domain) {
  const path = `/storage/kv/namespaces/${namespace}/values/EMAIL_DOMAINS`;
  const current = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (!current.ok && current.status !== 404) throw new Error(`Cannot read email domain setting (${current.status}).`);
  const domains = new Set((current.ok ? await current.text() : '').split(',').map(value => value.trim()).filter(Boolean));
  domains.add(domain);
  await api(path, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: [...domains].join(',') });
  console.log('Mailbox domain configuration saved.');
}

async function query(sql, params = []) {
  const result = await api(`/d1/database/${database}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params }) });
  if (!result[0]?.success) throw new Error('Owner initialization query failed.');
  return result[0].results;
}

// Reserve ownership for the verified GitHub identity that owns this deployment.
// Preserve an existing owner and never log account rows or credentials.
if (owner) {
  const owners = await query('SELECT ur.user_id FROM user_role ur JOIN role r ON r.id = ur.role_id WHERE r.name = ? LIMIT 1', ['EMPEROR']);
  if (owners.length) {
    console.log('Existing application owner preserved.');
  } else {
    const linked = await query('SELECT userId FROM account WHERE provider = ? AND providerAccountId = ?', ['github', owner]);
    let userId = linked[0]?.userId;
    if (!userId) {
      userId = randomUUID();
      await query('INSERT INTO user (id, name) VALUES (?, ?)', [userId, process.env.BOOTSTRAP_GITHUB_LOGIN]);
      await query('INSERT INTO account (userId, type, provider, providerAccountId) VALUES (?, ?, ?, ?)', [userId, 'oauth', 'github', owner]);
    }
    const roles = await query('SELECT id FROM role WHERE name = ? LIMIT 1', ['EMPEROR']);
    const roleId = roles[0]?.id || randomUUID();
    if (!roles.length) await query('INSERT INTO role (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [roleId, 'EMPEROR', 'Website owner', Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000)]);
    await query('INSERT OR IGNORE INTO user_role (user_id, role_id, created_at) VALUES (?, ?, ?)', [userId, roleId, Math.floor(Date.now() / 1000)]);
    console.log('Application ownership reserved for the deployment GitHub account.');
  }
}
