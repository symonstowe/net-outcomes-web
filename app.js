const DATA_URL = 'data/site_data.json';
const DEFAULT_SECTION_ID = 'rankingsPanel';
const DEFAULT_XG_MIN_PROB = 0.015;
const VALID_SECTION_IDS = [
  'rankingsPanel',
  'goaliePanel',
  'teamRankingsPanel',
  'underratedPanel',
  'anomaliesPanel',
  'teamPanel',
  'xgPanel',
];
const SECTION_SLUG_BY_ID = {
  rankingsPanel: 'skaters',
  goaliePanel: 'goalies',
  teamRankingsPanel: 'team-rankings',
  underratedPanel: 'underrated',
  anomaliesPanel: 'scoring-anomalies',
  teamPanel: 'line-analysis',
  xgPanel: 'team-xg',
};
const SKATER_SORT_KEYS = [
  'player_name',
  'team',
  'position',
  'total_talent',
  'offence_score',
  'finishing',
  'playmaking',
  'chance_creation',
  'leverage_xg_diff',
  'rush_defence',
  'chance_suppression',
  'defence_score',
  'special_teams',
  'ev_xgar_per_60',
  'pp_xgar_per_60',
  'pk_xgar_per_60',
  'season_gp',
  'season_toi_min',
];

const state = {
  payload: null,
  xgSummaryByTeam: new Map(),
  xgShotsCache: new Map(),
  skaterPosById: new Map(),
  rankingsSort: { key: 'total_talent', direction: 'desc' },
  teamRankingsSort: { key: 'total_team_score', direction: 'desc' },
  activeSection: DEFAULT_SECTION_ID,
  initialUrlState: null,
  suppressUrlSync: false,
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function signed(value, digits = 3) {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  const s = n.toFixed(digits);
  return n > 0 ? `+${s}` : s;
}

function classForSigned(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return n > 0 ? 'pos' : 'neg';
}

function pct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${(n * 100).toFixed(digits)}%`;
}

function updateSortableHeaders(tableId, sortState) {
  const headers = Array.from(document.querySelectorAll(`#${tableId} th.sf-sortable`));
  headers.forEach((header) => {
    const sortKey = String(header.dataset.sortKey || '');
    const active = sortKey === String(sortState?.key || '');
    header.classList.toggle('is-active', active);
    header.dataset.sortDir = active ? String(sortState?.direction || 'desc') : '';
    header.setAttribute('aria-sort', active
      ? (sortState?.direction === 'asc' ? 'ascending' : 'descending')
      : 'none');
    const arrow = header.querySelector('.sf-sort-arrow');
    if (arrow) {
      arrow.textContent = active
        ? (sortState?.direction === 'asc' ? '↑' : '↓')
        : '';
    }
  });
}

function bindSortableHeaders(tableId, stateKey, refreshFn) {
  const headers = Array.from(document.querySelectorAll(`#${tableId} th.sf-sortable`));
  headers.forEach((header) => {
    if (header.dataset.sortBound === 'true') return;
    header.dataset.sortBound = 'true';
    header.tabIndex = 0;
    header.setAttribute('role', 'button');
    const triggerSort = () => {
      const sortKey = String(header.dataset.sortKey || '').trim();
      if (!sortKey) return;
      const defaultDirection = String(header.dataset.sortDefault || 'desc');
      const current = state[stateKey] || {};
      const isSameKey = String(current.key || '') === sortKey;
      state[stateKey] = {
        key: sortKey,
        direction: isSameKey
          ? (current.direction === 'desc' ? 'asc' : 'desc')
          : defaultDirection,
      };
      updateSortableHeaders(tableId, state[stateKey]);
      refreshFn();
    };
    header.addEventListener('click', triggerSort);
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        triggerSort();
      }
    });
  });
  updateSortableHeaders(tableId, state[stateKey] || {});
}

function sanitizeSectionTarget(value) {
  const target = String(value || '').trim();
  if (VALID_SECTION_IDS.includes(target)) return target;
  const mapped = Object.entries(SECTION_SLUG_BY_ID).find(([, slug]) => slug === target);
  return mapped ? mapped[0] : '';
}

function normalizeTextValue(value) {
  return String(value || '').trim();
}

function sectionSlugFromTarget(value) {
  const target = sanitizeSectionTarget(value) || DEFAULT_SECTION_ID;
  return SECTION_SLUG_BY_ID[target] || SECTION_SLUG_BY_ID[DEFAULT_SECTION_ID];
}

