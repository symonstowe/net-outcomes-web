(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mod;
  } else {
    root.NetOutcomesFantasyDraft = mod;
  }
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // Starting points only. Every one of these is overridable per league, which
  // is the whole point of the tool: the weights are the USER's, not ours.
  // A weight of zero here means "not scored by default", never "not supported".
  //
  // Every category the board publishes must appear, or a league that scores it
  // is silently told the category does not exist. Faceoff wins were missing
  // until this was written, so a faceoff league was ranking on six of its seven
  // categories with no indication anything had been dropped.
  const DEFAULT_WEIGHTS = Object.freeze({
    goals: 3,
    assists: 2,
    shots: 0.25,
    powerplayPoints: 0.5,
    hits: 0.2,
    blocks: 0.3,
    pim: 0,
    faceoffWins: 0,
    wins: 4,
    saves: 0.2,
    shutouts: 3,
    goalsAgainst: -2,
    goalieStarts: 0,
  });

  const DEFAULT_ROSTER = Object.freeze({
    teams: 12,
    forwards: 9,
    defenders: 4,
    goalies: 2,
  });

  function finite(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function positionGroup(position) {
    const normalized = String(position || '').trim().toUpperCase();
    if (normalized === 'G') return 'G';
    if (normalized === 'D' || normalized === 'LD' || normalized === 'RD') return 'D';
    return 'F';
  }

  function skaterScore(row, weights) {
    return finite(row.fantasy_goals) * finite(weights.goals)
      + finite(row.fantasy_assists) * finite(weights.assists)
      + finite(row.fantasy_shots) * finite(weights.shots)
      + finite(row.fantasy_powerplay_points) * finite(weights.powerplayPoints)
      + finite(row.fantasy_hits) * finite(weights.hits)
      + finite(row.fantasy_blocks) * finite(weights.blocks)
      + finite(row.fantasy_pim) * finite(weights.pim)
      + finite(row.fantasy_faceoff_wins) * finite(weights.faceoffWins);
  }

  function goalieScore(row, weights) {
    return finite(row.fantasy_wins) * finite(weights.wins)
      + finite(row.fantasy_saves) * finite(weights.saves)
      + finite(row.fantasy_shutouts) * finite(weights.shutouts)
      + finite(row.fantasy_goals_against) * finite(weights.goalsAgainst)
      + finite(row.fantasy_starts) * finite(weights.goalieStarts);
  }

  function replacementCount(group, roster) {
    const leagueTeams = Math.max(1, Math.round(finite(roster.teams, DEFAULT_ROSTER.teams)));
    const slots = group === 'G'
      ? roster.goalies
      : (group === 'D' ? roster.defenders : roster.forwards);
    return leagueTeams * Math.max(1, Math.round(finite(slots, 1)));
  }

  function replacementScore(rows, group, roster) {
    const groupRows = rows
      .filter((row) => row.position_group === group)
      .slice()
      .sort((a, b) => b.projected_score - a.projected_score);
    if (!groupRows.length) return 0;
    const index = Math.min(groupRows.length, replacementCount(group, roster)) - 1;
    return finite(groupRows[index]?.projected_score);
  }

  function buildDraftBoard(skaterRows, goalieRows, weights = {}, roster = {}) {
    const resolvedWeights = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
    const resolvedRoster = { ...DEFAULT_ROSTER, ...(roster || {}) };
    const rows = [];

    (skaterRows || []).forEach((source) => {
      const position = String(source.position || '').trim().toUpperCase();
      rows.push({
        ...source,
        player_name: source.player_name || '',
        position,
        position_group: positionGroup(position),
        player_type: 'skater',
        projected_score: skaterScore(source, resolvedWeights),
      });
    });
    (goalieRows || []).forEach((source) => {
      rows.push({
        ...source,
        player_name: source.goalie_name || source.player_name || '',
        position: 'G',
        position_group: 'G',
        player_type: 'goalie',
        projected_score: goalieScore(source, resolvedWeights),
      });
    });

    const replacement = {
      F: replacementScore(rows, 'F', resolvedRoster),
      D: replacementScore(rows, 'D', resolvedRoster),
      G: replacementScore(rows, 'G', resolvedRoster),
    };
    rows.forEach((row) => {
      row.replacement_score = replacement[row.position_group] || 0;
      row.draft_value = row.projected_score - row.replacement_score;
    });
    rows.sort((a, b) => b.draft_value - a.draft_value
      || b.projected_score - a.projected_score
      || a.player_name.localeCompare(b.player_name));
    rows.forEach((row, index) => { row.draft_rank = index + 1; });
    return { rows, replacement, weights: resolvedWeights, roster: resolvedRoster };
  }

  return {
    DEFAULT_WEIGHTS,
    DEFAULT_ROSTER,
    buildDraftBoard,
    goalieScore,
    positionGroup,
    replacementCount,
    skaterScore,
  };
}));
