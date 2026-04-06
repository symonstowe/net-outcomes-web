(() => {
  const {
    esc,
    fetchJson,
    formatLocalDateTime,
    formatLocalDate,
    emptyRow,
  } = window.NetOutcomesCommon;

  function formatShare(value, digits = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return `${(n * 100).toFixed(digits)}%`;
  }

  function formatFixed(value, digits = 3) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return n.toFixed(digits);
  }

  function renderReviewRows(tableSelector, rows, emptyText) {
    const tbody = document.querySelector(`${tableSelector} tbody`);
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = emptyRow(6, emptyText);
      return;
    }
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td>${esc(formatLocalDateTime(row.start_time_utc) || formatLocalDate(row.game_date))}</td>
        <td>${esc(row.away_team)} at ${esc(row.home_team)}</td>
        <td><strong>${esc(row.predicted_team)}</strong> ${Number(row.favorite_win_prob || 0).toFixed(1)}%</td>
        <td>${esc(row.away_team)} ${Number(row.away_score || 0)} - ${Number(row.home_score || 0)} ${esc(row.home_team)}</td>
        <td>${Number(row.abs_prob_error || 0).toFixed(1)} pts</td>
        <td>${Number(row.away_expected_goals || 0).toFixed(2)} - ${Number(row.home_expected_goals || 0).toFixed(2)}</td>
      </tr>
    `).join('');
  }

  function renderCalibrationRows(rows) {
    const tbody = document.querySelector('#predictionReviewCalibrationTable tbody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = emptyRow(6, 'No confidence buckets are available yet.');
      return;
    }
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td>${esc(row.bucket)}</td>
        <td>${Number(row.games || 0)}</td>
        <td>${Number(row.mean_confidence || 0).toFixed(1)}%</td>
        <td>${Number(row.actual_win_rate || 0).toFixed(1)}%</td>
        <td>${Number(row.accuracy || 0).toFixed(1)}%</td>
        <td>${formatFixed(row.brier, 4)}</td>
      </tr>
    `).join('');
  }

  function renderYesterdayReview(review) {
    const basisEl = document.getElementById('predictionReviewBasis');
    const statusEl = document.getElementById('predictionReviewStatus');
    const statsEl = document.getElementById('predictionReviewStats');
    if (!statsEl) return;

    if (basisEl) basisEl.textContent = String(review?.basis || '');

    if (
      !review
      || review.status === 'missing_snapshot'
      || review.status === 'empty_snapshot'
      || review.status === 'pending_results'
      || Number(review.games_reviewed || 0) <= 0
    ) {
      statsEl.innerHTML = '<div class="sf-empty-state">No saved snapshot is available for yesterday yet.</div>';
      if (statusEl) {
        statusEl.textContent = String(
          review?.error_message
          || (Number(review?.games_pending || 0) > 0
            ? `${Number(review.games_pending || 0)} game(s) from yesterday are still pending final scores.`
            : ''),
        );
      }
      renderReviewRows('#predictionReviewBiggestMissesTable', [], 'No reviewed games yet.');
      renderReviewRows('#predictionReviewOverconfidentTable', [], 'No overconfident misses yet.');
      renderCalibrationRows([]);
      return;
    }

    const summary = review.summary || {};
    const snapshotLabel = review.snapshot_date
      ? formatLocalDate(review.snapshot_date)
      : 'Yesterday';
    statsEl.innerHTML = `
      <div class="sf-stat"><span class="sf-stat-label">Snapshot Day</span><span class="sf-stat-value">${esc(snapshotLabel)}</span></div>
      <div class="sf-stat"><span class="sf-stat-label">Games Graded</span><span class="sf-stat-value">${Number(review.games_reviewed || 0)} / ${Number(review.games_in_snapshot || 0)}</span></div>
      <div class="sf-stat"><span class="sf-stat-label">Pick Accuracy</span><span class="sf-stat-value">${formatShare(summary.accuracy, 1)}</span></div>
      <div class="sf-stat"><span class="sf-stat-label">Brier</span><span class="sf-stat-value">${formatFixed(summary.brier, 4)}</span></div>
      <div class="sf-stat"><span class="sf-stat-label">Log Loss</span><span class="sf-stat-value">${formatFixed(summary.logloss, 4)}</span></div>
      <div class="sf-stat"><span class="sf-stat-label">Mean Abs Error</span><span class="sf-stat-value">${formatShare(summary.mean_abs_prob_error, 1)}</span></div>
    `;
    if (statusEl) {
      const publishedText = review.published_at_utc
        ? `Published ${formatLocalDateTime(review.published_at_utc)}. `
        : '';
      const pendingText = Number(review.games_pending || 0) > 0
        ? `${Number(review.games_pending || 0)} game(s) are still pending final scores.`
        : 'All games in the saved snapshot have final scores.';
      statusEl.textContent = `${publishedText}${pendingText}`;
    }

    renderReviewRows(
      '#predictionReviewBiggestMissesTable',
      Array.isArray(review.biggest_misses) ? review.biggest_misses : [],
      'No reviewed games yet.',
    );
    renderReviewRows(
      '#predictionReviewOverconfidentTable',
      Array.isArray(review.overconfident_misses) ? review.overconfident_misses : [],
      'No overconfident misses yet.',
    );
    renderCalibrationRows(
      Array.isArray(review.calibration_by_confidence) ? review.calibration_by_confidence : [],
    );
  }

  async function init() {
    const payload = await fetchJson('data/prediction-review.json');
    renderYesterdayReview(payload?.review || {});
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error(error);
      const statusEl = document.getElementById('predictionReviewStatus');
      if (statusEl) statusEl.textContent = error.message;
      renderReviewRows('#predictionReviewBiggestMissesTable', [], error.message);
      renderReviewRows('#predictionReviewOverconfidentTable', [], error.message);
      renderCalibrationRows([]);
    });
  });
})();
