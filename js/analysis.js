(() => {
  const {
    esc,
    signed,
    classForSigned,
    fetchJson,
    normalizeText,
  } = window.NetOutcomesCommon;

  const DEFAULT_SECTION_ID = 'overviewPanel';
  const VALID_SECTION_IDS = ['overviewPanel', 'teamPanel', 'penaltyPanel', 'powerplayPanel', 'xgPanel'];
  const SECTION_SLUG_BY_ID = {
    overviewPanel: 'overview',
    teamPanel: 'line-analysis',
    penaltyPanel: 'penalties',
    powerplayPanel: 'pp-development',
    xgPanel: 'team-xg',
  };
  const DEFAULT_XG_MIN_PROB = 0.015;
  const PENALTY_COLORS = {
    primary: '#0f6b84',
    secondary: '#d07a22',
    tertiary: '#4f6b5d',
    positive: '#0b8f4d',
    negative: '#b04f2e',
  };
  const PENALTY_TYPE_METRICS = {
    goal_end_goals_per_two_minutes: 'Historical goals per strict 2:00 PP',
  };
  const PENALTY_END_RATE_KEYS = {
    goal_end: {
      chance: 'goal_end_two_minute_scoring_chance',
      rate: 'goal_end_goals_per_minute',
      minutes: 'goal_end_minutes',
      goals: 'goal_end_goals',
      label: 'Goal-End',
    },
    box_exit_plus5: {
      chance: 'box_exit_plus5_two_minute_scoring_chance',
      rate: 'box_exit_plus5_goals_per_minute',
      minutes: 'box_exit_plus5_minutes',
      goals: 'box_exit_plus5_goals',
      label: 'Box Exit + 5s',
    },
    possession_end: {
      chance: 'possession_end_two_minute_scoring_chance',
      rate: 'possession_end_goals_per_minute',
      minutes: 'possession_end_minutes',
      goals: 'possession_end_goals',
      label: 'First PK Possession',
    },
    change_end: {
      chance: 'change_end_two_minute_scoring_chance',
      rate: 'change_end_goals_per_minute',
      minutes: 'change_end_minutes',
      goals: 'change_end_goals',
      label: 'First PK Change',
    },
  };
  const PENALTY_STATE_SORT_LABELS = {
    chance: 'Scoring Chance',
    minutes: 'Game Time',
    goals: 'Total Goals',
  };
  const POWERPLAY_COLORS = {
    top: '#0f6b84',
    qualified: '#9bb7c4',
    accent: '#d07a22',
    positive: '#0b8f4d',
    negative: '#b04f2e',
    line: '#1f5f8b',
  };

  const state = {
    teams: [],
    xgSummaryByTeam: new Map(),
    xgShotsCache: new Map(),
    baseRinkMarkup: '',
    activeSection: DEFAULT_SECTION_ID,
    initialUrlState: null,
    suppressUrlSync: false,
    analysisPayload: null,
  };

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

  function readInlineAnalysisPayload() {
    const el = document.getElementById('analysisPagePayload');
    const raw = String(el?.textContent || '').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.error('Failed to parse inline analysis payload', error);
      return null;
    }
  }

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readShareStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const hashSection = sanitizeSectionTarget(window.location.hash.replace(/^#/, ''));
    return {
      section: hashSection || sanitizeSectionTarget(params.get('section')) || DEFAULT_SECTION_ID,
      lineTeam: String(params.get('lineTeam') || '').trim(),
      compareA: String(params.get('compareA') || '').trim(),
      compareB: String(params.get('compareB') || '').trim(),
      xgTeam: String(params.get('xgTeam') || '').trim(),
      xgMin: String(params.get('xgMin') || '').trim(),
      xgGoals: params.get('xgGoals'),
    };
  }

  function setControlValue(control, value) {
    if (!control || value === null || value === undefined) return;
    control.value = String(value);
  }

  function setSelectValueIfPresent(control, value) {
    if (!control) return;
    const normalized = String(value || '').trim();
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

    if (activeSection === 'teamPanel') {
      const lineTeam = String(document.getElementById('teamSearch')?.value || '').trim();
      const compareA = String(document.getElementById('compareTeamA')?.value || '').trim();
      const compareB = String(document.getElementById('compareTeamB')?.value || '').trim();
      if (compareA) params.set('compareA', compareA);
      if (compareB && compareB !== compareA) params.set('compareB', compareB);
      if (!compareA && !compareB && lineTeam) params.set('lineTeam', lineTeam);
    } else if (activeSection === 'xgPanel') {
      const xgTeam = String(document.getElementById('xgTeamSelect')?.value || '').trim();
      const xgMin = parseNumberParam(document.getElementById('xgMinProb')?.value, null);
      const showGoals = document.getElementById('xgShowGoals')?.checked;
      if (xgTeam) params.set('xgTeam', xgTeam);
      if (xgMin !== null && Math.abs(xgMin - DEFAULT_XG_MIN_PROB) > 1e-9) {
        params.set('xgMin', xgMin.toFixed(3));
      }
      if (showGoals === false) params.set('xgGoals', '0');
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
    const buttons = Array.from(document.querySelectorAll('#analysisSectionNav .sf-section-btn'));
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
      return 'Fit = weighted two-way composite (55% Off Sum, 45% Def Sum). Off Sum and Def Sum are raw player totals, so they do not add up to Fit.';
    }
    if (unitType === 'pp') {
      return 'PP Fit blends power-play RAPM, offensive talent, even-strength impact, finishing, and drawn-penalty value.';
    }
    if (unitType === 'pk') {
      return 'PK Fit leans on penalty-kill RAPM, defensive talent, real PK usage, and penalty avoidance.';
    }
    return 'Fit is a weighted composite.';
  }

  function unitColumnSummaryNote() {
    return 'Fit is a weighted unit score. Off Sum and Def Sum are raw player totals and do not add directly.';
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
    const direct = (players || []).map((player) => normalizeSlotPos(player?.position || ''));
    if (unitType === 'lines') return ['L', 'C', 'R'];
    if (unitType === 'pairs') return direct.some(Boolean) ? direct.map((value) => value || 'D') : ['D', 'D'];
    if (unitType === 'pp' || unitType === 'pk') {
      if (direct.some(Boolean)) {
        return direct.map((value, idx) => value || `P${idx + 1}`);
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
    const slotCount = Math.max(slotLabels.length, players.length, 1);
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
      const diff = unitSortValue(aLabel) - unitSortValue(bLabel);
      if (diff !== 0) return diff;
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
      return `
        <div class="sf-unit-row">
          <div class="sf-unit-row-head">
            <div class="sf-unit-label">${esc(label)}</div>
            <div class="sf-unit-scoreline">
              <div class="sf-unit-score ${classForSigned(score)}" title="${esc(unitBasisNote(unitType))}">${esc(unitCompositeLabel(unitType))} ${signed(score)}</div>
              <div class="sf-unit-score ${classForSigned(offScore)}">Off Sum ${signed(offScore)}</div>
              <div class="sf-unit-score ${classForSigned(defScore)}">Def Sum ${signed(defScore)}</div>
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
            <div class="sf-unit-group"><h5 class="sf-unit-group-title">Forward Lines</h5>${renderUnitRows(current.lines, 'lines')}</div>
            <div class="sf-unit-group"><h5 class="sf-unit-group-title">Defense Pairs</h5>${renderUnitRows(current.pairs, 'pairs')}</div>
            <div class="sf-unit-group"><h5 class="sf-unit-group-title">Power Play</h5>${renderUnitRows(current.pp, 'pp')}</div>
            <div class="sf-unit-group"><h5 class="sf-unit-group-title">Penalty Kill</h5>${renderUnitRows(current.pk, 'pk')}</div>
          </section>
          <section class="sf-unit-column sf-unit-column-suggested">
            <h4>Suggested Units</h4>
            <div class="sf-unit-basis">${esc(unitColumnSummaryNote())}</div>
            <div class="sf-unit-group"><h5 class="sf-unit-group-title">Forward Lines</h5>${renderUnitRows(suggested.lines, 'lines')}</div>
            <div class="sf-unit-group"><h5 class="sf-unit-group-title">Defense Pairs</h5>${renderUnitRows(suggested.pairs, 'pairs')}</div>
            <div class="sf-unit-group"><h5 class="sf-unit-group-title">Power Play</h5>${renderUnitRows(suggested.pp, 'pp')}</div>
            <div class="sf-unit-group"><h5 class="sf-unit-group-title">Penalty Kill</h5>${renderUnitRows(suggested.pk, 'pk')}</div>
          </section>
        </div>
      </article>
    `;
  }

  function populateTeamCompareSelect(selectEl, teamNames, placeholder, selectedValue) {
    if (!selectEl) return;
    const currentValue = String(selectedValue || '').trim();
    const options = [`<option value="">${esc(placeholder)}</option>`].concat(
      (teamNames || []).map((team) => {
        const selectedAttr = team === currentValue ? ' selected' : '';
        return `<option value="${esc(team)}"${selectedAttr}>${esc(team)}</option>`;
      }),
    );
    selectEl.innerHTML = options.join('');
  }

  function selectedComparisonTeams(selectA, selectB) {
    return Array.from(new Set([selectA?.value, selectB?.value].map((value) => String(value || '').trim()).filter(Boolean)));
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

  function refreshTeamCards() {
    const teamGrid = document.getElementById('teamGrid');
    if (!teamGrid) return;
    const teamQuery = normalizeText(document.getElementById('teamSearch')?.value);
    const compareA = document.getElementById('compareTeamA');
    const compareB = document.getElementById('compareTeamB');
    const selectedTeams = selectedComparisonTeams(compareA, compareB);
    updateTeamCompareNote(selectedTeams);

    if (!state.teams.length) {
      teamGrid.innerHTML = '<div class="sf-empty-state">No team analysis payload is available.</div>';
      syncUrlState();
      return;
    }

    let rows = state.teams.slice();
    if (selectedTeams.length) {
      const order = new Map(selectedTeams.map((team, index) => [team, index]));
      rows = rows
        .filter((row) => order.has(String(row.team || '')))
        .sort((a, b) => (order.get(String(a.team || '')) || 0) - (order.get(String(b.team || '')) || 0));
    } else if (teamQuery) {
      rows = rows.filter((row) => normalizeText(row.team).includes(teamQuery));
    }

    if (!rows.length) {
      teamGrid.innerHTML = '<div class="sf-empty-state">No teams match the current filters.</div>';
      syncUrlState();
      return;
    }
    teamGrid.innerHTML = rows.map(renderTeamCard).join('');
    syncUrlState();
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
    if (shotDot) shotDot.style.background = colors.primary;
    if (goalDot) goalDot.style.background = colors.secondary;
  }

  function shotCircleMarkup(shot, isGoal, teamInfo) {
    const x = Number(shot.x || 0);
    const y = Number(shot.y || 0);
    const cx = Math.max(-100, Math.min(100, x));
    const cy = Math.max(-42.5, Math.min(42.5, -y));
    const r = xgShotRadius(shot.xG);
    const colors = xgVisualizerColors(teamInfo);
    if (isGoal) {
      return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${esc(colors.secondary)}" fill-opacity="0.88" stroke="#ffffff" stroke-width="0.12"></circle>`;
    }
    return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fill="${esc(colors.primary)}" fill-opacity="0.58" stroke="#ffffff" stroke-width="0.12"></circle>`;
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
      if (noteEl) {
        noteEl.textContent = `Shots below xG ${Number(threshold).toFixed(3)} are downsampled. Stats shown are full-team totals.`;
      }
    } else {
      totalShots = filteredShots.length;
      expectedGoals = filteredShots.reduce((sum, row) => sum + Number(row.xG || 0), 0);
      actualGoals = filteredShots.reduce((sum, row) => sum + (row.goal ? 1 : 0), 0);
      if (noteEl) noteEl.textContent = '';
    }
    const diffPct = expectedGoals > 0 ? ((actualGoals - expectedGoals) / expectedGoals) * 100 : 0;
    const totalShotsEl = document.getElementById('xgTotalShots');
    const expectedGoalsEl = document.getElementById('xgExpectedGoals');
    const actualGoalsEl = document.getElementById('xgActualGoals');
    if (totalShotsEl) totalShotsEl.textContent = totalShots.toLocaleString();
    if (expectedGoalsEl) expectedGoalsEl.textContent = expectedGoals.toFixed(2);
    if (actualGoalsEl) actualGoalsEl.textContent = actualGoals.toLocaleString();
    const diffEl = document.getElementById('xgDiff');
    if (diffEl) {
      diffEl.textContent = `${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%`;
      diffEl.classList.remove('pos', 'neg');
      if (diffPct > 0) diffEl.classList.add('pos');
      if (diffPct < 0) diffEl.classList.add('neg');
    }
  }

  async function refreshXgPanel() {
    const select = document.getElementById('xgTeamSelect');
    const slider = document.getElementById('xgMinProb');
    const sliderValue = document.getElementById('xgMinProbValue');
    const showGoals = document.getElementById('xgShowGoals')?.checked;
    const svg = document.getElementById('xgRink');
    const team = select?.value || '';
    const minXg = Number(slider?.value || 0);
    if (sliderValue) sliderValue.textContent = minXg.toFixed(3);
    const summary = state.analysisPayload?.team_xg_summary || {};
    const threshold = Number(summary.low_xg_threshold || DEFAULT_XG_MIN_PROB);
    const selectedTeamInfo = state.xgSummaryByTeam.get(team);
    updateXgLegend(selectedTeamInfo);

    let shots = [];
    try {
      shots = await loadXgTeamShots(team);
    } catch (error) {
      if (svg) svg.innerHTML = `${state.baseRinkMarkup}<text x="0" y="0" text-anchor="middle" font-size="4.5" fill="#b13a30">${esc(error.message)}</text>`;
      const noteEl = document.getElementById('xgDataNote');
      if (noteEl) noteEl.textContent = 'Failed to load team shots.';
      return;
    }

    const filtered = shots.filter((row) => Number(row.xG || 0) >= minXg);
    const expectedCircles = filtered.map((shot) => shotCircleMarkup(shot, false, selectedTeamInfo)).join('');
    const goalCircles = showGoals
      ? filtered.filter((row) => !!row.goal).map((shot) => shotCircleMarkup(shot, true, selectedTeamInfo)).join('')
      : '';
    if (svg) svg.innerHTML = `${state.baseRinkMarkup}${expectedCircles}${goalCircles}`;
    updateXgStats(filtered, selectedTeamInfo, minXg, threshold);
    syncUrlState();
  }

  function initializeXgPanel() {
    const summary = state.analysisPayload?.team_xg_summary || {};
    const teams = Array.isArray(summary.teams) ? summary.teams : [];
    teams.forEach((row) => {
      if (row?.team) state.xgSummaryByTeam.set(String(row.team), row);
    });
    const select = document.getElementById('xgTeamSelect');
    if (!select) return;
    select.innerHTML = '';
    const teamCodes = Array.from(state.xgSummaryByTeam.keys()).sort();
    teamCodes.forEach((teamCode) => {
      const opt = document.createElement('option');
      opt.value = teamCode;
      opt.textContent = teamCode;
      select.appendChild(opt);
    });
    if (!teamCodes.length) {
      const svg = document.getElementById('xgRink');
      if (svg) svg.innerHTML = `${state.baseRinkMarkup}<text x="0" y="0" text-anchor="middle" font-size="4.5" fill="#555">No xG team data available</text>`;
      return;
    }

    const requestedTeam = String(state.initialUrlState?.xgTeam || '').trim();
    select.value = teamCodes.includes(requestedTeam)
      ? requestedTeam
      : (teamCodes.includes('OTT') ? 'OTT' : teamCodes[0]);

    const slider = document.getElementById('xgMinProb');
    const requestedMin = parseNumberParam(state.initialUrlState?.xgMin, null);
    if (slider && requestedMin !== null) {
      slider.value = clampNumber(
        requestedMin,
        Number(slider.min || 0),
        Number(slider.max || 0.5),
      ).toFixed(3);
    }

    const showGoals = document.getElementById('xgShowGoals');
    if (showGoals && state.initialUrlState?.xgGoals !== null) {
      showGoals.checked = parseBooleanParam(state.initialUrlState.xgGoals, true);
    }

    document.getElementById('xgMinProb')?.addEventListener('input', () => refreshXgPanel().catch(console.error));
    document.getElementById('xgShowGoals')?.addEventListener('change', () => refreshXgPanel().catch(console.error));
    document.getElementById('xgTeamSelect')?.addEventListener('change', () => refreshXgPanel().catch(console.error));
    refreshXgPanel().catch(console.error);
  }

  function formatPct(value, digits = 1) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'n/a';
    return `${(num * 100).toFixed(digits)}%`;
  }

  function formatFixed(value, digits = 2) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'n/a';
    return num.toFixed(digits);
  }

  function formatSignedFixed(value, digits = 2) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'n/a';
    return `${num >= 0 ? '+' : ''}${num.toFixed(digits)}`;
  }

  function paddedDomain(values, fallbackMin, fallbackMax) {
    const nums = (values || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
    if (!nums.length) return [fallbackMin, fallbackMax];
    let min = Math.min(...nums);
    let max = Math.max(...nums);
    if (Math.abs(max - min) < 1e-9) {
      const pad = Math.max(Math.abs(max) * 0.15, 0.25);
      min -= pad;
      max += pad;
    } else {
      const pad = Math.max((max - min) * 0.12, 0.08);
      min -= pad;
      max += pad;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      return [fallbackMin, fallbackMax];
    }
    return [min, max];
  }

  function axisTickValues(domain, tickCount = 5) {
    const [min, max] = domain;
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
    if (tickCount <= 1 || Math.abs(max - min) < 1e-9) return [min];
    return Array.from({ length: tickCount }, (_, idx) => min + ((max - min) * idx) / (tickCount - 1));
  }

  function renderPenaltyTypeImpactChart(analysis, metricKey) {
    const svg = document.getElementById('penaltyTypeImpactChart');
    if (!svg) return;
    const rows = Array.isArray(analysis?.type_impact?.rows) ? analysis.type_impact.rows : [];
    if (!rows.length) {
      svg.innerHTML = '<text x="380" y="180" text-anchor="middle" font-size="16" fill="#6a7a70">Penalty-type impact data is not available in this build.</text>';
      return;
    }

    const width = 920;
    const rowHeight = 44;
    const chartRows = rows
      .slice()
      .sort((a, b) => (
        Number(b?.[metricKey] || 0) - Number(a?.[metricKey] || 0)
      ) || (
          Number(b?.pp_minutes || 0) - Number(a?.pp_minutes || 0)
        ))
      .slice(0, 16);
    const maxLabelChars = chartRows.reduce((max, row) => Math.max(max, String(row?.penalty_type || '').length), 12);
    const leftPad = Math.max(220, Math.min(340, 48 + (maxLabelChars * 7.2)));
    const height = Math.max(420, 122 + (chartRows.length * rowHeight));
    const padding = { top: 56, right: 108, bottom: 54, left: leftPad };
    const innerWidth = width - padding.left - padding.right;
    const maxValue = Math.max(0.12, ...chartRows.map((row) => Number(row?.[metricKey] || 0)));
    const xAt = (value) => padding.left + (innerWidth * Number(value || 0)) / maxValue;
    const ticks = axisTickValues([0, maxValue], 6);
    const grid = ticks.map((tick) => {
      const x = xAt(tick);
      return `<line x1="${x.toFixed(2)}" y1="${padding.top}" x2="${x.toFixed(2)}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#e4edf1" stroke-width="1" />`;
    }).join('');
    const tickLabels = ticks.map((tick) => {
      const x = xAt(tick);
      return `<text x="${x.toFixed(2)}" y="${(height - padding.bottom + 20).toFixed(2)}" text-anchor="middle" font-size="11" fill="#5a6f77">${esc(formatFixed(tick, 2))}</text>`;
    }).join('');
    const legendX = width - padding.right - 196;
    const legendY = 18;
    const legend = `
      <g>
        <rect x="${legendX}" y="${legendY}" width="18" height="8" fill="${PENALTY_COLORS.primary}" />
        <text x="${legendX + 24}" y="${legendY + 7}" font-size="11" fill="#51656e">1-man PP minutes</text>
        <rect x="${legendX}" y="${legendY + 16}" width="18" height="8" fill="${PENALTY_COLORS.secondary}" />
        <text x="${legendX + 24}" y="${legendY + 23}" font-size="11" fill="#51656e">2-man PP minutes</text>
      </g>
    `;

    const bars = chartRows.map((row, idx) => {
      const y = padding.top + (idx * rowHeight);
      const value = Number(row?.[metricKey] || 0);
      const barWidth = Math.max(0, xAt(value) - padding.left);
      const oneManMinutes = Math.max(0, Number(row?.one_man_pp_minutes || 0));
      const twoManMinutes = Math.max(0, Number(row?.two_man_pp_minutes || 0));
      const totalMinutes = Math.max(0.0001, Number(row?.pp_minutes || 0));
      const twoManWidth = barWidth * Math.max(0, Math.min(1, twoManMinutes / totalMinutes));
      const oneManWidth = Math.max(0, barWidth - twoManWidth);
      const tooltip = `${row.penalty_type}: ${formatFixed(value, 2)} historical goals per strict 2:00 of PP time | ${formatFixed(row.goal_end_goals_per_minute, 3)} goals/min on the strict PP | ${row.count} non-offsetting PP penalties | ${formatFixed(row.pp_minutes, 1)} strict PP minutes | 1-man ${formatFixed(oneManMinutes, 1)} min | 2-man ${formatFixed(twoManMinutes, 1)} min`;
      const baselineY = y + 10;
      const meta = `${formatFixed(row.pp_minutes, 1)} PP min • 1-man ${formatFixed(oneManMinutes, 1)} • 2-man ${formatFixed(twoManMinutes, 1)}`;
      return `
        <line x1="${padding.left}" y1="${(baselineY + 24).toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${(baselineY + 24).toFixed(2)}" stroke="#eff4f6" stroke-width="1" />
        <text x="${(padding.left - 16).toFixed(2)}" y="${(baselineY + 2).toFixed(2)}" text-anchor="end" font-size="12" fill="#22353c" font-family="LatoWebSemibold, LatoWeb, sans-serif">${esc(row.penalty_type || '')}</text>
        <text x="${(padding.left - 16).toFixed(2)}" y="${(baselineY + 18).toFixed(2)}" text-anchor="end" font-size="10.5" fill="#677981">${esc(meta)}</text>
        <rect x="${padding.left}" y="${(baselineY - 8).toFixed(2)}" width="${barWidth.toFixed(2)}" height="14" fill="#edf3f6" stroke="none">
          <title>${esc(tooltip)}</title>
        </rect>
        <rect x="${padding.left}" y="${(baselineY - 8).toFixed(2)}" width="${oneManWidth.toFixed(2)}" height="14" fill="${PENALTY_COLORS.primary}">
          <title>${esc(tooltip)}</title>
        </rect>
        <rect x="${(padding.left + oneManWidth).toFixed(2)}" y="${(baselineY - 8).toFixed(2)}" width="${twoManWidth.toFixed(2)}" height="14" fill="${PENALTY_COLORS.secondary}">
          <title>${esc(tooltip)}</title>
        </rect>
        <text x="${(width - padding.right + 12).toFixed(2)}" y="${(baselineY + 2).toFixed(2)}" font-size="12" fill="#22353c" font-family="LatoWebSemibold, LatoWeb, sans-serif">${esc(formatFixed(value, 2))}</text>
        <text x="${(width - padding.right + 12).toFixed(2)}" y="${(baselineY + 18).toFixed(2)}" font-size="10.5" fill="#677981">${Number(row.count || 0).toLocaleString()} pens</text>
      `;
    }).join('');

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = `
      ${legend}
      ${grid}
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#7f9198" stroke-width="1" />
      <line x1="${padding.left}" y1="${(height - padding.bottom).toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#7f9198" stroke-width="1" />
      ${bars}
      ${tickLabels}
      <text x="${(width / 2).toFixed(2)}" y="${(height - 12).toFixed(2)}" text-anchor="middle" font-size="11" fill="#5a6f77">Historical goals per strict 2:00 of power-play time</text>
    `;
  }

  function renderPenaltyTypeImpactLegend() {
    const legendEl = document.getElementById('penaltyTypeImpactLegend');
    if (!legendEl) return;
    legendEl.innerHTML = '';
  }

  function ensureAnalysisBlurb(gridEl, blurbId, text) {
    if (!gridEl) return;
    let blurbEl = document.getElementById(blurbId);
    if (!blurbEl) {
      blurbEl = document.createElement('div');
      blurbEl.id = blurbId;
      blurbEl.className = 'sf-analysis-copy';
      gridEl.parentNode?.insertBefore(blurbEl, gridEl);
    }
    blurbEl.innerHTML = `<p>${esc(text)}</p>`;
  }

  function renderPenaltyAdvantageChanceGrid(analysis) {
    const gridEl = document.getElementById('penaltyAdvantageChanceGrid');
    if (!gridEl) return;
    ensureAnalysisBlurb(gridEl, 'penaltyAdvantageChanceBlurb', 'Given a 2 minute continuous stretch of time with an advantage, what is the chance the team with the advantage scores? The following scores are an average of all the possible definitions of the end of a penalty:');
    const rows = Array.isArray(analysis?.advantage_scoring?.rows) ? analysis.advantage_scoring.rows : [];
    if (!rows.length) {
      gridEl.innerHTML = '<div class="sf-empty-state">No advantage-size scoring summary is available in this build.</div>';
      return;
    }
    const defaultKey = 'box_exit_plus5';
    const defaultMetric = PENALTY_END_RATE_KEYS[defaultKey];
    gridEl.innerHTML = rows.map((row) => `
      <article class="sf-analysis-impact-card">
        <div class="sf-analysis-impact-label">${esc(row.label || '')}</div>
        <div class="sf-analysis-impact-value">${esc(formatPct(row?.[PENALTY_END_RATE_KEYS[defaultKey].chance], 1))}</div>
        <div class="sf-analysis-impact-subvalue">Chance of at least 1 goal in a hypothetical 2:00 at the observed scoring rate</div>
        <div class="sf-analysis-impact-meter"><span class="sf-analysis-impact-meter-fill" style="width:${Math.max(0, Math.min(100, 100 * Number(row?.[defaultMetric.chance] || 0))).toFixed(1)}%; background:${PENALTY_COLORS.primary};"></span></div>
        <div class="sf-analysis-impact-statline"><span class="sf-analysis-impact-statlabel">Exact segments</span><strong class="sf-analysis-impact-statvalue">${Number(row.opportunities || 0).toLocaleString()}</strong></div>
        <div class="sf-analysis-impact-statline"><span class="sf-analysis-impact-statlabel">Exact advantage minutes</span><strong class="sf-analysis-impact-statvalue">${esc(formatFixed(row.pp_minutes, 1))}</strong></div>
        <div class="sf-analysis-impact-note">${esc(row.state_examples || '')}</div>
        <div class="sf-analysis-impact-note"><strong>Box Exit + 5s rate:</strong> ${esc(formatFixed(row?.[PENALTY_END_RATE_KEYS[defaultKey].rate], 3))} goals/min</div>
        ${Object.values(PENALTY_END_RATE_KEYS).map((metric) => (
      `<div class="sf-analysis-impact-note"><strong>${esc(metric.label)}:</strong> ${esc(formatPct(row?.[metric.chance], 1))} over 2:00 • ${esc(formatFixed(row?.[metric.rate], 3))} goals/min • ${Number(row?.[metric.goals] || 0).toLocaleString()} goals in ${esc(formatFixed(row?.[metric.minutes], 1))} min</div>`
    )).join('')}
      </article>
    `).join('');
  }

  function renderPenaltyStateShotGrid(analysis, sortBy = 'chance') {
    const gridEl = document.getElementById('penaltyStateShotGrid');
    if (!gridEl) return;
    ensureAnalysisBlurb(gridEl, 'penaltyStateShotBlurb', 'Using only the precise time for each game state over the course of 2 minutes, what is the chance of a team scoring? This includes the short-handed contrast states, 3v3, 4v4, and penalty shots when they occur; pulled-goalie states include empty-net goals.');
    const rows = Array.isArray(analysis?.state_shot_context?.rows) ? analysis.state_shot_context.rows : [];
    if (!rows.length) {
      gridEl.innerHTML = '<div class="sf-empty-state">No shot-state scoring context is available in this build.</div>';
      return;
    }
    const stateSort = PENALTY_STATE_SORT_LABELS[String(sortBy || 'chance')] ? String(sortBy) : 'chance';
    const sortedRows = [...rows].sort((a, b) => {
      const scoreA = stateSort === 'minutes'
        ? Number(a?.minutes || 0)
        : stateSort === 'goals'
          ? Number(a?.goals || 0)
          : Number(a?.two_minute_scoring_chance || 0);
      const scoreB = stateSort === 'minutes'
        ? Number(b?.minutes || 0)
        : stateSort === 'goals'
          ? Number(b?.goals || 0)
          : Number(b?.two_minute_scoring_chance || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return String(a?.state || '').localeCompare(String(b?.state || ''));
    });
    gridEl.innerHTML = sortedRows.map((row) => {
      const isPenaltyShot = Boolean(row?.is_penalty_shot);
      const isAdvantageState = Boolean(row?.is_penalty_advantage_context);
      const isDisadvantageState = Boolean(row?.is_penalty_disadvantage_context);
      const displayChance = Number(row?.two_minute_scoring_chance || 0);
      const meterColor = isDisadvantageState ? PENALTY_COLORS.negative : PENALTY_COLORS.primary;
      const cardClasses = ['sf-analysis-impact-card'];
      if (isAdvantageState) cardClasses.push('sf-analysis-impact-card--penalty-emphasis');
      const statLineTwo = isPenaltyShot
        ? `<div class="sf-analysis-impact-statline"><span class="sf-analysis-impact-statlabel">Attempts</span><strong class="sf-analysis-impact-statvalue">${Number(row.attempts || 0).toLocaleString()}</strong></div>`
        : `<div class="sf-analysis-impact-statline"><span class="sf-analysis-impact-statlabel">State minutes</span><strong class="sf-analysis-impact-statvalue">${esc(formatFixed(row.minutes, 1))}</strong></div>`;
      const noteLine = isPenaltyShot
        ? `<div class="sf-analysis-impact-note"><strong>Conversion:</strong> ${esc(formatPct(displayChance, 1))} on penalty-shot attempts</div>`
        : `<div class="sf-analysis-impact-note"><strong>Rate:</strong> ${esc(formatFixed(row.goals_per_minute, 3))} goals/min</div>`;
      return `
      <article class="${cardClasses.join(' ')}">
        <div class="sf-analysis-impact-label">${esc(row.state || '')}</div>
        <div class="sf-analysis-impact-value">${esc(formatPct(displayChance, 1))}</div>
        <div class="sf-analysis-impact-subvalue">${isPenaltyShot ? 'Scoring chance on a penalty-shot attempt' : 'Scoring chance over 2:00 at this game-state scoring rate'}</div>
        <div class="sf-analysis-impact-meter"><span class="sf-analysis-impact-meter-fill" style="width:${Math.max(0, Math.min(100, 100 * displayChance)).toFixed(1)}%; background:${meterColor};"></span></div>
        <div class="sf-analysis-impact-statline"><span class="sf-analysis-impact-statlabel">Goals</span><strong class="sf-analysis-impact-statvalue">${Number(row.goals || 0).toLocaleString()}</strong></div>
        ${statLineTwo}
        ${noteLine}
      </article>
    `;
    }).join('');
  }

  function renderPenaltyPlayerScatterChart(analysis, group, options = {}) {
    const svg = document.getElementById('penaltyPlayerScatterChart');
    if (!svg) return;
    const rows = Array.isArray(analysis?.player_scatter?.rows) ? analysis.player_scatter.rows : [];
    const playerQuery = normalizeText(options.playerQuery || '');
    const teamQuery = normalizeText(options.teamQuery || '');
    const filtered = rows.filter((row) => {
      if (group === 'ALL') return true;
      return String(row?.position_group || '') === group;
    });
    if (!filtered.length) {
      svg.innerHTML = '<text x="380" y="210" text-anchor="middle" font-size="16" fill="#6a7a70">No player penalty rows match the current filter.</text>';
      return;
    }

    const width = 760;
    const height = 420;
    const padding = { top: 26, right: 28, bottom: 56, left: 62 };
    const domainMax = Math.max(
      0.2,
      ...filtered.map((row) => Math.max(Number(row?.taken_per60 || 0), Number(row?.drawn_per60 || 0))),
    ) * 1.08;
    const xAt = (value) => padding.left + ((width - padding.left - padding.right) * Number(value || 0)) / domainMax;
    const yAt = (value) => (height - padding.bottom) - ((height - padding.top - padding.bottom) * Number(value || 0)) / domainMax;
    const ticks = axisTickValues([0, domainMax], 5);

    const grid = ticks.map((tick) => {
      const x = xAt(tick);
      const y = yAt(tick);
      return `
        <line x1="${padding.left}" y1="${y.toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#dce8ed" stroke-width="1" />
        <line x1="${x.toFixed(2)}" y1="${padding.top}" x2="${x.toFixed(2)}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#dce8ed" stroke-width="1" />
        <text x="${x.toFixed(2)}" y="${(height - padding.bottom + 18).toFixed(2)}" text-anchor="middle" font-size="11" fill="#597166">${esc(formatFixed(tick, 2))}</text>
        <text x="${(padding.left - 8).toFixed(2)}" y="${(y + 4).toFixed(2)}" text-anchor="end" font-size="11" fill="#597166">${esc(formatFixed(tick, 2))}</text>
      `;
    }).join('');

    const diagonal = `<line x1="${padding.left}" y1="${(height - padding.bottom).toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${padding.top}" stroke="#8fa1a9" stroke-width="1.4" stroke-dasharray="6 5" />`;
    const matchesLabelSearch = (row) => {
      const playerMatch = playerQuery && normalizeText(row?.player_name || '').includes(playerQuery);
      const teamMatch = teamQuery && normalizeText(row?.team || '').includes(teamQuery);
      return Boolean(playerMatch || teamMatch);
    };
    const points = filtered.map((row) => {
      const x = xAt(row.taken_per60);
      const y = yAt(row.drawn_per60);
      const isLabeled = matchesLabelSearch(row);
      const color = Number(row.net_per60 || 0) >= 0 ? PENALTY_COLORS.positive : PENALTY_COLORS.negative;
      const radius = isLabeled ? 5.4 : 3.2;
      const tooltip = `${row.player_name} (${row.team} ${row.position}) | Taken ${formatFixed(row.taken_per60, 2)}/60 | Drawn ${formatFixed(row.drawn_per60, 2)}/60 | Net ${formatSignedFixed(row.net_per60, 2)} | TOI ${formatFixed(row.toi_min, 0)} min`;
      return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius}" fill="${color}" fill-opacity="${isLabeled ? 0.95 : 0.72}" stroke="${isLabeled ? '#1c2b25' : 'none'}" stroke-width="1.2"><title>${esc(tooltip)}</title></circle>`;
    }).join('');

    const labels = filtered
      .filter((row) => matchesLabelSearch(row))
      .sort((a, b) => {
        const teamCmp = String(a?.team || '').localeCompare(String(b?.team || ''));
        if (teamCmp !== 0) return teamCmp;
        return String(a?.player_name || '').localeCompare(String(b?.player_name || ''));
      })
      .map((row, idx) => {
        const x = xAt(row.taken_per60);
        const y = yAt(row.drawn_per60);
        const direction = idx % 2 === 0 ? 1 : -1;
        const dx = direction > 0 ? 8 : -8;
        const dy = ((idx % 3) - 1) * 12 - 8;
        const anchor = direction > 0 ? 'start' : 'end';
        return `<text x="${(x + dx).toFixed(2)}" y="${(y + dy).toFixed(2)}" text-anchor="${anchor}" font-size="11" fill="#29453b">${esc(row.player_name)}</text>`;
      }).join('');

    svg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" rx="16" ry="16" fill="#fbfeff" stroke="#dbe7ed" />
      ${grid}
      ${diagonal}
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#6e8175" stroke-width="1.2" />
      <line x1="${padding.left}" y1="${(height - padding.bottom).toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#6e8175" stroke-width="1.2" />
      ${points}
      ${labels}
      <text x="${(width / 2).toFixed(2)}" y="${(height - 10).toFixed(2)}" text-anchor="middle" font-size="11" fill="#597166">Penalties taken per 60 minutes</text>
      <text x="18" y="${(height / 2).toFixed(2)}" transform="rotate(-90 18 ${height / 2})" text-anchor="middle" font-size="11" fill="#597166">Penalties drawn per 60 minutes</text>
      <text x="${(width - padding.right - 6).toFixed(2)}" y="${(padding.top + 12).toFixed(2)}" text-anchor="end" font-size="11" fill="#597166">Above the dashed line = net positive</text>
    `;
  }

  function renderPenaltyTeamChart(analysis) {
    const svg = document.getElementById('penaltyTeamChart');
    if (!svg) return;
    const rows = Array.isArray(analysis?.team_differential?.rows) ? analysis.team_differential.rows.slice(0, 32) : [];
    if (!rows.length) {
      svg.innerHTML = '<text x="380" y="210" text-anchor="middle" font-size="16" fill="#6a7a70">Team penalty differential data is not available in this build.</text>';
      return;
    }

    const width = 920;
    const rowHeight = 30;
    const rowGap = 6;
    const barRows = rows.slice().sort((a, b) => Number(b.minute_differential_per_game || 0) - Number(a.minute_differential_per_game || 0));
    const height = 116 + (barRows.length * (rowHeight + rowGap));
    const padding = { top: 58, right: 112, bottom: 46, left: 192 };
    const maxAbs = Math.max(0.2, ...barRows.map((row) => Math.abs(Number(row.minute_differential_per_game || 0)))) * 1.08;
    const centerX = width / 2;
    const scale = (width - padding.left - padding.right) / (maxAbs * 2);
    const ticks = axisTickValues([-maxAbs, maxAbs], 7);
    const grid = ticks.map((tick) => {
      const x = centerX + (tick * scale);
      return `<line x1="${x.toFixed(2)}" y1="${padding.top}" x2="${x.toFixed(2)}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#e4edf1" stroke-width="1" />`;
    }).join('');
    const tickLabels = ticks.map((tick) => {
      const x = centerX + (tick * scale);
      return `<text x="${x.toFixed(2)}" y="${(height - padding.bottom + 20).toFixed(2)}" text-anchor="middle" font-size="11" fill="#5a6f77">${esc(formatFixed(tick, 2))}</text>`;
    }).join('');
    const legendX = width - padding.right - 180;
    const legend = `
      <g>
        <rect x="${legendX}" y="18" width="18" height="8" fill="${PENALTY_COLORS.positive}" />
        <text x="${legendX + 24}" y="25" font-size="11" fill="#51656e">More awarded PP time earned</text>
        <rect x="${legendX}" y="34" width="18" height="8" fill="${PENALTY_COLORS.negative}" />
        <text x="${legendX + 24}" y="41" font-size="11" fill="#51656e">More awarded PP time surrendered</text>
      </g>
    `;

    const bars = barRows.map((row, idx) => {
      const y = padding.top + (idx * (rowHeight + rowGap));
      const value = Number(row.minute_differential_per_game || 0);
      const widthPx = Math.abs(value) * scale;
      const x = value >= 0 ? centerX : centerX - widthPx;
      const color = value >= 0 ? PENALTY_COLORS.positive : PENALTY_COLORS.negative;
      const ppPerGame = Number(row.power_play_minutes_per_game || 0);
      const pkPerGame = Number(row.short_handed_minutes_per_game || 0);
      const meta = `PP ${formatFixed(ppPerGame, 2)}m/G • PK ${formatFixed(pkPerGame, 2)}m/G`;
      return `
        <line x1="${padding.left}" y1="${(y + 20).toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${(y + 20).toFixed(2)}" stroke="#eff4f6" stroke-width="1" />
        <text x="${(padding.left - 16).toFixed(2)}" y="${(y + 2).toFixed(2)}" text-anchor="end" font-size="12" fill="#22353c" font-family="LatoWebSemibold, LatoWeb, sans-serif">${esc(row.team || '')}</text>
        <text x="${(padding.left - 16).toFixed(2)}" y="${(y + 16).toFixed(2)}" text-anchor="end" font-size="9.7" fill="#677981">${esc(meta)}</text>
        <rect x="${x.toFixed(2)}" y="${(y - 7).toFixed(2)}" width="${widthPx.toFixed(2)}" height="14" fill="${color}">
          <title>${esc(`${row.team}: ${formatSignedFixed(value, 2)} awarded PP minutes per game | awarded PP ${formatFixed(row.power_play_minutes_per_game, 2)} | awarded PK-against ${formatFixed(row.short_handed_minutes_per_game, 2)}`)}</title>
        </rect>
        <text x="${(width - padding.right + 12).toFixed(2)}" y="${(y + 2).toFixed(2)}" font-size="12" fill="#22353c" font-family="LatoWebSemibold, LatoWeb, sans-serif">${esc(formatSignedFixed(value, 2))}</text>
        <text x="${(width - padding.right + 12).toFixed(2)}" y="${(y + 16).toFixed(2)}" font-size="10.2" fill="#677981">${Number(row.games_played || 0).toLocaleString()} GP</text>
      `;
    }).join('');

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = `
      ${legend}
      ${grid}
      <line x1="${centerX.toFixed(2)}" y1="${padding.top}" x2="${centerX.toFixed(2)}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#7f9198" stroke-width="1.1" />
      ${bars}
      ${tickLabels}
      <text x="${(width / 2).toFixed(2)}" y="${(height - 10).toFixed(2)}" text-anchor="middle" font-size="11" fill="#5a6f77">Awarded power-play minutes earned minus surrendered per game</text>
    `;
  }

  function renderPenaltyOfficialsTable(analysis) {
    const tableWrap = document.getElementById('penaltyOfficialsTable');
    const copyEl = document.getElementById('penaltyOfficialsCopy');
    if (!tableWrap || !copyEl) return;
    const officials = analysis?.officials || {};
    const rows = Array.isArray(officials?.rows) ? officials.rows : [];
    const note = String(officials?.note || '').trim();
    copyEl.innerHTML = `<p>${esc(note || 'Officials are summarized at the game level because the public NHL feed does not identify which referee made each individual call.')}</p>`;
    if (!rows.length) {
      tableWrap.innerHTML = '<div class="sf-empty-state">No official-level penalty summary is available.</div>';
      return;
    }
    tableWrap.innerHTML = `
      <table class="sf-table">
        <thead>
          <tr>
            <th>Referee</th>
            <th>Games</th>
            <th>All Pens/G</th>
            <th>All Minors/G</th>
            <th>Non-Off Minors/G</th>
            <th>Fight Pens/G</th>
            <th>Away - Home Pens/G</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${esc(row.name || row.official_id || '')}</td>
              <td>${Number(row.games_worked || 0).toLocaleString()}</td>
              <td>${esc(formatFixed(row.penalties_per_game, 2))}</td>
              <td>${esc(formatFixed(row.minor_penalties_per_game, 2))}</td>
              <td>${esc(formatFixed(row.non_offsetting_minor_penalties_per_game, 2))}</td>
              <td>${esc(formatFixed(row.fighting_penalties_per_game, 2))}</td>
              <td class="${Number(row.away_minus_home_penalties_per_game || 0) >= 0 ? 'pos' : 'neg'}">${esc(formatSignedFixed(row.away_minus_home_penalties_per_game, 2))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function formatMetric(value, digits = 3) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'n/a';
    return num.toFixed(digits);
  }

  function formatSignedMetric(value, digits = 3) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'n/a';
    return `${num >= 0 ? '+' : ''}${num.toFixed(digits)}`;
  }

  function renderPowerplaySummaryCards(analysis) {
    const introEl = document.getElementById('ppDevIntro');
    const cardsEl = document.getElementById('ppDevSummaryCards');
    if (!introEl || !cardsEl) return;
    const summary = analysis?.summary || {};
    const topPlayers = Array.isArray(analysis?.top_players) ? analysis.top_players : [];
    if (!topPlayers.length) {
      const errorMessage = String(analysis?.error_message || '').trim();
      introEl.innerHTML = `<p>${esc(errorMessage || 'Power-play development data is not available in this build yet.')}</p>`;
      cardsEl.innerHTML = '<div class="sf-empty-state">No power-play development payload is available.</div>';
      return;
    }

    const qualifiedPlayers = Number(summary.qualified_players || 0);
    const threshold = Number(summary.current_pp_minute_threshold || 0);
    const topN = Number(summary.top_n || topPlayers.length || 0);
    const strongestTrait = String(summary.strongest_trait_label || '').trim();
    const strongestTraitCorr = Number(summary.strongest_trait_correlation);
    const currentVsCareerCorr = Number(summary.current_vs_career_minutes_correlation);
    const careerRateVsMinutesCorr = Number(summary.career_rate_vs_career_minutes_correlation);
    const currentSeasonLabel = String(summary.current_season_label || '').trim();
    const careerStart = String(summary.career_start_season_label || '').trim();
    const careerEnd = String(summary.career_end_season_label || '').trim();

    introEl.innerHTML = `
      <p>The current leaderboard takes the top ${topN.toLocaleString()} skaters in <strong>${esc(currentSeasonLabel || 'the current season')}</strong> by power-play points per 60 minutes, but only after filtering to a real PP-opportunity pool of <strong>${qualifiedPlayers.toLocaleString()}</strong> skaters with at least <strong>${esc(formatFixed(threshold, 1))}</strong> current-season PP minutes.</p>
      <p>This lets us compare true power-play finishers against their 5v5 profile, then trace those same players back through their careers to see how much of PP excellence looks like transferable skill versus a role that grows only after coaches keep feeding minutes. Career coverage in this local database currently runs from <strong>${esc(careerStart || 'the earliest loaded season')}</strong> through <strong>${esc(careerEnd || 'the latest loaded season')}</strong>.</p>
    `;
    cardsEl.innerHTML = `
      <article class="sf-analysis-impact-card">
        <div class="sf-analysis-impact-label">Current PP Ceiling</div>
        <div class="sf-analysis-impact-value">${esc(formatFixed(summary.top20_avg_current_pp_points_per60, 2))}</div>
        <div class="sf-analysis-impact-subvalue">Average PP points / 60 for the top ${topN.toLocaleString()} current-season PP scorers</div>
        <div class="sf-analysis-impact-note">Qualified-pool average: ${esc(formatFixed(summary.qualified_avg_current_pp_points_per60, 2))} P/60</div>
      </article>
      <article class="sf-analysis-impact-card">
        <div class="sf-analysis-impact-label">Opportunity Filter</div>
        <div class="sf-analysis-impact-value">${qualifiedPlayers.toLocaleString()}</div>
        <div class="sf-analysis-impact-subvalue">Qualified current-season skaters after applying the PP-minute floor</div>
        <div class="sf-analysis-impact-note">Threshold used this run: ${esc(formatFixed(threshold, 1))} PP minutes</div>
      </article>
      <article class="sf-analysis-impact-card">
        <div class="sf-analysis-impact-label">Strongest 5v5 Link</div>
        <div class="sf-analysis-impact-value">${esc(formatSignedMetric(strongestTraitCorr, 3))}</div>
        <div class="sf-analysis-impact-subvalue">${esc(strongestTrait || 'No stable 5v5 trait correlation')}</div>
        <div class="sf-analysis-impact-note">Correlation against current PP points / 60 in the qualified pool</div>
      </article>
      <article class="sf-analysis-impact-card">
        <div class="sf-analysis-impact-label">Minutes vs Skill</div>
        <div class="sf-analysis-impact-value">${esc(formatSignedMetric(currentVsCareerCorr, 3))}</div>
        <div class="sf-analysis-impact-subvalue">Correlation between career PP minutes and current PP points / 60</div>
        <div class="sf-analysis-impact-note">Career PP rate vs career minutes: ${esc(formatSignedMetric(careerRateVsMinutesCorr, 3))}</div>
      </article>
    `;
  }

  function renderPowerplayTopPlayersTable(analysis) {
    const tableWrap = document.getElementById('ppDevTopPlayersTable');
    if (!tableWrap) return;
    const rows = Array.isArray(analysis?.top_players) ? analysis.top_players : [];
    if (!rows.length) {
      tableWrap.innerHTML = '<div class="sf-empty-state">No current power-play leaderboard is available.</div>';
      return;
    }
    tableWrap.innerHTML = `
      <table class="sf-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>Team</th>
            <th>Pos</th>
            <th>PP P/60</th>
            <th>PP Pts</th>
            <th>PP Min</th>
            <th>5v5 P/60</th>
            <th>Offence</th>
            <th>Playmaking</th>
            <th>Chance Gen</th>
            <th>Finishing</th>
            <th>5v5 xG Diff/60</th>
            <th>Career PP P/60</th>
            <th>Career PP Min</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${Number(row.rank || 0).toLocaleString()}</td>
              <td>${esc(row.player_name || '')}</td>
              <td>${esc(row.team || '')}</td>
              <td>${esc(row.position || '')}</td>
              <td>${esc(formatMetric(row.current_pp_points_per60, 2))}</td>
              <td>${Number(row.current_pp_points || 0).toLocaleString()}</td>
              <td>${esc(formatFixed(row.current_pp_minutes, 1))}</td>
              <td>${esc(formatMetric(row.current_5v5_points_per60, 2))}</td>
              <td class="${classForSigned(row.offence_score)}">${esc(formatSignedMetric(row.offence_score, 3))}</td>
              <td class="${classForSigned(row.playmaking)}">${esc(formatSignedMetric(row.playmaking, 3))}</td>
              <td class="${classForSigned(row.chance_creation)}">${esc(formatSignedMetric(row.chance_creation, 3))}</td>
              <td class="${classForSigned(row.finishing)}">${esc(formatSignedMetric(row.finishing, 3))}</td>
              <td class="${classForSigned(row.on_ice_5v5_xg_diff_no_en_per60)}">${esc(formatSignedMetric(row.on_ice_5v5_xg_diff_no_en_per60, 3))}</td>
              <td>${esc(formatMetric(row.career_pp_points_per60, 2))}</td>
              <td>${esc(formatFixed(row.career_pp_minutes, 1))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderPowerplayTraitCorrelationGrid(analysis) {
    const gridEl = document.getElementById('ppDevTraitCorrelationGrid');
    if (!gridEl) return;
    const rows = Array.isArray(analysis?.trait_correlations) ? analysis.trait_correlations : [];
    if (!rows.length) {
      gridEl.innerHTML = '<div class="sf-empty-state">No stable 5v5-trait correlations were available for this build.</div>';
      return;
    }
    gridEl.innerHTML = rows.map((row) => `
      <article class="sf-analysis-impact-card">
        <div class="sf-analysis-impact-label">${esc(row.label || '')}</div>
        <div class="sf-analysis-impact-value">${esc(formatSignedMetric(row.correlation, 3))}</div>
        <div class="sf-analysis-impact-subvalue">Correlation with current PP points / 60</div>
        <div class="sf-analysis-impact-note">Top-${Math.min(20, Number(analysis?.summary?.top_n || 20)).toLocaleString()} mean: ${esc(formatSignedMetric(row.top20_mean, 3))}</div>
        <div class="sf-analysis-impact-note">Qualified-pool mean: ${esc(formatSignedMetric(row.qualified_mean, 3))}</div>
        <div class="sf-analysis-impact-note">Sample size: ${Number(row.sample_size || 0).toLocaleString()} skaters</div>
      </article>
    `).join('');
  }

  function buildScatterGridMarkup(width, height, padding, xTicks, yTicks, xAt, yAt) {
    const horizontal = yTicks.map((tick) => {
      const y = yAt(tick);
      return `<line x1="${padding.left}" y1="${y.toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#dce8ed" stroke-width="1" />`;
    }).join('');
    const vertical = xTicks.map((tick) => {
      const x = xAt(tick);
      return `<line x1="${x.toFixed(2)}" y1="${padding.top}" x2="${x.toFixed(2)}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#dce8ed" stroke-width="1" />`;
    }).join('');
    const xLabels = xTicks.map((tick) => {
      const x = xAt(tick);
      return `<text x="${x.toFixed(2)}" y="${(height - padding.bottom + 18).toFixed(2)}" text-anchor="middle" font-size="11" fill="#597166">${esc(formatFixed(tick, 2))}</text>`;
    }).join('');
    const yLabels = yTicks.map((tick) => {
      const y = yAt(tick);
      return `<text x="${(padding.left - 8).toFixed(2)}" y="${(y + 4).toFixed(2)}" text-anchor="end" font-size="11" fill="#597166">${esc(formatFixed(tick, 2))}</text>`;
    }).join('');
    return `${horizontal}${vertical}${xLabels}${yLabels}`;
  }

  function renderPowerplayTraitScatterChart(analysis, metricKey) {
    const svg = document.getElementById('ppDevTraitScatterChart');
    if (!svg) return;
    const traits = Array.isArray(analysis?.trait_correlations) ? analysis.trait_correlations : [];
    const trait = traits.find((row) => String(row.metric_key || '') === String(metricKey || '')) || traits[0] || null;
    const rows = (Array.isArray(analysis?.opportunity_scatter?.rows) ? analysis.opportunity_scatter.rows : [])
      .filter((row) => Number.isFinite(Number(row?.current_pp_points_per60)) && Number.isFinite(Number(row?.[String(trait?.metric_key || '')])));
    if (!trait || !rows.length) {
      svg.innerHTML = '<text x="380" y="210" text-anchor="middle" font-size="16" fill="#6a7a70">Not enough qualified players were available for the 5v5-trait scatter.</text>';
      return;
    }

    const width = 760;
    const height = 420;
    const padding = { top: 26, right: 26, bottom: 56, left: 64 };
    const xDomain = paddedDomain(rows.map((row) => Number(row?.[trait.metric_key] || 0)), -1, 1);
    const yDomain = paddedDomain(rows.map((row) => Number(row?.current_pp_points_per60 || 0)), 0, 10);
    const xAt = (value) => padding.left + ((width - padding.left - padding.right) * (Number(value || 0) - xDomain[0])) / (xDomain[1] - xDomain[0]);
    const yAt = (value) => (height - padding.bottom) - ((height - padding.top - padding.bottom) * (Number(value || 0) - yDomain[0])) / (yDomain[1] - yDomain[0]);
    const xTicks = axisTickValues(xDomain, 5);
    const yTicks = axisTickValues(yDomain, 5);
    const grid = buildScatterGridMarkup(width, height, padding, xTicks, yTicks, xAt, yAt);
    const points = rows.map((row) => {
      const isTop = Boolean(row?.is_top_twenty);
      const x = xAt(row[trait.metric_key]);
      const y = yAt(row.current_pp_points_per60);
      const color = isTop ? POWERPLAY_COLORS.top : POWERPLAY_COLORS.qualified;
      const radius = isTop ? 5.1 : 3.4;
      const tooltip = `${row.player_name} (${row.team} ${row.position}) | ${trait.label}: ${formatSignedMetric(row[trait.metric_key], 3)} | Current PP P/60: ${formatMetric(row.current_pp_points_per60, 2)} | Current PP min: ${formatFixed(row.current_pp_minutes, 1)}`;
      return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius}" fill="${color}" fill-opacity="${isTop ? 0.92 : 0.72}" stroke="${isTop ? '#163744' : 'none'}" stroke-width="1.1"><title>${esc(tooltip)}</title></circle>`;
    }).join('');
    const labels = rows
      .filter((row) => Boolean(row?.is_top_twenty))
      .sort((a, b) => Number(b?.current_pp_points_per60 || 0) - Number(a?.current_pp_points_per60 || 0))
      .map((row, idx) => {
        const x = xAt(row[trait.metric_key]);
        const y = yAt(row.current_pp_points_per60);
        const dx = idx % 2 === 0 ? 8 : -8;
        const dy = ((idx % 4) - 1.5) * 11;
        const anchor = dx > 0 ? 'start' : 'end';
        return `<text x="${(x + dx).toFixed(2)}" y="${(y + dy).toFixed(2)}" text-anchor="${anchor}" font-size="10.5" fill="#25444f">${esc(row.player_name)}</text>`;
      }).join('');

    svg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" rx="16" ry="16" fill="#fbfeff" stroke="#dbe7ed" />
      ${grid}
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#6e8175" stroke-width="1.2" />
      <line x1="${padding.left}" y1="${(height - padding.bottom).toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#6e8175" stroke-width="1.2" />
      ${points}
      ${labels}
      <text x="${(width - padding.right - 4).toFixed(2)}" y="${(padding.top + 14).toFixed(2)}" text-anchor="end" font-size="11" fill="#597166">Top-20 current PP players are highlighted</text>
      <text x="${(width / 2).toFixed(2)}" y="${(height - 10).toFixed(2)}" text-anchor="middle" font-size="11" fill="#597166">${esc(trait.label || '5v5 trait')}</text>
      <text x="18" y="${(height / 2).toFixed(2)}" transform="rotate(-90 18 ${height / 2})" text-anchor="middle" font-size="11" fill="#597166">Current PP points per 60</text>
    `;
  }

  function renderPowerplayOpportunityChart(analysis) {
    const svg = document.getElementById('ppDevOpportunityChart');
    if (!svg) return;
    const summary = analysis?.summary || {};
    const rows = (Array.isArray(analysis?.opportunity_scatter?.rows) ? analysis.opportunity_scatter.rows : [])
      .filter((row) => Number.isFinite(Number(row?.career_pp_minutes)) && Number.isFinite(Number(row?.current_pp_points_per60)));
    if (!rows.length) {
      svg.innerHTML = '<text x="380" y="210" text-anchor="middle" font-size="16" fill="#6a7a70">No career-opportunity scatter is available in this build.</text>';
      return;
    }

    const width = 760;
    const height = 420;
    const padding = { top: 26, right: 26, bottom: 56, left: 64 };
    const xDomain = paddedDomain(rows.map((row) => Number(row.career_pp_minutes || 0)), 0, 100);
    const yDomain = paddedDomain(rows.map((row) => Number(row.current_pp_points_per60 || 0)), 0, 10);
    const xAt = (value) => padding.left + ((width - padding.left - padding.right) * (Number(value || 0) - xDomain[0])) / (xDomain[1] - xDomain[0]);
    const yAt = (value) => (height - padding.bottom) - ((height - padding.top - padding.bottom) * (Number(value || 0) - yDomain[0])) / (yDomain[1] - yDomain[0]);
    const xTicks = axisTickValues(xDomain, 5);
    const yTicks = axisTickValues(yDomain, 5);
    const grid = buildScatterGridMarkup(width, height, padding, xTicks, yTicks, xAt, yAt);
    const points = rows.map((row) => {
      const isTop = Boolean(row?.is_top_twenty);
      const x = xAt(row.career_pp_minutes);
      const y = yAt(row.current_pp_points_per60);
      const color = isTop ? POWERPLAY_COLORS.accent : POWERPLAY_COLORS.qualified;
      const radius = isTop ? 5.2 : 3.3;
      const tooltip = `${row.player_name} (${row.team} ${row.position}) | Career PP min: ${formatFixed(row.career_pp_minutes, 1)} | Career PP P/60: ${formatMetric(row.career_pp_points_per60, 2)} | Current PP P/60: ${formatMetric(row.current_pp_points_per60, 2)}`;
      return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius}" fill="${color}" fill-opacity="${isTop ? 0.92 : 0.68}" stroke="${isTop ? '#6b3a0f' : 'none'}" stroke-width="1.1"><title>${esc(tooltip)}</title></circle>`;
    }).join('');
    const labels = rows
      .filter((row) => Boolean(row?.is_top_twenty))
      .sort((a, b) => Number(b?.current_pp_points_per60 || 0) - Number(a?.current_pp_points_per60 || 0))
      .map((row, idx) => {
        const x = xAt(row.career_pp_minutes);
        const y = yAt(row.current_pp_points_per60);
        const dx = idx % 2 === 0 ? 8 : -8;
        const dy = ((idx % 4) - 1.5) * 11;
        const anchor = dx > 0 ? 'start' : 'end';
        return `<text x="${(x + dx).toFixed(2)}" y="${(y + dy).toFixed(2)}" text-anchor="${anchor}" font-size="10.5" fill="#5a3b18">${esc(row.player_name)}</text>`;
      }).join('');

    svg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" rx="16" ry="16" fill="#fbfeff" stroke="#dbe7ed" />
      ${grid}
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#6e8175" stroke-width="1.2" />
      <line x1="${padding.left}" y1="${(height - padding.bottom).toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#6e8175" stroke-width="1.2" />
      ${points}
      ${labels}
      <text x="${(width - padding.right - 4).toFixed(2)}" y="${(padding.top + 14).toFixed(2)}" text-anchor="end" font-size="11" fill="#597166">Corr(current PP skill, career PP minutes) = ${esc(formatSignedMetric(summary.current_vs_career_minutes_correlation, 3))}</text>
      <text x="${(width / 2).toFixed(2)}" y="${(height - 10).toFixed(2)}" text-anchor="middle" font-size="11" fill="#597166">Career regular-season PP minutes</text>
      <text x="18" y="${(height / 2).toFixed(2)}" transform="rotate(-90 18 ${height / 2})" text-anchor="middle" font-size="11" fill="#597166">Current-season PP points per 60</text>
    `;
  }

  function renderPowerplayCareerChart(analysis, requestedPlayerId = '') {
    const select = document.getElementById('ppDevCareerPlayerSelect');
    const svg = document.getElementById('ppDevCareerChart');
    if (!select || !svg) return;
    const rows = Array.isArray(analysis?.career_progressions) ? analysis.career_progressions : [];
    if (!rows.length) {
      select.innerHTML = '<option value="">No player data</option>';
      svg.innerHTML = '<text x="380" y="210" text-anchor="middle" font-size="16" fill="#6a7a70">No career PP progression data is available in this build.</text>';
      return;
    }

    const optionsHtml = rows.map((row) => (
      `<option value="${esc(String(row.player_id || ''))}">${esc(`${row.player_name || 'Unknown'} (${row.team || ''})`)}</option>`
    )).join('');
    if (select.innerHTML !== optionsHtml) {
      select.innerHTML = optionsHtml;
    }
    const preferred = String(requestedPlayerId || select.value || rows[0]?.player_id || '').trim();
    const selected = rows.find((row) => String(row.player_id || '') === preferred) || rows[0];
    if (!selected) return;
    select.value = String(selected.player_id || '');

    const samples = Array.isArray(selected?.samples) ? selected.samples : [];
    const validSamples = samples.filter((row) => Number.isFinite(Number(row?.career_pp_minutes)) && Number.isFinite(Number(row?.career_pp_points_per60)));
    if (!validSamples.length) {
      svg.innerHTML = '<text x="380" y="210" text-anchor="middle" font-size="16" fill="#6a7a70">Selected player does not have enough PP sample data for a career curve.</text>';
      return;
    }

    const width = 760;
    const height = 420;
    const padding = { top: 28, right: 26, bottom: 56, left: 64 };
    const xDomain = paddedDomain(validSamples.map((row) => Number(row.career_pp_minutes || 0)), 0, 100);
    const yDomain = paddedDomain(validSamples.map((row) => Number(row.career_pp_points_per60 || 0)), 0, 10);
    const xAt = (value) => padding.left + ((width - padding.left - padding.right) * (Number(value || 0) - xDomain[0])) / (xDomain[1] - xDomain[0]);
    const yAt = (value) => (height - padding.bottom) - ((height - padding.top - padding.bottom) * (Number(value || 0) - yDomain[0])) / (yDomain[1] - yDomain[0]);
    const xTicks = axisTickValues(xDomain, 5);
    const yTicks = axisTickValues(yDomain, 5);
    const grid = buildScatterGridMarkup(width, height, padding, xTicks, yTicks, xAt, yAt);
    const path = validSamples.map((row, idx) => `${idx === 0 ? 'M' : 'L'} ${xAt(row.career_pp_minutes).toFixed(2)} ${yAt(row.career_pp_points_per60).toFixed(2)}`).join(' ');
    const circles = validSamples.map((row, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === validSamples.length - 1;
      const radius = isFirst || isLast ? 4.8 : 3.0;
      const fill = isFirst ? POWERPLAY_COLORS.accent : isLast ? POWERPLAY_COLORS.top : POWERPLAY_COLORS.line;
      const tooltip = `${selected.player_name} | ${row.season || ''} ${row.game_date || ''} | Career PP min: ${formatFixed(row.career_pp_minutes, 1)} | Career PP points: ${Number(row.career_pp_points || 0).toLocaleString()} | Career PP P/60: ${formatMetric(row.career_pp_points_per60, 2)}`;
      return `<circle cx="${xAt(row.career_pp_minutes).toFixed(2)}" cy="${yAt(row.career_pp_points_per60).toFixed(2)}" r="${radius}" fill="${fill}" stroke="#ffffff" stroke-width="1.1"><title>${esc(tooltip)}</title></circle>`;
    }).join('');
    const early = validSamples[0];
    const latest = validSamples[validSamples.length - 1];

    svg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" rx="16" ry="16" fill="#fbfeff" stroke="#dbe7ed" />
      ${grid}
      <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#6e8175" stroke-width="1.2" />
      <line x1="${padding.left}" y1="${(height - padding.bottom).toFixed(2)}" x2="${(width - padding.right).toFixed(2)}" y2="${(height - padding.bottom).toFixed(2)}" stroke="#6e8175" stroke-width="1.2" />
      <path d="${path}" fill="none" stroke="${POWERPLAY_COLORS.line}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
      ${circles}
      <text x="${(width - padding.right - 4).toFixed(2)}" y="${(padding.top + 12).toFixed(2)}" text-anchor="end" font-size="11" fill="#597166">Early sample: ${esc(formatFixed(selected.early_sample_minutes, 1))} min at ${esc(formatMetric(selected.early_sample_pp_points_per60, 2))} P/60</text>
      <text x="${(width - padding.right - 4).toFixed(2)}" y="${(padding.top + 28).toFixed(2)}" text-anchor="end" font-size="11" fill="#597166">Career now: ${esc(formatFixed(selected.career_pp_minutes, 1))} min at ${esc(formatMetric(selected.career_pp_points_per60, 2))} P/60</text>
      <text x="${(xAt(early.career_pp_minutes) + 8).toFixed(2)}" y="${(yAt(early.career_pp_points_per60) - 10).toFixed(2)}" font-size="10.5" fill="#6b3a0f">Early</text>
      <text x="${(xAt(latest.career_pp_minutes) + 8).toFixed(2)}" y="${(yAt(latest.career_pp_points_per60) - 10).toFixed(2)}" font-size="10.5" fill="#163744">Current career level</text>
      <text x="${(width / 2).toFixed(2)}" y="${(height - 10).toFixed(2)}" text-anchor="middle" font-size="11" fill="#597166">Career PP minutes accumulated</text>
      <text x="18" y="${(height / 2).toFixed(2)}" transform="rotate(-90 18 ${height / 2})" text-anchor="middle" font-size="11" fill="#597166">Career PP points per 60</text>
    `;
  }

  function renderPowerplayDevelopmentTable(analysis) {
    const tableWrap = document.getElementById('ppDevDevelopmentTable');
    const notesEl = document.getElementById('ppDevNotes');
    if (!tableWrap || !notesEl) return;
    const rows = Array.isArray(analysis?.development_rows) ? analysis.development_rows : [];
    const notes = Array.isArray(analysis?.notes) ? analysis.notes : [];
    if (!rows.length) {
      tableWrap.innerHTML = '<div class="sf-empty-state">No PP development summary rows are available.</div>';
      notesEl.innerHTML = notes.map((note) => `<li>${esc(note)}</li>`).join('');
      return;
    }
    tableWrap.innerHTML = `
      <table class="sf-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Team</th>
            <th>Early PP Min</th>
            <th>Early PP P/60</th>
            <th>Career PP P/60</th>
            <th>Delta</th>
            <th>Current PP P/60</th>
            <th>Career PP Min</th>
            <th>Career PP Pts</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${esc(row.player_name || '')}</td>
              <td>${esc(row.team || '')}</td>
              <td>${esc(formatFixed(row.early_sample_minutes, 1))}</td>
              <td>${esc(formatMetric(row.early_sample_pp_points_per60, 2))}</td>
              <td>${esc(formatMetric(row.career_pp_points_per60, 2))}</td>
              <td class="${classForSigned(row.development_delta_per60)}">${esc(formatSignedMetric(row.development_delta_per60, 3))}</td>
              <td>${esc(formatMetric(row.current_pp_points_per60, 2))}</td>
              <td>${esc(formatFixed(row.career_pp_minutes, 1))}</td>
              <td>${Number(row.career_pp_points || 0).toLocaleString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    notesEl.innerHTML = notes.map((note) => `<li>${esc(note)}</li>`).join('');
  }

  function renderPowerplaySection() {
    const analysis = state.analysisPayload?.powerplay_development_analysis || {};
    const traitSelect = document.getElementById('ppDevTraitSelect');
    const careerSelect = document.getElementById('ppDevCareerPlayerSelect');
    const traitRows = Array.isArray(analysis?.trait_correlations) ? analysis.trait_correlations : [];
    const progressionRows = Array.isArray(analysis?.career_progressions) ? analysis.career_progressions : [];

    renderPowerplaySummaryCards(analysis);
    renderPowerplayTopPlayersTable(analysis);
    renderPowerplayTraitCorrelationGrid(analysis);
    renderPowerplayDevelopmentTable(analysis);

    if (traitSelect) {
      traitSelect.innerHTML = traitRows.length
        ? traitRows.map((row) => `<option value="${esc(String(row.metric_key || ''))}">${esc(row.label || row.metric_key || '')}</option>`).join('')
        : '<option value="">No trait data</option>';
      if (!traitSelect.dataset.bound) {
        traitSelect.addEventListener('change', () => {
          renderPowerplayTraitScatterChart(
            analysis,
            String(traitSelect.value || ''),
          );
        });
        traitSelect.dataset.bound = '1';
      }
      if (traitRows.length) {
        traitSelect.value = String(traitRows[0]?.metric_key || '');
      }
    }

    if (careerSelect && !careerSelect.dataset.bound) {
      careerSelect.addEventListener('change', () => {
        renderPowerplayCareerChart(
          analysis,
          String(careerSelect.value || ''),
        );
      });
      careerSelect.dataset.bound = '1';
    }

    renderPowerplayTraitScatterChart(
      analysis,
      String(traitSelect?.value || traitRows[0]?.metric_key || ''),
    );
    renderPowerplayOpportunityChart(analysis);
    renderPowerplayCareerChart(
      analysis,
      String(careerSelect?.value || progressionRows[0]?.player_id || ''),
    );
  }

  function renderPenaltySection() {
    const introEl = document.getElementById('penaltyIntro');
    const cardsEl = document.getElementById('penaltyImpactCards');
    const notesEl = document.getElementById('penaltyNotes');
    const metricSelect = document.getElementById('penaltyTypeMetricSelect');
    const stateSortSelect = document.getElementById('penaltyStateSortSelect');
    const groupSelect = document.getElementById('penaltyPlayerGroupSelect');
    const playerSearchInput = document.getElementById('penaltyPlayerSearch');
    const teamSearchInput = document.getElementById('penaltyPlayerTeamSearch');
    const analysis = state.analysisPayload?.penalty_analysis || {};
    const summary = analysis?.summary || {};
    const impactCards = Array.isArray(analysis?.impact_cards) ? analysis.impact_cards : [];
    const notes = Array.isArray(analysis?.notes) ? analysis.notes : [];

    if (!impactCards.length) {
      const errorMessage = String(analysis?.error_message || '').trim();
      if (introEl) introEl.innerHTML = `<p>${esc(errorMessage || 'Penalty analysis is not available in this build yet.')}</p>`;
      if (cardsEl) cardsEl.innerHTML = '<div class="sf-empty-state">No penalty-analysis payload is available.</div>';
      if (notesEl) notesEl.innerHTML = '';
      renderPenaltyAdvantageChanceGrid(analysis);
      renderPenaltyStateShotGrid(analysis, String(stateSortSelect?.value || 'chance'));
      renderPenaltyTypeImpactChart(analysis, 'goal_end_goals_per_two_minutes');
      renderPenaltyTypeImpactLegend();
      renderPenaltyPlayerScatterChart(analysis, 'F', {
        playerQuery: String(playerSearchInput?.value || ''),
        teamQuery: String(teamSearchInput?.value || ''),
      });
      renderPenaltyTeamChart(analysis);
      renderPenaltyOfficialsTable(analysis);
      return;
    }

    const games = Number(summary?.games || 0);
    const advantagePenalties = Number(summary?.advantage_penalties || 0);
    const goalEndCard = impactCards.find((card) => String(card?.key || '') === 'goal_end') || {};
    const changeEndCard = impactCards.find((card) => String(card?.key || '') === 'change_end') || {};
    const goalEndGoals = Number(goalEndCard?.goals ?? summary?.official_pp_goals ?? 0);
    const goalEndGoalShare = Number(goalEndCard?.share ?? summary?.official_pp_goal_share ?? 0);
    const goalEndMinutes = Number(goalEndCard?.minutes || 0);
    const goalEndTimeShare = Number(goalEndCard?.time_share || 0);
    const changeEndGoals = Number(changeEndCard?.goals || 0);
    const changeEndGoalShare = Number(changeEndCard?.share || 0);
    const changeEndTimeShare = Number(changeEndCard?.time_share || 0);
    const averageTeamPpTimeShare = goalEndTimeShare / 2;
    const averageTeamPkTimeShare = goalEndTimeShare / 2;

    if (introEl) {
      introEl.innerHTML = `
        <p>In the <strong>${games.toLocaleString()} games in the current season</strong> there have been <strong>${advantagePenalties.toLocaleString()} penalties</strong> that created a man-advantage opportunity, leading to <strong>${goalEndGoals.toLocaleString()} goals</strong>. In total there have been <strong>${esc(formatFixed(goalEndMinutes, 1))} minutes</strong> on the power play corresponding to <strong>${esc(formatPct(goalEndTimeShare, 1))}</strong> of total game time in the season. This means that <strong>${esc(formatPct(goalEndGoalShare, 1))}</strong> of all the goals in the season come from <strong>${esc(formatPct(goalEndTimeShare, 1))}</strong> of the game time.</p>
        <p>For individual teams this corresponds to an average of <strong>${esc(formatPct(goalEndGoalShare, 1))}</strong> of goals for in <strong>${esc(formatPct(averageTeamPpTimeShare, 1))}</strong> of game time on the power play and <strong>${esc(formatPct(goalEndGoalShare, 1))}</strong> of goals against in <strong>${esc(formatPct(averageTeamPkTimeShare, 1))}</strong> of game time on the penalty kill.</p>
        <p>When you look deeper into the penalty to consider when the actual advantage of the power play might end these numbers can be slightly different. For example, if we consider the advantage to continue until both of the defencemen on the ice for the penalty kill have the opportunity to change, we get <strong>${changeEndGoals.toLocaleString()} goals</strong>, or <strong>${esc(formatPct(changeEndGoalShare, 1))}</strong> of all goals, from <strong>${esc(formatPct(changeEndTimeShare, 1))}</strong> of the total game time.</p>
        <p>Overall roughly 1/5 of all goals this season are happening due to power-play advantages. The state context cards below break that scoring out across 5v3, 5v4, 4v3, 4v4, 3v3, 5v5, 4v5, 4v6, 5v6, 6v4, 6v5, and penalty shots when they occur.</p>
      `;
    }

    if (cardsEl) {
      cardsEl.innerHTML = `
        ${impactCards.map((card) => `
        <article class="sf-analysis-impact-card">
          <div class="sf-analysis-impact-label">${esc(card.label || '')}</div>
          <div class="sf-analysis-impact-value">${esc(formatPct(card.share, 1))}</div>
          <div class="sf-analysis-impact-subvalue">${Number(card.goals || 0).toLocaleString()} of ${Number(card.total_goals || 0).toLocaleString()} goals</div>
          <div class="sf-analysis-impact-note"><strong>Time covered:</strong> ${esc(formatFixed(card.minutes, 1))} min • ${esc(formatPct(card.time_share, 1))} of total game time</div>
          ${card.leverage_share == null || Number(card.total_leverage || 0) <= 0
          ? '<div class="sf-analysis-impact-note"><strong>Leverage-weighted share:</strong> unavailable in this database build</div>'
          : `<div class="sf-analysis-impact-note"><strong>Leverage-weighted share:</strong> ${esc(formatPct(card.leverage_share, 1))}</div>
               <div class="sf-analysis-impact-note"><strong>Counted leverage:</strong> ${esc(formatFixed(card.leverage, 3))} of ${esc(formatFixed(card.total_leverage, 3))} total${Number(card.goals || 0) > 0 && card.avg_leverage_per_goal != null ? ` • avg ${esc(formatFixed(card.avg_leverage_per_goal, 3))} per goal` : ''}</div>`
        }
          <div class="sf-analysis-impact-note">${esc(card.description || '')}</div>
        </article>
      `).join('')}
      `;
    }

    if (metricSelect && !metricSelect.dataset.bound) {
      metricSelect.innerHTML = Object.entries(PENALTY_TYPE_METRICS).map(([value, label]) => (
        `<option value="${esc(value)}">${esc(label)}</option>`
      )).join('');
      metricSelect.addEventListener('change', () => {
        renderPenaltyTypeImpactChart(analysis, 'goal_end_goals_per_two_minutes');
      });
      metricSelect.dataset.bound = '1';
    }
    if (metricSelect) {
      metricSelect.value = 'goal_end_goals_per_two_minutes';
    }

    if (groupSelect && !groupSelect.dataset.bound) {
      groupSelect.addEventListener('change', () => {
        renderPenaltyPlayerScatterChart(analysis, String(groupSelect.value || 'F'), {
          playerQuery: String(playerSearchInput?.value || ''),
          teamQuery: String(teamSearchInput?.value || ''),
        });
      });
      groupSelect.dataset.bound = '1';
    }
    if (groupSelect) {
      groupSelect.value = String(analysis?.player_scatter?.default_group || 'F');
    }

    if (stateSortSelect && !stateSortSelect.dataset.bound) {
      stateSortSelect.addEventListener('change', () => {
        renderPenaltyStateShotGrid(analysis, String(stateSortSelect.value || 'chance'));
      });
      stateSortSelect.dataset.bound = '1';
    }
    if (stateSortSelect) {
      stateSortSelect.value = 'chance';
    }

    const rerenderPenaltyScatter = () => {
      renderPenaltyPlayerScatterChart(
        analysis,
        String(groupSelect?.value || analysis?.player_scatter?.default_group || 'F'),
        {
          playerQuery: String(playerSearchInput?.value || ''),
          teamQuery: String(teamSearchInput?.value || ''),
        },
      );
    };

    if (playerSearchInput && !playerSearchInput.dataset.bound) {
      playerSearchInput.addEventListener('input', rerenderPenaltyScatter);
      playerSearchInput.dataset.bound = '1';
    }

    if (teamSearchInput && !teamSearchInput.dataset.bound) {
      teamSearchInput.addEventListener('input', rerenderPenaltyScatter);
      teamSearchInput.dataset.bound = '1';
    }

    if (notesEl) {
      notesEl.innerHTML = notes.map((note) => `<li>${esc(note)}</li>`).join('');
    }

    renderPenaltyAdvantageChanceGrid(analysis);
    renderPenaltyStateShotGrid(analysis, String(stateSortSelect?.value || 'chance'));
    renderPenaltyTypeImpactChart(
      analysis,
      'goal_end_goals_per_two_minutes',
    );
    renderPenaltyTypeImpactLegend();
    rerenderPenaltyScatter();
    renderPenaltyTeamChart(analysis);
    renderPenaltyOfficialsTable(analysis);
  }

  async function init() {
    state.suppressUrlSync = true;
    state.initialUrlState = readShareStateFromUrl();
    setupSectionNavigation(state.initialUrlState.section);
    const payload = readInlineAnalysisPayload() || await fetchJson('data/analysis.json');
    state.analysisPayload = payload || {};
    state.teams = Array.isArray(payload?.teams) ? payload.teams : [];
    state.baseRinkMarkup = document.getElementById('xgRink')?.innerHTML || '';

    const teamNames = Array.from(new Set(state.teams.map((row) => String(row?.team || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    populateTeamCompareSelect(document.getElementById('compareTeamA'), teamNames, 'Compare team A', state.initialUrlState.compareA || '');
    populateTeamCompareSelect(document.getElementById('compareTeamB'), teamNames, 'Compare team B', state.initialUrlState.compareB || '');
    setControlValue(document.getElementById('teamSearch'), state.initialUrlState.lineTeam);
    setSelectValueIfPresent(document.getElementById('compareTeamA'), state.initialUrlState.compareA);
    setSelectValueIfPresent(document.getElementById('compareTeamB'), state.initialUrlState.compareB);

    if (payload?.use_legacy_lineup_cards && payload?.legacy_lineup_cards_html) {
      const teamGrid = document.getElementById('teamGrid');
      if (teamGrid) teamGrid.innerHTML = String(payload.legacy_lineup_cards_html);
    } else {
      refreshTeamCards();
      document.getElementById('teamSearch')?.addEventListener('input', refreshTeamCards);
      document.getElementById('compareTeamA')?.addEventListener('change', refreshTeamCards);
      document.getElementById('compareTeamB')?.addEventListener('change', refreshTeamCards);
    }

    renderPowerplaySection();
    renderPenaltySection();
    initializeXgPanel();
    state.suppressUrlSync = false;
    syncUrlState();
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error(error);
      const teamGrid = document.getElementById('teamGrid');
      if (teamGrid) teamGrid.innerHTML = `<div class="sf-empty-state">${esc(error.message)}</div>`;
      const svg = document.getElementById('xgRink');
      if (svg) svg.innerHTML = `${state.baseRinkMarkup}<text x="0" y="0" text-anchor="middle" font-size="4.5" fill="#b13a30">${esc(error.message)}</text>`;
      const penaltySvg = document.getElementById('penaltyTypeImpactChart');
      if (penaltySvg) penaltySvg.innerHTML = `<text x="380" y="180" text-anchor="middle" font-size="16" fill="#b13a30">${esc(error.message)}</text>`;
      const ppTraitSvg = document.getElementById('ppDevTraitScatterChart');
      if (ppTraitSvg) ppTraitSvg.innerHTML = `<text x="380" y="210" text-anchor="middle" font-size="16" fill="#b13a30">${esc(error.message)}</text>`;
      const ppCareerSvg = document.getElementById('ppDevCareerChart');
      if (ppCareerSvg) ppCareerSvg.innerHTML = `<text x="380" y="210" text-anchor="middle" font-size="16" fill="#b13a30">${esc(error.message)}</text>`;
    });
  });
})();
