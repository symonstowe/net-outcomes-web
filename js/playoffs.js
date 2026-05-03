/* playoffs.js - playoff bracket probability flow + standings table */
(() => {
  const common = window.NetOutcomesCommon || {};
  const esc = common.esc || ((value) => String(value ?? ''));
  const socialCardMode = (() => {
    try {
      return new URLSearchParams(window.location.search).get('social-card') === '1';
    } catch (_error) {
      return false;
    }
  })();

  function setRenderStatus(status) {
    document.documentElement.setAttribute('data-playoffs-render-status', String(status || ''));
  }

  function markRenderStatus(status) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setRenderStatus(status));
    });
  }

  function settleSvgImages(root, timeoutMs = 4000) {
    const imageNodes = Array.from((root || document).querySelectorAll('#bracketChart image'));
    if (!imageNodes.length) return Promise.resolve();
    return Promise.all(imageNodes.map((node) => new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        node.removeEventListener('load', done);
        node.removeEventListener('error', done);
        resolve();
      };
      node.addEventListener('load', done, { once: true });
      node.addEventListener('error', done, { once: true });
      window.setTimeout(done, timeoutMs);
    }))).then(() => undefined);
  }

  function settleSocialCapture(root) {
    const waits = [settleSvgImages(root)];
    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
      waits.push(document.fonts.ready.catch(() => undefined));
    }
    return Promise.allSettled(waits).then(() => new Promise((resolve) => {
      window.setTimeout(resolve, 150);
    }));
  }

  if (socialCardMode) {
    document.documentElement.classList.add('sf-social-card-mode');
  }
  setRenderStatus('pending');

  async function fetchJson(url) {
    if (typeof common.fetchJson === 'function') {
      return common.fetchJson(url);
    }
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status}`);
    }
    return response.json();
  }

  const TEAM_COLOR = {
    ANA: '#F47A38', BOS: '#FFB81C', BUF: '#003087', CAR: '#CC0000',
    CBJ: '#002654', CGY: '#F1BE48', CHI: '#CF0A2C', COL: '#6F263D',
    DAL: '#006847', DET: '#CE1126', EDM: '#FF4C00', FLA: '#041E42',
    LAK: '#A2AAAD', MIN: '#154734', MTL: '#AF1E2D', NJD: '#CE1126',
    NSH: '#FFB81C', NYI: '#003087', NYR: '#0038A8', OTT: '#C52032',
    PHI: '#F74902', PIT: '#FCB514', SEA: '#001628', SJS: '#006D75',
    STL: '#002F87', TBL: '#002868', TOR: '#003E7E', UTA: '#010066',
    VAN: '#00843D', VGK: '#B4975A', WSH: '#041E42', WPG: '#004C97',
  };

  const teamColor = (abbrev) => TEAM_COLOR[abbrev] || '#4a6fa5';

  const CONF_TO_SIDE = { Western: 'West', Eastern: 'East' };
  const BRACKET_SLOT_ORDER = 4; // 4 R1 series per conference

  const DIVISION_ABBR = {
    Atlantic: 'ATL',
    Metropolitan: 'MET',
    Central: 'CEN',
    Pacific: 'PAC',
  };

  function seedLabelFor(slot, division) {
    if (slot === 1) return 'WC2';
    if (slot === 5) return 'WC1';
    const abbr = DIVISION_ABBR[division] || (division ? division.slice(0, 3).toUpperCase() : 'DIV');
    const rank = (slot === 0 || slot === 4) ? 1 : ((slot === 2 || slot === 6) ? 2 : 3);
    return `${abbr}${rank}`;
  }

  // Build the 16-team array the visualization expects, from the payload.
  function buildTeams(seriesFlat, standingsRows) {
    const standingsMap = new Map();
    (standingsRows || []).forEach((row) => standingsMap.set(row.team, row));

    // Any team that lost a completed series at any round is eliminated.
    const eliminated = new Set();
    (seriesFlat || []).forEach((s) => {
      if (!s || !s.is_complete || !s.winner) return;
      if (s.top_seed && s.top_seed !== s.winner) eliminated.add(s.top_seed);
      if (s.bottom_seed && s.bottom_seed !== s.winner) eliminated.add(s.bottom_seed);
    });

    const teams = [];
    const r1Series = [];
    const allSeries = [];

    const ROUND_STAGE = { 1: 'r1', 2: 'r2', 3: 'cf', 4: 'cup' };
    const slotGroupForRound = (roundNum, bracketSlot) => {
      if (roundNum === 1) return bracketSlot * 2;
      if (roundNum === 2) return bracketSlot * 4;
      return 0;
    };

    (seriesFlat || []).forEach((series) => {
      const roundNum = Number(series.round || 0);
      const stage = ROUND_STAGE[roundNum];
      if (!stage) return;
      // Cup is rendered only on the West side; map "Finals" (or any non-conf) to West.
      const side = stage === 'cup'
        ? 'West'
        : CONF_TO_SIDE[series.conference] || 'West';
      allSeries.push({
        stage,
        conf: side,
        slotGroup: slotGroupForRound(roundNum, Number(series.bracket_slot || 0)),
        topAbbrev: series.top_seed || '',
        topWins: Number(series.top_seed_wins || 0),
        bottomAbbrev: series.bottom_seed || '',
        bottomWins: Number(series.bottom_seed_wins || 0),
        isComplete: Boolean(series.is_complete),
        winner: series.winner || '',
      });
    });

    ['Western', 'Eastern'].forEach((conference) => {
      const side = CONF_TO_SIDE[conference];
      const r1 = seriesFlat
        .filter((s) => s.round === 1 && s.conference === conference)
        .sort((a, b) => (a.bracket_slot || 0) - (b.bracket_slot || 0));

      for (let i = 0; i < BRACKET_SLOT_ORDER; i += 1) {
        const series = r1[i];
        if (series) {
          r1Series.push({
            conf: side,
            slotGroup: i * 2,
            topAbbrev: series.top_seed || '',
            topWins: Number(series.top_seed_wins || 0),
            bottomAbbrev: series.bottom_seed || '',
            bottomWins: Number(series.bottom_seed_wins || 0),
            isComplete: Boolean(series.is_complete),
            winner: series.winner || '',
          });
        }
        [
          ['top_seed', 'top_seed_full_name', 'top_seed_logo', 'top_seed_series_win_pct'],
          ['bottom_seed', 'bottom_seed_full_name', 'bottom_seed_logo', 'bottom_seed_series_win_pct'],
        ].forEach(([abbrevKey, nameKey, logoKey, seriesPctKey], seatIdx) => {
          const slot = i * 2 + seatIdx;
          const abbrev = series ? series[abbrevKey] || '' : '';
          const name = series ? series[nameKey] || abbrev : '';
          const logo = series ? series[logoKey] || '' : '';
          const seriesPct = series ? Number(series[seriesPctKey] || 0) : 0;
          const sRow = abbrev ? standingsMap.get(abbrev) || {} : {};

          const r2 = seriesPct / 100;
          const cf = Number(sRow.win_round2_pct ?? 0) / 100;
          const finalProb = Number(sRow.win_conf_pct ?? 0) / 100;
          const cup = Number(sRow.win_cup_pct ?? 0) / 100;

          const division = sRow.division || '';
          const seedLabel = seedLabelFor(slot, division);

          teams.push({
            id: `${side.toLowerCase()}${slot}`,
            conf: side,
            seed: seedLabel,
            slot,
            abbrev,
            name: name || `${side} ${seedLabel}`,
            logo,
            color: teamColor(abbrev),
            probs: { r2, cf, final: finalProb, cup },
            eliminated: abbrev ? eliminated.has(abbrev) : false,
          });
        });
      }
    });

    return { teams, r1Series, allSeries };
  }

  function seriesScoreLabel(series) {
    const { topAbbrev, topWins, bottomAbbrev, bottomWins, isComplete, winner } = series;
    if (isComplete && winner) {
      const loserWins = winner === topAbbrev ? bottomWins : topWins;
      const winnerWins = winner === topAbbrev ? topWins : bottomWins;
      return `${winner} wins ${winnerWins}-${loserWins}`;
    }
    if (topWins === 0 && bottomWins === 0) return '';
    if (topWins === bottomWins) return `Tied ${topWins}-${bottomWins}`;
    if (topWins > bottomWins) return `${topAbbrev} leads ${topWins}-${bottomWins}`;
    return `${bottomAbbrev} leads ${bottomWins}-${topWins}`;
  }

  function fmtPct(v) {
    if (!Number.isFinite(v) || v <= 0) return '—';
    if (v >= 0.999) return '100%';
    return `${(v * 100).toFixed(1)}%`;
  }

  function renderFlowChart(teams, r1Series, allSeries) {
    const d3 = window.d3;
    if (!d3) {
      const container = document.getElementById('bracketContainer');
      if (container) container.textContent = 'd3 failed to load.';
      return;
    }

    const shell = document.getElementById('bracketContainer');
    const svgEl = document.getElementById('bracketChart');
    const tooltip = d3.select('#bracketTooltip');
    const details = d3.select('#bracketDetails');
    const select = d3.select('#bracketTeamSelect');
    if (!shell || !svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.on('click', clearSelection);

    // Layout is fixed in viewBox coordinates; the SVG uses CSS
    // `width:100%; height:auto` so the entire visual scales uniformly with the
    // container. A CSS `min-width` keeps the chart from shrinking past the
    // point of legibility — below it the container scrolls horizontally.
    const W = 1600;
    const cardW = 172;
    const flowScale = 60;        // vertical thickness of bars/cards (+25%)
    const cardH = flowScale;
    const nodeW = 30;
    const yTop = 140;
    // Bracket-style spacing: small visible gap inside a matchup (~14px),
    // much larger gap (~52px) between matchups for clear bracket structure.
    const intraGap = 74;         // slots 0↔1, 2↔3, 4↔5, 6↔7
    const interGap = 84;         // slots 1↔2, 3↔4, 5↔6
    const gap = 2.0;             // gap between stacked ribbons within a node
    const headerY = 92;
    const H = 820;

    // X positions are tuned so the curves with the most vertical change
    // (r1→r2, r2→cf) get the most horizontal room. The gentle start→r1 and
    // cf→cup curves can be tighter without looking pinched.
    const r1X = 290;
    const r2X = 460;
    const cfX = 670;
    const xs = {
      West: { start: 40, r1: r1X, r2: r2X, cf: cfX, cup: W / 2 - nodeW / 2 },
      East: {
        start: W - 40 - cardW,
        r1: W - r1X - nodeW,
        r2: W - r2X - nodeW,
        cf: W - cfX - nodeW,
        cup: W / 2 - nodeW / 2,
      },
    };

    svg
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('width', null)
      .attr('height', null);

    const stages = ['start', 'r1', 'r2', 'cf', 'cup'];
    const stageLabel = {
      start: 'Teams',
      r1: 'Round 1',
      r2: 'Round 2',
      cf: 'Conf. Final',
      cup: 'Cup Final',
    };
    const stageLabelLines = {
      start: ['Teams'],
      r1: ['Round 1'],
      r2: ['Round 2'],
      cf: ['Conf.', 'Final'],
      cup: ['Cup', 'Final'],
    };

    const prob = (t, s) => {
      if (s === 'start') return 1;
      if (s === 'r1') return t.probs.r2;
      if (s === 'r2') return t.probs.cf;
      if (s === 'cf') return t.probs.final;
      return t.probs.cup;
    };

    // Variable spacing: matchup pairs (0&1, 2&3, 4&5, 6&7) are tight; the
    // gaps between matchups are wider so the bracket structure reads clearly.
    const ySlot = (i) => yTop
      + Math.floor((i + 1) / 2) * intraGap
      + Math.floor(i / 2) * interGap;
    const groupSlots = (stage) => {
      if (stage === 'start') return d3.range(8);
      if (stage === 'r1') return [0, 2, 4, 6];
      if (stage === 'r2') return [0, 4];
      return [0];
    };
    const cupCenter = d3.mean(d3.range(8).map(ySlot));
    // Pull the two Round-2 nodes inward toward the cup-final center so the
    // ribbons flow more cleanly through Conf. Final and Cup Final.
    const R2_PULL = 0.32;
    const yNode = (stage, slot) => {
      if (stage === 'start') return ySlot(slot);
      if (stage === 'r1') return (ySlot(slot) + ySlot(slot + 1)) / 2;
      if (stage === 'r2') {
        const slotMean = d3.mean([0, 1, 2, 3].map((i) => ySlot(slot + i)));
        return slotMean + (cupCenter - slotMean) * R2_PULL;
      }
      return cupCenter;
    };
    const stageGroup = (stage, slot) => {
      if (stage === 'start') return slot;
      if (stage === 'r1') return Math.floor(slot / 2) * 2;
      if (stage === 'r2') return Math.floor(slot / 4) * 4;
      return 0;
    };
    const stageX = (t, stage) => (stage === 'start' ? xs[t.conf].start : xs[t.conf][stage]);

    const PROB_EPS = 1e-6;
    // Include zero-probability teams in each stack so eliminated teams still
    // have a lane position — their ribbon tapers to a zero-width point at
    // the node's edge instead of vanishing entirely. Teams whose previous
    // stage already had zero probability are excluded (no incoming flow).
    const sortTeamsAt = (stage, conf, group) => teams
      .filter((t) => (stage === 'cup' || t.conf === conf) && stageGroup(stage, t.slot) === group)
      .sort((a, b) => (a.conf === b.conf ? 0 : a.conf === 'West' ? -1 : 1) || a.slot - b.slot);

    const laneCache = new Map();
    function lane(t, stage) {
      const key = `${stage === 'cup' ? 'League' : t.conf}-${stage}-${stageGroup(stage, t.slot)}`;
      if (!laneCache.has(key)) {
        const arr = sortTeamsAt(stage, t.conf, stageGroup(stage, t.slot));
        const visible = arr.filter((d) => prob(d, stage) > PROB_EPS);
        const total = d3.sum(visible, (d) => prob(d, stage) * flowScale)
          + gap * Math.max(0, visible.length - 1);
        let y = yNode(stage, stageGroup(stage, t.slot)) - total / 2;
        const map = new Map();
        let lastVisibleBottom = y;
        for (const a of arr) {
          const h = prob(a, stage) * flowScale;
          if (h > PROB_EPS) {
            map.set(a.id, { top: y, bottom: y + h, mid: y + h / 2, h });
            y += h + gap;
            lastVisibleBottom = y - gap;
          } else {
            // Zero-probability team: collapse to a single point at the
            // current cursor (the boundary just past the previous visible
            // ribbon) so the incoming ribbon tapers to that edge.
            const py = lastVisibleBottom;
            map.set(a.id, { top: py, bottom: py, mid: py, h: 0 });
          }
        }
        laneCache.set(key, map);
      }
      return laneCache.get(key).get(t.id);
    }

    const rightEdge = (t, stage) => stageX(t, stage) + (stage === 'start' ? cardW : nodeW);
    const leftEdge = (t, stage) => stageX(t, stage);

    function ribbonPath(t, a, b) {
      const A = lane(t, a);
      const B = lane(t, b);
      const x1 = t.conf === 'West' ? rightEdge(t, a) : leftEdge(t, a);
      const x2 = t.conf === 'West' ? leftEdge(t, b) : rightEdge(t, b);
      const dx = Math.abs(x2 - x1);
      const s = x2 > x1 ? 1 : -1;
      const c1 = x1 + s * dx * 0.52;
      const c2 = x2 - s * dx * 0.52;
      return `M ${x1},${A.top} C ${c1},${A.top} ${c2},${B.top} ${x2},${B.top} `
        + `L ${x2},${B.bottom} C ${c2},${B.bottom} ${c1},${A.bottom} ${x1},${A.bottom} Z`;
    }

    const links = [];
    for (const t of teams) {
      for (let i = 0; i < stages.length - 1; i += 1) {
        // Skip ribbons with no incoming flow — once a team has zero
        // probability at the source stage, no further ribbons are drawn.
        // The ribbon INTO their elimination round is still drawn (and
        // tapers to a point at the round node's edge).
        if (prob(t, stages[i]) <= PROB_EPS) continue;
        links.push({
          team: t,
          from: stages[i],
          to: stages[i + 1],
          prob: prob(t, stages[i + 1]),
          path: ribbonPath(t, stages[i], stages[i + 1]),
        });
      }
    }

    const bg = svg.append('g');
    const nodes = svg.append('g');
    const flows = svg.append('g');
    const labels = svg.append('g');

    bg.selectAll('line')
      .data(d3.range(8))
      .join('line')
      .attr('x1', 20)
      .attr('x2', W - 20)
      .attr('y1', (d) => ySlot(d))
      .attr('y2', (d) => ySlot(d))
      .attr('stroke', 'rgba(255,255,255,.025)');


    const header = [];
    for (const conf of ['West', 'East']) {
      for (const s of stages) {
        // Cup column is shared between conferences — render its label only
        // once so the text isn't drawn on top of itself.
        if (s === 'cup' && conf === 'East') continue;
        header.push({
          conf,
          s,
          x: stageX({ conf }, s) + (s === 'start' ? cardW / 2 : nodeW / 2),
          text: stageLabel[s],
        });
      }
    }
    const headerLabels = labels.selectAll('.round-label')
      .data(header)
      .join('text')
      .attr('class', (d) => (d.s === 'start' ? 'conf-label' : 'round-label'))
      .attr('data-stage', (d) => d.s)
      .attr('x', (d) => d.x)
      .attr('y', headerY)
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => {
        if (d.s === 'cup') return '#3b473b';
        return d.conf === 'West' ? '#06799f' : '#ff8300';
      })
      .style('cursor', (d) => (d.s === 'start' ? 'default' : 'pointer'))
      .on('click', (ev, d) => {
        if (d.s === 'start') return;
        ev.stopPropagation();
        selectRound(d.s);
      });
    headerLabels.each(function renderHeaderLabel(d) {
      const lines = d.s === 'start' ? [d.conf] : (stageLabelLines[d.s] || [d.text]);
      const sel = d3.select(this);
      sel.selectAll('tspan').remove();
      // Vertically center the multi-line block on the original baseline so a
      // 2-line label (e.g. "Conference Final") and a 1-line label (e.g.
      // "Round 1") visually align.
      const lineHeight = 20;
      const startDy = -((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, i) => {
        sel.append('tspan')
          .attr('x', d.x)
          .attr('dy', i === 0 ? startDy : lineHeight)
          .text(line);
      });
    });

    flows.selectAll('path')
      .data(links, (d) => d.team.id + d.from + d.to)
      .join('path')
      .attr('class', 'flow-ribbon')
      .attr('d', (d) => d.path)
      .attr('fill', (d) => d.team.color)
      .attr('opacity', 0.68)
      .on('mouseenter', (event, d) => showTip(event,
        `<b>${esc(d.team.name)}</b><br>${stageLabel[d.to]}: ${fmtPct(d.prob)}`
        + '<br><span style="color:#7d959c">Click to highlight</span>'))
      .on('mousemove', moveTip)
      .on('mouseleave', hideTip)
      .on('click', (e, d) => {
        e.stopPropagation();
        selectTeam(d.team.id, true);
      });

    function nodeExtent(conf, stage, slot) {
      const arr = sortTeamsAt(stage, conf, slot);
      const tops = arr.map((t) => lane(t, stage).top);
      const bottoms = arr.map((t) => lane(t, stage).bottom);
      const pad = 3;
      return { top: d3.min(tops) - pad, bottom: d3.max(bottoms) + pad };
    }

    function drawRoundNode(conf, stage, slot) {
      const x = stageX({ conf }, stage);
      const e = nodeExtent(conf, stage, slot);
      const g = nodes.append('g').attr('class', 'round-node');
      const arr = sortTeamsAt(stage, conf, slot);
      g.selectAll('rect.node-fill')
        .data(arr, (d) => d.id)
        .join('rect')
        .attr('class', 'node-fill')
        .attr('data-team', (d) => d.id)
        .attr('data-stage', stage)
        .attr('x', x)
        .attr('y', (d) => lane(d, stage).top)
        .attr('width', nodeW)
        .attr('height', (d) => Math.max(0, lane(d, stage).bottom - lane(d, stage).top))
        .attr('fill', (d) => d.color)
        .attr('opacity', 0.76)
        .style('cursor', 'pointer')
        .on('mouseenter', (event, d) => showTip(event,
          `<b>${esc(d.name)}</b><br>${stageLabel[stage]}: ${fmtPct(prob(d, stage))}`
          + '<br><span style="color:#7d959c">Click to highlight</span>'))
        .on('mousemove', moveTip)
        .on('mouseleave', hideTip)
        .on('click', (ev, d) => {
          ev.stopPropagation();
          selectTeam(d.id, true);
        });
      g.append('rect')
        .attr('class', 'node-border')
        .attr('x', x)
        .attr('y', e.top)
        .attr('width', nodeW)
        .attr('height', e.bottom - e.top)
        .attr('rx', 0);
      return g;
    }

    for (const conf of ['West', 'East']) {
      for (const s of stages.slice(1)) {
        if (s === 'cup' && conf === 'East') continue;
        for (const sl of groupSlots(s)) drawRoundNode(conf, s, sl);
      }
    }

    (allSeries || r1Series || []).forEach((series) => {
      const stage = series.stage || 'r1';
      const label = seriesScoreLabel(series);
      if (!label) return;
      const e = nodeExtent(series.conf, stage, series.slotGroup);
      const x = xs[series.conf][stage] + nodeW / 2;
      labels.append('text')
        .attr('class', 'series-score')
        .attr('data-stage', stage)
        .attr('x', x)
        .attr('y', e.bottom + 18)
        .attr('text-anchor', 'middle')
        .text(label);
    });

    const cards = nodes.selectAll('.team-card')
      .data(teams, (d) => d.id)
      .join('g')
      .attr('class', 'team-card')
      .attr('transform', (d) => `translate(${stageX(d, 'start')},${ySlot(d.slot) - cardH / 2})`)
      .style('cursor', 'pointer')
      .on('mouseenter', (event, d) => showTip(event, `<b>${esc(d.name)}</b><br>Click to highlight`))
      .on('mousemove', moveTip)
      .on('mouseleave', hideTip)
      .on('click', (e, d) => {
        e.stopPropagation();
        selectTeam(d.id, true);
      });

    function cardPath(w, h, r, squareSide) {
      if (squareSide === 'right') {
        return `M ${r},0 L ${w},0 L ${w},${h} L ${r},${h}`
          + ` Q 0,${h} 0,${h - r} L 0,${r} Q 0,0 ${r},0 Z`;
      }
      return `M 0,0 L ${w - r},0 Q ${w},0 ${w},${r} L ${w},${h - r}`
        + ` Q ${w},${h} ${w - r},${h} L 0,${h} Z`;
    }

    cards.append('path')
      .attr('class', 'card-bg')
      .attr('d', (d) => cardPath(cardW, cardH, 6, d.conf === 'West' ? 'right' : 'left'));

    cards.each(function appendCardContent(d) {
      const g = d3.select(this);
      const logoSize = 36;
      const logoX = d.conf === 'West' ? 10 : cardW - 10 - logoSize;
      if (d.logo) {
        g.append('image')
          .attr('href', d.logo)
          .attr('x', logoX)
          .attr('y', (cardH - logoSize) / 2)
          .attr('width', logoSize)
          .attr('height', logoSize);
      }
      const textAnchor = d.conf === 'West' ? 'start' : 'end';
      const textX = d.conf === 'West' ? 10 + logoSize + 10 : cardW - 10 - logoSize - 10;
      g.append('text')
        .attr('x', textX)
        .attr('y', 24)
        .attr('text-anchor', textAnchor)
        .attr('font-weight', 700)
        .attr('font-size', 17)
        .text(`${d.seed} · ${d.abbrev || 'TBD'}`);
      g.append('text')
        .attr('class', 'small')
        .attr('x', textX)
        .attr('y', 44)
        .attr('text-anchor', textAnchor)
        .text(`Cup ${fmtPct(d.probs.cup)}`);
    });

    // Populate select dropdown.
    select.selectAll('option').remove();
    select.append('option').attr('value', '').text('None — show all teams');
    select.selectAll('option.team-option')
      .data(teams)
      .join('option')
      .attr('class', 'team-option')
      .attr('value', (d) => d.id)
      .text((d) => `${d.conf} ${d.seed} — ${d.name}`);
    select.on('change', (e) => (e.target.value ? selectTeam(e.target.value, false) : clearSelection()));

    function clearSelection() {
      select.property('value', '');
      flows.selectAll('.flow-ribbon').transition().duration(110)
        .attr('opacity', (d) => (d.team.eliminated ? 0.08 : 0.68))
        .attr('filter', null);
      nodes.selectAll('.node-fill').transition().duration(110)
        .attr('opacity', (d) => (d.eliminated ? 0.08 : 0.76));
      cards.classed('selected', false).transition().duration(110)
        .attr('opacity', (d) => (d.eliminated ? 0.32 : 1));
      labels.selectAll('.series-score').transition().duration(110).attr('opacity', 1);
      labels.selectAll('.round-label')
        .attr('font-weight', null)
        .attr('opacity', 1);
      labels.selectAll('.annotation').remove();
      details.html('<div class="team">NHL playoffs</div>'
        + '<div class="metric-row"><span>Teams</span><b>16</b></div>'
        + '<div class="metric-row"><span>Click a team, ribbon, or round</span><b>for details</b></div>');
    }

    function selectRound(stage) {
      if (!stage || stage === 'start') return;
      select.property('value', '');
      // Fade everything; matchup nodes for this round stay full-strength.
      flows.selectAll('.flow-ribbon').transition().duration(110)
        .attr('opacity', 0.06)
        .attr('filter', null);
      nodes.selectAll('.node-fill').transition().duration(110)
        .attr('opacity', function () {
          return this.getAttribute('data-stage') === stage ? 0.9 : 0.06;
        });
      cards.classed('selected', false).transition().duration(110)
        .attr('opacity', 0.32);
      labels.selectAll('.series-score').transition().duration(110)
        .attr('opacity', function () {
          return this.getAttribute('data-stage') === stage ? 1 : 0.12;
        });
      labels.selectAll('.round-label')
        .attr('font-weight', function () {
          return this.getAttribute('data-stage') === stage ? 800 : null;
        })
        .attr('opacity', function () {
          const s = this.getAttribute('data-stage');
          return (s === stage || s === 'start') ? 1 : 0.45;
        });
      // Top-team annotation above each matchup at this stage.
      labels.selectAll('.annotation').remove();
      const matchupKeys = new Set();
      for (const t of teams) {
        if (stage !== 'cup' && t.conf !== t.conf) continue;
        const conf = stage === 'cup' ? 'League' : t.conf;
        const grp = stageGroup(stage, t.slot);
        matchupKeys.add(`${conf}|${grp}|${t.conf}`);
      }
      const seen = new Set();
      for (const t of teams) {
        const grp = stageGroup(stage, t.slot);
        const key = stage === 'cup' ? 'cup' : `${t.conf}|${grp}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const arr = sortTeamsAt(stage, t.conf, grp).filter((x) => x.abbrev);
        if (!arr.length) continue;
        const top = arr.reduce((a, b) => (prob(b, stage) > prob(a, stage) ? b : a));
        const e = nodeExtent(t.conf, stage, grp);
        const x = stageX(t, stage) + nodeW / 2;
        labels.append('text')
          .attr('class', 'annotation')
          .attr('x', x)
          .attr('y', e.top - 10)
          .attr('text-anchor', 'middle')
          .text(`${top.abbrev} ${fmtPct(prob(top, stage))}`);
      }

      details.html(
        `<div class="team">${esc(stageLabel[stage])}</div>`
        + '<div class="metric-row"><span>View</span><b>round highlight</b></div>'
        + '<div class="metric-row"><span>Annotations</span><b>top team per matchup</b></div>'
        + '<div class="metric-row"><span>Click background</span><b>to clear</b></div>',
      );
    }

    function selectTeam(id, update) {
      const t = teams.find((x) => x.id === id);
      if (!t) return;
      if (update) select.property('value', id);
      flows.selectAll('.flow-ribbon')
        .transition().duration(110)
        .attr('opacity', (d) => (d.team.id === id ? 0.95 : 0.08))
        .attr('filter', (d) => (d.team.id === id ? 'drop-shadow(0 1px 4px rgba(6,121,159,.35))' : null));
      nodes.selectAll('.node-fill').transition().duration(110)
        .attr('opacity', (d) => (d.id === id ? 0.95 : 0.08));
      cards.classed('selected', (d) => d.id === id)
        .transition().duration(110)
        .attr('opacity', (d) => (d.id === id ? 1 : 0.32));
      labels.selectAll('.series-score').transition().duration(110).attr('opacity', 1);
      labels.selectAll('.round-label').attr('font-weight', null).attr('opacity', 1);
      labels.selectAll('.annotation').remove();
      for (const s of stages.slice(1)) {
        const e = nodeExtent(t.conf, s, stageGroup(s, t.slot));
        const x = stageX(t, s) + nodeW / 2;
        labels.append('text')
          .attr('class', 'annotation')
          .attr('x', x)
          .attr('y', e.top - 10)
          .attr('text-anchor', 'middle')
          .text(fmtPct(prob(t, s)));
      }
      details.html(
        `<div class="team" style="color:${t.color}">${esc(t.name)}</div>`
        + `<div class="metric-row"><span>Conference / seed</span><b>${t.conf} ${t.seed}</b></div>`
        + `<div class="metric-row"><span>Win Round 1</span><b>${fmtPct(t.probs.r2)}</b></div>`
        + `<div class="metric-row"><span>Win Round 2</span><b>${fmtPct(t.probs.cf)}</b></div>`
        + `<div class="metric-row"><span>Win Conference Final</span><b>${fmtPct(t.probs.final)}</b></div>`
        + `<div class="metric-row"><span>Win Cup Final</span><b>${fmtPct(t.probs.cup)}</b></div>`,
      );
    }

    function showTip(e, html) {
      tooltip.html(html).style('opacity', 1);
      moveTip(e);
    }
    function moveTip(e) {
      const r = shell.getBoundingClientRect();
      tooltip
        .style('left', `${e.clientX - r.left}px`)
        .style('top', `${e.clientY - r.top}px`);
    }
    function hideTip() {
      tooltip.style('opacity', 0);
    }

    clearSelection();
  }

  function renderBracket(seriesByRound, standingsRows) {
    const loading = document.getElementById('bracketLoading');
    const container = document.getElementById('bracketContainer');
    if (!container) return;

    const seriesFlat = Object.values(seriesByRound || {}).flat();
    if (!seriesFlat.some((s) => s.top_seed || s.bottom_seed)) {
      if (loading) loading.textContent = 'Playoff bracket not yet available.';
      markRenderStatus('empty');
      return;
    }

    const built = buildTeams(seriesFlat, standingsRows);
    if (!built.teams.some((t) => t.abbrev)) {
      if (loading) loading.textContent = 'Playoff bracket not yet available.';
      markRenderStatus('empty');
      return;
    }

    renderFlowChart(built.teams, built.r1Series, built.allSeries);
    if (loading) loading.hidden = true;
    container.hidden = false;
    const settled = socialCardMode ? settleSocialCapture(container) : Promise.resolve();
    settled.then(() => {
      markRenderStatus('ready');
    });
  }

  function renderProbBar(pct) {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    const t = clamped / 100;
    const r = Math.round(199 + (255 - 199) * t);
    const g = Math.round(216 + (131 - 216) * t);
    const b = Math.round(222 + (0 - 222) * t);
    const color = `rgb(${r},${g},${b})`;
    const label = clamped === 100 ? '100%' : clamped === 0 ? '—' : `${clamped.toFixed(1)}%`;
    return `<div class="sf-prob-bar-cell">
      <div class="sf-prob-bar-track">
        <div class="sf-prob-bar-fill" style="width:${clamped.toFixed(1)}%;background:${color}"></div>
      </div>
      <span class="sf-prob-bar-label">${label}</span>
    </div>`;
  }

  function renderStandingsRow(row, rank) {
    return `<tr class="${row.in_playoffs ? 'sf-standings-playoff-team' : 'sf-standings-out-team'}">
      <td class="sf-col-rank">${rank}</td>
      <td class="sf-col-team"><span class="sf-team-cell">
        <span class="sf-factor-edge-logo-box" aria-hidden="true"><img class="sf-factor-edge-logo" src="${esc(row.logo_url)}" alt="" loading="lazy" decoding="async"/></span>
        <span class="sf-team-name-cell">
          <span class="sf-team-abbrev">${esc(row.team)}</span>
          <span class="sf-team-fullname">${esc(row.full_name)}</span>
        </span>
      </span></td>
      <td class="sf-col-pts"><strong>${row.points}</strong></td>
      <td class="sf-col-pct">${renderProbBar(row.win_cup_pct)}</td>
      <td class="sf-col-pct">${renderProbBar(row.win_conf_pct)}</td>
      <td class="sf-col-pct">${renderProbBar(row.win_division_pct)}</td>
      <td class="sf-col-pct">${renderProbBar(row.make_playoffs_pct)}</td>
    </tr>`;
  }

  function renderStandings(rows) {
    const tbody = document.getElementById('standingsBody');
    const mount = document.getElementById('standingsTableMount');
    const loading = document.getElementById('standingsLoading');
    if (!tbody || !mount) return;
    if (!Array.isArray(rows) || !rows.length) {
      if (loading) loading.textContent = 'No standings data available.';
      return;
    }
    tbody.innerHTML = rows.map((row, idx) => renderStandingsRow(row, idx + 1)).join('');
    if (loading) loading.hidden = true;
    mount.hidden = false;
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

  async function init() {
    const [payload] = await Promise.all([
      fetchJson('data/playoffs.json'),
      waitForD3().catch(() => null),
    ]);
    const playoffs = payload && payload.playoffs ? payload.playoffs : {};
    renderBracket(playoffs.series || {}, playoffs.standings || []);
    renderStandings(playoffs.standings || []);
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
      console.error('playoffs.js:', error);
      const bracketLoading = document.getElementById('bracketLoading');
      const standingsLoading = document.getElementById('standingsLoading');
      if (bracketLoading) bracketLoading.textContent = `Error: ${error.message}`;
      if (standingsLoading) standingsLoading.textContent = `Error: ${error.message}`;
      markRenderStatus('error');
    });
  });
})();
