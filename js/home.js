(() => {
  const {
    esc,
    signed,
    fetchJson,
    setText,
    formatLocalDateTime,
  } = window.NetOutcomesCommon;

  function renderHighlightList(containerId, rows, renderRow, emptyText) {
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = `<div class="sf-empty-state">${esc(emptyText)}</div>`;
      return;
    }
    el.innerHTML = rows.map(renderRow).join('');
  }

  function renderPredictionCards(rows) {
    const el = document.getElementById('homeTodayGames');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<div class="sf-empty-state">No games are scheduled today in the current prediction window.</div>';
      return;
    }
    const cards = rows.slice(0, 3).map((row) => `
      <article class="sf-prediction-card">
        <div class="sf-prediction-card-head">${esc(row.away_team)} at ${esc(row.home_team)}</div>
        <div class="sf-prediction-card-pick">${esc(row.favorite_team)} ${Number(row.favorite_win_prob || 0).toFixed(1)}%</div>
        <div class="sf-prediction-card-meta">${formatLocalDateTime(row.start_time_utc || row.game_date)}</div>
        <div class="sf-prediction-card-sub">Edge ${Number(row.confidence_edge || 0).toFixed(1)} pts</div>
        ${Array.isArray(row.top_factors) && row.top_factors.length ? `
          <ol class="sf-factor-list">
            ${row.top_factors.map((factor) => `<li>${esc(factor)}</li>`).join('')}
          </ol>
        ` : ''}
      </article>
    `);
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

  async function init() {
    const payload = await fetchJson('data/home.json');
    const counts = payload?.counts || {};
    setText('homeGeneratedAt', payload?.generated_at || '');
    setText('homeLastUpdated', payload?.last_updated_utc || '');
    setText('homeSkaterCount', counts?.skaters || 0);
    setText('homeGoalieCount', counts?.goalies || 0);
    setText('homeTodayGameCount', counts?.today_games || 0);
    setText('homePredictionCount', counts?.predictions || 0);
    setText('homeRecentBasis', payload?.recent_basis || '');

    const predictionWindow = payload?.prediction_window || {};
    if (predictionWindow.start_utc || predictionWindow.end_utc) {
      setText(
        'homePredictionWindow',
        `${formatLocalDateTime(predictionWindow.start_utc)} to ${formatLocalDateTime(predictionWindow.end_utc)}`,
      );
    }

    renderHighlightList(
      'homeTrendingSkaters',
      Array.isArray(payload?.trending_skaters) ? payload.trending_skaters : [],
      (row) => `
        <div class="sf-highlight-item">
          <div class="sf-highlight-title">${row.player_url ? `<a class="sf-player-link" href="${esc(row.player_url)}">${esc(row.player_name)}</a>` : esc(row.player_name)}</div>
          <div class="sf-highlight-meta">${esc(row.team)} • ${esc(row.position || '')} • Talent Delta ${signed(row.talent_score_delta || 0, 3)}</div>
          <div class="sf-highlight-sub">Current ${signed(row.current_overall_talent_score || 0, 3)} vs Prior ${signed(row.prior_overall_talent_score || 0, 3)} • Off ${signed(row.offence_score_delta || 0, 3)} • Def ${signed(row.defence_score_delta || 0, 3)}</div>
        </div>
      `,
      'No recent skater trend rows available.',
    );

    renderHighlightList(
      'homeSkaterIceTime',
      Array.isArray(payload?.skater_ice_time_up) ? payload.skater_ice_time_up : [],
      (row) => `
        <div class="sf-highlight-item">
          <div class="sf-highlight-title">${row.player_url ? `<a class="sf-player-link" href="${esc(row.player_url)}">${esc(row.player_name)}</a>` : esc(row.player_name)}</div>
          <div class="sf-highlight-meta">${esc(row.team)} • ${esc(row.position || '')} • TOI Delta ${signed(row.toi_delta || 0, 2)} min/g</div>
          <div class="sf-highlight-sub">Recent 10 ${Number(row.recent_toi || 0).toFixed(2)} vs Prior 10 ${Number(row.prior_toi || 0).toFixed(2)} • Talent ${signed(row.talent_score_delta || 0, 3)}</div>
        </div>
      `,
      'No recent skater ice-time shifts available.',
    );

    renderHighlightList(
      'homeTrendingTeams',
      Array.isArray(payload?.trending_teams) ? payload.trending_teams : [],
      (row) => `
        <div class="sf-highlight-item">
          <div class="sf-highlight-title">${esc(row.team)}</div>
          <div class="sf-highlight-meta">Team Score Delta ${signed(row.total_team_score_delta || 0, 3)}</div>
          <div class="sf-highlight-sub">Current ${signed(row.current_total_team_score || 0, 3)} vs Prior ${signed(row.prior_total_team_score || 0, 3)} • Chance ${signed(row.chance_generation_delta || 0, 3)} • Supp ${signed(row.chance_suppression_delta || 0, 3)} • Goalie ${signed(row.goaltending_talent_delta || 0, 3)}</div>
        </div>
      `,
      'No recent team trend rows available.',
    );

    renderHighlightList(
      'homeTrendingGoalies',
      Array.isArray(payload?.trending_goalies) ? payload.trending_goalies : [],
      (row) => `
        <div class="sf-highlight-item">
          <div class="sf-highlight-title">${esc(row.goalie_name)}</div>
          <div class="sf-highlight-meta">${esc(row.team)} • Goalie Score Delta ${signed(row.goalie_score_delta || 0, 3)}</div>
          <div class="sf-highlight-sub">Current ${signed(row.current_goalie_score || 0, 3)} vs Prior ${signed(row.prior_goalie_score || 0, 3)} • HLD GSAX/60 ${signed(row.hld_goalie_talent_gsax_5v5_per60 || 0, 3)} • GSAX/60 ${signed(row.gsax_current_per60 || 0, 3)}</div>
        </div>
      `,
      'No recent goalie trend rows available.',
    );

    renderHighlightList(
      'homeGoalieStarts',
      Array.isArray(payload?.goalie_start_share_up) ? payload.goalie_start_share_up : [],
      (row) => `
        <div class="sf-highlight-item">
          <div class="sf-highlight-title">${esc(row.goalie_name)}</div>
          <div class="sf-highlight-meta">${esc(row.team)} • Start Share Delta ${signed((row.start_share_delta || 0) * 100, 1)} pts</div>
          <div class="sf-highlight-sub">Recent 10 ${Number(row.recent_starts || 0)}/${Number(row.recent_team_games || 0)} vs Prior 10 ${Number(row.prior_starts || 0)}/${Number(row.prior_team_games || 0)} • Goalie Score ${signed(row.goalie_score_delta || 0, 3)}</div>
        </div>
      `,
      'No recent goalie usage shifts available.',
    );

    renderPredictionCards(Array.isArray(payload?.today_games) ? payload.today_games : []);
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error(error);
      const targets = ['homeTrendingSkaters', 'homeSkaterIceTime', 'homeTrendingTeams', 'homeTrendingGoalies', 'homeGoalieStarts', 'homeTodayGames'];
      targets.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<div class="sf-empty-state">${esc(error.message)}</div>`;
      });
    });
  });
})();
