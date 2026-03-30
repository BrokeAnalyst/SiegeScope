// chart wrappers
/**
 * SiegeScope — charts.js
 * Chart.js wrappers for RP projection, season history, and multikill charts.
 * Import Chart.js from CDN in your HTML before using these.
 */

// ─── RP Projection Line Chart ─────────────────────────────────────────────────

/**
 * Renders an RP-over-time line chart into a <canvas> element.
 * @param {string}  canvasId   - ID of the canvas element
 * @param {Array}   rpHistory  - from fetchRPHistory(): [{timestamp, rp, rank, color}]
 * @param {number}  currentRp  - current RP value to project from
 * @param {string}  seasonColor - hex color for the current season accent
 */
export function renderRPChart(canvasId, rpHistory, currentRp, seasonColor = '#a0daae') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // Destroy existing chart if present
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  if (!rpHistory || rpHistory.length === 0) {
    _showEmpty(canvas, 'No RP history available');
    return;
  }

  // Last 50 matches for readability
  const data = rpHistory.slice(-50);

  const labels = data.map(d => _formatChartDate(d.timestamp));
  const values = data.map(d => d.rp);
  const colors = data.map(d => d.color || seasonColor);

  // Compute 5-match rolling average for projection line
  const rollingAvg = _rollingAverage(values, 5);
  const projected  = _projectNext(values, 5);

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Rank Points',
          data: values,
          borderColor: seasonColor,
          backgroundColor: `${seasonColor}22`,
          pointBackgroundColor: colors,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.3,
          fill: true,
          borderWidth: 2,
        },
        {
          label: '5-Match Trend',
          data: rollingAvg,
          borderColor: '#ffffff55',
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0.4,
          borderWidth: 1.5,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: {
          labels: { color: '#ccc', font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            title: (items) => items[0].label,
            label: (item) => ` ${item.dataset.label}: ${item.raw?.toLocaleString() ?? '—'} RP`,
          },
          backgroundColor: '#1a1a2e',
          borderColor: seasonColor,
          borderWidth: 1,
          titleColor: '#fff',
          bodyColor: '#ccc',
        },
      },
      scales: {
        x: {
          ticks: { color: '#888', maxTicksLimit: 8, maxRotation: 0 },
          grid: { color: '#ffffff0a' },
        },
        y: {
          ticks: {
            color: '#888',
            callback: (v) => v.toLocaleString(),
          },
          grid: { color: '#ffffff0a' },
        },
      },
    },
  });
}

// ─── Season History Bar Chart ─────────────────────────────────────────────────

/**
 * Bar chart showing peak RP per season across history.
 * @param {string} canvasId
 * @param {Array}  seasonHistory - from parseProfile(): player.seasonHistory
 * @param {number} maxSeasons    - how many seasons to show (newest first)
 */
export function renderSeasonHistoryChart(canvasId, seasonHistory, maxSeasons = 12) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  if (!seasonHistory || seasonHistory.length === 0) {
    _showEmpty(canvas, 'No season history');
    return;
  }

  const seasons = seasonHistory
    .filter(s => s.maxRp !== null)
    .slice(0, maxSeasons)
    .reverse(); // oldest → newest for left-to-right

  const labels = seasons.map(s => s.shortName || `S${s.season}`);
  const values = seasons.map(s => s.maxRp);
  const colors = seasons.map(s => s.color || '#888');

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Peak RP',
        data: values,
        backgroundColor: colors.map(c => `${c}bb`),
        borderColor: colors,
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => ` Peak RP: ${item.raw?.toLocaleString() ?? '—'}`,
            afterLabel: (item) => {
              const s = seasons[item.dataIndex];
              return ` ${s.rankName}  |  ${s.wins}W / ${s.losses}L`;
            },
          },
          backgroundColor: '#1a1a2e',
          titleColor: '#fff',
          bodyColor: '#ccc',
        },
      },
      scales: {
        x: {
          ticks: { color: '#888', font: { size: 10 } },
          grid: { display: false },
        },
        y: {
          ticks: { color: '#888', callback: v => v.toLocaleString() },
          grid: { color: '#ffffff08' },
        },
      },
    },
  });
}

// ─── Multikill Doughnut Chart ─────────────────────────────────────────────────

/**
 * Doughnut showing 1K–5K distribution for current season.
 */
export function renderMultikillChart(canvasId, multikills, seasonColor = '#a0daae') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  const mk = multikills || {};
  const values = [mk.k1||0, mk.k2||0, mk.k3||0, mk.k4||0, mk.k5||0];
  if (values.every(v => v === 0)) {
    _showEmpty(canvas, 'No multikill data');
    return;
  }

  const palette = [
    `${seasonColor}99`,
    `${seasonColor}bb`,
    `${seasonColor}dd`,
    `${seasonColor}ee`,
    seasonColor,
  ];

  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['1K', '2K', '3K', '4K', 'ACE'],
      datasets: [{
        data: values,
        backgroundColor: palette,
        borderColor: '#0d0d1a',
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#aaa', font: { size: 11 }, padding: 10 },
        },
        tooltip: {
          backgroundColor: '#1a1a2e',
          bodyColor: '#ccc',
          callbacks: {
            label: (item) => ` ${item.label}: ${item.raw.toLocaleString()}`,
          },
        },
      },
    },
  });
}

// ─── Win/Loss Horizontal Bar ──────────────────────────────────────────────────

export function renderWinLossBar(elementId, wins, losses) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const total = wins + losses;
  if (total === 0) return;
  const pct = ((wins / total) * 100).toFixed(1);
  el.innerHTML = `
    <div class="wl-bar-track">
      <div class="wl-bar-fill" style="width:${pct}%"></div>
    </div>
    <div class="wl-bar-labels">
      <span class="wl-w">${wins.toLocaleString()}W</span>
      <span class="wl-pct">${pct}%</span>
      <span class="wl-l">${losses.toLocaleString()}L</span>
    </div>
  `;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _rollingAverage(arr, window) {
  return arr.map((_, i) => {
    if (i < window - 1) return null;
    const slice = arr.slice(i - window + 1, i + 1);
    return Math.round(slice.reduce((s, v) => s + v, 0) / window);
  });
}

function _projectNext(values, window) {
  const last  = values.slice(-window);
  if (last.length < 2) return [];
  const delta = (last[last.length - 1] - last[0]) / (last.length - 1);
  return [...Array(values.length).fill(null)];  // placeholder; extend in dashboard
}

function _formatChartDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _showEmpty(canvas, message) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#555';
  ctx.font = '13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(message, canvas.width / 2, canvas.height / 2);
}
