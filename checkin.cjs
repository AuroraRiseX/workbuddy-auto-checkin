'use strict';
// Node.js >= 18; uses WorkBuddy's authenticated local IPC. No cloud token export.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const CONFIG = process.env.WORKBUDDY_CONFIG_DIR || path.join(os.homedir(), '.workbuddy');
const DATA = process.env.WB_CHECKIN_DATA_DIR || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library/Application Support/WorkBuddyAutoCheckin')
  : path.join(process.env.LOCALAPPDATA || os.homedir(), 'WorkBuddyAutoCheckin'));
const STATUS = '/v2/billing/meter/checkin-activity-status';
const CLAIM = '/v2/billing/meter/daily-checkin';
const delay = ms => new Promise(r => setTimeout(r, ms));
function proof(ticket, role, endpoint, clientNonce, serverNonce) {
  const transcript = [role === 'server' ? 'wbipc-s' : 'wbipc-c', '1', endpoint, clientNonce, serverNonce];
  const bytes = transcript.flatMap(v => { const b = Buffer.from(v); const n = Buffer.alloc(4); n.writeUInt32BE(b.length); return [n, b]; });
  return crypto.createHmac('sha256', ticket).update(Buffer.concat(bytes)).digest('base64url');
}
function connect(discovery, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const { endpoint, ticket } = discovery;
    if (typeof endpoint !== 'string' || typeof ticket !== 'string' || !ticket) return reject(Error('INVALID_DISCOVERY'));
    // Only local Unix sockets / Windows named pipes, never TCP.
    if (!(process.platform === 'win32' ? endpoint.startsWith('\\\\.\\pipe\\') : path.isAbsolute(endpoint))) return reject(Error('NONLOCAL_ENDPOINT'));
    const nonce = crypto.randomBytes(16).toString('base64url');
    const socket = net.connect(endpoint);
    const pending = new Map(); let seq = 0, buffer = '', ready = false;
    const send = value => socket.write(JSON.stringify(value) + '\n');
    const fail = code => {
      const err = Error(code); reject(err);
      for (const { reject: no, timer } of pending.values()) { clearTimeout(timer); no(err); }
      pending.clear(); socket.destroy();
    };
    const handshake = setTimeout(() => fail('IPC_HANDSHAKE_TIMEOUT'), 10000);
    const call = (method, params, mode) => new Promise((yes, no) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); no(Error('IPC_REQUEST_TIMEOUT')); socket.destroy(); }, timeout);
      pending.set(id, { resolve: yes, reject: no, timer });
      send({ jsonrpc: '2.0', id, method, params, ...(mode ? { mode } : {}) });
    });
    socket.on('connect', () => send({ type: 'session_hello', protocol_min: 1, protocol_max: 1,
      ticket_id: crypto.createHash('sha256').update(ticket).digest('hex').slice(0, 16),
      client_nonce: nonce, client: { kind: 'script', id: 'workbuddy-daily-checkin', version: '1.0' } }));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) return fail('IPC_FRAME_TOO_LARGE');
      for (let i; (i = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (!line) continue;
        let frame; try { frame = JSON.parse(line); } catch { return fail('IPC_INVALID_JSON'); }
        if (frame.type === 'session_challenge' && !ready) {
          const expected = proof(ticket, 'server', endpoint, nonce, frame.server_nonce);
          if (frame.server_proof !== expected) return fail('IPC_SERVER_PROOF_INVALID');
          send({ type: 'session_prove', client_proof: proof(ticket, 'client', endpoint, nonce, frame.server_nonce) });
        } else if (frame.type === 'session_hello_ack' && !ready) {
          ready = true; clearTimeout(handshake);
          resolve({ call, close: () => socket.destroy() });
        } else if (frame.type === 'session_hello_error' || frame.type === 'pipe_revoked') {
          fail('IPC_AUTH_OR_SESSION_CHANGED'); return;
        } else if (pending.has(frame.id)) {
          const p = pending.get(frame.id); pending.delete(frame.id); clearTimeout(p.timer);
          frame.error ? p.reject(Error('IPC_RPC_' + String(frame.error.code).replace(/[^A-Za-z0-9_-]/g, ''))) : p.resolve(frame.result);
        }
      }
    });
    socket.on('error', () => fail('IPC_UNAVAILABLE'));
    socket.on('close', () => { clearTimeout(handshake); if (!ready || pending.size) fail('IPC_CLOSED'); });
  });
}
async function requestClient(discovery) {
  const rpc = await connect(discovery);
  try {
    const pipe = await rpc.call('broker/GetPipe', { pipe: 'wb.request' });
    if (!pipe.methods?.includes('http.fetch')) throw Error('WORKBUDDY_VERSION_UNSUPPORTED');
    return { close: rpc.close, post: async route => {
      // Keep this program restricted to the two check-in operations.
      if (![STATUS, CLAIM].includes(route)) throw Error('ROUTE_NOT_ALLOWED');
      const result = await rpc.call(pipe.channel + '/http.fetch', {
        method: 'POST', path: route, headers: { 'content-type': 'application/json' }, body_b64: 'e30='
      }, 'call');
      if (result.status === 401 || result.status === 403) throw Error('LOGIN_REQUIRED');
      if (result.status < 200 || result.status >= 500) throw Error('HTTP_' + result.status);
      let body; try { body = JSON.parse(Buffer.from(result.body_b64, 'base64').toString('utf8')); }
      catch { throw Error('INVALID_SERVER_RESPONSE'); }
      return body;
    } };
  } catch (e) { rpc.close(); throw e; }
}
function statusData(body) {
  if (body?.code !== 0 || typeof body.data?.active !== 'boolean' || typeof body.data?.today_checked_in !== 'boolean')
    throw Error('STATUS_REJECTED_' + (Number.isInteger(body?.code) ? body.code : 'INVALID'));
  return body.data;
}
async function checkin(post, readOnly = false) {
  const before = statusData(await post(STATUS));
  if (before.today_checked_in) return { status: 'already_claimed', credit: before.today_credit, season: before.season };
  if (!before.active) return { status: 'event_inactive', endTime: before.end_time };
  if (readOnly) return { status: 'available', credit: before.today_credit, season: before.season };
  const claim = await post(CLAIM);
  // The current server returns HTTP 400 / code 10001 for an already claimed day.
  // Re-read server status for every business result, including concurrent claims.
  // Never report success solely because a request was sent.
  const after = statusData(await post(STATUS));
  if (!after.today_checked_in) throw Error('CLAIM_NOT_CONFIRMED_' + (Number.isInteger(claim?.code) ? claim.code : 'INVALID'));
  return { status: claim.code === 0 ? 'claimed' : 'already_claimed', credit: after.today_credit, season: after.season };
}
function launchApp() {
  if (process.platform === 'darwin') cp.spawnSync('/usr/bin/open', ['-g', '-a', 'WorkBuddy'], { stdio: 'ignore', timeout: 10000 });
  else if (process.platform === 'win32') {
    const candidates = [process.env.WORKBUDDY_EXE,
      path.join(process.env.LOCALAPPDATA || '', 'Programs/WorkBuddy/WorkBuddy.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'WorkBuddy/WorkBuddy.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WorkBuddy/WorkBuddy.exe')].filter(Boolean);
    const exe = candidates.find(p => fs.existsSync(p));
    if (!exe) throw Error('WORKBUDDY_EXE_NOT_FOUND');
    const child = cp.spawn(exe, [], { detached: true, stdio: 'ignore' }); child.on('error', () => {}); child.unref();
  } else throw Error('PLATFORM_UNSUPPORTED');
}
async function openClient(noLaunch) {
  const read = () => JSON.parse(fs.readFileSync(path.join(CONFIG, 'wbipc/endpoint.json'), 'utf8'));
  try { return await requestClient(read()); } catch (e) { if (noLaunch) throw e; }
  launchApp();
  for (let i = 0; i < 12; i++) { await delay(2500); try { return await requestClient(read()); } catch {} }
  throw Error('WORKBUDDY_NOT_READY_OR_LOGIN_REQUIRED');
}
function log(result) {
  const file = path.join(DATA, 'checkin.log');
  if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) { fs.rmSync(file + '.old', { force: true }); fs.renameSync(file, file + '.old'); }
  const record = { time: new Date().toISOString(), ...result };
  fs.appendFileSync(file, JSON.stringify(record) + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(DATA, 'last-result.json'), JSON.stringify(record, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(record));
}
async function main() {
  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const lock = path.join(DATA, 'run.lock'); let owned = false;
  try {
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); owned = true; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); return; } catch (err) { if (err.code !== 'ESRCH') return; }
      }
      fs.unlinkSync(lock); fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); owned = true;
    }
    const client = await openClient(process.argv.includes('--no-launch'));
    try { log(await checkin(client.post, process.argv.includes('--status'))); } finally { client.close(); }
  } catch (e) {
    // Error messages are generated locally; upstream response bodies and tickets are never logged.
    const code = /^[A-Z0-9_-]+$/.test(e.message) ? e.message : 'LOCAL_IO_OR_CONFIGURATION_ERROR';
    log({ status: 'failed', error: code }); process.exitCode = 1;
  } finally { if (owned) fs.unlinkSync(lock); }
}
module.exports = { proof, connect, requestClient, checkin, STATUS, CLAIM };
if (require.main === module) main();
