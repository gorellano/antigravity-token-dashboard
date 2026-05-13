/* ===========================
   Antigravity Token Dashboard — app.js
   Fase 1: prototipo con datos mock
   =========================== */

// ─── Mock data ───────────────────────────────────────────────────────────────

let MODELS = [];

let resetSeconds = 4 * 3600 + 58 * 60 + 11;
let charts = {};  // gauge charts by model id
let historyChart = null; // line chart for trends
let historyData = [];
let notifiedModels = new Set();
let notificationsEnabled = false;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusFor(pct) {
  if (pct < 60) return { cls: 'chip-ok', label: 'Healthy' };
  if (pct < 80) return { cls: 'chip-warn', label: 'Warning' };
  return { cls: 'chip-crit', label: 'Critical' };
}

function barColor(pct) {
  if (pct < 60) return 'linear-gradient(90deg, #16a34a, #22c55e)';
  if (pct < 80) return 'linear-gradient(90deg, #d97706, #f59e0b)';
  return 'linear-gradient(90deg, #dc2626, #ef4444)';
}

function gaugeColors(pct, modelColor) {
  if (pct >= 80) return ['#ef4444', 'rgba(239,68,68,0.08)'];
  if (pct >= 60) return ['#f59e0b', 'rgba(245,158,11,0.08)'];
  return [modelColor, 'rgba(0,0,0,0.08)'];
}

function fmtSeconds(s) {
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function etaPrediction(pct, requestsToday) {
  // Simulate a moving-average-based prediction
  if (pct === 0) return null;
  const ratePerHour = requestsToday / (new Date().getHours() + 1);
  if (ratePerHour === 0) return null;
  const remaining = 100 - pct;
  const pctPerRequest = pct / requestsToday;
  const hoursLeft = remaining / (ratePerHour * pctPerRequest);
  if (hoursLeft > 12) return null; // no urgency
  const h = Math.floor(hoursLeft);
  const m = Math.floor((hoursLeft - h) * 60);
  return `~${h}h ${m}m`;
}

// ─── Gauge chart ──────────────────────────────────────────────────────────────

function createGauge(canvasId, pct, modelColor) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const [fg, bg] = gaugeColors(pct, modelColor);

  if (charts[canvasId]) {
    charts[canvasId].destroy();
  }

  charts[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [pct, 100 - pct],
        backgroundColor: [fg, bg],
        borderWidth: 0,
        hoverOffset: 0,
      }],
    },
    options: {
      cutout: '68%',
      rotation: 0,
      circumference: 360,
      responsive: false,
      animation: {
        animateRotate: true,
        duration: 1200,
        easing: 'easeInOutQuart',
      },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });
}

// ─── Card renderer ────────────────────────────────────────────────────────────

function renderCard(model) {
  const status = statusFor(model.pct);
  const eta = etaPrediction(model.pct, model.requests);
  const canvasId = `gauge-${model.id}`;

  return `
    <div class="model-card" id="card-${model.id}" style="--model-color: ${model.color}">
      <div class="card-top">
        <div class="model-info">
          <div class="model-name">${model.name}</div>
          <div class="model-provider" style="color: ${model.color}">${model.provider} · ${model.tier}</div>
        </div>
        <div class="gauge-wrap">
          <canvas id="${canvasId}" width="80" height="80"></canvas>
          <div class="gauge-label">
            <span class="gauge-pct" style="color: ${gaugeColors(model.pct, model.color)[0]}">${model.pct}%</span>
            <span class="gauge-used">used</span>
          </div>
        </div>
      </div>

      <div class="bar-section">
        <div class="bar-meta">
          <span class="bar-label">Quota consumed</span>
          <span class="bar-reset mono" id="reset-${model.id}">Resets in ${fmtSeconds(resetSeconds)}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" id="bar-${model.id}"
            style="width: 0%; background: ${barColor(model.pct)}">
          </div>
        </div>
      </div>

      <div class="card-bottom">
        <span class="chip ${status.cls}">${status.label}</span>
        <span class="chip chip-model">${model.requests} req</span>
        <span class="chip chip-model">${model.tokensM}M tok</span>
        ${eta ? `<span class="chip chip-warn">⏳ ${eta}</span>` : ''}
      </div>
    </div>
  `;
}

