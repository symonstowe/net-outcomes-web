(() => {
  const {
    esc,
    fetchJson,
    setText,
    formatLocalDateTime,
    formatLocalDate,
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

  function renderPredictionCards(rows) {
    const el = document.getElementById('predictionsCards');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="sf-empty-state">No games are scheduled in the next 48 hours.</div>';
      return;
    }
    el.innerHTML = rows.slice(0, 6).map((row) => `
      <article class="sf-prediction-card">
        <div class="sf-prediction-card-head">${esc(row.away_team)} at ${esc(row.home_team)}</div>
        <div class="sf-prediction-card-pick">${esc(row.favorite_team)} ${Number(row.favorite_win_prob || 0).toFixed(1)}%</div>
        <div class="sf-prediction-card-meta">${formatLocalDateTime(row.start_time_utc || row.game_date)}</div>
        <div class="sf-prediction-card-sub">Edge ${Number(row.confidence_edge || 0).toFixed(1)} pts • Rest ${formatRestHours(row.away_rest_hours, row.away_rest_days)} / ${formatRestHours(row.home_rest_hours, row.home_rest_days)} • Travel 48h ${formatTravelKm(row.away_travel_48h_km)} / ${formatTravelKm(row.home_travel_48h_km)}</div>
      </article>
    `).join('');
  }

  function renderPredictionTable(rows) {
    const tbody = document.querySelector('#predictionsTable tbody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = emptyRow(11, 'No games are scheduled in the next 48 hours.');
      return;
    }
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td>${esc(formatLocalDateTime(row.start_time_utc) || formatLocalDate(row.game_date))}</td>
        <td>${esc(row.away_team)} at ${esc(row.home_team)}</td>
        <td><strong>${esc(row.favorite_team)}</strong> ${Number(row.favorite_win_prob || 0).toFixed(1)}%</td>
        <td>${Number(row.home_win_prob || 0).toFixed(1)}%</td>
        <td>${Number(row.away_win_prob || 0).toFixed(1)}%</td>
        <td>${Number(row.ot_prob || 0).toFixed(1)}%</td>
        <td>${Number(row.away_expected_goals || 0).toFixed(2)} - ${Number(row.home_expected_goals || 0).toFixed(2)}</td>
        <td>${formatRestHours(row.away_rest_hours, row.away_rest_days)} / ${formatRestHours(row.home_rest_hours, row.home_rest_days)}</td>
        <td>${formatTravelKm(row.away_travel_48h_km)} / ${formatTravelKm(row.home_travel_48h_km)}</td>
        <td>${esc(row.away_goalie_mix || '')}<br/>${esc(row.home_goalie_mix || '')}</td>
        <td>${esc(row.top_deciding_factors || '')}</td>
      </tr>
    `).join('');
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
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      timeNoteEl.textContent = tz
        ? `Times are shown in your local timezone (${tz}).`
        : 'Times are shown in your local timezone.';
    }

    if (predictions?.window_start_utc || predictions?.window_end_utc) {
      setText(
        'predictionsWindowValue',
        `${formatLocalDateTime(predictions.window_start_utc)} to ${formatLocalDateTime(predictions.window_end_utc)}`,
      );
    }
    setText('predictionsGameCount', rows.length);
    setText('predictionsCalibrationGames', modelSummary?.calibration_games || 0);
    setText(
      'predictionsCalibrationLogloss',
      Number(modelSummary?.calibration_logloss || 0).toFixed(4),
    );

    renderPredictionCards(rows);
    renderPredictionTable(rows);
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error(error);
      const tbody = document.querySelector('#predictionsTable tbody');
      if (tbody) tbody.innerHTML = emptyRow(11, error.message);
      const cards = document.getElementById('predictionsCards');
      if (cards) cards.innerHTML = `<div class="sf-empty-state">${esc(error.message)}</div>`;
    });
  });
})();