function parseBooleanParam(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumberParam(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeSkaterSortKey(value) {
  const sortKey = String(value || '').trim();
  return SKATER_SORT_KEYS.includes(sortKey) ? sortKey : '';
}

function sanitizeSortDirection(value, fallback = 'desc') {
  const direction = String(value || '').trim().toLowerCase();
  return direction === 'asc' || direction === 'desc' ? direction : fallback;
}

function readShareStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const hashSection = sanitizeSectionTarget(window.location.hash.replace(/^#/, ''));
  return {
    section: hashSection || sanitizeSectionTarget(params.get('section')) || DEFAULT_SECTION_ID,
    player: normalizeTextValue(params.get('player')),
    skaterTeam: normalizeTextValue(params.get('skaterTeam')),
    goalie: normalizeTextValue(params.get('goalie')),
    teamRank: normalizeTextValue(params.get('teamRank')),
    underrated: normalizeTextValue(params.get('underrated')),
    underratedTeam: normalizeTextValue(params.get('underratedTeam')),
    lineTeam: normalizeTextValue(params.get('lineTeam')),
    compareA: normalizeTextValue(params.get('compareA')),
    compareB: normalizeTextValue(params.get('compareB')),
    xgTeam: normalizeTextValue(params.get('xgTeam')),
    xgMin: normalizeTextValue(params.get('xgMin')),
    xgGoals: params.get('xgGoals'),
    skaterSort: sanitizeSkaterSortKey(params.get('sort')),
    skaterDir: sanitizeSortDirection(params.get('dir'), 'desc'),
  };
}

function setControlValue(control, value) {
  if (!control || value === null || value === undefined) return;
  control.value = String(value);
}

function setSelectValueIfPresent(control, value) {
  if (!control) return;
  const normalized = normalizeTextValue(value);
  if (!normalized) {
    control.value = '';
    return;
  }
  const hasMatch = Array.from(control.options || []).some((opt) => String(opt.value || '') === normalized);
  if (hasMatch) {
    control.value = normalized;
  }
}

function syncUrlState() {
  if (state.suppressUrlSync) return;

  const params = new URLSearchParams();
  const activeSection = sanitizeSectionTarget(state.activeSection) || DEFAULT_SECTION_ID;

  if (activeSection === 'rankingsPanel') {
    const player = normalizeTextValue(document.getElementById('playerSearch')?.value);
    const skaterTeam = normalizeTextValue(document.getElementById('rankingsTeamSearch')?.value);
    const skaterSort = sanitizeSkaterSortKey(state.rankingsSort?.key);
    const skaterDir = sanitizeSortDirection(state.rankingsSort?.direction, 'desc');
    if (player) params.set('player', player);
    if (skaterTeam) params.set('skaterTeam', skaterTeam);
    if (skaterSort && (skaterSort !== 'total_talent' || skaterDir !== 'desc')) {
      params.set('sort', skaterSort);
      params.set('dir', skaterDir);
    }
  } else if (activeSection === 'goaliePanel') {
    const goalie = normalizeTextValue(document.getElementById('goalieSearch')?.value);
    if (goalie) params.set('goalie', goalie);
  } else if (activeSection === 'teamRankingsPanel') {
    const teamRank = normalizeTextValue(document.getElementById('teamRankingsSearch')?.value);
    if (teamRank) params.set('teamRank', teamRank);
  } else if (activeSection === 'underratedPanel') {
    const underrated = normalizeTextValue(document.getElementById('underratedSearch')?.value);
    const underratedTeam = normalizeTextValue(document.getElementById('underratedTeamSearch')?.value);
    if (underrated) params.set('underrated', underrated);
    if (underratedTeam) params.set('underratedTeam', underratedTeam);
  } else if (activeSection === 'teamPanel') {
    const lineTeam = normalizeTextValue(document.getElementById('teamSearch')?.value);
    const compareA = normalizeTextValue(document.getElementById('compareTeamA')?.value);
    const compareB = normalizeTextValue(document.getElementById('compareTeamB')?.value);
    if (compareA) params.set('compareA', compareA);
    if (compareB && compareB !== compareA) params.set('compareB', compareB);
    if (!compareA && !compareB && lineTeam) params.set('lineTeam', lineTeam);
  } else if (activeSection === 'xgPanel') {
    const xgTeam = normalizeTextValue(document.getElementById('xgTeamSelect')?.value);
    const xgMin = parseNumberParam(document.getElementById('xgMinProb')?.value, null);
    const showGoals = document.getElementById('xgShowGoals')?.checked;
    if (xgTeam) params.set('xgTeam', xgTeam);
    if (xgMin !== null && Math.abs(xgMin - DEFAULT_XG_MIN_PROB) > 1e-9) {
      params.set('xgMin', xgMin.toFixed(3));
    }
    if (showGoals === false) params.set('xgGoals', '0');
  }

  const query = params.toString();
  const hash = activeSection !== DEFAULT_SECTION_ID ? `#${sectionSlugFromTarget(activeSection)}` : '';
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(null, '', nextUrl);
  }
}

function setupSectionNavigation(initialTarget) {
  const buttons = Array.from(document.querySelectorAll('.sf-section-btn'));
  const panels = Array.from(document.querySelectorAll('.sf-section-panel'));
  if (!buttons.length || !panels.length) return;

  const activate = (targetId, options = {}) => {
    const nextTarget = sanitizeSectionTarget(targetId) || DEFAULT_SECTION_ID;
    state.activeSection = nextTarget;
    buttons.forEach((btn) => {
      const active = btn.dataset.sectionTarget === nextTarget;
      btn.classList.toggle('is-active', active);
    });
    panels.forEach((panel) => panel.classList.toggle('is-active', panel.id === nextTarget));
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

function renderRankings(rows) {
  const tbody = document.querySelector('#rankingsTable tbody');
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
  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.rank}</td>
      <td>${esc(row.goalie_name)}</td>
      <td>${esc(row.team)}</td>
      <td>${row.starts}</td>
      <td>${row.sa}</td>
      <td>${Number(row.toi_min || 0).toFixed(1)}</td>
      <td class="${classForSigned(row.shot_quality_gsax_per60_5v5)}">${signed(row.shot_quality_gsax_per60_5v5)}</td>
      <td>${pct(row.sv_pct, 2)}</td>
      <td>${pct(row.xsv_pct, 2)}</td>
      <td class="${classForSigned(row.sv_above_exp_pct)}">${pct(row.sv_above_exp_pct, 2)}</td>
      <td class="${classForSigned(row.gsax_current)}">${signed(row.gsax_current)}</td>
      <td class="${classForSigned(row.gsax_current_per60)}">${signed(row.gsax_current_per60)}</td>
      <td class="${classForSigned(row.pk_sv_above_exp_pct)}">${pct(row.pk_sv_above_exp_pct, 2)}</td>
    </tr>
  `).join('');
}

function renderTeamRankings(rows) {
  const tbody = document.querySelector('#teamRankingsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = rows.map((row, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${esc(row.team)}</td>
      <td>${row.games_played}</td>
      <td class="${classForSigned(row.total_team_score)}">${signed(row.total_team_score)}</td>
      <td class="${classForSigned(row.shooting_talent)}">${signed(row.shooting_talent)}</td>
      <td class="${classForSigned(row.playmaking_talent)}">${signed(row.playmaking_talent)}</td>
      <td class="${classForSigned(row.goaltending_talent)}">${signed(row.goaltending_talent)}</td>
      <td class="${classForSigned(row.chance_generation)}">${signed(row.chance_generation)}</td>
      <td class="${classForSigned(row.chance_suppression)}">${signed(row.chance_suppression)}</td>
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
  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.rank}</td>
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
  if (basisEl) {
    basisEl.textContent = String(payload?.basis || '');
  }

  const ppTbody = document.querySelector('#powerplayAnomaliesTable tbody');
  if (ppTbody) {
    ppTbody.innerHTML = ppRows.length ? ppRows.map((row) => `
      <tr>
        <td>${row.rank}</td>
        <td>${esc(row.player_name)}</td>
        <td>${esc(row.team)}</td>
        <td>${esc(row.position)}</td>
        <td>${row.season_gp}</td>
        <td>${row.total_points}</td>
        <td>${row.powerplay_points}</td>
        <td>${row.points_5v5}</td>
        <td>${row.other_points}</td>
        <td>${pct(row.powerplay_share, 1)}</td>
      </tr>
    `).join('') : '<tr><td colspan="10">No qualifying players.</td></tr>';
  }

  const enTbody = document.querySelector('#emptyNetAnomaliesTable tbody');
  if (enTbody) {
    enTbody.innerHTML = enRows.length ? enRows.map((row) => `
      <tr>
        <td>${row.rank}</td>
        <td>${esc(row.player_name)}</td>
        <td>${esc(row.team)}</td>
        <td>${esc(row.position)}</td>
        <td>${row.season_gp}</td>
        <td>${row.total_points}</td>
        <td>${row.empty_net_points}</td>
        <td>${row.non_en_points}</td>
        <td>${pct(row.empty_net_share, 1)}</td>
      </tr>
    `).join('') : '<tr><td colspan="9">No qualifying players.</td></tr>';
  }

  const oneGoalTbody = document.querySelector('#oneGoalGamePointsTable tbody');
  if (oneGoalTbody) {
    oneGoalTbody.innerHTML = oneGoalRows.length ? oneGoalRows.map((row) => `
      <tr>
        <td>${row.rank}</td>
        <td>${esc(row.player_name)}</td>
        <td>${esc(row.team)}</td>
        <td>${esc(row.position)}</td>
        <td>${row.season_gp}</td>
        <td>${row.total_points}</td>
        <td>${row.one_goal_game_points}</td>
        <td>${row.other_game_points}</td>
        <td>${pct(row.one_goal_game_share, 1)}</td>
      </tr>
    `).join('') : '<tr><td colspan="9">No qualifying players.</td></tr>';
  }

  const fiveVFiveTbody = document.querySelector('#fiveVFiveGoalShareTable tbody');
  if (fiveVFiveTbody) {
    fiveVFiveTbody.innerHTML = lowFiveVFiveRows.length ? lowFiveVFiveRows.map((row) => `
      <tr>
        <td>${row.rank}</td>
        <td>${esc(row.player_name)}</td>
        <td>${esc(row.team)}</td>
        <td>${esc(row.position)}</td>
        <td>${row.season_gp}</td>
        <td>${row.total_goals}</td>
        <td>${row.goals_5v5}</td>
        <td>${row.other_state_goals}</td>
        <td>${pct(row.fivevfive_share, 1)}</td>
      </tr>
    `).join('') : '<tr><td colspan="9">No qualifying players.</td></tr>';
  }
}

function renderRankingBasis(payload) {
  const skaterEl = document.getElementById('skaterRankBasis');
  const goalieEl = document.getElementById('goalieRankBasis');
  const teamEl = document.getElementById('teamRankBasis');
  const underratedEl = document.getElementById('underratedRankBasis');
  if (skaterEl) {
    skaterEl.textContent = String(
      payload?.skater_rank_basis || 'On-ice and personal statistics are combined into puck-carrying and away-from-the-puck based statistics. Metrics are heavily weighted toward the current season, but use the last 3 seasons to assign certainty. Fits and models are trained solely on data available through the public NHL API. All analysis on this page excludes empty-net goals unless otherwise specified. Metrics are also shrunk based on certainty and stability, so it may take several games for a player to be appropriately ranked.'
    );
  }
  if (goalieEl) {
    goalieEl.textContent = String(
      payload?.goalie_rank_basis || 'Shot-stopping and save-based statistics are combined into goalie rankings. Metrics are heavily weighted toward the current season, but use the last 3 seasons to assign certainty. Fits and models are trained solely on data available through the public NHL API. All analysis on this page excludes empty-net goals unless otherwise specified. Metrics are also shrunk based on certainty and stability, so it may take several games for a goalie to be appropriately ranked. Goalies need at least min(10, ceil(10% of an 82-game season)) starts to qualify.'
    );
  }
  if (teamEl) {
    teamEl.textContent = String(
      payload?.team_rank_basis || 'On-ice team statistics are combined into attacking, defending, and special teams based statistics. Metrics are heavily weighted toward the current season, but use the last 3 seasons to assign certainty. Fits and models are trained solely on data available through the public NHL API. All analysis on this page excludes empty-net goals unless otherwise specified. Metrics are also shrunk based on certainty and stability, so it may take several games for a team to be appropriately ranked.'
    );
  }
  if (underratedEl) {
    underratedEl.textContent = String(
      payload?.underrated_rank_basis
        || 'Talent, role, and context statistics are combined into an underplayed score. Metrics are heavily weighted toward the current season, but use the last 3 seasons to assign certainty. Fits and models are trained solely on data available through the public NHL API. All analysis on this page excludes empty-net goals unless otherwise specified. Metrics are also shrunk based on certainty and stability, so it may take several games for a player to be appropriately ranked.'
    );
  }
}

function unitSortValue(label) {
  const match = String(label || '').match(/(\d+)/);
  return match ? Number(match[1]) : 999;
}

function unitCompositeLabel(unitType) {
  if (unitType === 'pp') return 'PP Fit';
  if (unitType === 'pk') return 'PK Fit';
  return 'Fit';
}

function unitBasisNote(unitType) {
  if (unitType === 'lines' || unitType === 'pairs') {
    return 'Fit = weighted two-way composite (55% Off Sum, 45% Def Sum). Off Sum and Def Sum are raw player-component sums, so they do not add up to Fit.';
  }
  if (unitType === 'pp') {
    return 'PP Fit = special-teams deployment score built around PP RAPM, offensive talent, EV impact, finishing, and drawn-penalty value. Off Sum and Def Sum are raw skater totals, so they do not add up to PP Fit.';
  }
  if (unitType === 'pk') {
    return 'PK Fit = penalty-kill deployment score driven mostly by PK RAPM, defensive talent, real PK usage, and penalty avoidance. Off Sum and Def Sum are raw skater totals, so they do not add up to PK Fit.';
  }
  return 'Fit is a weighted composite. Off Sum and Def Sum are raw component sums, so they do not add up directly.';
}

function unitColumnSummaryNote() {
  return 'Fit is a weighted unit score. Off Sum and Def Sum are raw player totals and do not add directly. PP Fit still blends PP RAPM, offensive talent, EV impact, finishing, and drawn-penalty value; PK Fit is driven mostly by PK RAPM, defensive talent, real PK usage, and penalty avoidance.';
}

function normalizeSlotPos(value) {
  const pos = String(value || '').trim().toUpperCase();
  if (pos === 'LW') return 'L';
  if (pos === 'RW') return 'R';
  if (pos === 'C') return 'C';
  if (pos === 'LD') return 'LD';
  if (pos === 'RD') return 'RD';
  if (pos === 'L' || pos === 'R' || pos === 'D' || pos === 'F') return pos;
  return '';
}

function slotLabelsForUnit(unitType, players) {
  const fromPlayerData = (players || []).map((player) => {
    const direct = normalizeSlotPos(player?.position || '');
    if (direct) return direct;
    const pid = Number(player?.player_id || 0);
    if (Number.isFinite(pid) && state.skaterPosById.has(pid)) {
      return normalizeSlotPos(state.skaterPosById.get(pid));
    }
    return '';
  });

  if (unitType === 'lines') {
    return ['L', 'C', 'R'];
  }
  if (unitType === 'pairs') {
    if (fromPlayerData.some((v) => !!v)) {
      return fromPlayerData.map((v) => v || 'D');
    }
    return ['D', 'D'];
  }
  if (unitType === 'pp' || unitType === 'pk') {
    if (fromPlayerData.some((v) => !!v)) {
      return fromPlayerData.map((v, idx) => v || `P${idx + 1}`);
    }
  }
  return Array.from({ length: Math.max(1, (players || []).length) }, (_, idx) => `P${idx + 1}`);
}

function renderPlayerCell(player) {
  if (!player || !player.name) {
    return '<div class="sf-unit-mini-cell sf-unit-mini-player-cell">-</div>';
  }
  const moveClass = String(player.movement_class || '').trim();
  const moveArrow = String(player.movement_arrow || '').trim();
  const moveNote = String(player.movement_note || '').trim();
  const titleAttr = moveNote ? ` title="${esc(moveNote)}"` : '';
  const arrowMarkup = moveArrow ? `<span class="sf-player-arrow">${esc(moveArrow)}</span>` : '';
  return `<div class="sf-unit-mini-cell sf-unit-mini-player-cell ${esc(moveClass)}"${titleAttr}>${arrowMarkup}<span>${esc(player.name)}</span></div>`;
}

function renderDisplayRows(displayRows) {
  return (displayRows || []).map((row) => {
    const labels = Array.isArray(row?.slot_labels) ? row.slot_labels : [];
    const players = Array.isArray(row?.players) ? row.players : [];
    const slotCount = Math.max(labels.length, players.length, 1);
    const gridStyle = `style="grid-template-columns: repeat(${slotCount}, minmax(0, 1fr));"`;
    const headerCells = Array.from({ length: slotCount }, (_, idx) => {
      const label = labels[idx] || `P${idx + 1}`;
      return `<div class="sf-unit-mini-cell sf-unit-mini-head-cell">${esc(label)}</div>`;
    }).join('');
    const playerCells = Array.from({ length: slotCount }, (_, idx) => renderPlayerCell(players[idx])).join('');
    return `
      <div class="sf-unit-mini-row-group">
        <div class="sf-unit-mini-row sf-unit-mini-head-row" ${gridStyle}>${headerCells}</div>
        <div class="sf-unit-mini-row sf-unit-mini-player-row" ${gridStyle}>${playerCells}</div>
      </div>
    `;
  }).join('');
}

function renderPlayerSlotGrid(unit, unitType) {
  const displayRows = Array.isArray(unit?.display_rows) ? unit.display_rows : [];
  if (displayRows.length) {
    return `<div class="sf-unit-mini-table">${renderDisplayRows(displayRows)}</div>`;
  }

  const players = Array.isArray(unit?.players) ? unit.players : [];
  const slotLabels = slotLabelsForUnit(unitType, players);
  const slotCount = Math.max(slotLabels.length, players.length);
  const gridStyle = `style="grid-template-columns: repeat(${slotCount}, minmax(0, 1fr));"`;

  const headerCells = Array.from({ length: slotCount }, (_, idx) => {
    const label = slotLabels[idx] || `P${idx + 1}`;
    return `<div class="sf-unit-mini-cell sf-unit-mini-head-cell">${esc(label)}</div>`;
  }).join('');

  const playerCells = Array.from({ length: slotCount }, (_, idx) => renderPlayerCell(players[idx])).join('');

  return `
    <div class="sf-unit-mini-table">
      <div class="sf-unit-mini-row sf-unit-mini-head-row" ${gridStyle}>${headerCells}</div>
      <div class="sf-unit-mini-row sf-unit-mini-player-row" ${gridStyle}>${playerCells}</div>
    </div>
  `;
}

function renderUnitRows(units, unitType) {
  const sorted = (units || []).slice().sort((a, b) => {
    const aLabel = String(a?.label || `Unit ${a?.unit || ''}`).trim() || 'Unit';
    const bLabel = String(b?.label || `Unit ${b?.unit || ''}`).trim() || 'Unit';
    const orderDiff = unitSortValue(aLabel) - unitSortValue(bLabel);
    if (orderDiff !== 0) return orderDiff;
    return aLabel.localeCompare(bLabel);
  });

  if (!sorted.length) {
    return '<div class="sf-unit-empty">No unit data available.</div>';
  }

  return sorted.map((unit) => {
    const label = String(unit?.label || `Unit ${unit?.unit || ''}`).trim() || 'Unit';
    const score = Number(unit?.score || 0);
    const offScore = Number(unit?.off_score || 0);
    const defScore = Number(unit?.def_score || 0);
    const compositeLabel = unitCompositeLabel(unitType);
    const basisNote = unitBasisNote(unitType);
    return `
      <div class="sf-unit-row">
        <div class="sf-unit-row-head">
          <div class="sf-unit-label">${esc(label)}</div>
          <div class="sf-unit-scoreline">
            <div class="sf-unit-score ${classForSigned(score)}" title="${esc(basisNote)}">${esc(compositeLabel)} ${signed(score)}</div>
            <div class="sf-unit-score ${classForSigned(offScore)}" title="Sum of the players' offensive component scores in this unit.">Off Sum ${signed(offScore)}</div>
            <div class="sf-unit-score ${classForSigned(defScore)}" title="Sum of the players' defensive component scores in this unit.">Def Sum ${signed(defScore)}</div>
          </div>
        </div>
        ${renderPlayerSlotGrid(unit || {}, unitType)}
      </div>
    `;
  }).join('');
}

function renderTeamCard(team) {
  const deltaClass = classForSigned(team.delta);
  const current = team.units?.current || {};
  const suggested = team.units?.suggested || {};

  return `
    <article class="sf-team-card" data-team="${esc(team.team)}">
      <header class="sf-team-header">
        <h3>${esc(team.team)}</h3>
      </header>
      <div class="sf-score-compare">
        <span class="sf-score-chip">Current ${signed(team.current_score)}</span>
        <span class="sf-score-chip">Suggested ${signed(team.suggested_score)}</span>
        <span class="sf-score-chip ${deltaClass}">Delta ${signed(team.delta)}</span>
      </div>

      <div class="sf-unit-grid">
        <section class="sf-unit-column sf-unit-column-current">
          <h4>Current Units</h4>
          <div class="sf-unit-basis">${esc(unitColumnSummaryNote())}</div>
          <div class="sf-unit-group">
            <h5 class="sf-unit-group-title">Forward Lines</h5>
            ${renderUnitRows(current.lines, 'lines')}
          </div>
          <div class="sf-unit-group">
            <h5 class="sf-unit-group-title">Defense Pairs</h5>
            ${renderUnitRows(current.pairs, 'pairs')}
          </div>
          <div class="sf-unit-group">
            <h5 class="sf-unit-group-title">Power Play</h5>
            ${renderUnitRows(current.pp, 'pp')}
          </div>
          <div class="sf-unit-group">
            <h5 class="sf-unit-group-title">Penalty Kill</h5>
            ${renderUnitRows(current.pk, 'pk')}
          </div>
        </section>
        <section class="sf-unit-column sf-unit-column-suggested">
          <h4>Suggested Units</h4>
          <div class="sf-unit-basis">${esc(unitColumnSummaryNote())}</div>
          <div class="sf-unit-group">
            <h5 class="sf-unit-group-title">Forward Lines</h5>
            ${renderUnitRows(suggested.lines, 'lines')}
          </div>
          <div class="sf-unit-group">
            <h5 class="sf-unit-group-title">Defense Pairs</h5>
            ${renderUnitRows(suggested.pairs, 'pairs')}
          </div>
          <div class="sf-unit-group">
            <h5 class="sf-unit-group-title">Power Play</h5>
            ${renderUnitRows(suggested.pp, 'pp')}
          </div>
          <div class="sf-unit-group">
            <h5 class="sf-unit-group-title">Penalty Kill</h5>
            ${renderUnitRows(suggested.pk, 'pk')}
          </div>
        </section>
      </div>
    </article>
  `;
}

function applyRankingsFilter(allRows, playerQuery, teamQuery) {
  const playerQ = String(playerQuery || '').toLowerCase().trim();
  const teamQ = String(teamQuery || '').toLowerCase().trim();
  return allRows.filter((row) => {
    const playerMatch = !playerQ || String(row.player_name || '').toLowerCase().includes(playerQ);
    const teamMatch = !teamQ || String(row.team || '').toLowerCase().includes(teamQ);
    return playerMatch && teamMatch;
  });
}

function rankSortedRows(rows) {
  return (rows || []).map((row, idx) => ({
    ...row,
    display_rank: idx + 1,
  }));
}

function sortRankingsRows(rows, sortState) {
  const key = String(sortState?.key || 'total_talent');
  const direction = String(sortState?.direction || 'desc');
  const dirMult = direction === 'asc' ? 1 : -1;
  const missingNumber = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value));
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
    rush_defence: { field: 'rush_defence', type: 'number' },
    chance_suppression: { field: 'chance_suppression', type: 'number' },
    defence_score: { field: 'defence_score', type: 'number' },
    special_teams: { field: 'special_teams', type: 'number' },
    ev_xgar_per_60: { field: 'sort_ev_xgar_per_60', type: 'number' },
    pp_xgar_per_60: { field: 'sort_pp_xgar_per_60', type: 'number' },
    pk_xgar_per_60: { field: 'sort_pk_xgar_per_60', type: 'number' },
    season_gp: { field: 'season_gp', type: 'number' },
    season_toi_min: { field: 'season_toi_min', type: 'number' },
  };
  const spec = fieldMap[key] || fieldMap.total_talent;
  return [...(rows || [])].sort((a, b) => {
    let primary = 0;
    if (spec.type === 'string') {
      primary = String(a?.[spec.field] || '').localeCompare(String(b?.[spec.field] || ''));
      if (primary !== 0) return dirMult * primary;
    } else {
      const aMissing = missingNumber(a?.[spec.field]);
      const bMissing = missingNumber(b?.[spec.field]);
      if (aMissing !== bMissing) {
        return aMissing ? 1 : -1;
      }
      if (aMissing && bMissing) {
        primary = 0;
      } else {
        primary = Number(a?.[spec.field]) - Number(b?.[spec.field]);
      }
      if (Math.abs(primary) > 1e-12) return dirMult * primary;
    }
    const aTotal = missingNumber(a?.total_talent) ? Number.NEGATIVE_INFINITY : Number(a?.total_talent);
    const bTotal = missingNumber(b?.total_talent) ? Number.NEGATIVE_INFINITY : Number(b?.total_talent);
    const totalTie = bTotal - aTotal;
    if (Math.abs(totalTie) > 1e-12) return totalTie;
    const toiTie = Number(b?.season_toi_min || 0) - Number(a?.season_toi_min || 0);
    if (Math.abs(toiTie) > 1e-12) return toiTie;
    return String(a?.player_name || '').localeCompare(String(b?.player_name || ''));
  });
}

function applyTeamRankingsFilter(allRows, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return allRows;
  return (allRows || []).filter((row) => String(row.team || '').toLowerCase().includes(q));
}

function sortTeamRankingsRows(rows, sortState) {
  const key = String(sortState?.key || 'total_team_score');
  const direction = String(sortState?.direction || 'desc');
  const dirMult = direction === 'asc' ? 1 : -1;
  const fieldMap = {
    team: { field: 'team', type: 'string' },
    games_played: { field: 'games_played', type: 'number' },
    total_team_score: { field: 'total_team_score', type: 'number' },
    shooting_talent: { field: 'shooting_talent', type: 'number' },
    playmaking_talent: { field: 'playmaking_talent', type: 'number' },
    goaltending_talent: { field: 'goaltending_talent', type: 'number' },
    chance_generation: { field: 'chance_generation', type: 'number' },
    chance_suppression: { field: 'chance_suppression', type: 'number' },
    leverage_xg_net: { field: 'leverage_xg_net', type: 'number' },
    rush_defence: { field: 'rush_defence', type: 'number' },
    high_danger_for: { field: 'high_danger_for', type: 'number' },
    high_danger_against: { field: 'high_danger_against', type: 'number' },
    special_teams: { field: 'special_teams', type: 'number' },
  };
  const spec = fieldMap[key] || fieldMap.total_team_score;
  return [...(rows || [])].sort((a, b) => {
    let primary = 0;
    if (spec.type === 'string') {
      primary = String(a?.[spec.field] || '').localeCompare(String(b?.[spec.field] || ''));
      if (primary !== 0) return dirMult * primary;
    } else {
      primary = Number(a?.[spec.field] || 0) - Number(b?.[spec.field] || 0);
      if (Math.abs(primary) > 1e-12) return dirMult * primary;
    }
    const totalTie = Number(b?.total_team_score || 0) - Number(a?.total_team_score || 0);
    if (Math.abs(totalTie) > 1e-12) return totalTie;
    return String(a?.team || '').localeCompare(String(b?.team || ''));
  });
}

function applyGoalieFilter(allRows, query) {
  if (!query) return allRows;
  const q = query.toLowerCase();
  return allRows.filter((row) => (
    String(row.goalie_name || '').toLowerCase().includes(q) ||
    String(row.team || '').toLowerCase().includes(q)
  ));
}

function applyTeamFilter(allRows, query) {
  if (!query) return allRows;
  const q = query.toLowerCase();
  return allRows.filter((row) => String(row.team || '').toLowerCase().includes(q));
}

function applyTeamCompareFilter(allRows, selectedTeams) {
  if (!Array.isArray(selectedTeams) || !selectedTeams.length) return allRows;
  const order = new Map(selectedTeams.map((team, index) => [String(team), index]));
  return allRows
    .filter((row) => order.has(String(row.team || '')))
    .sort((a, b) => (order.get(String(a.team || '')) || 0) - (order.get(String(b.team || '')) || 0));
}

function uniqueSortedTeamNames(rows) {
  return Array.from(
    new Set(
      (rows || [])
        .map((row) => String(row?.team || '').trim())
        .filter((team) => !!team)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function populateTeamCompareSelect(selectEl, teamNames, placeholder, selectedValue) {
  if (!selectEl) return;
  const currentValue = String(selectedValue || '').trim();
  const options = [`<option value="">${esc(placeholder)}</option>`].concat(
    (teamNames || []).map((team) => {
      const selectedAttr = team === currentValue ? ' selected' : '';
      return `<option value="${esc(team)}"${selectedAttr}>${esc(team)}</option>`;
    })
  );
  selectEl.innerHTML = options.join('');
}

function selectedComparisonTeams(selectA, selectB) {
  return Array.from(
    new Set(
      [selectA?.value, selectB?.value]
        .map((value) => String(value || '').trim())
        .filter((value) => !!value)
    )
  );
}

function updateTeamCompareNote(selectedTeams) {
  const noteEl = document.getElementById('teamCompareNote');
  if (!noteEl) return;
  if (selectedTeams.length >= 2) {
    noteEl.textContent = `Comparing ${selectedTeams[0]} and ${selectedTeams[1]}.`;
  } else if (selectedTeams.length === 1) {
    noteEl.textContent = `Focused on ${selectedTeams[0]}. Select another team to compare side by side.`;
  } else {
    noteEl.textContent = 'Search teams normally or select up to two teams to compare side by side.';
  }
}

function applyUnderratedFilter(allRows, playerQuery, teamQuery) {
  const playerQ = String(playerQuery || '').toLowerCase().trim();
  const teamQ = String(teamQuery || '').toLowerCase().trim();
  return allRows.filter((row) => {
    const playerMatch = !playerQ || String(row.player_name || '').toLowerCase().includes(playerQ);
    const teamMatch = !teamQ || String(row.team || '').toLowerCase().includes(teamQ);
    return playerMatch && teamMatch;
  });
}

function toggleSuggestedLineup(el) {
  const card = el?.closest ? el.closest('.lineup-card') : null;
  if (!card) return;
  card.classList.toggle('show-suggested', !!el.checked);
}

function rinkBaseMarkup() {
  return `
  <rect x="-100" y="-42.5" width="200" height="85" rx="28" ry="28" fill="#ffffff" stroke="#111111" stroke-width="0.599"></rect>
  <line x1="-89.000" y1="11.000" x2="-100.000" y2="14.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.500"></line>
  <line x1="-89.000" y1="-11.000" x2="-100.000" y2="-14.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.500"></line>
  <line x1="89.000" y1="11.000" x2="100.000" y2="14.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.500"></line>
  <line x1="89.000" y1="-11.000" x2="100.000" y2="-14.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.500"></line>
  <line x1="0.000" y1="-42.500" x2="0.000" y2="42.500" stroke="#C60C30" stroke-width="0.998" stroke-opacity="0.700"></line>
  <line x1="-25.000" y1="-42.500" x2="-25.000" y2="42.500" stroke="#0033A0" stroke-width="0.998" stroke-opacity="0.700"></line>
  <line x1="25.000" y1="-42.500" x2="25.000" y2="42.500" stroke="#0033A0" stroke-width="0.998" stroke-opacity="0.700"></line>
  <line x1="-89.000" y1="-37.000" x2="-89.000" y2="37.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="89.000" y1="-37.000" x2="89.000" y2="37.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <circle cx="0.000" cy="0.000" r="15.000" fill="none" fill-opacity="1.000" stroke="#C60C30" stroke-width="0.599" stroke-opacity="0.700"></circle>
  <circle cx="0.000" cy="0.000" r="0.500" fill="#C60C30" fill-opacity="1.000" stroke="#ffffff" stroke-width="0.200" stroke-opacity="1.000"></circle>
  <circle cx="-69.000" cy="22.000" r="1.000" fill="#C60C30" fill-opacity="1.000" stroke="#ffffff" stroke-width="0.200" stroke-opacity="1.000"></circle>
  <circle cx="-69.000" cy="-22.000" r="1.000" fill="#C60C30" fill-opacity="1.000" stroke="#ffffff" stroke-width="0.200" stroke-opacity="1.000"></circle>
  <circle cx="-22.000" cy="22.000" r="1.000" fill="#C60C30" fill-opacity="1.000" stroke="#ffffff" stroke-width="0.200" stroke-opacity="1.000"></circle>
  <circle cx="-22.000" cy="-22.000" r="1.000" fill="#C60C30" fill-opacity="1.000" stroke="#ffffff" stroke-width="0.200" stroke-opacity="1.000"></circle>
  <circle cx="22.000" cy="22.000" r="1.000" fill="#C60C30" fill-opacity="1.000" stroke="#ffffff" stroke-width="0.200" stroke-opacity="1.000"></circle>
  <circle cx="22.000" cy="-22.000" r="1.000" fill="#C60C30" fill-opacity="1.000" stroke="#ffffff" stroke-width="0.200" stroke-opacity="1.000"></circle>
  <circle cx="69.000" cy="22.000" r="1.000" fill="#C60C30" fill-opacity="1.000" stroke="#ffffff" stroke-width="0.200" stroke-opacity="1.000"></circle>
  <circle cx="69.000" cy="-22.000" r="1.000" fill="#C60C30" fill-opacity="1.000" stroke="#ffffff" stroke-width="0.200" stroke-opacity="1.000"></circle>
  <circle cx="-69.000" cy="22.000" r="15.000" fill="none" fill-opacity="1.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></circle>
  <circle cx="-69.000" cy="-22.000" r="15.000" fill="none" fill-opacity="1.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></circle>
  <circle cx="69.000" cy="22.000" r="15.000" fill="none" fill-opacity="1.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></circle>
  <circle cx="69.000" cy="-22.000" r="15.000" fill="none" fill-opacity="1.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></circle>
  <line x1="-71.000" y1="24.000" x2="-73.000" y2="24.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-71.000" y1="24.000" x2="-71.000" y2="26.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-71.000" y1="20.000" x2="-73.000" y2="20.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-71.000" y1="20.000" x2="-71.000" y2="18.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-67.000" y1="24.000" x2="-65.000" y2="24.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-67.000" y1="24.000" x2="-67.000" y2="26.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-67.000" y1="20.000" x2="-65.000" y2="20.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-67.000" y1="20.000" x2="-67.000" y2="18.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-71.000" y1="36.866" x2="-71.000" y2="38.866" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-71.000" y1="7.134" x2="-71.000" y2="5.134" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-67.000" y1="36.866" x2="-67.000" y2="38.866" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-67.000" y1="7.134" x2="-67.000" y2="5.134" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-71.000" y1="-20.000" x2="-73.000" y2="-20.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-71.000" y1="-20.000" x2="-71.000" y2="-18.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-71.000" y1="-24.000" x2="-73.000" y2="-24.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-71.000" y1="-24.000" x2="-71.000" y2="-26.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-67.000" y1="-20.000" x2="-65.000" y2="-20.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-67.000" y1="-20.000" x2="-67.000" y2="-18.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-67.000" y1="-24.000" x2="-65.000" y2="-24.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-67.000" y1="-24.000" x2="-67.000" y2="-26.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-71.000" y1="-36.866" x2="-71.000" y2="-38.866" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-71.000" y1="-7.134" x2="-71.000" y2="-5.134" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-67.000" y1="-36.866" x2="-67.000" y2="-38.866" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="-67.000" y1="-7.134" x2="-67.000" y2="-5.134" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="67.000" y1="24.000" x2="65.000" y2="24.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="67.000" y1="24.000" x2="67.000" y2="26.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="67.000" y1="20.000" x2="65.000" y2="20.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="67.000" y1="20.000" x2="67.000" y2="18.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="71.000" y1="24.000" x2="73.000" y2="24.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="71.000" y1="24.000" x2="71.000" y2="26.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="71.000" y1="20.000" x2="73.000" y2="20.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="71.000" y1="20.000" x2="71.000" y2="18.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="67.000" y1="36.866" x2="67.000" y2="38.866" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="67.000" y1="7.134" x2="67.000" y2="5.134" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="71.000" y1="36.866" x2="71.000" y2="38.866" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="71.000" y1="7.134" x2="71.000" y2="5.134" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="67.000" y1="-20.000" x2="65.000" y2="-20.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="67.000" y1="-20.000" x2="67.000" y2="-18.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="67.000" y1="-24.000" x2="65.000" y2="-24.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="67.000" y1="-24.000" x2="67.000" y2="-26.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="71.000" y1="-20.000" x2="73.000" y2="-20.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="71.000" y1="-20.000" x2="71.000" y2="-18.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="71.000" y1="-24.000" x2="73.000" y2="-24.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="71.000" y1="-24.000" x2="71.000" y2="-26.000" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="67.000" y1="-36.866" x2="67.000" y2="-38.866" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="67.000" y1="-7.134" x2="67.000" y2="-5.134" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="71.000" y1="-36.866" x2="71.000" y2="-38.866" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <line x1="71.000" y1="-7.134" x2="71.000" y2="-5.134" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></line>
  <path d="M -89.000 -4.000 L -89.000 4.000 L -84.500 4.000 A 6.000 6.000 0 0 0 -84.500 -4.000 L -89.000 -4.000 Z" fill="#ADD8E6" fill-opacity="0.300" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></path>
  <path d="M 89.000 -4.000 L 89.000 4.000 L 84.500 4.000 A 6.000 6.000 0 0 1 84.500 -4.000 L 89.000 -4.000 Z" fill="#ADD8E6" fill-opacity="0.300" stroke="#C60C30" stroke-width="0.399" stroke-opacity="0.700"></path>
  <path d="M -89.000 -3.000 C -89.900 -3.670, -92.330 -3.600, -92.330 -2.000" fill="none" stroke="#111111" stroke-width="0.399" stroke-opacity="0.5"></path>
  <line x1="-92.330" y1="-2.000" x2="-92.330" y2="2.000" stroke="#111111" stroke-width="0.399" stroke-opacity="0.500"></line>
  <path d="M -92.330 2.000 C -92.330 3.600, -89.900 3.670, -89.000 3.000" fill="none" stroke="#111111" stroke-width="0.399" stroke-opacity="0.5"></path>
  <path d="M 89.000 -3.000 C 89.900 -3.670, 92.330 -3.600, 92.330 -2.000" fill="none" stroke="#111111" stroke-width="0.399" stroke-opacity="0.5"></path>
  <line x1="92.330" y1="-2.000" x2="92.330" y2="2.000" stroke="#111111" stroke-width="0.399" stroke-opacity="0.500"></line>
  <path d="M 92.330 2.000 C 92.330 3.600, 89.900 3.670, 89.000 3.000" fill="none" stroke="#111111" stroke-width="0.399" stroke-opacity="0.5"></path>
  `;
}

function xgVisualizerColors(teamInfo) {
  const primary = String(teamInfo?.primary_color || '#06799f').trim() || '#06799f';
  const secondary = String(teamInfo?.secondary_color || '#ff8300').trim() || '#ff8300';
  return { primary, secondary };
}

function xgShotRadius(xg) {
  const value = Number(xg || 0);
  return Math.min(3.6, Math.max(1.0, 1.0 + (Math.sqrt(Math.max(value, 0)) * 2.0)));
}

function updateXgLegend(teamInfo) {
  const colors = xgVisualizerColors(teamInfo);
  const shotDot = document.getElementById('xgLegendShot');
  const goalDot = document.getElementById('xgLegendGoal');
  if (shotDot) {
    shotDot.style.background = colors.primary;
  }
  if (goalDot) {
    goalDot.style.background = colors.secondary;
  }
}

function shotCircleMarkup(shot, isGoal, teamInfo) {
  const x = Number(shot.x || 0);
  const y = Number(shot.y || 0);
  const cx = Math.max(-100, Math.min(100, x));
  const cy = Math.max(-42.5, Math.min(42.5, -y));
  const r = xgShotRadius(shot.xG);
  const colors = xgVisualizerColors(teamInfo);
  const strokeWidth = 0.12;

  if (isGoal) {
    return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${esc(colors.secondary)}" fill-opacity="0.88" stroke="#ffffff" stroke-width="${strokeWidth.toFixed(2)}"></circle>`;
  }
  return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${esc(colors.primary)}" fill-opacity="0.58" stroke="#ffffff" stroke-width="${strokeWidth.toFixed(2)}"></circle>`;
}

async function loadXgTeamShots(teamCode) {
  if (state.xgShotsCache.has(teamCode)) {
    return state.xgShotsCache.get(teamCode);
  }

  const teamInfo = state.xgSummaryByTeam.get(teamCode);
  if (!teamInfo || !teamInfo.shots_file) {
    return [];
  }

  const response = await fetch(`data/${teamInfo.shots_file}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load xG shot file for ${teamCode}: ${response.status}`);
  }

  const payload = await response.json();
  const shots = Array.isArray(payload?.shots) ? payload.shots : [];
  state.xgShotsCache.set(teamCode, shots);
  return shots;
}

function updateXgStats(filteredShots, selectedTeamInfo, minXg, threshold) {
  const usingFullStats = Number(minXg) < Number(threshold);
  const noteEl = document.getElementById('xgDataNote');

  let totalShots = 0;
  let expectedGoals = 0;
  let actualGoals = 0;

  if (usingFullStats) {
    totalShots = Number(selectedTeamInfo?.total_shots || 0);
    expectedGoals = Number(selectedTeamInfo?.total_xg || 0);
    actualGoals = Number(selectedTeamInfo?.total_goals || 0);
    noteEl.textContent = `Shots below xG ${Number(threshold).toFixed(3)} are downsampled. Stats shown are full-team totals.`;
  } else {
    totalShots = filteredShots.length;
    expectedGoals = filteredShots.reduce((sum, row) => sum + Number(row.xG || 0), 0);
    actualGoals = filteredShots.reduce((sum, row) => sum + (row.goal ? 1 : 0), 0);
    noteEl.textContent = '';
  }

  const diffPct = expectedGoals > 0 ? ((actualGoals - expectedGoals) / expectedGoals) * 100 : 0;

  document.getElementById('xgTotalShots').textContent = totalShots.toLocaleString();
  document.getElementById('xgExpectedGoals').textContent = expectedGoals.toFixed(2);
  document.getElementById('xgActualGoals').textContent = actualGoals.toLocaleString();

  const diffEl = document.getElementById('xgDiff');
  diffEl.textContent = `${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%`;
  diffEl.classList.remove('pos', 'neg');
  if (diffPct > 0) {
    diffEl.classList.add('pos');
  } else if (diffPct < 0) {
    diffEl.classList.add('neg');
  }
}

async function refreshXgPanel() {
  const select = document.getElementById('xgTeamSelect');
  const slider = document.getElementById('xgMinProb');
  const sliderValue = document.getElementById('xgMinProbValue');
  const showGoals = document.getElementById('xgShowGoals').checked;
  const svg = document.getElementById('xgRink');

  const team = select.value;
  const minXg = Number(slider.value || 0);
  sliderValue.textContent = minXg.toFixed(3);

  const summary = state.payload?.team_xg_summary || {};
  const threshold = Number(summary.low_xg_threshold || 0.015);
  const selectedTeamInfo = state.xgSummaryByTeam.get(team);
  updateXgLegend(selectedTeamInfo);

  let shots = [];
  try {
    shots = await loadXgTeamShots(team);
  } catch (error) {
    svg.innerHTML = `${rinkBaseMarkup()}<text x="0" y="0" text-anchor="middle" font-size="4.5" fill="#b13a30">${esc(error.message)}</text>`;
    document.getElementById('xgDataNote').textContent = 'Failed to load team shots.';
    return;
  }

  const filtered = shots.filter((row) => Number(row.xG || 0) >= minXg);

  const expectedCircles = filtered.map((shot) => shotCircleMarkup(shot, false, selectedTeamInfo)).join('');
  const goalCircles = showGoals
    ? filtered.filter((row) => !!row.goal).map((shot) => shotCircleMarkup(shot, true, selectedTeamInfo)).join('')
    : '';

  svg.innerHTML = `${rinkBaseMarkup()}${expectedCircles}${goalCircles}`;
  updateXgStats(filtered, selectedTeamInfo, minXg, threshold);
  syncUrlState();
}

function initializeXgPanel() {
  const summary = state.payload?.team_xg_summary || {};
  const teams = Array.isArray(summary.teams) ? summary.teams : [];

  teams.forEach((row) => {
    if (row && row.team) {
      state.xgSummaryByTeam.set(String(row.team), row);
    }
  });

  const select = document.getElementById('xgTeamSelect');
  select.innerHTML = '';

  const sortedTeams = Array.from(state.xgSummaryByTeam.keys()).sort();
  sortedTeams.forEach((teamCode) => {
    const opt = document.createElement('option');
    opt.value = teamCode;
    opt.textContent = teamCode;
    select.appendChild(opt);
  });

  if (!sortedTeams.length) {
    document.getElementById('xgRink').innerHTML = `${rinkBaseMarkup()}<text x="0" y="0" text-anchor="middle" font-size="4.5" fill="#555">No xG team data available</text>`;
    return;
  }

  const initialShareState = state.initialUrlState || {};
  const requestedTeam = normalizeTextValue(initialShareState.xgTeam);
  const defaultTeam = sortedTeams.includes(requestedTeam)
    ? requestedTeam
    : (sortedTeams.includes('OTT') ? 'OTT' : sortedTeams[0]);
  select.value = defaultTeam;

  const xgSlider = document.getElementById('xgMinProb');
  const requestedMin = parseNumberParam(initialShareState.xgMin, null);
  if (xgSlider && requestedMin !== null) {
    const minAllowed = Number(xgSlider.min || 0);
    const maxAllowed = Number(xgSlider.max || 0.5);
    xgSlider.value = clampNumber(requestedMin, minAllowed, maxAllowed).toFixed(3);
  }

  const xgShowGoals = document.getElementById('xgShowGoals');
  if (xgShowGoals && initialShareState.xgGoals !== null) {
    xgShowGoals.checked = parseBooleanParam(initialShareState.xgGoals, true);
  }

  document.getElementById('xgMinProb').addEventListener('input', () => {
    refreshXgPanel().catch(console.error);
  });
  document.getElementById('xgShowGoals').addEventListener('change', () => {
    refreshXgPanel().catch(console.error);
  });
  document.getElementById('xgTeamSelect').addEventListener('change', () => {
    refreshXgPanel().catch(console.error);
  });

  refreshXgPanel().catch(console.error);
}

function seasonLabel(code) {
  const s = String(code || '').trim();
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  }
  return s || '-';
}