// ─── Full render ──────────────────────────────────────────────────────────────

function renderDashboard() {
  const grid = document.getElementById('modelsGrid');
  grid.innerHTML = MODELS.map(renderCard).join('');

  // Init gauges and bars after DOM is painted
  requestAnimationFrame(() => {
    MODELS.forEach(m => {
      createGauge(`gauge-${m.id}`, m.pct, m.color);
      // Animate bar from 0
      setTimeout(() => {
        const bar = document.getElementById(`bar-${m.id}`);
        if (bar) bar.style.width = `${m.pct}%`;
      }, 80);
    });
  });
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function updateStats() {
  const totalRequests = MODELS.reduce((s, m) => s + m.requests, 0);
  const totalTokens = MODELS.reduce((s, m) => s + m.tokensM, 0);
  const avgLatency = (MODELS.reduce((s, m) => s + Number(m.avgLatency), 0) / MODELS.length).toFixed(1);
  const cost = (totalTokens * 1.3).toFixed(2); // rough mock cost

  animateNumber('statRequests', totalRequests, v => v);
  animateNumber('statTokens', totalTokens, v => `${v.toFixed(1)}M`);
  animateNumber('statCost', parseFloat(cost), v => `$${v.toFixed(2)}`);
  animateNumber('statLatency', parseFloat(avgLatency), v => `${v.toFixed(1)}s`);
}

function animateNumber(id, target, fmt) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('pop');
  void el.offsetWidth; // reflow
  el.classList.add('pop');
  el.textContent = fmt(target);
}

// ─── Countdown ────────────────────────────────────────────────────────────────

function tickCountdown() {
  if (resetSeconds > 0) resetSeconds--;
  const el = document.getElementById('statReset');
  if (el) el.textContent = fmtSeconds(resetSeconds);

  // Update per-card reset labels
  MODELS.forEach(m => {
    const el = document.getElementById(`reset-${m.id}`);
    if (el) el.textContent = `Resets in ${fmtSeconds(resetSeconds)}`;
  });
}

// ─── Refresh (simulated data variance) ───────────────────────────────────────

function jitter(val, delta = 5) {
  return Math.max(0, Math.min(100, val + (Math.random() * delta * 2 - delta)));
}

window.refreshData = function () {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');

  setTimeout(() => {
    // Simulate polling update
    MODELS.forEach(m => {
      m.pct = Math.round(jitter(m.pct, 4));
      m.requests += Math.round(Math.random() * 3);
      m.tokensM = parseFloat((m.tokensM + Math.random() * 0.2).toFixed(1));
      m.avgLatency = parseFloat(jitter(m.avgLatency * 10, 3) / 10).toFixed(1);
    });

    renderDashboard();
    updateStats();
    updateLastUpdate();
    btn.classList.remove('spinning');
  }, 600);
};

