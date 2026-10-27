// Read-only inspection. Never print API responses containing runtime secrets.
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const projectName = process.env.PROJECT_NAME || 'moemail';
const domain = process.env.EMAIL_DOMAIN;
if (!token || !account || !domain) throw new Error('Missing deployment configuration');

async function request(path, { text = false } = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (text && response.ok) return await response.text();
  const data = await response.json();
  if (!response.ok || data.success === false) {
    return { unavailable: true, status: response.status, errors: data.errors?.map(e => ({ code: e.code, message: e.message })) };
  }
  return data.result;
}

const report = { domain };
const project = await request(`/accounts/${account}/pages/projects/${encodeURIComponent(projectName)}`);
if (project.unavailable) {
  report.project = project;
} else {
  const config = project.deployment_configs?.production || {};
  report.project = {
    name: project.name,
    subdomain: project.subdomain,
    domains: project.domains,
    deployment: project.canonical_deployment && {
      url: project.canonical_deployment.url,
      stage: project.canonical_deployment.latest_stage,
      created: project.canonical_deployment.created_on,
    },
    secretNames: Object.keys(config.env_vars || {}),
    d1: config.d1_databases,
    kv: config.kv_namespaces,
  };
  const namespace = config.kv_namespaces?.SITE_CONFIG?.namespace_id;
  if (namespace) {
    report.emailDomains = await request(`/accounts/${account}/storage/kv/namespaces/${namespace}/values/EMAIL_DOMAINS`, { text: true });
  }
}

const scripts = await request(`/accounts/${account}/workers/scripts`);
report.workers = Array.isArray(scripts) ? scripts.map(s => ({ name: s.id, modified: s.modified_on })) : scripts;
const zones = await request(`/zones?name=${encodeURIComponent(domain)}`);
if (Array.isArray(zones) && zones.length) {
  const zone = zones[0];
  report.zone = { id: zone.id, name: zone.name, status: zone.status, nameservers: zone.name_servers };
  const records = await request(`/zones/${zone.id}/dns_records?per_page=100`);
  report.dns = Array.isArray(records) ? records.filter(r => ['MX', 'CNAME'].includes(r.type) || (r.type === 'TXT' && r.content.startsWith('v=spf1'))).map(r => ({ type: r.type, name: r.name, content: r.content, priority: r.priority, proxied: r.proxied })) : records;
  report.emailRouting = await request(`/zones/${zone.id}/email/routing`);
  report.catchAll = await request(`/zones/${zone.id}/email/routing/rules/catch_all`);
} else {
  report.zone = zones;
}
console.log(JSON.stringify(report, null, 2));
if (project.unavailable) process.exitCode = 1;
