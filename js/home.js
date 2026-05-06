(() => {
  const {
    esc,
    fetchJson,
    formatGameDateTime,
  } = window.NetOutcomesCommon;

  function renderPredictionCard(row) {
    const awayTeam = String(row.away_team || '').trim();
    const homeTeam = String(row.home_team || '').trim();
    const factorItems = Array.isArray(row.top_factor_items) ? row.top_factor_items : [];
    return `
      <article class="sf-prediction-card">
        <div class="sf-prediction-card-head">${esc(awayTeam)} at ${esc(homeTeam)}</div>
        <div class="sf-prediction-card-pick">${esc(row.favorite_team)} ${Number(row.favorite_win_prob || 0).toFixed(1)}%</div>
        <div class="sf-prediction-card-meta">${formatGameDateTime(row)}</div>
        <div class="sf-prediction-card-sub">Edge ${Number(row.confidence_edge || 0).toFixed(1)} pts</div>
        ${factorItems.length ? `
          <ol class="sf-factor-list">
            ${factorItems.map((item) => `
              <li>
                <span class="sf-factor-edge-item">
                  <span class="sf-factor-edge-label">${esc(item.label || '')}</span>
                  ${item.edge_logo_url && item.edge_team ? `<span class="sf-factor-edge-logo-box" aria-hidden="true"><img class="sf-factor-edge-logo" src="${esc(item.edge_logo_url)}" alt="" loading="lazy" decoding="async"/></span>` : ''}
                </span>
              </li>
            `).join('')}
          </ol>
        ` : ''}
      </article>
    `;
  }

  function renderPredictionCards(rows) {
    const el = document.getElementById('homeTodayGames');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="sf-empty-state">No games are scheduled today in the current prediction window.</div>';
      return;
    }
    const cards = rows.slice(0, 3).map((row) => renderPredictionCard(row));
    cards.push(`
      <a class="sf-prediction-card sf-prediction-card--cta" href="/predictions.html" aria-label="See all predictions for today">
        <div class="sf-prediction-card-cta-kicker">More Predictions</div>
        <div class="sf-prediction-card-cta-title">See all predictions for today</div>
        <div class="sf-prediction-card-cta-sub">Open the full prediction board.</div>
        <span class="sf-prediction-card-chevron" aria-hidden="true">&rsaquo;</span>
      </a>
    `);
    el.innerHTML = cards.join('');
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

  function renderBracket(playoffsPayload) {
    const loading = document.getElementById('homeBracketLoading');
    const container = document.getElementById('homeBracketContainer');
    const svgEl = document.getElementById('homeBracketChart');
    const bracketLib = window.NetOutcomesBracket;
    if (!container || !svgEl) return;
    if (!bracketLib || typeof bracketLib.renderBracket !== 'function') {
      if (loading) loading.textContent = 'Bracket renderer failed to load.';
      return;
    }
    if (!window.d3) {
      if (loading) loading.textContent = 'd3 failed to load.';
      return;
    }
    const series = (playoffsPayload && playoffsPayload.series) || {};
    const standings = (playoffsPayload && playoffsPayload.standings) || [];
    const result = bracketLib.renderBracket({
      d3: window.d3,
      svgEl,
      series,
      standings,
      esc,
      interactive: true,
      elements: {
        shell: container,
        tooltip: document.getElementById('homeBracketTooltip'),
        details: document.getElementById('homeBracketDetails'),
      },
    });
    if (!result.rendered) {
      if (loading) loading.textContent = 'Playoff bracket not yet available.';
      return;
    }
    if (loading) loading.hidden = true;
    container.hidden = false;
  }

  async function init() {
    const [payload] = await Promise.all([
      fetchJson('data/home.json'),
      waitForD3().catch(() => null),
    ]);
    renderPredictionCards(Array.isArray(payload?.today_games) ? payload.today_games : []);
    let playoffs = (payload && payload.playoff_bracket && payload.playoff_bracket.playoffs) || null;
    if (!playoffs || !playoffs.series) {
      try {
        const playoffsPayload = await fetchJson('data/playoffs.json');
        playoffs = playoffsPayload && playoffsPayload.playoffs;
      } catch (_) {
        playoffs = null;
      }
    }
    if (playoffs && (playoffs.series || playoffs.standings)) {
      renderBracket(playoffs);
    } else {
      const loading = document.getElementById('homeBracketLoading');
      if (loading) loading.textContent = 'Playoff bracket not yet available.';
    }
  }

  function wireTabs(tabSelector, panelSelector, dataAttr) {
    const tabs = document.querySelectorAll(tabSelector);
    const panels = document.querySelectorAll(panelSelector);
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const cat = tab.getAttribute(dataAttr);
        tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
        panels.forEach((p) => p.classList.toggle('is-active', p.getAttribute(dataAttr) === cat));
      });
    });
  }
  function wireRankTabs() {
    wireTabs('.sf-rank-tab', '.sf-rank-panel', 'data-rank-cat');
    wireTabs('.sf-trend-tab', '.sf-trend-panel', 'data-trend-cat');
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireRankTabs();
    init().catch((error) => {
      console.error(error);
      const el = document.getElementById('homeTodayGames');
      if (el) el.innerHTML = `<div class="sf-empty-state">${esc(error.message)}</div>`;
    });
  });
})();