function updateLastUpdate() {
  const el = document.getElementById('lastUpdate');
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

const BRIDGE_URL = 'http://localhost:4000/api/quota';
const HISTORY_URL = 'http://localhost:4000/api/history';
let usingLiveData = false;

/**
 * Match a real model (from bridge/config) to a MODELS entry.
 * The CLI returns labels like "Claude Sonnet 4.6 (Thinking)".
 * We match by partial label since mock names differ from real names.
 */
function matchModelByLabel(label = '') {
  const l = label.toLowerCase();
  // Claude models
  if (l.includes('sonnet'))  return MODELS.find(m => m.id === 'claude-sonnet');
  if (l.includes('opus'))    return MODELS.find(m => m.id === 'claude-opus');
  // Gemini models
  if (l.includes('flash'))   return MODELS.find(m => m.id === 'gemini-flash');
  if (l.includes('pro') && l.includes('high')) return MODELS.find(m => m.id === 'gemini-pro-high');
  if (l.includes('pro') && l.includes('low'))  return MODELS.find(m => m.id === 'gemini-pro-low');
  if (l.includes('pro'))     return MODELS.find(m => m.id === 'gemini-pro-high'); // fallback
  // GPT
  if (l.includes('gpt'))     return MODELS.find(m => m.id === 'gpt-oss');
  return null;
}

function applyRealData(cfg) {
  if (!Array.isArray(cfg.models)) return;

  let earliestResetMs = Infinity;

  cfg.models.forEach(real => {
    // Match by label (bridge) or by id (manual config.json)
    let model = matchModelByLabel(real.name || real.label) ||
                  MODELS.find(m => m.id === real.id);
    
    // IF MODEL DOES NOT EXIST, CREATE IT DYNAMICALLY
    if (!model) {
      model = {
        id: real.id || (real.name || real.label).toLowerCase().replace(/\s+/g, '-'),
        name: real.name || real.label,
        tier: real.tier || 'Standard',
        provider: real.provider || (real.name?.includes('Claude') ? 'Anthropic' : real.name?.includes('Gemini') ? 'Google' : 'AI'),
        color: real.color || '#a78bfa',
        pct: 0,
        requests: 0,
        tokensM: 0,
        avgLatency: 0
      };
      MODELS.push(model);
    }

    if (real.remainingFraction !== undefined) {
      model.pct = Math.round((1 - real.remainingFraction) * 100);
    }
    // Track earliest reset
    if (real.resetTimestamp) {
      const diff = new Date(real.resetTimestamp) - Date.now();
      if (diff > 0 && diff < earliestResetMs) earliestResetMs = diff;
    }
    if (real.requests   !== undefined) model.requests   = real.requests;
    if (real.tokensM    !== undefined) model.tokensM    = real.tokensM;
    if (real.avgLatency !== undefined) model.avgLatency = real.avgLatency;
  });

  if (earliestResetMs !== Infinity) {
    resetSeconds = Math.floor(earliestResetMs / 1000);
  }

  // Trigger browser notifications check
  checkBrowserNotifications(cfg.models);
}

async function tryBridge() {
  try {
    const res = await fetch(BRIDGE_URL, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const cfg = await res.json();
    applyRealData(cfg);
    usingLiveData = true;
    const badge = document.querySelector('.live-badge');
    if (badge) badge.innerHTML = '<span class="live-dot"></span> Live · ' + (cfg._email || '');
    return true;
  } catch { return false; }
}

async function tryConfigFile() {
  try {
    const res = await fetch('./config.json');
    if (!res.ok) return false;
    const cfg = await res.json();
    applyRealData(cfg);
    usingLiveData = true;
    const badge = document.querySelector('.live-badge');
    if (badge) badge.innerHTML = '<span class="live-dot"></span> Real data';
    console.log('[dashboard] config.json loaded — using real data');
    return true;
  } catch { return false; }
}

async function loadConfig() {
  // Priority: bridge (live) → config.json (manual) → mock
  const liveFetched = await tryBridge();
  if (!liveFetched) await tryConfigFile();
  
  if (usingLiveData) {
    await fetchHistory();
  }
}

// ─── History Logic ────────────────────────────────────────────────────────────

async function fetchHistory() {
  try {
    const res = await fetch(HISTORY_URL);
    if (!res.ok) return;
    historyData = await res.json();
    renderHistory();
  } catch (err) {
    console.warn('[dashboard] history fetch failed');
  }
}

function renderHistory() {
  if (!historyData || historyData.length < 2) return;
  const ctx = document.getElementById('historyChart')?.getContext('2d');
  if (!ctx) return;

  const labels = historyData.map(h => {
    const date = new Date(h.t);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  // Unique model IDs from history
  const modelIdsInHistory = new Set();
  historyData.forEach(h => h.m.forEach(m => modelIdsInHistory.add(m.id)));

  const datasets = Array.from(modelIdsInHistory).map(id => {
    // Try to find model info for color/label
    const realModel = historyData.find(h => h.m.find(m => m.id === id))?.m.find(m => m.id === id);
    const dashboardModel = matchModelByLabel(id) || MODELS.find(m => m.id === id);
    
    const color = dashboardModel?.color || '#a78bfa';
    const label = dashboardModel?.name || id;

    return {
      label,
      data: historyData.map(h => {
        const m = h.m.find(m => m.id === id);
        return m ? Math.round((1 - m.u) * 100) : null;
      }),
      borderColor: color,
      backgroundColor: color + '10',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.3,
      fill: false
    };
  });

  if (historyChart) {
    historyChart.data.labels = labels;
    historyChart.data.datasets = datasets;
    historyChart.update('none');
  } else {
    historyChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(15, 15, 20, 0.9)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: (context) => ` ${context.dataset.label}: ${context.parsed.y}%`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }
          },
          y: {
            min: 0, max: 100,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { 
              color: '#94a3b8', font: { size: 10 },
              callback: v => v + '%'
            }
          }
        }
      }
    });
  }

  renderLegend(datasets);
}

