/* Net Outcomes player card renderer (v3 layout).
   One shared script for every player stub page: reads window.PLAYER_ID,
   fetches ../data/players/{id}.json + the shared validated rink base
   (../data/rink_base.svg) and renders the card client-side.
   Every percentile bar carries values vs 4 peer groups (position group,
   all skaters, team, exact position) — the Ranked Against toggle switches
   between them without refetching. */
(() => {
  const pid = window.PLAYER_ID;
  const root = document.getElementById('cardRoot');
  if (!pid || !root) return;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ord = (p) => (p == null ? '—' : `${p}${['th', 'st', 'nd', 'rd'][((p % 100) - 20) % 10] || 'th'}`);
  const sgn = (v, d = 3) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(d)}`);
  let GROUP = 'pg'; // pg | all | tm | xp
  let DATA = null;
  let RINK = '';

  const mp = (m) => (m && m.p ? m.p[GROUP] : null);

  function bar(label, m, digits = 3) {
    const pct = mp(m);
    const v = m ? m.v : null;
    if (pct == null && v == null) {
      return `<div class="metric"><div class="mtop"><b>${esc(label)}</b><span>Not qualified</span></div><div class="bar"><div class="bt" style="color:var(--muted);justify-content:center"><span>NQ</span></div></div></div>`;
    }
    const w = Math.max(2, Math.min(100, pct ?? 50));
    const red = (pct ?? 50) < 50 ? ' red' : '';
    return `<div class="metric"><div class="mtop"><b>${esc(label)}</b><span>${ord(pct)} pct</span></div>` +
      `<div class="bar"><div class="fill${red}" style="width:${w}%"></div><div class="bt"><span>${sgn(v, digits)}</span><span>${ord(pct)} pct</span></div></div></div>`;
  }

  function spider(sp) {
    // offense axes on the LEFT half, defense on the RIGHT half; each axis is
    // the same percentile as its panel bar (follows the Ranked Against toggle)
    if (!sp || !sp.off || !sp.def) return '';
    const R = 112;
    const place = (list, side) => list.map((a, i) => {
      const ang = ((i + 0.5) / list.length) * Math.PI; // top -> bottom
      const sx = side === 'def' ? 1 : -1;
      const ux = sx * Math.sin(ang);
      const uy = -Math.cos(ang);
      const pct = Math.max(4, Math.min(100, mp(a.m) ?? 4));
      return { l: a.l, pct: mp(a.m), x: ux * R * pct / 100, y: uy * R * pct / 100,
               lx: ux * (R + 14), ly: uy * (R + 14), right: sx > 0 };
    });
    const dpts = place(sp.def, 'def');
    const opts = place(sp.off, 'off');
    const ring = [...dpts, ...opts.slice().reverse()];
    const poly = ring.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const labels = ring.map((p) =>
      `<text x="${p.lx.toFixed(0)}" y="${(p.ly + 3).toFixed(0)}" text-anchor="${p.right ? 'start' : 'end'}" font-size="10" fill="#6b7280">${esc(p.l)}</text>` +
      `<text x="${p.lx.toFixed(0)}" y="${(p.ly + 14).toFixed(0)}" text-anchor="${p.right ? 'start' : 'end'}" font-size="9" font-weight="900" fill="var(--blue)">${ord(p.pct)}</text>`
    ).join('');
    const spokes = ring.map((p) => {
      const n = Math.hypot(p.lx, p.ly) / (R + 14);
      return `<line x1="0" y1="0" x2="${(p.lx / n / (R + 14) * R).toFixed(1)}" y2="${(p.ly / n / (R + 14) * R).toFixed(1)}" stroke="#eef2f7"/>`;
    }).join('');
    return `<svg viewBox="0 0 480 330"><g transform="translate(240,158)">` +
      `<circle r="${R}" fill="none" stroke="#d9e2ec"/><circle r="${R / 2}" fill="none" stroke="#d9e2ec"/>` +
      `<line x1="0" y1="${-R}" x2="0" y2="${R}" stroke="#d9e2ec"/>` +
      spokes +
      `<polygon points="${poly}" fill="var(--blue)" opacity=".3" stroke="var(--blue)" stroke-width="3"/>` +
      labels +
      `<text x="-${R + 2}" y="-${R + 24}" text-anchor="end" font-size="11" font-weight="900" fill="#6b7280">OFFENCE</text>` +
      `<text x="${R + 2}" y="-${R + 24}" text-anchor="start" font-size="11" font-weight="900" fill="#6b7280">DEFENCE</text>` +
      `</g></svg>`;
  }

  /* 5v5 On Ice Shot Map — EXACT port of the validated server renderer
     (_render_player_shot_svg): identical rink geometry (shared rink_base.svg
     from _render_svg_rink_base), coordinate handedness (for: (x, -y);
     against: (-x, y)), radii, opacities, team colours, green goal rings,
     labels and legend. Counts + xG shares precomputed over the full set. */
  const PT = (pt) => (pt * (2.54 / 72.27)) / 0.088;
  const SHOT_W = PT(0.3);
  const RING_W = PT(1.5);

  function shotCircle(x, y, xg, isGoal, isAgainst, fill, opacity) {
    const px = isAgainst ? -x : x;
    const py = isAgainst ? y : -y;
    const r = Math.min(3.6, Math.max(1.0, 1.0 + Math.sqrt(Math.max(xg, 0)) * 2.0));
    let ring = '';
    if (isGoal) {
      ring = `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${(r * 1.18).toFixed(2)}" fill="none" stroke="#228B22" stroke-width="${RING_W.toFixed(3)}"></circle>`;
    }
    return `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${r.toFixed(2)}" fill="${fill}" fill-opacity="${opacity}" stroke="#ffffff" stroke-width="${SHOT_W.toFixed(3)}"></circle>${ring}`;
  }

  function rink(sm, rinkBase) {
    if (!sm || (!sm.for?.length && !sm.against?.length)) {
      return '<div class="note">No 5v5 shot data.</div>';
    }
    const col = sm.color || '#0072B2';
    const pcol = sm.personal_color || '#E69F00';
    const agNon = [], agGoal = [], forNon = [], forGoal = [], perNon = [], perGoal = [];
    (sm.against || []).forEach(([x, y, xg, g]) => (g ? agGoal : agNon).push([x, y, xg]));
    (sm.for || []).forEach(([x, y, xg, g, per]) => {
      if (per) (g ? perGoal : perNon).push([x, y, xg]);
      else (g ? forGoal : forNon).push([x, y, xg]);
    });
    const dots =
      agNon.map(([x, y, xg]) => shotCircle(x, y, xg, false, true, col, '0.56')).join('') +
      forNon.map(([x, y, xg]) => shotCircle(x, y, xg, false, false, col, '0.72')).join('') +
      perNon.map(([x, y, xg]) => shotCircle(x, y, xg, false, false, pcol, '0.88')).join('') +
      agGoal.map(([x, y, xg]) => shotCircle(x, y, xg, true, true, col, '0.72')).join('') +
      forGoal.map(([x, y, xg]) => shotCircle(x, y, xg, true, false, col, '0.82')).join('') +
      perGoal.map(([x, y, xg]) => shotCircle(x, y, xg, true, false, pcol, '0.94')).join('');
    const nAg = (sm.against || []).length;
    const nFor = (sm.for || []).length;
    return `
<svg class="ps-scorecard-rink" viewBox="-105 -68 210 142" aria-label="Season shot profile">
  <defs>
    <marker id="ps-arrow-head" markerWidth="6" markerHeight="6" refX="5.2" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M 0 0 L 6 3 L 0 6 z" fill="${col}"></path>
    </marker>
  </defs>
  ${rinkBase}
  <text x="-60" y="-56" text-anchor="middle" font-size="6" font-weight="700" fill="${col}">AGST ${esc(sm.against_share || '-')}</text>
  <text x="-60" y="-50.8" text-anchor="middle" font-size="4.4" font-weight="600" fill="#4b5a50">${nAg} shots | ${sm.against_goals ?? 0} goals</text>
  <text x="60" y="-56" text-anchor="middle" font-size="6" font-weight="700" fill="${col}">FOR ${esc(sm.for_share || '-')}</text>
  <text x="60" y="-50.8" text-anchor="middle" font-size="4.4" font-weight="600" fill="#4b5a50">${nFor} shots | ${sm.for_goals ?? 0} goals</text>
  ${dots}
  <g font-size="4.4" fill="#4b5a50">
    <line x1="-18" y1="52.5" x2="-88" y2="52.5" stroke="${col}" stroke-width="${RING_W.toFixed(3)}" marker-end="url(#ps-arrow-head)"></line>
    <text x="-53" y="49.3" text-anchor="middle" font-size="4.6" font-weight="700" fill="${col}">AGST</text>
    <line x1="18" y1="52.5" x2="88" y2="52.5" stroke="${col}" stroke-width="${RING_W.toFixed(3)}" marker-end="url(#ps-arrow-head)"></line>
    <text x="53" y="49.3" text-anchor="middle" font-size="4.6" font-weight="700" fill="${col}">FOR</text>
    <circle cx="-63" cy="64.8" r="1.65" fill="${col}" stroke="#ffffff" stroke-width="${SHOT_W.toFixed(3)}"></circle>
    <text x="-58" y="65.4" text-anchor="start">On-ice shots</text>
    <circle cx="-9" cy="64.8" r="1.65" fill="${pcol}" stroke="#ffffff" stroke-width="${SHOT_W.toFixed(3)}"></circle>
    <text x="-4" y="65.4" text-anchor="start">Personal shots (${sm.personal_n ?? 0})</text>
    <circle cx="58" cy="64.8" r="1.9" fill="none" stroke="#228B22" stroke-width="${RING_W.toFixed(3)}"></circle>
    <text x="63" y="65.4" text-anchor="start">Goal ring</text>
    <text x="0" y="72.2" text-anchor="middle">Dot size ∝ xG</text>
  </g>
</svg>`;
  }

  function spark(us) {
    const vals = us.spark || [];
    if (vals.length < 3) return '';
    const min = Math.min(...vals, us.spark_avg ?? Infinity);
    const max = Math.max(...vals, us.spark_avg ?? -Infinity);
    const range = Math.max(0.1, max - min);
    const X = (i) => (i * 270 / Math.max(1, vals.length - 1)).toFixed(1);
    const Y = (v) => (46 - ((v - min) / range) * 40).toFixed(1);
    const pts = vals.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
    const avgY = us.spark_avg != null ? Y(us.spark_avg) : null;
    const dm = us.trust?.trend_min;
    const delta = dm == null ? '—' : `${dm >= 0 ? '+' : '−'}${Math.floor(Math.abs(dm))}:${String(Math.round((Math.abs(dm) % 1) * 60)).padStart(2, '0')}`;
    return `<div class="spark"><div class="mtop"><b>Last ${vals.length} GP vs avg</b><span style="color:var(--blue);font-weight:900">${delta}</span></div>` +
      `<svg viewBox="0 0 270 52">` +
      (avgY ? `<line x1="0" y1="${avgY}" x2="270" y2="${avgY}" stroke="var(--border)" stroke-width="1.5"/>` : '') +
      `<polyline points="${pts}" fill="none" stroke="var(--blue)" stroke-width="2.6"/></svg></div>`;
  }

  function trustWord(dm) {
    if (dm == null) return '—';
    if (dm > 0.5) return 'Rising';
    if (dm < -0.5) return 'Falling';
    return 'Steady';
  }

  function render() {
    const d = DATA;
    const b = d.bio, bd = d.board, c = d.cells, sk = d.skills || {}, pr = d.production || {},
      sh = d.shooting || {}, cx = d.context || {}, st = d.style || {}, us = d.usage || {};
    const comp = bd.components || {};
    const tr = us.trust || {};
    const wy = cx.wowy || {};
    const posGroup = (b.pos || '').toUpperCase() === 'D' ? 'Defencemen' : 'Forwards';
    const groupLabels = { pg: posGroup, all: 'All Skaters', tm: `Team ${b.team}`, xp: `Position ${b.pos}` };
    const vsLabel = groupLabels[GROUP];
    const retTag = b.returning ? ' <sup style="color:var(--orange)">R</sup>' : '';
    const carry = st.entry_carry_pct, dump = st.entry_dump_pct;
    const carryShare = carry != null && dump != null && (carry + dump) > 0 ? Math.round(100 * carry / (carry + dump)) : null;
    document.title = `${b.name} — Net Outcomes Player Scorecard`;

    root.innerHTML = `
  <div class="muted" style="font-size:18px;font-weight:900"><a href="../rankings.html" style="color:inherit;text-decoration:none">← Back to Rankings</a></div>
  <div style="font-size:26px;font-weight:900;margin-top:20px">Net Outcomes Player Scorecard</div>

  <section class="row">
    <div><h1>${esc(b.name)}${retTag}</h1><div class="summary">GP ${b.gp} · TOI ${Math.floor((b.toi_min || 0) / 60)}h ${Math.round((b.toi_min || 0) % 60)}m · TOI/GP ${b.gp ? `${Math.floor(b.toi_min / b.gp)}:${String(Math.round(((b.toi_min / b.gp) % 1) * 60)).padStart(2, '0')}` : '—'}</div></div>
    <aside class="war"><b>Proj. Impact /60</b><div class="big">${ord(bd.pct)}</div><div style="font-size:24px;font-weight:900">${sgn(bd.total60)}</div>
    <div class="muted" style="font-size:13px;font-weight:700;margin-top:4px">band ${ord(bd.pct_lo)}–${ord(bd.pct_hi)}</div></aside>
  </section>

  <section class="table">
    <div class="cell"><b>Team</b><span>${esc(b.team) || '—'}</span></div>
    <div class="cell"><b>Pos</b><span>${esc(b.pos)}</span></div>
    <div class="cell"><b>Shoots</b><span>${esc(b.shoots) || '—'}</span></div>
    <div class="cell"><b>Season</b><span>${esc(b.season)}</span></div>
    <div class="cell"><b>Line</b><span>${esc(b.line) || '—'}</span></div>
    <div class="cell"><b>PP</b><span>${b.pp_unit ? 'PP' + b.pp_unit : '—'}</span></div>
    <div class="cell"><b>PK</b><span>${b.pk_unit ? 'PK' + b.pk_unit : '—'}</span></div>
    <div class="cell"><b>Draft</b><span>${esc(b.draft) || 'Undrafted'}</span></div>
    <div class="cell"><b>Age</b><span>${b.age ?? '—'}</span></div>
    <div class="cell"><b>Height</b><span>${esc(b.height) || '—'}</span></div>
    <div class="cell"><b>Weight</b><span>${esc(b.weight) || '—'}</span></div>
  </section>

  <section class="toggle"><b>Ranked Against</b>${['pg', 'all', 'tm', 'xp'].map((g) =>
    `<button data-group="${g}" class="${g === GROUP ? 'active' : ''}">${esc(groupLabels[g])}</button>`).join('')}</section>

  <section class="rankstrip">
    <div class="rank good"><b>Overall rank</b><span>#${bd.rank} / ${bd.n}</span></div>
    <div class="rank good"><b>Team rank</b><span>#${bd.team_rank} ${esc(b.team)}</span></div>
    <div class="rank good"><b>Position rank</b><span>#${bd.pos_rank} / ${bd.pos_n}</span></div>
    <div class="rank${bd.under_rank && bd.under_rank <= 50 ? ' good' : ''}"><b>Underused rank</b><span>${bd.under_rank ? '#' + bd.under_rank : '—'}</span></div>
    <div class="rank"><b>Overused rank</b><span>${bd.over_rank && bd.over_rank <= 50 ? '#' + bd.over_rank : '—'}</span></div>
    <div class="rank${(bd.trend_rank ?? 0) >= 60 ? ' good' : ''}"><b>Last-10 trend</b><span>${ord(bd.trend_rank)} pct</span></div>
  </section>

  <section class="grid3">
    <article class="panel">
      <div class="head"><h2>Offence</h2><span>vs ${esc(vsLabel)} · goals of impact /60</span></div>
      ${bar('Overall Offence /60', comp.off)}
      ${bar('OZ-Faceoff Offence', c.off_oz)}
      ${bar('In-Flow Offence', c.off_fly)}
      ${bar('Finishing', sk.finishing)}
      ${bar('Playmaking', sk.playmaking)}
      ${bar('Entry Creation', sk.dv_off)}
      ${bar('Power Play', comp.pp)}
    </article>

    <article class="panel">
      <div class="head"><h2>Defence</h2><span>vs ${esc(vsLabel)} · goals of impact /60</span></div>
      ${bar('Overall Defence /60', comp.def)}
      ${bar('DZ-Faceoff Defence', c.dz_set, 4)}
      ${bar('Rush Defence', c.dz_rush, 4)}
      ${bar('Entry Prevention', sk.dv_def)}
      ${bar('Penalty Kill', comp.pk)}
      ${bar('Penalty Differential', comp.pen)}
    </article>

    <article class="panel">
      <div class="head"><h2>Profile Spider</h2><span>Percentiles vs ${esc(vsLabel)}</span></div>
      <div class="spider">${spider(d.spider)}</div>
    </article>

    <div class="reads">
      <div class="read"><b>Process</b><span>${ord(bd.pct)} pct</span><small>Forward impact rating vs all skaters</small></div>
      <div class="read"><b>Production</b><span>${ord(pr.p60_pct)} pct</span><small>Points per 60 vs ${posGroup.toLowerCase()}</small></div>
      <div class="read"><b>Usage</b><span>${ord(mp(us.toi_gp))} pct</span><small>Ice time per game vs ${posGroup.toLowerCase()}</small></div>
    </div>
  </section>

  <section class="bottom">
    <article class="panel">
      <div class="head"><h2>Production</h2><span>Raw output + peer percentiles</span></div>
      <table class="prod">
        <thead><tr><th>State</th><th>G</th><th>iXG</th><th>G-iXG</th><th>A1</th><th>A2</th><th>P/60</th><th>Pctl</th></tr></thead>
        <tbody>${(pr.states || []).map((s) => `<tr><td>${esc(s.state)}</td><td>${s.g ?? '—'}</td><td>${s.ixg ?? '—'}</td><td>${s.g != null && s.ixg != null ? sgn(s.g - s.ixg, 1) : '—'}</td><td>${s.a1 ?? '—'}</td><td>${s.a2 ?? '—'}</td><td>${s.p60 ?? '—'}</td><td>${ord(s.p60_pct)}</td></tr>`).join('')}</tbody>
      </table>
      ${d.faceoffs && d.faceoffs.n >= 100 ? bar(`Faceoffs (${d.faceoffs.n} taken)`, d.faceoffs.m, 1) : ''}
      <div class="head" style="margin-top:18px;margin-bottom:10px"><h2 style="font-size:18px">Shooting</h2><span>Finishing sustainability</span></div>
      <div class="shooting-grid">
        <div class="shooting-card"><b>Goals vs iXG</b><span>${sgn(pr.g_minus_ixg, 1)}</span><small>${pr.g_minus_ixg > 1 ? 'Finishing above expected' : pr.g_minus_ixg < -1 ? 'Finishing below expected' : 'Near expected'}</small></div>
        <div class="shooting-card"><b>Shooting %</b><span>${sh.sh_pct != null ? sh.sh_pct + '%' : '—'}</span><small>on-goal shots</small></div>
        <div class="shooting-card"><b>Shot quality</b><span>${sh.ixg_per_shot != null ? sh.ixg_per_shot + ' iXG/shot' : '—'}</span><small>&nbsp;</small></div>
        <div class="shooting-card"><b>Shot volume</b><span>${sh.shots60 != null ? sh.shots60 + ' att/60' : '—'}</span><small>&nbsp;</small></div>
      </div>
      <div class="head" style="margin-top:18px;margin-bottom:10px"><h2 style="font-size:18px">Usage</h2><span>Coach trust · 5v5</span></div>
      ${bar('TOI per game', us.toi_gp, 1)}
      ${spark(us)}
      <div class="trust-grid">
        <div class="trust-card"><b>Late-game TOI</b><span>${ord(mp(tr.late))} pct</span></div>
        <div class="trust-card"><b>Trailing by 1</b><span>${ord(mp(tr.trail1))} pct</span></div>
        <div class="trust-card"><b>Protecting lead</b><span>${ord(mp(tr.lead1))} pct</span></div>
        <div class="trust-card"><b>Recent trust</b><span>${trustWord(tr.trend_min)}</span></div>
      </div>
      <div class="head" style="margin:12px 0 8px"><h2 style="font-size:18px">3-Year Trajectory</h2><span>Net impact percentile by season</span></div>
      <div class="trust-grid" style="grid-template-columns:repeat(3,1fr)">
        ${(d.trajectory || []).map((t) => `<div class="trust-card"><b>${esc(t.s)}</b><span>${t.pct == null ? '—' : ord(t.pct) + ' pct'}</span></div>`).join('')}
      </div>
    </article>

    <article class="panel">
      <div class="head"><h2>5v5 On Ice Shot Map</h2><span>Season shot profile</span></div>
      <div class="spark">${rink(d.shot_map, RINK)}</div>
    </article>

    <article class="panel">
      <div class="head"><h2>Context</h2><span>Environment</span></div>
      ${bar('Quality of Teammates', cx.qot)}
      ${bar('Quality of Competition', cx.qoc)}
      <div style="margin-top:12px">
        <b style="font-size:12px">Common linemates (5v5 TOI share)</b>
        <div style="margin-top:7px;font-size:13px">${(cx.linemates || []).map((l) => `${esc(l.name)} <b>${l.share}%</b>`).join(' · ') || '—'}</div>
        <div class="dependence-row"><b>With ${esc(wy.mate || 'top linemate')} xG%</b><span>${wy.with_xg != null ? wy.with_xg + '%' : '—'}</span></div>
        <div class="dependence-row"><b>Away from ${esc(wy.mate || 'top linemate')} xG%</b><span>${wy.away_xg != null ? wy.away_xg + '%' : '—'}</span></div>
        <div class="dependence-row"><b>Linemate independence</b><span>${ord(wy.independence_pct)} pct</span></div>
        <div class="dependence-row"><b>Line-driving flag</b><span>${wy.away_xg == null ? '—' : wy.away_xg >= 50 ? 'Positive away' : 'Negative away'}</span></div>
      </div>
      <div class="pill" style="margin-top:14px"><b>Current deployment</b><span>${esc(b.line) || '—'}${b.pp_unit ? ' · PP' + b.pp_unit : ''}${b.pk_unit ? ' · PK' + b.pk_unit : ''}</span></div>
    </article>

    <article class="panel">
      <div class="head"><h2>Style</h2><span>Role tendencies</span></div>
      <b style="font-size:13px">Event Style</b>
      <div class="split"><div class="l" style="width:${st.pace_pct ?? 50}%">${st.pace_pct ?? 50}% pace</div><div class="r" style="width:${100 - (st.pace_pct ?? 50)}%">${100 - (st.pace_pct ?? 50)}% control</div></div>
      <b style="font-size:13px">Zone Entry Style (proxy)</b>
      ${carryShare != null
        ? `<div class="split"><div class="l" style="width:${100 - carryShare}%">${100 - carryShare}% dump</div><div class="r" style="width:${carryShare}%">${carryShare}% carry</div></div>
      <div class="note" style="margin:-8px 0 12px">Experimental proxy: carry ~ ΔV offence pct, dump ~ territory-push pct</div>`
        : '<div class="note" style="margin:2px 0 12px">Not qualified</div>'}
      ${bar('Hits /60', st.hits60, 1)}
      ${bar('Penalties drawn /60', st.pen_drawn60, 2)}
      ${bar('Penalties taken /60', st.pen_taken60, 2)}
      ${bar('Takeaways − Giveaways /60', st.tkgv60, 2)}
      ${bar('Blocked shots /60', st.blk60, 2)}
    </article>
  </section>

  <div class="footer">netoutcomes.ca</div>`;

    root.querySelectorAll('.toggle button').forEach((btn) => {
      btn.addEventListener('click', () => {
        GROUP = btn.getAttribute('data-group') || 'pg';
        render();
      });
    });
  }

  Promise.all([
    fetch(`../data/players/${pid}.json`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }),
    fetch('../data/rink_base.svg')
      .then((r) => (r.ok ? r.text() : ''))
      .catch(() => ''),
  ])
    .then(([d, rinkBase]) => { DATA = d; RINK = rinkBase; render(); })
    .catch(() => {
      root.innerHTML = '<div class="panel" style="margin-top:40px"><h2>Player data unavailable</h2>' +
        '<div class="note">This player\'s card data could not be loaded. <a href="../rankings.html">Back to rankings</a></div></div>';
    });
})();