function metricText(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(digits);
}

function renderStage1AucChart(modelReport) {
  const root = document.getElementById('stage1AucChart');
  if (!root) return;
  root.innerHTML = '';

  const stage1 = modelReport?.stage1_5v5 || {};
  const rows = [
    { label: 'Blocked', value: Number(stage1.auc_blocked) },
    { label: 'Missed', value: Number(stage1.auc_missed) },
    { label: 'On Net', value: Number(stage1.auc_on_net) },
  ].filter((row) => Number.isFinite(row.value));

  if (!rows.length || typeof d3 === 'undefined') {
    root.innerHTML = '<div class="sf-error">Stage 1 chart unavailable.</div>';
    return;
  }

  const width = root.clientWidth > 0 ? root.clientWidth : 520;
  const height = 250;
  const margin = { top: 18, right: 18, bottom: 34, left: 40 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const svg = d3.select(root)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const x = d3.scaleBand().domain(rows.map((r) => r.label)).range([0, innerW]).padding(0.32);
  const y = d3.scaleLinear().domain([0.5, 1.0]).range([innerH, 0]);

  g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickSizeOuter(0))
    .selectAll('text')
    .style('font-size', '11px');

  g.append('g')
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.2f')))
    .selectAll('text')
    .style('font-size', '11px');

  g.selectAll('rect.sf-bar')
    .data(rows)
    .enter()
    .append('rect')
    .attr('x', (d) => x(d.label))
    .attr('y', (d) => y(d.value))
    .attr('width', x.bandwidth())
    .attr('height', (d) => innerH - y(d.value))
    .attr('fill', '#06799f');

  g.selectAll('text.sf-bar-label')
    .data(rows)
    .enter()
    .append('text')
    .attr('x', (d) => (x(d.label) || 0) + x.bandwidth() / 2)
    .attr('y', (d) => y(d.value) - 6)
    .attr('text-anchor', 'middle')
    .style('font-size', '11px')
    .style('font-family', 'LatoWebSemibold, LatoWeb, sans-serif')
    .text((d) => d.value.toFixed(3));
}

