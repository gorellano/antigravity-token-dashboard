/**
 * Antigravity Token Dashboard — bridge.js
 *
 * Serves the web dashboard on http://localhost:4000
 * and polls the Antigravity Language Server every 30s for real quota data.
 *
 * Usage:
 *   node bridge.js
 *
 * Then open: http://localhost:4000
 *
 * No external dependencies — pure Node.js only.
 */

import { fetchQuota } from './src/fetcher.js';
import { createServer } from 'http';
import { writeFile, readFile } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const POLL_MS  = 30_000;
const PORT     = 4000;
const CFG_PATH = join(__dirname, 'config.json');
const HIST_PATH = join(__dirname, 'history.json');
const MAX_HIST = 1000; // ~8 hours of data at 30s intervals

// ── Notifications ─────────────────────────────────────────────────────────────

const notifiedModels = new Set();

async function sendNotification(title, message) {
  try {
    // macOS native notification via osascript
    const cmd = `osascript -e 'display notification "${message}" with title "⚡ Antigravity" subtitle "${title}" sound name "Crystal"'`;
    const { exec } = await import('child_process');
    exec(cmd);
  } catch (err) {
    console.error('    ⚠️ Notification failed:', err.message);
  }
}

function checkThresholds(config) {
  if (!config.models) return;

  for (const m of config.models) {
    const remaining = m.remainingFraction ?? 1;
    const name = m.name;
    const key_warn = `${name}_warn`;
    const key_crit = `${name}_crit`;

    // Critical: 0% remaining
    if (remaining === 0) {
      if (!notifiedModels.has(key_crit)) {
        sendNotification('🚨 Quota Exhausted', `${name} has reached 0% remaining.`);
        notifiedModels.add(key_crit);
      }
    } 
    // Warning: < 10% remaining
    else if (remaining <= 0.1) {
      if (!notifiedModels.has(key_warn)) {
        const pct = Math.round(remaining * 100);
        sendNotification('⚠️ Low Quota', `${name} is almost empty (${pct}% left).`);
        notifiedModels.add(key_warn);
      }
    }
    // Reset notification state if quota is back (e.g. after reset)
    else if (remaining > 0.15) {
      notifiedModels.delete(key_warn);
      notifiedModels.delete(key_crit);
    }
  }
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function saveToHistory(snapshot) {
  try {
    let history = [];
    if (existsSync(HIST_PATH)) {
      history = JSON.parse(await readFile(HIST_PATH, 'utf8'));
    }
    
    // Add new entry with only relevant data to save space
    history.push({
      t: snapshot.timestamp,
      m: snapshot.models.map(m => ({ id: m.modelId, u: m.usedPct }))
    });

    // Keep only the last MAX_HIST entries
    if (history.length > MAX_HIST) {
      history = history.slice(-MAX_HIST);
    }

    await writeFile(HIST_PATH, JSON.stringify(history));
  } catch (err) {
    console.error('    ⚠️ History save failed:', err.message);
  }
}

// ── Color map ─────────────────────────────────────────────────────────────────

const MODEL_COLORS = {
  claude:  { color: '#e8a87c', colorBg: 'rgba(232,168,124,0.12)' },
  gemini:  { color: '#4fc3f7', colorBg: 'rgba(79,195,247,0.12)'  },
  gpt:     { color: '#81c784', colorBg: 'rgba(129,199,132,0.12)' },
  default: { color: '#a78bfa', colorBg: 'rgba(167,139,250,0.12)' },
};

function modelColors(label = '') {
  const l = label.toLowerCase();
  if (l.includes('claude')) return MODEL_COLORS.claude;
  if (l.includes('gemini')) return MODEL_COLORS.gemini;
  if (l.includes('gpt'))    return MODEL_COLORS.gpt;
  return MODEL_COLORS.default;
}

// ── Convert snapshot to dashboard config format ───────────────────────────────

function toConfig(snapshot) {
  return {
    _source:    'bridge.js (live)',
    _timestamp: snapshot.timestamp,
    _email:     snapshot.email,
    promptCredits: snapshot.promptCredits,
    models: snapshot.models.map(m => ({
      id:                m.modelId,
      name:              m.label,
      remainingFraction: m.remainingFraction,
      resetTimestamp:    m.resetTime,
      ...modelColors(m.label),
    })),
  };
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

let lastUpdate = null;
let lastError  = null;

async function poll() {
  const ts = new Date().toLocaleTimeString();
  process.stdout.write(`[${ts}] Fetching quota... `);
  try {
    const snapshot = await fetchQuota();
    const config   = toConfig(snapshot);
    await writeFile(CFG_PATH, JSON.stringify(config, null, 2));
    await saveToHistory(snapshot);
    checkThresholds(config);
    lastUpdate = new Date();
    lastError  = null;

    console.log(`✅  ${config.models.length} models detected · ${config._email || 'unknown account'}`);
    for (const m of config.models) {
      const used = Math.round((1 - (m.remainingFraction ?? 1)) * 100);
      console.log(`    ${m.name.padEnd(35)} ${used}% used`);
    }
  } catch (err) {
    lastError = err.message;
    console.log(`❌  ${err.message}`);
    if (err.message.includes('not found') || err.message.includes('not open')) {
      console.log('    → Make sure Antigravity is running');
    }
  }
}

// ── Static file server ────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // /api/quota — live data
  if (req.url === '/api/quota') {
    res.setHeader('Content-Type', 'application/json');
    try {
      const cfg = await readFile(CFG_PATH, 'utf8');
      res.end(cfg);
    } catch {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'Polling in progress, retry in a moment...' }));
    }
    return;
  }

  // /api/history — historical trend data
  if (req.url === '/api/history') {
    res.setHeader('Content-Type', 'application/json');
    try {
      if (existsSync(HIST_PATH)) {
        const hist = await readFile(HIST_PATH, 'utf8');
        res.end(hist);
      } else {
        res.end('[]');
      }
    } catch {
      res.writeHead(500);
      res.end('[]');
    }
    return;
  }

  // /api/status — bridge health
  if (req.url === '/api/status') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok:         lastError === null,
      lastUpdate: lastUpdate?.toISOString() ?? null,
      lastError,
      nextPoll:   lastUpdate
        ? new Date(lastUpdate.getTime() + POLL_MS).toISOString()
        : null,
    }));
    return;
  }

  // Static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = join(__dirname, filePath);
  try {
    const content = readFileSync(filePath);
    res.setHeader('Content-Type', MIME[extname(filePath)] ?? 'text/plain');
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

console.log('');
console.log('⚡ Antigravity Token Dashboard — Web Mode');
console.log(`   Dashboard → http://localhost:${PORT}`);
console.log(`   API       → http://localhost:${PORT}/api/quota`);
console.log(`   Polling every ${POLL_MS / 1000}s`);
console.log('');

server.listen(PORT);
await poll();
setInterval(poll, POLL_MS);
