(() => {
  const {
    esc,
    signed,
    classForSigned,
    fetchJson,
    normalizeText,
  } = window.NetOutcomesCommon;

  const DEFAULT_SECTION_ID = 'overviewPanel';
  const VALID_SECTION_IDS = ['overviewPanel', 'teamPanel', 'xgPanel'];
  const SECTION_SLUG_BY_ID = {
    overviewPanel: 'overview',
    teamPanel: 'line-analysis',
    xgPanel: 'team-xg',
  };
  const DEFAULT_XG_MIN_PROB = 0.015;

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

  async function init() {
    const payload = await fetchJson('data/analysis.json');
    state.suppressUrlSync = true;
    state.initialUrlState = readShareStateFromUrl();
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

    initializeXgPanel();
    setupSectionNavigation(state.initialUrlState.section);
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
    });
  });
})();