function renderCombinedCalibrationChart(modelReport) {
  const root = document.getElementById('combinedCalibrationChart');
  if (!root) return;
  root.innerHTML = '';

  const combined = modelReport?.combined_5v5 || {};
  const curveBase = Array.isArray(combined.calibration_curve_base) ? combined.calibration_curve_base : [];
  const curveCal = Array.isArray(combined.calibration_curve_calibrated) ? combined.calibration_curve_calibrated : [];

  if ((!curveBase.length && !curveCal.length) || typeof d3 === 'undefined') {
    root.innerHTML = '<div class="sf-error">Combined calibration curve unavailable.</div>';
    return;
  }

  const width = root.clientWidth > 0 ? root.clientWidth : 520;
  const height = 250;
  const margin = { top: 20, right: 24, bottom: 34, left: 40 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const svg = d3.select(root)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const x = d3.scaleLinear().domain([0, 1]).range([0, innerW]);
  const y = d3.scaleLinear().domain([0, 1]).range([innerH, 0]);

  g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format('.1f')))
    .selectAll('text')
    .style('font-size', '11px');

  g.append('g')
    .call(d3.axisLeft(y).ticks(6).tickFormat(d3.format('.1f')))
    .selectAll('text')
    .style('font-size', '11px');

  g.append('line')
    .attr('x1', x(0))
    .attr('y1', y(0))
    .attr('x2', x(1))
    .attr('y2', y(1))
    .attr('stroke', '#9cb8c4')
    .attr('stroke-width', 1.2)
    .attr('stroke-dasharray', '4,4');

  const line = d3.line()
    .x((d) => x(Number(d.pred_mean || 0)))
    .y((d) => y(Number(d.actual_mean || 0)));

  if (curveBase.length) {
    g.append('path')
      .datum(curveBase)
      .attr('fill', 'none')
      .attr('stroke', '#ff8300')
      .attr('stroke-width', 2.2)
      .attr('d', line);
  }
  if (curveCal.length) {
    g.append('path')
      .datum(curveCal)
      .attr('fill', 'none')
      .attr('stroke', '#06799f')
      .attr('stroke-width', 2.2)
      .attr('d', line);
  }

  const legend = g.append('g').attr('transform', `translate(${Math.max(0, innerW - 160)}, 6)`);
  legend.append('line').attr('x1', 0).attr('x2', 18).attr('y1', 0).attr('y2', 0).attr('stroke', '#ff8300').attr('stroke-width', 2.2);
  legend.append('text').attr('x', 24).attr('y', 3).style('font-size', '11px').text('Base');
  legend.append('line').attr('x1', 68).attr('x2', 86).attr('y1', 0).attr('y2', 0).attr('stroke', '#06799f').attr('stroke-width', 2.2);
  legend.append('text').attr('x', 92).attr('y', 3).style('font-size', '11px').text('Calibrated');
}

