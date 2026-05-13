#!/usr/bin/env node
/**
 * Antigravity Token Dashboard — src/cli.js
 *
 * Terminal version of the quota monitor.
 * Runs once and prints a pretty table, or with --watch refreshes every 30s.
 *
 * Usage:
 *   node src/cli.js            # one-shot
 *   node src/cli.js --watch    # auto-refresh every 30s
 *   node src/cli.js --json     # raw JSON output
 *
 * No external dependencies — pure Node.js only.
 */

import { fetchQuota } from './fetcher.js';

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  gray:   '\x1b[90m',
  bgRed:  '\x1b[41m',
  bgGreen:'\x1b[42m',
};

const bold  = s => `${C.bold}${s}${C.reset}`;
const dim   = s => `${C.dim}${s}${C.reset}`;
const red   = s => `${C.red}${s}${C.reset}`;
const green = s => `${C.green}${s}${C.reset}`;
const yellow = s => `${C.yellow}${s}${C.reset}`;
const cyan  = s => `${C.cyan}${s}${C.reset}`;
const gray  = s => `${C.gray}${s}${C.reset}`;

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtPct(pct) {
  if (pct === null || pct === undefined) return gray('  —  ');
  const used = Math.round(pct * 100);
  const remaining = 100 - used;
  if (remaining <= 20) return red(`${remaining}%`);
  if (remaining <= 50) return yellow(`${remaining}%`);
  return green(`${remaining}%`);
}

function fmtBar(pct, width = 20) {
  if (pct === null) return gray('─'.repeat(width));
  const used = Math.round(pct * width);
  const rem  = width - used;
  const usedChar  = '█';
  const remChar   = '░';
  const bar = usedChar.repeat(used) + remChar.repeat(rem);
  const usedPct = Math.round(pct * 100);
  if (usedPct >= 80) return red(bar);
  if (usedPct >= 50) return yellow(bar);
  return green(bar);
}

function fmtTime(ms) {
  if (!ms || ms <= 0) return gray('—');
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtEta(model) {
  // Estimate exhaustion time from current consumption rate
  // (only meaningful if we have usage history - here we show time until reset)
  if (model.isExhausted) return red('EXHAUSTED');
  if (model.remainingFraction === 1) return green('Full');
  if (model.remainingFraction === null) return gray('—');
  return dim(`${Math.round(model.remainingFraction * 100)}% left`);
}

// ── Box drawing ───────────────────────────────────────────────────────────────

function hr(width, char = '─') { return char.repeat(width); }

function padEnd(str, width) {
  // pad ignoring ANSI escape codes
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, width - visible.length);
  return str + ' '.repeat(pad);
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(snapshot) {
  const { email, models, promptCredits, timestamp } = snapshot;
  const cols = { model: 32, bar: 22, pct: 8, resets: 10 };
  const totalW = cols.model + cols.bar + cols.pct + cols.resets + 7;

  console.clear();

  // Header
  console.log('\n' + bold(cyan('  ⚡ Antigravity Token Dashboard')));
  console.log(gray(`  ${new Date(timestamp).toLocaleString()} · ${email || 'unknown account'}`));
  console.log();

  // Table header
  const hModel  = bold(padEnd('  Model', cols.model));
  const hBar    = bold(padEnd('Usage', cols.bar));
  const hPct    = bold(padEnd('Remaining', cols.pct));
  const hResets = bold('Resets In');
  console.log(`${hModel} ${hBar} ${hPct} ${hResets}`);
  console.log(gray(hr(totalW)));

  // Rows
  for (const m of models) {
    const usedPct = m.usedPct ?? 0;
    const name    = padEnd(`  ${m.label}`, cols.model);
    const bar     = padEnd(fmtBar(usedPct, 18), cols.bar + 18); // bar has ANSI so extra room
    const pct     = padEnd(fmtPct(usedPct), cols.pct + 10);
    const resets  = fmtTime(m.resetMs);
    console.log(`${name} ${bar} ${pct} ${resets}`);
  }

  console.log(gray(hr(totalW)));

  // Prompt credits
  if (promptCredits) {
    const { available, monthly, usedPct } = promptCredits;
    const creditBar = fmtBar(usedPct, 18);
    const creditPct = fmtPct(usedPct);
    console.log(`  ${padEnd('AI Credits (prompt)', cols.model)} ${padEnd(creditBar, cols.bar + 18)} ${creditPct} ${dim(`${available.toLocaleString()} / ${monthly.toLocaleString()}`)}`);
    console.log(gray(hr(totalW)));
  }

  // Footer
  const watchMode = process.argv.includes('--watch');
  if (watchMode) {
    console.log(gray(`\n  Auto-refresh every 30s · Ctrl+C to exit\n`));
  } else {
    console.log(gray(`\n  Tip: run with --watch for auto-refresh\n`));
  }
}

function renderError(err) {
  console.error('\n' + red('  ✗ Error: ') + err.message);
  if (err.message.includes('not found') || err.message.includes('not open')) {
    console.error(gray('  → Make sure Antigravity is running'));
  }
  console.error();
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isJson  = args.includes('--json');
const isWatch = args.includes('--watch');

async function run() {
  try {
    const snapshot = await fetchQuota();
    if (isJson) {
      console.log(JSON.stringify(snapshot, null, 2));
    } else {
      render(snapshot);
    }
  } catch (err) {
    if (isJson) {
      console.error(JSON.stringify({ error: err.message }, null, 2));
    } else {
      renderError(err);
    }
    if (!isWatch) process.exit(1);
  }
}

// Run immediately
await run();

// Watch mode
if (isWatch) {
  setInterval(run, 30_000);
}
