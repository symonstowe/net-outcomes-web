(() => {
  const {
    esc,
    fetchJson,
    setText,
    formatGameDateTime,
    formatUtcDateTime,
    emptyRow,
  } = window.NetOutcomesCommon;

  function formatRestHours(value, fallbackDays) {
    const hours = Number.isFinite(Number(value))
      ? Number(value)
      : Math.max(24, (Number(fallbackDays || 0) + 1) * 24);
    return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
  }

  function formatTravelKm(value) {
    const km = Number.isFinite(Number(value)) ? Number(value) : 0;
    return `${km.toFixed(km % 1 === 0 ? 0 : 1)} km`;
  }

  function renderFactorHtml(row) {
    const items = Array.isArray(row.top_deciding_factor_items) ? row.top_deciding_factor_items : [];
    if (items.length) {
      return `
        <div class="sf-factor-edge-list">
          ${items.map((item) => `
            <span class="sf-factor-edge-item">
              <span class="sf-factor-edge-label">${esc(item.label || '')}</span>
              ${item.edge_logo_url && item.edge_team ? `<span class="sf-factor-edge-logo-box" aria-hidden="true"><img class="sf-factor-edge-logo" src="${esc(item.edge_logo_url)}" alt="" loading="lazy" decoding="async"/></span>` : ''}
            </span>
          `).join('')}
        </div>
      `;
    }
    return row.top_deciding_factors_html ? String(row.top_deciding_factors_html) : esc(row.top_deciding_factors || '');
  }

  function renderPredictionCard(row) {
    const awayTeam = String(row.away_team || '').trim();
    const homeTeam = String(row.home_team || '').trim();
    const awayGoalieMixHtml = row.away_goalie_mix_html ? String(row.away_goalie_mix_html) : esc(row.away_goalie_mix || '');
    const homeGoalieMixHtml = row.home_goalie_mix_html ? String(row.home_goalie_mix_html) : esc(row.home_goalie_mix || '');
    const factorHtml = renderFactorHtml(row);
    return `
      <article class="sf-prediction-card sf-prediction-card--detailed">
        <div class="sf-prediction-card-head">${esc(awayTeam)} at ${esc(homeTeam)}</div>
        <div class="sf-prediction-card-pick">${esc(row.favorite_team)} ${Number(row.favorite_win_prob || 0).toFixed(1)}%</div>
        <div class="sf-prediction-card-meta">${formatGameDateTime(row)}</div>
        <div class="sf-prediction-card-sub">Edge ${Number(row.confidence_edge || 0).toFixed(1)} pts</div>
        <div class="sf-prediction-card-prob-grid">
          <div class="sf-prediction-card-prob"><span class="sf-prediction-card-prob-label">${esc(awayTeam)} Win</span><span class="sf-prediction-card-prob-value">${Number(row.away_win_prob || 0).toFixed(1)}%</span></div>
          <div class="sf-prediction-card-prob"><span class="sf-prediction-card-prob-label">${esc(homeTeam)} Win</span><span class="sf-prediction-card-prob-value">${Number(row.home_win_prob || 0).toFixed(1)}%</span></div>
          <div class="sf-prediction-card-prob"><span class="sf-prediction-card-prob-label">OT</span><span class="sf-prediction-card-prob-value">${Number(row.ot_prob || 0).toFixed(1)}%</span></div>
        </div>
        <div class="sf-prediction-card-detail-grid">
          <div class="sf-prediction-card-detail"><span class="sf-prediction-card-detail-label">xG</span><span class="sf-prediction-card-detail-value">${Number(row.away_expected_goals || 0).toFixed(2)} - ${Number(row.home_expected_goals || 0).toFixed(2)}</span></div>
          <div class="sf-prediction-card-detail"><span class="sf-prediction-card-detail-label">Rest</span><span class="sf-prediction-card-detail-value">${formatRestHours(row.away_rest_hours, row.away_rest_days)} / ${formatRestHours(row.home_rest_hours, row.home_rest_days)}</span></div>
          <div class="sf-prediction-card-detail"><span class="sf-prediction-card-detail-label">Travel 48h</span><span class="sf-prediction-card-detail-value">${formatTravelKm(row.away_travel_48h_km)} / ${formatTravelKm(row.home_travel_48h_km)}</span></div>
        </div>
        <div class="sf-prediction-card-section-label">Goalie Mix</div>
        <div class="sf-prediction-card-goalies">
          <div class="sf-prediction-card-goalie"><span class="sf-prediction-card-goalie-team">${esc(awayTeam)}</span><span class="sf-prediction-card-goalie-value">${awayGoalieMixHtml}</span></div>
          <div class="sf-prediction-card-goalie"><span class="sf-prediction-card-goalie-team">${esc(homeTeam)}</span><span class="sf-prediction-card-goalie-value">${homeGoalieMixHtml}</span></div>
        </div>
        <div class="sf-prediction-card-section-label">Top Factors</div>
        <div class="sf-prediction-card-factors">${factorHtml}</div>
      </article>
    `;
  }

  function renderPredictionCards(rows) {
    const el = document.getElementById('predictionsCards');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="sf-empty-state">No games are scheduled in the next 48 hours.</div>';
      return;
    }
    el.innerHTML = rows.map((row) => renderPredictionCard(row)).join('');
  }

  async function init() {
    const payload = await fetchJson('data/predictions.json');
    const predictions = payload?.predictions || {};
    const rows = Array.isArray(predictions?.games) ? predictions.games : [];
    const modelSummary = predictions?.model_summary || {};

    const basisEl = document.getElementById('predictionsBasis');
    if (basisEl) basisEl.textContent = String(predictions?.basis || '');
    const timeNoteEl = document.getElementById('predictionsLocalTimeNote');
    if (timeNoteEl) {
      timeNoteEl.textContent = 'Game times are shown in the local time zone of the venue.';
    }

    if (predictions?.window_start_utc || predictions?.window_end_utc) {
      setText(
        'predictionsWindowValue',
        `${formatUtcDateTime(predictions.window_start_utc)} to ${formatUtcDateTime(predictions.window_end_utc)}`,
      );
    }
    setText('predictionsGameCount', rows.length);
    setText('predictionsCalibrationGames', modelSummary?.calibration_games || 0);
    setText(
      'predictionsCalibrationLogloss',
      Number(modelSummary?.calibration_logloss || 0).toFixed(4),
    );

    renderPredictionCards(rows);
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error(error);
      const cards = document.getElementById('predictionsCards');
      if (cards) cards.innerHTML = `<div class="sf-empty-state">${esc(error.message)}</div>`;
    });
  });
})();
