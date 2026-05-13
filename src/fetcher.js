/**
 * Antigravity Token Dashboard — src/fetcher.js
 *
 * Engine to detect and communicate with the local Antigravity Language Server.
 * Uses native Connect RPC protocol to retrieve real-time quota data.
 */

import { exec }  from 'child_process';
import { promisify } from 'util';
import http  from 'http';
import https from 'https';

const execAsync = promisify(exec);

// ── Constants ─────────────────────────────────────────────────────────────────

const PROBE_PATH    = '/exa.language_server_pb.LanguageServerService/GetUnleashData';
const STATUS_PATH   = '/exa.language_server_pb.LanguageServerService/GetUserStatus';
const PROBE_BODY    = JSON.stringify({ wrapper_data: {} });
const STATUS_BODY   = JSON.stringify({ metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' } });
const HEADERS_BASE  = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Connect-Protocol-Version': '1' };

// ── Step 1 — Find the Antigravity process PID and optional CSRF token ─────────

export async function findAntigravityProcess() {
  try {
    const { stdout } = await execAsync('ps aux');
    for (const line of stdout.split('\n')) {
      const lower = line.toLowerCase();
      if (!lower.includes('antigravity')) continue;
      if (lower.includes('server installation script')) continue;

      const hasServerSignal =
        lower.includes('language-server') ||
        lower.includes('language_server') ||
        lower.includes('--csrf_token') ||
        lower.includes('--extension_server_port') ||
        lower.includes('exa.language_server_pb');

      if (!hasServerSignal) continue;

      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) continue;

      const pid = parseInt(parts[1], 10);
      if (isNaN(pid)) continue;

      const commandLine  = parts.slice(10).join(' ');
      const csrfToken    = extractArg(commandLine, '--csrf_token');
      const portFromArgs = extractArg(commandLine, '--extension_server_port');

      return {
        pid,
        csrfToken: csrfToken ?? undefined,
        portFromArgs: portFromArgs ? parseInt(portFromArgs, 10) : undefined,
        commandLine,
      };
    }
  } catch {}
  return null;
}

// ── Step 2 — Find which ports the process is listening on ─────────────────────

export async function findListeningPorts(pid) {
  try {
    const { stdout } = await execAsync(`lsof -nP -iTCP -sTCP:LISTEN -a -p ${pid}`);
    const ports = [];
    for (const line of stdout.split('\n')) {
      const m = line.match(/:(\d+)\s+\(LISTEN\)/);
      if (m) {
        const p = parseInt(m[1], 10);
        if (!isNaN(p) && !ports.includes(p)) ports.push(p);
      }
    }
    return ports;
  } catch {
    return [];
  }
}

// ── Step 3 — Probe ports to find the Connect RPC endpoint ────────────────────

export async function probeForEndpoint(ports, csrfToken, timeoutMs = 800) {
  const results = await Promise.allSettled(
    ports.map(port => _probePort(port, csrfToken, timeoutMs))
  );
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) return r.value;
  }
  return null;
}

function _probePort(port, csrfToken, timeoutMs) {
  return new Promise(resolve => {
    // Try HTTPS first (self-signed cert), then HTTP
    _probeWith(https, port, csrfToken, timeoutMs)
      .then(r => r ? resolve(r) : _probeWith(http, port, csrfToken, timeoutMs))
      .then(r => resolve(r))
      .catch(() => resolve(null));
  });
}

function _probeWith(protocol, port, csrfToken, timeoutMs) {
  return new Promise(resolve => {
    const headers = { ...HEADERS_BASE };
    if (csrfToken) headers['X-Codeium-Csrf-Token'] = csrfToken;

    const opts = {
      hostname: '127.0.0.1', port, path: PROBE_PATH, method: 'POST',
      timeout: timeoutMs, rejectUnauthorized: false, headers,
    };

    const req = (protocol === https ? https : http).request(opts, res => {
      res.resume(); // drain
      if (res.statusCode === 200 || res.statusCode === 401) {
        resolve({ baseUrl: `${protocol === https ? 'https' : 'http'}://127.0.0.1:${port}`, port });
      } else {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(PROBE_BODY);
    req.end();
  });
}

// ── Step 4 — Call GetUserStatus and return raw response ───────────────────────

export async function getUserStatus(baseUrl, csrfToken) {
  const url = new URL(STATUS_PATH, baseUrl);
  const isHttps = url.protocol === 'https:';
  const headers = { ...HEADERS_BASE };
  if (csrfToken) headers['X-Codeium-Csrf-Token'] = csrfToken;

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: url.hostname, port: url.port || (isHttps ? 443 : 80),
      path: url.pathname, method: 'POST', timeout: 8000,
      rejectUnauthorized: false, headers,
    };

    const protocol = isHttps ? https : http;
    const req = protocol.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); }
          catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(STATUS_BODY);
    req.end();
  });
}

