(() => {
  const {
    esc,
    signed,
    classForSigned,
    pct,
    fetchJson,
    bindSortableHeaders,
    emptyRow,
    normalizeText,
  } = window.NetOutcomesCommon;

  const DEFAULT_SECTION_ID = 'rankingsPanel';
  const VALID_SECTION_IDS = [
    'rankingsPanel',
    'goaliePanel',
    'teamRankingsPanel',
    'underratedPanel',
    'anomaliesPanel',
  ];
  const SECTION_SLUG_BY_ID = {
    rankingsPanel: 'skaters',
    goaliePanel: 'goalies',
    teamRankingsPanel: 'team-rankings',
    underratedPanel: 'underrated',
    anomaliesPanel: 'scoring-anomalies',
  };
  const VALID_POSITION_FILTERS = ['L', 'C', 'R', 'LD', 'RD'];
  const VALID_SKATER_SORT_KEYS = [
    'player_name',
    'team',
    'position',
    'total_talent',
    'offence_score',
    'finishing',
    'playmaking',
    'chance_creation',
    'leverage_xg_diff',
    'defence_score',
    'rush_defence',
    'chance_suppression',
    'special_teams',
    'ev_xgar_per_60',
    'pp_xgar_per_60',
    'pk_xgar_per_60',
    'season_gp',
    'season_toi_min',
  ];
  const VALID_TEAM_SORT_KEYS = [
    'team',
    'games_played',
    'total_team_score',
    'shooting_talent',
    'playmaking_talent',
    'goaltending_talent',
    'chance_generation',
    'chance_suppression',
    'offensive_depth',
    'defensive_depth',
    'physicality_depth',
    'oz_non_offsetting_penalties_pg',
    'leverage_xg_net',
    'rush_defence',
    'high_danger_for',
    'high_danger_against',
    'special_teams',
  ];
  const VALID_GOALIE_SORT_KEYS = [
    'rank',
    'goalie_name',
    'team',
    'starts',
    'sa',
    'toi_min',
    'shot_quality_gsax_per60_5v5',
    'sv_pct',
    'xsv_pct',
    'sv_above_exp_pct',
    'gsax_current',
    'gsax_current_per60',
    'pk_sv_above_exp_pct',
  ];
  const VALID_UNDERRATED_SORT_KEYS = [
    'rank',
    'player_name',
    'team',
    'position',
    'season_gp',
    'toi_per_gp',
    'total_offence_defence',
    'talent_norm',
    'toi_norm',
    'qoc',
    'qot',
    'underplayed_score',
  ];

  const state = {
    rankings: [],
    goalieRankings: [],
    teamRankings: [],
    underrated: [],
    scoringAnomalies: {},
    rankingsSort: { key: 'total_talent', direction: 'desc' },
    goalieSort: { key: 'rank', direction: 'asc' },
    teamSort: { key: 'total_team_score', direction: 'desc' },
    underratedSort: { key: 'rank', direction: 'asc' },
    activeSection: DEFAULT_SECTION_ID,
    initialUrlState: null,
    suppressUrlSync: false,
  };

  function normalizeSlotPos(value) {
    const pos = String(value || '').trim().toUpperCase();
    if (pos === 'LW') return 'L';
    if (pos === 'RW') return 'R';
    if (pos === 'LEFT WING') return 'L';
    if (pos === 'RIGHT WING') return 'R';
    if (VALID_POSITION_FILTERS.includes(pos)) return pos;
    if (pos === 'D') return 'D';
    return '';
  }

  function positionMatches(selectedPositions, rowPosition) {
    if (!selectedPositions.length) return true;
    const normalized = normalizeSlotPos(rowPosition);
    if (!normalized) return false;
    if (normalized === 'D') {
      return selectedPositions.includes('LD') || selectedPositions.includes('RD');
    }
    return selectedPositions.includes(normalized);
  }

  function sanitizeSectionTarget(value) {
    const target = String(value || '').trim();
    if (VALID_SECTION_IDS.includes(target)) return target;
    const mapped = Object.entries(SECTION_SLUG_BY_ID).find(([, slug]) => slug === target);
    return mapped ? mapped[0] : '';
  }

  function sectionSlugFromTarget(value) {
    const target = sanitizeSectionTarget(value) || DEFAULT_SECTION_ID;
    return SECTION_SLUG_BY_ID[target] || SECTION_SLUG_BY_ID[DEFAULT_SECTION_ID];
  }

  function sanitizeSortDirection(value, fallback = 'desc') {
    const direction = String(value || '').trim().toLowerCase();
    return direction === 'asc' || direction === 'desc' ? direction : fallback;
  }

  function sanitizeSkaterSortKey(value) {
    const key = String(value || '').trim();
    return VALID_SKATER_SORT_KEYS.includes(key) ? key : '';
  }

  function sanitizeTeamSortKey(value) {
    const key = String(value || '').trim();
    return VALID_TEAM_SORT_KEYS.includes(key) ? key : '';
  }

  function sanitizeGoalieSortKey(value) {
    const key = String(value || '').trim();
    return VALID_GOALIE_SORT_KEYS.includes(key) ? key : '';
  }

  function sanitizeUnderratedSortKey(value) {
    const key = String(value || '').trim();
    return VALID_UNDERRATED_SORT_KEYS.includes(key) ? key : '';
  }

  function parsePositionParam(value) {
    return Array.from(new Set(
      String(value || '')
        .split(',')
        .map((item) => normalizeSlotPos(item))
        .filter((item) => VALID_POSITION_FILTERS.includes(item)),
    ));
  }

  function readShareStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const hashSection = sanitizeSectionTarget(window.location.hash.replace(/^#/, ''));
    return {
      section: hashSection || sanitizeSectionTarget(params.get('section')) || DEFAULT_SECTION_ID,
      player: String(params.get('player') || '').trim(),
      skaterTeam: String(params.get('skaterTeam') || '').trim(),
      positions: parsePositionParam(params.get('pos')),
      goalie: String(params.get('goalie') || '').trim(),
      goalieTeam: String(params.get('goalieTeam') || '').trim(),
      goalieSort: sanitizeGoalieSortKey(params.get('goalieSort')),
      goalieDir: sanitizeSortDirection(params.get('goalieDir'), 'asc'),
      teamRank: String(params.get('teamRank') || '').trim(),
      underrated: String(params.get('underrated') || '').trim(),
      underratedTeam: String(params.get('underratedTeam') || '').trim(),
      underratedPositions: parsePositionParam(params.get('undPos')),
      underratedSort: sanitizeUnderratedSortKey(params.get('undSort')),
      underratedDir: sanitizeSortDirection(params.get('undDir'), 'asc'),
      skaterSort: sanitizeSkaterSortKey(params.get('sort')),
      skaterDir: sanitizeSortDirection(params.get('dir'), 'desc'),
      teamSort: sanitizeTeamSortKey(params.get('teamSort')),
      teamDir: sanitizeSortDirection(params.get('teamDir'), 'desc'),
    };
  }

  function setControlValue(control, value) {
    if (!control || value === null || value === undefined) return;
    control.value = String(value);
  }

  function setSelectedPositions(inputName, values) {
    const selected = new Set(Array.isArray(values) ? values : []);
    document.querySelectorAll(`input[name="${inputName}"]`).forEach((input) => {
      input.checked = selected.has(String(input.value || ''));
    });
  }

  function selectedPositions(inputName) {
    return Array.from(
      new Set(
        Array.from(document.querySelectorAll(`input[name="${inputName}"]:checked`))
          .map((input) => String(input.value || ''))
          .filter((value) => VALID_POSITION_FILTERS.includes(value)),
      ),
    );
  }

  function syncUrlState() {
    if (state.suppressUrlSync) return;

    const params = new URLSearchParams();
    const activeSection = sanitizeSectionTarget(state.activeSection) || DEFAULT_SECTION_ID;

    if (activeSection === 'rankingsPanel') {
      const player = String(document.getElementById('playerSearch')?.value || '').trim();
      const skaterTeam = String(document.getElementById('rankingsTeamSearch')?.value || '').trim();
      const positions = selectedPositions('rankingsPos');
      const skaterSort = sanitizeSkaterSortKey(state.rankingsSort?.key);
      const skaterDir = sanitizeSortDirection(state.rankingsSort?.direction, 'desc');
      if (player) params.set('player', player);
      if (skaterTeam) params.set('skaterTeam', skaterTeam);
      if (positions.length) params.set('pos', positions.join(','));
      if (skaterSort && (skaterSort !== 'total_talent' || skaterDir !== 'desc')) {
        params.set('sort', skaterSort);
        params.set('dir', skaterDir);
      }
    } else if (activeSection === 'goaliePanel') {
      const goalie = String(document.getElementById('goalieSearch')?.value || '').trim();
      const goalieTeam = String(document.getElementById('goalieTeamSearch')?.value || '').trim();
      const goalieSort = sanitizeGoalieSortKey(state.goalieSort?.key);
      const goalieDir = sanitizeSortDirection(state.goalieSort?.direction, 'asc');
      if (goalie) params.set('goalie', goalie);
      if (goalieTeam) params.set('goalieTeam', goalieTeam);
      if (goalieSort && (goalieSort !== 'rank' || goalieDir !== 'asc')) {
        params.set('goalieSort', goalieSort);
        params.set('goalieDir', goalieDir);
      }
    } else if (activeSection === 'teamRankingsPanel') {
      const teamRank = String(document.getElementById('teamRankingsSearch')?.value || '').trim();
      const teamSort = sanitizeTeamSortKey(state.teamSort?.key);
      const teamDir = sanitizeSortDirection(state.teamSort?.direction, 'desc');
      if (teamRank) params.set('teamRank', teamRank);
      if (teamSort && (teamSort !== 'total_team_score' || teamDir !== 'desc')) {
        params.set('teamSort', teamSort);
        params.set('teamDir', teamDir);
      }
    } else if (activeSection === 'underratedPanel') {
      const underrated = String(document.getElementById('underratedSearch')?.value || '').trim();
      const underratedTeam = String(document.getElementById('underratedTeamSearch')?.value || '').trim();
      const underratedPositions = selectedPositions('underratedPos');
      const underratedSort = sanitizeUnderratedSortKey(state.underratedSort?.key);
      const underratedDir = sanitizeSortDirection(state.underratedSort?.direction, 'asc');
      if (underrated) params.set('underrated', underrated);
      if (underratedTeam) params.set('underratedTeam', underratedTeam);
      if (underratedPositions.length) params.set('undPos', underratedPositions.join(','));
      if (underratedSort && (underratedSort !== 'rank' || underratedDir !== 'asc')) {
        params.set('undSort', underratedSort);
        params.set('undDir', underratedDir);
      }
    }

    const hash = activeSection !== DEFAULT_SECTION_ID ? `#${sectionSlugFromTarget(activeSection)}` : '';
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }

  function setupSectionNavigation(initialTarget) {
    const buttons = Array.from(document.querySelectorAll('#sectionNav .sf-section-btn'));
    const panels = Array.from(document.querySelectorAll('.sf-section-panel'));
    if (!buttons.length || !panels.length) return;

    const activate = (targetId, options = {}) => {
      const nextTarget = sanitizeSectionTarget(targetId) || DEFAULT_SECTION_ID;
      state.activeSection = nextTarget;
      buttons.forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.sectionTarget === nextTarget);
      });
      panels.forEach((panel) => {
        panel.classList.toggle('is-active', panel.id === nextTarget);
      });
      if (options.syncUrl !== false) {
        syncUrlState();
      }
    };

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => activate(btn.dataset.sectionTarget));
    });

    window.addEventListener('hashchange', () => {
      const requested = sanitizeSectionTarget(window.location.hash.replace(/^#/, '')) || DEFAULT_SECTION_ID;
      if (requested !== state.activeSection) {
        activate(requested, { syncUrl: false });
      }
    });

    activate(initialTarget, { syncUrl: false });
  }

  function emptyMessage(selector, colspan, message) {
    const tbody = document.querySelector(selector);
    if (tbody) tbody.innerHTML = emptyRow(colspan, message);
  }

  function renderRankings(rows) {
    const tbody = document.querySelector('#rankingsTable tbody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = emptyRow(19, 'No skater rankings available.');
      return;
    }
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td>${row.display_rank ?? row.rank}</td>
        <td>${row.player_url ? `<a class="sf-player-link" href="${esc(row.player_url)}">${esc(row.player_name)}</a>` : esc(row.player_name)}</td>
        <td>${esc(row.team)}</td>
        <td>${esc(row.position)}</td>
        <td class="${classForSigned(row.total_talent)}">${signed(row.total_talent)}</td>
        <td class="${classForSigned(row.offence_score)}">${signed(row.offence_score)}</td>
        <td class="${classForSigned(row.finishing)}">${signed(row.finishing)}</td>
        <td class="${classForSigned(row.playmaking)}">${signed(row.playmaking)}</td>
        <td class="${classForSigned(row.chance_creation)}">${signed(row.chance_creation)}</td>
        <td class="${classForSigned(row.leverage_xg_diff)}">${signed(row.leverage_xg_diff)}</td>
        <td class="${classForSigned(row.defence_score)}">${signed(row.defence_score)}</td>
        <td class="${classForSigned(row.rush_defence)}">${signed(row.rush_defence)}</td>
        <td class="${classForSigned(row.chance_suppression)}">${signed(row.chance_suppression)}</td>
        <td class="${classForSigned(row.special_teams)}">${signed(row.special_teams)}</td>
        <td class="${classForSigned(row.ev_xgar_per_60)}">${signed(row.ev_xgar_per_60)}</td>
        <td class="${classForSigned(row.pp_xgar_per_60)}">${signed(row.pp_xgar_per_60)}</td>
        <td class="${classForSigned(row.pk_xgar_per_60)}">${signed(row.pk_xgar_per_60)}</td>
        <td>${row.season_gp}</td>
        <td>${Number(row.season_toi_min || 0).toFixed(1)}</td>
      </tr>
    `).join('');
  }

  function renderGoalies(rows) {
    const tbody = document.querySelector('#goalieTable tbody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = emptyRow(13, 'No goalie rankings available.');
      return;
    }
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td>${row.display_rank ?? row.rank}</td>
        <td>${esc(row.goalie_name)}</td>
        <td>${esc(row.team)}</td>
        <td>${row.starts}</td>
        <td>${row.sa}</td>
        <td>${Number(row.toi_min || 0).toFixed(1)}</td>
        <td class="${classForSigned(row.shot_quality_gsax_per60_5v5)}">${signed(row.shot_quality_gsax_per60_5v5)}</td>
        <td>${pct((row.sv_pct || 0) * 100, 2)}</td>
        <td>${pct((row.xsv_pct || 0) * 100, 2)}</td>
        <td class="${classForSigned(row.sv_above_exp_pct)}">${pct((row.sv_above_exp_pct || 0) * 100, 2)}</td>
        <td class="${classForSigned(row.gsax_current)}">${signed(row.gsax_current)}</td>
        <td class="${classForSigned(row.gsax_current_per60)}">${signed(row.gsax_current_per60)}</td>
        <td class="${classForSigned(row.pk_sv_above_exp_pct)}">${pct((row.pk_sv_above_exp_pct || 0) * 100, 2)}</td>
      </tr>
    `).join('');
  }

  function renderTeamRankings(rows) {
    const tbody = document.querySelector('#teamRankingsTable tbody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = emptyRow(18, 'No team rankings available.');
      return;
    }
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td>${row.display_rank ?? row.rank}</td>
        <td>${esc(row.team)}</td>
        <td>${row.games_played}</td>
        <td class="${classForSigned(row.total_team_score)}">${signed(row.total_team_score)}</td>
        <td class="${classForSigned(row.shooting_talent)}">${signed(row.shooting_talent)}</td>
        <td class="${classForSigned(row.playmaking_talent)}">${signed(row.playmaking_talent)}</td>
        <td class="${classForSigned(row.goaltending_talent)}">${signed(row.goaltending_talent)}</td>
        <td class="${classForSigned(row.chance_generation)}">${signed(row.chance_generation)}</td>
        <td class="${classForSigned(row.chance_suppression)}">${signed(row.chance_suppression)}</td>
        <td>${Number(row.offensive_depth || 0).toFixed(2)}</td>
        <td>${Number(row.defensive_depth || 0).toFixed(2)}</td>
        <td>${Number(row.physicality_depth || 0).toFixed(2)}</td>
        <td>${Number(row.oz_non_offsetting_penalties_pg || 0).toFixed(2)}</td>
        <td class="${classForSigned(row.leverage_xg_net)}">${signed(row.leverage_xg_net)}</td>
        <td class="${classForSigned(row.rush_defence)}">${signed(row.rush_defence)}</td>
        <td>${Number(row.high_danger_for || 0).toFixed(2)}</td>
        <td>${Number(row.high_danger_against || 0).toFixed(2)}</td>
        <td class="${classForSigned(row.special_teams)}">${signed(row.special_teams)}</td>
      </tr>
    `).join('');
  }

  function renderUnderrated(rows) {
    const tbody = document.querySelector('#underratedTable tbody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = emptyRow(12, 'No underrated rows available.');
      return;
    }
    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td>${row.display_rank ?? row.rank}</td>
        <td>${esc(row.player_name)}</td>
        <td>${esc(row.team)}</td>
        <td>${esc(row.position)}</td>
        <td>${row.season_gp}</td>
        <td>${Number(row.toi_per_gp || 0).toFixed(2)}</td>
        <td class="${classForSigned(row.total_offence_defence)}">${signed(row.total_offence_defence)}</td>
        <td>${Number(row.talent_norm || 0).toFixed(3)}</td>
        <td>${Number(row.toi_norm || 0).toFixed(3)}</td>
        <td class="${classForSigned(row.qoc)}">${signed(row.qoc)}</td>
        <td class="${classForSigned(row.qot)}">${signed(row.qot)}</td>
        <td class="${classForSigned(row.underplayed_score)}">${signed(row.underplayed_score)}</td>
      </tr>
    `).join('');
  }

  function renderScoringAnomalies(payload) {
    const ppRows = Array.isArray(payload?.powerplay_heavy) ? payload.powerplay_heavy : [];
    const enRows = Array.isArray(payload?.empty_net_heavy) ? payload.empty_net_heavy : [];
    const oneGoalRows = Array.isArray(payload?.one_goal_game_points_share) ? payload.one_goal_game_points_share : [];
    const lowFiveVFiveRows = Array.isArray(payload?.lowest_5v5_goal_share) ? payload.lowest_5v5_goal_share : [];
    const basisEl = document.getElementById('scoringAnomaliesBasis');
    if (basisEl) basisEl.textContent = String(payload?.basis || '');

    const ppTbody = document.querySelector('#powerplayAnomaliesTable tbody');
    const enTbody = document.querySelector('#emptyNetAnomaliesTable tbody');
    const oneGoalTbody = document.querySelector('#oneGoalGamePointsTable tbody');
    const fiveVFiveTbody = document.querySelector('#fiveVFiveGoalShareTable tbody');

    if (ppTbody) {
      ppTbody.innerHTML = ppRows.length ? ppRows.map((row) => `
        <tr>
          <td>${row.rank}</td><td>${esc(row.player_name)}</td><td>${esc(row.team)}</td><td>${esc(row.position)}</td>
          <td>${row.season_gp}</td><td>${row.total_points}</td><td>${row.powerplay_points}</td>
          <td>${row.points_5v5}</td><td>${row.other_points}</td><td>${pct((row.powerplay_share || 0) * 100, 1)}</td>
        </tr>
      `).join('') : emptyRow(10, 'No qualifying players.');
    }
    if (enTbody) {
      enTbody.innerHTML = enRows.length ? enRows.map((row) => `
        <tr>
          <td>${row.rank}</td><td>${esc(row.player_name)}</td><td>${esc(row.team)}</td><td>${esc(row.position)}</td>
          <td>${row.season_gp}</td><td>${row.total_points}</td><td>${row.empty_net_points}</td>
          <td>${row.non_en_points}</td><td>${pct((row.empty_net_share || 0) * 100, 1)}</td>
        </tr>
      `).join('') : emptyRow(9, 'No qualifying players.');
    }
    if (oneGoalTbody) {
      oneGoalTbody.innerHTML = oneGoalRows.length ? oneGoalRows.map((row) => `
        <tr>
          <td>${row.rank}</td><td>${esc(row.player_name)}</td><td>${esc(row.team)}</td><td>${esc(row.position)}</td>
          <td>${row.season_gp}</td><td>${row.total_points}</td><td>${row.one_goal_game_points}</td>
          <td>${row.other_game_points}</td><td>${pct((row.one_goal_game_share || 0) * 100, 1)}</td>
        </tr>
      `).join('') : emptyRow(9, 'No qualifying players.');
    }
    if (fiveVFiveTbody) {
      fiveVFiveTbody.innerHTML = lowFiveVFiveRows.length ? lowFiveVFiveRows.map((row) => `
        <tr>
          <td>${row.rank}</td><td>${esc(row.player_name)}</td><td>${esc(row.team)}</td><td>${esc(row.position)}</td>
          <td>${row.season_gp}</td><td>${row.total_goals}</td><td>${row.goals_5v5}</td>
          <td>${row.other_state_goals}</td><td>${pct((row.fivevfive_share || 0) * 100, 1)}</td>
        </tr>
      `).join('') : emptyRow(9, 'No qualifying players.');
    }
  }

  function missingNumber(value) {
    return value === null || value === undefined || value === '' || !Number.isFinite(Number(value));
  }

  function rankSortedRows(rows) {
    return (rows || []).map((row, idx) => ({ ...row, display_rank: idx + 1 }));
  }

  function sortRankings(rows) {
    const key = String(state.rankingsSort?.key || 'total_talent');
    const direction = String(state.rankingsSort?.direction || 'desc');
    const dir = direction === 'asc' ? 1 : -1;
    const fieldMap = {
      player_name: { field: 'player_name', type: 'string' },
      team: { field: 'team', type: 'string' },
      position: { field: 'position', type: 'string' },
      total_talent: { field: 'total_talent', type: 'number' },
      offence_score: { field: 'offence_score', type: 'number' },
      finishing: { field: 'finishing', type: 'number' },
      playmaking: { field: 'playmaking', type: 'number' },
      chance_creation: { field: 'chance_creation', type: 'number' },
      leverage_xg_diff: { field: 'leverage_xg_diff', type: 'number' },
      defence_score: { field: 'defence_score', type: 'number' },
      rush_defence: { field: 'rush_defence', type: 'number' },
      chance_suppression: { field: 'chance_suppression', type: 'number' },
      special_teams: { field: 'special_teams', type: 'number' },
      ev_xgar_per_60: { field: 'ev_xgar_per_60', type: 'number' },
      pp_xgar_per_60: { field: 'pp_xgar_per_60', type: 'number' },
      pk_xgar_per_60: { field: 'pk_xgar_per_60', type: 'number' },
      season_gp: { field: 'season_gp', type: 'number' },
      season_toi_min: { field: 'season_toi_min', type: 'number' },
    };
    const spec = fieldMap[key] || fieldMap.total_talent;
    return [...rows].sort((a, b) => {
      if (spec.type === 'string') {
        const primary = String(a?.[spec.field] || '').localeCompare(String(b?.[spec.field] || ''));
        if (primary !== 0) return dir * primary;
      } else {
        const aMissing = missingNumber(a?.[spec.field]);
        const bMissing = missingNumber(b?.[spec.field]);
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        const primary = aMissing ? 0 : Number(a?.[spec.field]) - Number(b?.[spec.field]);
        if (Math.abs(primary) > 1e-12) return dir * primary;
      }
      const totalTie = Number(b?.total_talent || 0) - Number(a?.total_talent || 0);
      if (Math.abs(totalTie) > 1e-12) return totalTie;
      const toiTie = Number(b?.season_toi_min || 0) - Number(a?.season_toi_min || 0);
      if (Math.abs(toiTie) > 1e-12) return toiTie;
      return String(a?.player_name || '').localeCompare(String(b?.player_name || ''));
    });
  }

  function sortTeams(rows) {
    const key = String(state.teamSort?.key || 'total_team_score');
    const direction = String(state.teamSort?.direction || 'desc');
    const dir = direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (key === 'team') {
        const primary = String(a?.team || '').localeCompare(String(b?.team || ''));
        if (primary !== 0) return dir * primary;
      } else {
        const primary = Number(a?.[key] || 0) - Number(b?.[key] || 0);
        if (Math.abs(primary) > 1e-12) return dir * primary;
      }
      const totalTie = Number(b?.total_team_score || 0) - Number(a?.total_team_score || 0);
      if (Math.abs(totalTie) > 1e-12) return totalTie;
      return String(a?.team || '').localeCompare(String(b?.team || ''));
    });
  }

  function sortGoalies(rows) {
    const key = String(state.goalieSort?.key || 'rank');
    const direction = String(state.goalieSort?.direction || 'asc');
    const dir = direction === 'asc' ? 1 : -1;
    const fieldMap = {
      rank: { field: 'rank', type: 'number' },
      goalie_name: { field: 'goalie_name', type: 'string' },
      team: { field: 'team', type: 'string' },
      starts: { field: 'starts', type: 'number' },
      sa: { field: 'sa', type: 'number' },
      toi_min: { field: 'toi_min', type: 'number' },
      shot_quality_gsax_per60_5v5: { field: 'shot_quality_gsax_per60_5v5', type: 'number' },
      sv_pct: { field: 'sv_pct', type: 'number' },
      xsv_pct: { field: 'xsv_pct', type: 'number' },
      sv_above_exp_pct: { field: 'sv_above_exp_pct', type: 'number' },
      gsax_current: { field: 'gsax_current', type: 'number' },
      gsax_current_per60: { field: 'gsax_current_per60', type: 'number' },
      pk_sv_above_exp_pct: { field: 'pk_sv_above_exp_pct', type: 'number' },
    };
    const spec = fieldMap[key] || fieldMap.rank;
    return [...rows].sort((a, b) => {
      if (spec.type === 'string') {
        const primary = String(a?.[spec.field] || '').localeCompare(String(b?.[spec.field] || ''));
        if (primary !== 0) return dir * primary;
      } else {
        const aMissing = missingNumber(a?.[spec.field]);
        const bMissing = missingNumber(b?.[spec.field]);
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        const primary = aMissing ? 0 : Number(a?.[spec.field]) - Number(b?.[spec.field]);
        if (Math.abs(primary) > 1e-12) return dir * primary;
      }
      const rankTie = Number(a?.rank || 0) - Number(b?.rank || 0);
      if (Math.abs(rankTie) > 1e-12) return rankTie;
      return String(a?.goalie_name || '').localeCompare(String(b?.goalie_name || ''));
    });
  }

  function sortUnderrated(rows) {
    const key = String(state.underratedSort?.key || 'rank');
    const direction = String(state.underratedSort?.direction || 'asc');
    const dir = direction === 'asc' ? 1 : -1;
    const fieldMap = {
      rank: { field: 'rank', type: 'number' },
      player_name: { field: 'player_name', type: 'string' },
      team: { field: 'team', type: 'string' },
      position: { field: 'position', type: 'string' },
      season_gp: { field: 'season_gp', type: 'number' },
      toi_per_gp: { field: 'toi_per_gp', type: 'number' },
      total_offence_defence: { field: 'total_offence_defence', type: 'number' },
      talent_norm: { field: 'talent_norm', type: 'number' },
      toi_norm: { field: 'toi_norm', type: 'number' },
      qoc: { field: 'qoc', type: 'number' },
      qot: { field: 'qot', type: 'number' },
      underplayed_score: { field: 'underplayed_score', type: 'number' },
    };
    const spec = fieldMap[key] || fieldMap.rank;
    return [...rows].sort((a, b) => {
      if (spec.type === 'string') {
        const primary = String(a?.[spec.field] || '').localeCompare(String(b?.[spec.field] || ''));
        if (primary !== 0) return dir * primary;
      } else {
        const aMissing = missingNumber(a?.[spec.field]);
        const bMissing = missingNumber(b?.[spec.field]);
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        const primary = aMissing ? 0 : Number(a?.[spec.field]) - Number(b?.[spec.field]);
        if (Math.abs(primary) > 1e-12) return dir * primary;
      }
      const rankTie = Number(a?.rank || 0) - Number(b?.rank || 0);
      if (Math.abs(rankTie) > 1e-12) return rankTie;
      return String(a?.player_name || '').localeCompare(String(b?.player_name || ''));
    });
  }

  function refreshRankings() {
    const sorted = rankSortedRows(sortRankings(state.rankings));
    const playerQuery = normalizeText(document.getElementById('playerSearch')?.value);
    const teamQuery = normalizeText(document.getElementById('rankingsTeamSearch')?.value);
    const positions = selectedPositions('rankingsPos');
    const filtered = sorted.filter((row) => {
      const playerMatch = !playerQuery || normalizeText(row.player_name).includes(playerQuery);
      const teamMatch = !teamQuery || normalizeText(row.team).includes(teamQuery);
      const positionMatch = positionMatches(positions, row.position);
      return playerMatch && teamMatch && positionMatch;
    });
    renderRankings(filtered);
    syncUrlState();
  }

  function refreshGoalies() {
    const sorted = rankSortedRows(sortGoalies(state.goalieRankings));
    const goalieQuery = normalizeText(document.getElementById('goalieSearch')?.value);
    const teamQuery = normalizeText(document.getElementById('goalieTeamSearch')?.value);
    const filtered = sorted.filter((row) => {
      const goalieMatch = !goalieQuery || normalizeText(row.goalie_name).includes(goalieQuery);
      const teamMatch = !teamQuery || normalizeText(row.team).includes(teamQuery);
      return goalieMatch && teamMatch;
    });
    renderGoalies(filtered);
    syncUrlState();
  }

  function refreshTeams() {
    const sorted = rankSortedRows(sortTeams(state.teamRankings));
    const teamQuery = normalizeText(document.getElementById('teamRankingsSearch')?.value);
    const filtered = sorted.filter((row) => !teamQuery || normalizeText(row.team).includes(teamQuery));
    renderTeamRankings(filtered);
    syncUrlState();
  }

  function refreshUnderrated() {
    const sorted = rankSortedRows(sortUnderrated(state.underrated));
    const playerQuery = normalizeText(document.getElementById('underratedSearch')?.value);
    const teamQuery = normalizeText(document.getElementById('underratedTeamSearch')?.value);
    const positions = selectedPositions('underratedPos');
    const filtered = sorted.filter((row) => {
      const playerMatch = !playerQuery || normalizeText(row.player_name).includes(playerQuery);
      const teamMatch = !teamQuery || normalizeText(row.team).includes(teamQuery);
      const positionMatch = positionMatches(positions, row.position);
      return playerMatch && teamMatch && positionMatch;
    });
    renderUnderrated(filtered);
    syncUrlState();
  }

  async function init() {
    const payload = await fetchJson('data/rankings.json');
    state.suppressUrlSync = true;
    state.initialUrlState = readShareStateFromUrl();
    state.rankings = Array.isArray(payload?.rankings) ? payload.rankings : [];
    state.goalieRankings = Array.isArray(payload?.goalie_rankings) ? payload.goalie_rankings : [];
    state.teamRankings = Array.isArray(payload?.team_rankings) ? payload.team_rankings : [];
    state.underrated = Array.isArray(payload?.underrated_rankings) ? payload.underrated_rankings : [];
    state.scoringAnomalies = payload?.scoring_anomalies || {};

    if (state.initialUrlState.skaterSort) {
      state.rankingsSort = {
        key: state.initialUrlState.skaterSort,
        direction: state.initialUrlState.skaterDir || 'desc',
      };
    }
    if (state.initialUrlState.teamSort) {
      state.teamSort = {
        key: state.initialUrlState.teamSort,
        direction: state.initialUrlState.teamDir || 'desc',
      };
    }
    if (state.initialUrlState.goalieSort) {
      state.goalieSort = {
        key: state.initialUrlState.goalieSort,
        direction: state.initialUrlState.goalieDir || 'asc',
      };
    }
    if (state.initialUrlState.underratedSort) {
      state.underratedSort = {
        key: state.initialUrlState.underratedSort,
        direction: state.initialUrlState.underratedDir || 'asc',
      };
    }

    const basisIds = {
      skaterRankBasis: payload?.skater_rank_basis || '',
      goalieRankBasis: payload?.goalie_rank_basis || '',
      teamRankBasis: payload?.team_rank_basis || '',
      underratedRankBasis: payload?.underrated_rank_basis || '',
    };
    Object.entries(basisIds).forEach(([id, text]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(text);
    });

    renderScoringAnomalies(state.scoringAnomalies);

    setControlValue(document.getElementById('playerSearch'), state.initialUrlState.player);
    setControlValue(document.getElementById('rankingsTeamSearch'), state.initialUrlState.skaterTeam);
    setControlValue(document.getElementById('goalieSearch'), state.initialUrlState.goalie);
    setControlValue(document.getElementById('goalieTeamSearch'), state.initialUrlState.goalieTeam);
    setControlValue(document.getElementById('teamRankingsSearch'), state.initialUrlState.teamRank);
    setControlValue(document.getElementById('underratedSearch'), state.initialUrlState.underrated);
    setControlValue(document.getElementById('underratedTeamSearch'), state.initialUrlState.underratedTeam);
    setSelectedPositions('rankingsPos', state.initialUrlState.positions);
    setSelectedPositions('underratedPos', state.initialUrlState.underratedPositions);

    bindSortableHeaders(
      'rankingsTable',
      () => state.rankingsSort,
      (next) => { state.rankingsSort = next; },
      refreshRankings,
    );
    bindSortableHeaders(
      'goalieTable',
      () => state.goalieSort,
      (next) => { state.goalieSort = next; },
      refreshGoalies,
    );
    bindSortableHeaders(
      'teamRankingsTable',
      () => state.teamSort,
      (next) => { state.teamSort = next; },
      refreshTeams,
    );
    bindSortableHeaders(
      'underratedTable',
      () => state.underratedSort,
      (next) => { state.underratedSort = next; },
      refreshUnderrated,
    );

    ['playerSearch', 'rankingsTeamSearch'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', refreshRankings);
    });
    document.querySelectorAll('input[name="rankingsPos"]').forEach((input) => {
      input.addEventListener('change', refreshRankings);
    });
    document.querySelectorAll('input[name="underratedPos"]').forEach((input) => {
      input.addEventListener('change', refreshUnderrated);
    });
    ['goalieSearch', 'goalieTeamSearch'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', refreshGoalies);
    });
    document.getElementById('teamRankingsSearch')?.addEventListener('input', refreshTeams);
    ['underratedSearch', 'underratedTeamSearch'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', refreshUnderrated);
    });

    refreshRankings();
    refreshGoalies();
    refreshTeams();
    refreshUnderrated();
    setupSectionNavigation(state.initialUrlState.section);
    state.suppressUrlSync = false;
    syncUrlState();
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error(error);
      emptyMessage('#rankingsTable tbody', 19, error.message);
      emptyMessage('#goalieTable tbody', 13, error.message);
      emptyMessage('#teamRankingsTable tbody', 18, error.message);
      emptyMessage('#underratedTable tbody', 12, error.message);
    });
  });
})();
