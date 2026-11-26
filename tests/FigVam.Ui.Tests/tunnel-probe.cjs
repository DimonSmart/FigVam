// Stand-in executable for tunnel-client: exercises the real AppHost-to-MCP hop.
// No requests to OpenAI, no real API credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function main() {
  const env = process.env;
  const endpoint = new URL(env.MCP_SERVER_URL);
  assert.equal(endpoint.protocol, 'http:');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname));
  assert.equal(endpoint.pathname, '/mcp');
  assert.equal(env.CONTROL_PLANE_TUNNEL_ID, 'tunnel_test');
  assert.equal(env.CONTROL_PLANE_API_KEY, 'figvam-fake-runtime-api-key');
  assert.match(env.FIGVAM_TUNNEL_KEY, /^fvmt_[0-9A-F]{64}$/);
  assert.equal(env.MCP_EXTRA_HEADERS, 'X-FigVam-Tunnel-Key: env:FIGVAM_TUNNEL_KEY');
  assert.equal(env.MCP_DISCOVERY_EXTRA_HEADERS, env.MCP_EXTRA_HEADERS);
  assert.equal(env.MCP_OAUTH_DISCOVERY, 'disabled');
  assert.equal(env.HEALTH_LISTEN_ADDR, '127.0.0.1:0');

  let id = 0, version;
  async function rpc(method, params, notification = false) {
    const requestId = ++id;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-FigVam-Tunnel-Key': env.FIGVAM_TUNNEL_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(version ? { 'MCP-Protocol-Version': version } : {})
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: requestId }), method, params }),
      signal: AbortSignal.timeout(10000)
    });
    assert.ok(response.ok, 'MCP ' + method + ': HTTP ' + response.status);
    if (notification) return;
    const body = await response.text();
    const message = body.trimStart().startsWith('{') ? JSON.parse(body) :
      body.split(/\r?\n/).filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6))).find(message => message.id === requestId);
    assert.ok(message && !message.error, 'MCP ' + method + ' failed');
    return message.result;
  }
  const init = { protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'Aspire tunnel probe', version: '1' } };
  // A Running process can precede Kestrel's listener becoming reachable.
  for (let attempt = 0; ; attempt++) {
    try {
      version = (await rpc('initialize', init)).protocolVersion;
      break;
    } catch (error) {
      if (attempt === 14) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  await rpc('notifications/initialized', {}, true);
  assert.equal((await rpc('tools/list', {})).tools.length, 33);
  const denied = await rpc('tools/call', { name: 'get_document', arguments: {} });
  assert.equal(denied.isError, true);
  assert.equal(denied.structuredContent.code, 'MCP_TUNNEL_ACCESS_REQUIRED');

  const report = path.join(__dirname, 'tunnel-probe-report.json');
  fs.writeFileSync(report + '.tmp', JSON.stringify({
    endpoint: endpoint.href, pid: process.pid,
    keyFingerprint: crypto.createHash('sha256').update(env.FIGVAM_TUNNEL_KEY).digest('hex')
  }));
  fs.renameSync(report + '.tmp', report);
  setInterval(() => {}, 1000);
}
main().catch(error => {
  // Avoid printing credentials or request bodies.
  let message = error.message;
  for (const secret of [process.env.FIGVAM_TUNNEL_KEY, process.env.CONTROL_PLANE_API_KEY])
    if (secret) message = message.replaceAll(secret, '[redacted]');
  console.error('Tunnel probe failed:', message);
  fs.writeFileSync(path.join(__dirname, 'tunnel-probe-report.json.error'), message);
  process.exitCode = 1;
});