function renderLegend(datasets) {
  const legendEl = document.getElementById('historyLegend');
  if (!legendEl) return;
  legendEl.innerHTML = datasets.map(ds => `
    <div class="legend-item">
      <span class="legend-color" style="background: ${ds.borderColor}"></span>
      <span>${ds.label}</span>
    </div>
  `).join('');
}

// ─── Auto-polling every 30s (real or mock) ────────────────────────────────────

window.refreshData = async function () {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');

  if (usingLiveData) {
    // Fetch fresh data from bridge or config
    const liveFetched = await tryBridge();
    if (!liveFetched) await tryConfigFile();
    await fetchHistory();
  } else {
    // Mock jitter
    MODELS.forEach(m => {
      m.pct = Math.round(jitter(m.pct, 4));
      m.requests += Math.round(Math.random() * 3);
      m.tokensM = parseFloat((m.tokensM + Math.random() * 0.2).toFixed(1));
      m.avgLatency = parseFloat(jitter(m.avgLatency * 10, 3) / 10).toFixed(1);
    });
  }

  renderDashboard();
  updateStats();
  updateLastUpdate();
  btn.classList.remove('spinning');
};

setInterval(window.refreshData, 30_000);

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  initNotifications();
  renderDashboard();
  updateStats();
  updateLastUpdate();
  setInterval(tickCountdown, 1000);
});

// ─── Browser Notifications Logic ──────────────────────────────────────────────

function initNotifications() {
  const btn = document.getElementById('notifBtn');
  if (!btn) return;

  if ('Notification' in window) {
    updateNotifBtnState();
    btn.onclick = async () => {
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        updateNotifBtnState();
        if (permission === 'granted') {
          new Notification('⚡ Antigravity', { body: 'Notifications enabled!' });
        }
      } else if (Notification.permission === 'granted') {
        notificationsEnabled = !notificationsEnabled;
        updateNotifBtnState();
      }
    };
  } else {
    btn.style.display = 'none';
  }
}

function updateNotifBtnState() {
  const btn = document.getElementById('notifBtn');
  if (!btn) return;

  if (Notification.permission === 'granted') {
    btn.classList.add('granted');
    if (notificationsEnabled) {
      btn.classList.add('active');
      btn.title = 'Notifications: Active';
    } else {
      btn.classList.remove('active');
      btn.title = 'Notifications: Paused';
    }
  } else if (Notification.permission === 'denied') {
    btn.classList.add('denied');
    btn.title = 'Notifications: Blocked by browser';
  }
}

function checkBrowserNotifications(models) {
  if (!notificationsEnabled || Notification.permission !== 'granted') return;

  models.forEach(m => {
    const remaining = m.remainingFraction;
    if (remaining === undefined) return;

    const key_warn = `${m.id}_warn`;
    const key_crit = `${m.id}_crit`;

    if (remaining === 0) {
      if (!notifiedModels.has(key_crit)) {
        new Notification('🚨 Quota Exhausted', { body: `${m.name} is at 0%.` });
        notifiedModels.add(key_crit);
      }
    } else if (remaining <= 0.1) {
      if (!notifiedModels.has(key_warn)) {
        new Notification('⚠️ Low Quota', { body: `${m.name} is at ${Math.round(remaining * 100)}%.` });
        notifiedModels.add(key_warn);
      }
    } else if (remaining > 0.15) {
      notifiedModels.delete(key_warn);
      notifiedModels.delete(key_crit);
    }
  });
}
