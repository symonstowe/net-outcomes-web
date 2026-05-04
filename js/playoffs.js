/* playoffs.js - playoff page wiring (bracket render + standings table).
 *
 * The bracket itself is rendered by NetOutcomesBracket.renderBracket
 * (see playoffs-bracket.js), which is shared with the server-side
 * social-card renderer. This file fetches the data, finds the DOM
 * nodes, and renders the standings table next to the bracket.
 */
(() => {
  const common = window.NetOutcomesCommon || {};
  const esc = common.esc || ((value) => String(value ?? ''));
  const bracketLib = window.NetOutcomesBracket;

  async function fetchJson(url) {
    if (typeof common.fetchJson === 'function') {
      return common.fetchJson(url);
    }
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status}`);
    }
    return response.json();
  }

  function renderProbBar(pct) {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    const t = clamped / 100;
    const r = Math.round(199 + (255 - 199) * t);
    const g = Math.round(216 + (131 - 216) * t);
    const b = Math.round(222 + (0 - 222) * t);
    const color = `rgb(${r},${g},${b})`;
    const label = clamped === 100 ? '100%' : clamped === 0 ? '—' : `${clamped.toFixed(1)}%`;
    return `<div class="sf-prob-bar-cell">
      <div class="sf-prob-bar-track">
        <div class="sf-prob-bar-fill" style="width:${clamped.toFixed(1)}%;background:${color}"></div>
      </div>
      <span class="sf-prob-bar-label">${label}</span>
    </div>`;
  }

  function renderStandingsRow(row, rank) {
    return `<tr class="${row.in_playoffs ? 'sf-standings-playoff-team' : 'sf-standings-out-team'}">
      <td class="sf-col-rank">${rank}</td>
      <td class="sf-col-team"><span class="sf-team-cell">
        <span class="sf-factor-edge-logo-box" aria-hidden="true"><img class="sf-factor-edge-logo" src="${esc(row.logo_url)}" alt="" loading="lazy" decoding="async"/></span>
        <span class="sf-team-name-cell">
          <span class="sf-team-abbrev">${esc(row.team)}</span>
          <span class="sf-team-fullname">${esc(row.full_name)}</span>
        </span>
      </span></td>
      <td class="sf-col-pts"><strong>${row.points}</strong></td>
      <td class="sf-col-pct">${renderProbBar(row.win_cup_pct)}</td>
      <td class="sf-col-pct">${renderProbBar(row.win_conf_pct)}</td>
      <td class="sf-col-pct">${renderProbBar(row.win_division_pct)}</td>
      <td class="sf-col-pct">${renderProbBar(row.make_playoffs_pct)}</td>
    </tr>`;
  }

  function renderStandings(rows) {
    const tbody = document.getElementById('standingsBody');
    const mount = document.getElementById('standingsTableMount');
    const loading = document.getElementById('standingsLoading');
    if (!tbody || !mount) return;
    if (!Array.isArray(rows) || !rows.length) {
      if (loading) loading.textContent = 'No standings data available.';
      return;
    }
    tbody.innerHTML = rows.map((row, idx) => renderStandingsRow(row, idx + 1)).join('');
    if (loading) loading.hidden = true;
    mount.hidden = false;
  }

  function renderBracket(seriesByRound, standingsRows) {
    const loading = document.getElementById('bracketLoading');
    const container = document.getElementById('bracketContainer');
    const svgEl = document.getElementById('bracketChart');
    if (!container || !svgEl) return;
    if (!bracketLib || typeof bracketLib.renderBracket !== 'function') {
      if (loading) loading.textContent = 'Bracket renderer failed to load.';
      return;
    }
    if (!window.d3) {
      if (loading) loading.textContent = 'd3 failed to load.';
      return;
    }

    const result = bracketLib.renderBracket({
      d3: window.d3,
      svgEl,
      series: seriesByRound,
      standings: standingsRows,
      esc,
      interactive: true,
      elements: {
        shell: container,
        tooltip: document.getElementById('bracketTooltip'),
        details: document.getElementById('bracketDetails'),
        select: document.getElementById('bracketTeamSelect'),
      },
    });

    if (!result.rendered) {
      if (loading) loading.textContent = 'Playoff bracket not yet available.';
      return;
    }
    if (loading) loading.hidden = true;
    container.hidden = false;
  }

  function waitForD3(timeoutMs = 5000) {
    if (window.d3) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        if (window.d3) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('d3 failed to load'));
        setTimeout(tick, 50);
      }());
    });
  }

  async function init() {
    const [payload] = await Promise.all([
      fetchJson('data/playoffs.json'),
      waitForD3().catch(() => null),
    ]);
    const playoffs = payload && payload.playoffs ? payload.playoffs : {};
    renderBracket(playoffs.series || {}, playoffs.standings || []);
    renderStandings(playoffs.standings || []);
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('playoffs.js:', error);
      const bracketLoading = document.getElementById('bracketLoading');
      const standingsLoading = document.getElementById('standingsLoading');
      if (bracketLoading) bracketLoading.textContent = `Error: ${error.message}`;
      if (standingsLoading) standingsLoading.textContent = `Error: ${error.message}`;
    });
  });
})();