function renderModelPerformance(modelReport, payload) {
  const report = modelReport || {};
  const trainingSeasons = Array.isArray(report.training_seasons) ? report.training_seasons : [];
  const stage2 = report.stage2_5v5 || {};
  const combined = report.combined_5v5 || {};

  document.getElementById('modelTrainingSeasons').textContent = trainingSeasons.length
    ? trainingSeasons.map(seasonLabel).join(', ')
    : '-';
  document.getElementById('modelTestSeason').textContent = seasonLabel(report.test_season || '');
  document.getElementById('modelTrainedAt').textContent = `Trained: ${String(stage2.trained_at || report.generated_at_utc || '-')}`;
  document.getElementById('modelStage2Auc').textContent = metricText(stage2.auc, 3);
  document.getElementById('modelCombinedAuc').textContent = metricText(combined.auc_calibrated, 3);
  document.getElementById('modelStage2Brier').textContent = metricText(stage2.brier, 4);
  document.getElementById('modelCombinedBrier').textContent = metricText(combined.brier_calibrated, 4);

  renderStage1AucChart(report);
  renderCombinedCalibrationChart(report);

  const updatedLabel = String(payload.last_updated_utc || payload.generated_at || '');
  document.getElementById('lastUpdatedBanner').textContent = `Last updated: ${updatedLabel}`;
}