// ── High-level: discover endpoint automatically ───────────────────────────────

export async function discoverEndpoint() {
  const proc = await findAntigravityProcess();
  if (!proc) throw new Error('Antigravity not found. Is the app open?');

  // If port was passed as CLI arg, try it directly
  if (proc.portFromArgs) {
    const endpoint = await probeForEndpoint([proc.portFromArgs], proc.csrfToken);
    if (endpoint) return { ...endpoint, csrfToken: proc.csrfToken };
  }

  const ports = await findListeningPorts(proc.pid);
  if (!ports.length) throw new Error(`No listening ports found for PID ${proc.pid}`);

  const endpoint = await probeForEndpoint(ports, proc.csrfToken);
  if (!endpoint) throw new Error('No Connect RPC endpoint found on any port');

  return { ...endpoint, csrfToken: proc.csrfToken };
}

// ── Full quota fetch pipeline ─────────────────────────────────────────────────

export async function fetchQuota() {
  const endpoint = await discoverEndpoint();
  const raw = await getUserStatus(endpoint.baseUrl, endpoint.csrfToken);
  return parseQuota(raw);
}

// ── Parser ────────────────────────────────────────────────────────────────────

export function parseQuota(raw) {
  const data = raw?.userStatus ?? raw ?? {};

  // Email
  const email = data.email ?? null;

  // Prompt credits
  let promptCredits = null;
  const planStatus = data.planStatus;
  if (planStatus) {
    const available = planStatus.availablePromptCredits;
    const monthly   = planStatus.planInfo?.monthlyPromptCredits;
    if (typeof available === 'number' && typeof monthly === 'number') {
      const used = monthly - available;
      promptCredits = { available, monthly, used, usedPct: used / monthly, remainingPct: available / monthly };
    }
  }

  // Models
  const configs = data.cascadeModelConfigData?.clientModelConfigs ?? [];
  const models = configs.map(m => {
    const modelOrAlias = m.modelOrAlias ?? {};
    const modelId = modelOrAlias.model ?? 'unknown';
    const label   = m.label ?? modelId;
    const qi      = m.quotaInfo ?? {};
    
    // Antigravity might not send remainingFraction if exhausted or in certain plan states
    // If we have quotaInfo but no remainingFraction, it might be 0
    let remaining = null;
    if (typeof qi.remainingFraction === 'number') {
      remaining = qi.remainingFraction;
    } else if (qi.resetTime && !qi.remainingFraction) {
      // If there's a reset time but no fraction, it often means it's exhausted (0)
      remaining = 0;
    }

    const resetTime  = qi.resetTime ?? null;
    const resetMs    = resetTime ? (new Date(resetTime) - Date.now()) : null;

    return {
      modelId,
      label,
      remainingFraction: remaining,
      usedPct:       remaining !== null ? (1 - remaining) : null,
      isExhausted:   remaining === 0,
      resetTime,
      resetMs:       resetMs > 0 ? resetMs : null,
    };
  }).filter(m => {
    // Only show models that actually have some quota info or labels
    return m.label && (m.remainingFraction !== null || m.resetTime);
  });

  return {
    timestamp: new Date().toISOString(),
    email,
    promptCredits,
    models,
  };
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function extractArg(cmdLine, argName) {
  const eqM = cmdLine.match(new RegExp(`${argName}=([^\\s"']+|"[^"]*"|'[^']*')`, 'i'));
  if (eqM) return eqM[1].replace(/^["']|["']$/g, '');
  const spM = cmdLine.match(new RegExp(`${argName}\\s+([^\\s"']+|"[^"]*"|'[^']*')`, 'i'));
  if (spM) return spM[1].replace(/^["']|["']$/g, '');
  return null;
}