async function main() {
  const response = await fetch(DATA_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load ${DATA_URL}: ${response.status}`);
  }
  const payload = await response.json();
  state.payload = payload;
  state.suppressUrlSync = true;
  state.initialUrlState = readShareStateFromUrl();
  if (state.initialUrlState.skaterSort) {
    state.rankingsSort = {
      key: state.initialUrlState.skaterSort,
      direction: state.initialUrlState.skaterDir || 'desc',
    };
  }

  const allRankings = payload.rankings || [];
  const allGoalies = payload.goalie_rankings || [];
  const allTeamRankings = payload.team_rankings || [];
  const allUnderrated = payload.underrated_rankings || [];
  const scoringAnomalies = payload.scoring_anomalies || {};
  const allTeams = payload.teams || [];
  state.skaterPosById = new Map(
    allRankings
      .map((row) => [Number(row.player_id || 0), String(row.position || '')])
      .filter((entry) => Number.isFinite(entry[0]) && entry[0] > 0)
  );
  const legacyLineupCardsHtml = String(payload.legacy_lineup_cards_html || '').trim();
  const usingLegacyLineupCards = (
    legacyLineupCardsHtml.length > 0 &&
    (
      payload?.use_legacy_lineup_cards === true ||
      !Array.isArray(allTeams) ||
      allTeams.length === 0
    )
  );

  renderRankingBasis(payload);
  document.getElementById('generatedAt').textContent = String(payload.generated_at || '');
  document.getElementById('skaterCount').textContent = String(allRankings.length);
  document.getElementById('goalieCount').textContent = String(allGoalies.length);
  document.getElementById('teamCount').textContent = String(
    usingLegacyLineupCards
      ? (legacyLineupCardsHtml.match(/class="lineup-card"/g) || []).length
      : allTeams.length
  );
  document.getElementById('lastUpdatedBanner').textContent = `Last updated: ${String(payload.last_updated_utc || payload.generated_at || '')}`;

  const teamGrid = document.getElementById('teamGrid');
  const renderTeams = (rows) => {
    if (usingLegacyLineupCards) {
      teamGrid.innerHTML = legacyLineupCardsHtml;
      return;
    }
    teamGrid.innerHTML = rows.map(renderTeamCard).join('');
  };

  renderRankings(rankSortedRows(sortRankingsRows(allRankings, state.rankingsSort)));
  renderGoalies(allGoalies);
  renderTeamRankings(sortTeamRankingsRows(allTeamRankings, state.teamRankingsSort));
  renderUnderrated(allUnderrated);
  renderScoringAnomalies(scoringAnomalies);
  renderTeams(allTeams);

  const playerSearch = document.getElementById('playerSearch');
  const rankingsTeamSearch = document.getElementById('rankingsTeamSearch');
  setControlValue(playerSearch, state.initialUrlState.player);
  setControlValue(rankingsTeamSearch, state.initialUrlState.skaterTeam);
  const refreshRankings = () => {
    const rankedRows = rankSortedRows(sortRankingsRows(allRankings, state.rankingsSort));
    const filtered = applyRankingsFilter(
      rankedRows,
      playerSearch?.value || '',
      rankingsTeamSearch?.value || ''
    );
    renderRankings(filtered);
    updateSortableHeaders('rankingsTable', state.rankingsSort);
    syncUrlState();
  };
  playerSearch.addEventListener('input', refreshRankings);
  rankingsTeamSearch.addEventListener('input', refreshRankings);
  bindSortableHeaders('rankingsTable', 'rankingsSort', refreshRankings);

  const teamRankingsSearch = document.getElementById('teamRankingsSearch');
  setControlValue(teamRankingsSearch, state.initialUrlState.teamRank);
  const refreshTeamRankings = () => {
    const filtered = applyTeamRankingsFilter(allTeamRankings, teamRankingsSearch?.value || '');
    const rows = sortTeamRankingsRows(filtered, state.teamRankingsSort);
    renderTeamRankings(rows);
    updateSortableHeaders('teamRankingsTable', state.teamRankingsSort);
    syncUrlState();
  };
  teamRankingsSearch.addEventListener('input', refreshTeamRankings);
  bindSortableHeaders('teamRankingsTable', 'teamRankingsSort', refreshTeamRankings);

  const goalieSearch = document.getElementById('goalieSearch');
  setControlValue(goalieSearch, state.initialUrlState.goalie);
  const refreshGoalies = () => {
    const rows = applyGoalieFilter(allGoalies, goalieSearch.value || '');
    renderGoalies(rows);
    syncUrlState();
  };
  goalieSearch.addEventListener('input', refreshGoalies);

  const underratedSearch = document.getElementById('underratedSearch');
  const underratedTeamSearch = document.getElementById('underratedTeamSearch');
  setControlValue(underratedSearch, state.initialUrlState.underrated);
  setControlValue(underratedTeamSearch, state.initialUrlState.underratedTeam);
  const refreshUnderrated = () => {
    const rows = applyUnderratedFilter(
      allUnderrated,
      underratedSearch?.value || '',
      underratedTeamSearch?.value || ''
    );
    renderUnderrated(rows);
    syncUrlState();
  };
  underratedSearch.addEventListener('input', refreshUnderrated);
  underratedTeamSearch.addEventListener('input', refreshUnderrated);

  const teamSearch = document.getElementById('teamSearch');
  const compareTeamA = document.getElementById('compareTeamA');
  const compareTeamB = document.getElementById('compareTeamB');
  setControlValue(teamSearch, state.initialUrlState.lineTeam);
  const availableTeamNames = usingLegacyLineupCards
    ? uniqueSortedTeamNames(Array.from(teamGrid.querySelectorAll('.lineup-card')).map((card) => ({ team: card.dataset?.team || '' })))
    : uniqueSortedTeamNames(allTeams);

  populateTeamCompareSelect(compareTeamA, availableTeamNames, 'Compare team A', state.initialUrlState.compareA || '');
  populateTeamCompareSelect(compareTeamB, availableTeamNames, 'Compare team B', state.initialUrlState.compareB || '');
  setSelectValueIfPresent(compareTeamA, state.initialUrlState.compareA);
  setSelectValueIfPresent(compareTeamB, state.initialUrlState.compareB);

  const refreshTeamPanel = () => {
    const selectedTeams = selectedComparisonTeams(compareTeamA, compareTeamB);
    updateTeamCompareNote(selectedTeams);
    if (usingLegacyLineupCards) {
      const q = String(teamSearch.value || '').toLowerCase().trim();
      teamGrid.querySelectorAll('.lineup-card').forEach((card) => {
        const team = String(card.dataset?.team || '').toLowerCase();
        const text = String(card.textContent || '').toLowerCase();
        const show = selectedTeams.length
          ? selectedTeams.includes(String(card.dataset?.team || '').trim())
          : (!q || team.includes(q) || text.includes(q));
        card.style.display = show ? '' : 'none';
      });
    } else {
      const rows = selectedTeams.length
        ? applyTeamCompareFilter(allTeams, selectedTeams)
        : applyTeamFilter(allTeams, teamSearch.value || '');
      renderTeams(rows);
    }
    syncUrlState();
  };
  teamSearch.addEventListener('input', refreshTeamPanel);
  compareTeamA.addEventListener('change', refreshTeamPanel);
  compareTeamB.addEventListener('change', refreshTeamPanel);
  refreshRankings();
  refreshTeamRankings();
  refreshGoalies();
  refreshUnderrated();
  refreshTeamPanel();

  setupSectionNavigation(state.initialUrlState.section);
  state.suppressUrlSync = false;
  initializeXgPanel();
  syncUrlState();
}

main().catch((error) => {
  console.error(error);
  const xgRink = document.getElementById('xgRink');
  if (xgRink) {
    xgRink.innerHTML = `${rinkBaseMarkup()}<text x="0" y="0" text-anchor="middle" font-size="4.5" fill="#b13a30">${esc(error.message)}</text>`;
  }
  const teamGrid = document.getElementById('teamGrid');
  if (teamGrid) {
    teamGrid.innerHTML = `<div class="sf-error">Failed to load site data: ${esc(error.message)}</div>`;
  }
});
