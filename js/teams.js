// =====================================================================
// TEAMS — sección de equipos NBA/MLB (lista + detalle + gráficas)
// =====================================================================
// Cargado antes de app.js. Las funciones quedan en scope global.

    // =====================================================================
    // SECCIÓN EQUIPOS — estadísticas de equipos NBA y MLB
    // Misma idea que la sección de jugadores: lista → detalle → volver
    // =====================================================================

    // ===== ESTADO GLOBAL DE PREDICCIONES =====
    let allTodayGames    = { nba: [], mlb: [] };  // partidos de hoy cargados en init()
    let allTodayOddsRaw  = { nba: [], mlb: [] };  // datos crudos de The Odds API
    let allTodayOddsOpen = {};                    // odds de apertura del día { 'nba-gameId': shape }
    let predictionsInitialized = false;           // bandera: no recargar al volver

    // ELO: power rating dinámico que se actualiza al reconciliar partidos
    let eloRatings = {};  // { nba: { teamId: 1500 }, mlb: { teamId: 1500 } }
    const ELO_STORAGE_KEY = 'sp_elo_v1';

    // Bankroll del usuario para Kelly Criterion
    let userBankroll = parseFloat(localStorage.getItem('sp_bankroll_v1') || '0') || 0;

    // Calcula el pago por unidad apostada según las cuotas americanas.
    // Ej: +150 → ganas 1.50 por cada 1 apostado; -110 → ganas 0.909.
    function calcBetPayout(odds) {
      if (odds == null || isNaN(odds)) return 0.9091; // fallback -110
      if (odds > 0) return odds / 100;
      return 100 / Math.abs(odds);
    }

    function saveBankroll(amount) {
      userBankroll = parseFloat(amount) || 0;
      localStorage.setItem('sp_bankroll_v1', String(userBankroll));
    }

    let teamCharts = {};
    let currentTeamChartData = {};   // guarda juegos del equipo activo para switchTeamStat
    let currentTeamSport = 'nba';
    let equiposInitialized = false;  // bandera para no recargar al volver

    // Destruye las gráficas anteriores antes de crear nuevas
    function destroyTeamCharts() {
      Object.values(teamCharts).forEach(c => { if (c && c.destroy) c.destroy(); });
      teamCharts = {};
    }

    // Punto de entrada cuando el usuario llega a la sección por primera vez
    async function initEquipos() {
      equiposInitialized = true;
      await loadTeamsList('nba');
    }

    // Cambia entre NBA y MLB en la lista
    async function switchTeamSport(sport, btn) {
      currentTeamSport = sport;
      document.querySelectorAll('.team-sport-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await loadTeamsList(sport);
    }

    // Carga y dibuja el grid de todos los equipos de un deporte.
    // ESPN bloquea por CORS el endpoint /teams, pero el endpoint /standings
    // sí está abierto y trae la misma info (id, nombre, logo) más el récord.
    async function loadTeamsList(sport) {
      const container = document.getElementById('teamsListContainer');
      container.innerHTML = '<div class="loading-container"><div class="spinner"></div><div class="loading-text">Cargando equipos...</div></div>';
      try {
        const url = sport === 'nba'
          ? 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings'
          : 'https://site.api.espn.com/apis/v2/sports/baseball/mlb/standings';
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        // /standings devuelve children[]: una entrada por conferencia/liga.
        // Cada child.standings.entries[] son los equipos con team{} + stats[].
        const entries = (data.children || []).flatMap(c => c.standings?.entries || []);

        if (!entries.length) {
          container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">No se encontraron equipos</div>';
          return;
        }

        // Helper: extrae victorias y derrotas de los stats[] del equipo.
        const findStat = (stats, name) => {
          const s = (stats || []).find(x => x.name === name);
          return s ? (s.value ?? null) : null;
        };

        // Ordenamos alfabéticamente por nombre para que sea fácil encontrar.
        entries.sort((a, b) =>
          (a.team?.displayName || '').localeCompare(b.team?.displayName || ''));

        container.innerHTML = `<div class="teams-grid">${
          entries.map(e => {
            const tm = e.team || {};
            const wins   = findStat(e.stats, 'wins');
            const losses = findStat(e.stats, 'losses');
            const record = (wins != null && losses != null) ? `${wins}-${losses}` : '';
            const logo   = tm.logos?.[0]?.href || '';
            return `
              <div class="team-card" onclick="openTeamDetail('${tm.id}','${sport}')">
                <div class="team-card-logo-wrap">
                  ${logo
                    ? `<img class="team-card-logo" src="${logo}" alt="${tm.displayName}" onerror="this.style.display='none';this.nextSibling.style.display='flex'">
                       <div class="team-logo-fallback" style="display:none">${tm.abbreviation || '?'}</div>`
                    : `<div class="team-logo-fallback">${tm.abbreviation || '?'}</div>`}
                </div>
                <div class="team-card-name">${tm.shortDisplayName || tm.displayName || ''}</div>
                ${record ? `<div class="team-card-record">${record}</div>` : ''}
                <div class="team-card-location">${tm.location || ''}</div>
              </div>`;
          }).join('')
        }</div>`;
      } catch(e) {
        container.innerHTML = `<div class="error-container"><p>Error cargando equipos</p><p style="font-size:0.8rem;color:var(--text-muted)">${e.message}</p></div>`;
      }
    }

    // Abre el perfil de un equipo: oculta la lista y muestra el detalle
    async function openTeamDetail(teamId, sport) {
      document.getElementById('equiposListView').style.display = 'none';
      document.getElementById('equiposDetailView').style.display = 'block';
      const loadEl = document.getElementById('teamLoadingState');
      document.getElementById('teamDetailContent').innerHTML = '';
      loadEl.style.display = 'flex';
      destroyTeamCharts();
      document.getElementById('teamBreadcrumb').textContent = `${sport.toUpperCase()} › cargando...`;
      if (sport === 'nba') await loadNBATeamData(teamId);
      else await loadMLBTeamData(teamId);
      loadEl.style.display = 'none';
    }

    // Regresa de un perfil de equipo a la lista
    function goBackFromTeamDetail() {
      destroyTeamCharts();
      document.getElementById('equiposDetailView').style.display = 'none';
      document.getElementById('equiposListView').style.display = 'block';
    }

    // Cambia la métrica que muestra la gráfica del equipo (a favor / en contra)
    // Sigue el mismo patrón de mutar + .update() que en los jugadores
    function switchTeamStat(key) {
      if (!teamCharts.main) return;
      const { games } = currentTeamChartData;
      const isFavor = key === 'PTS_FAVOR';
      const vals = games.map(g => isFavor ? g.ptsFavor : g.ptsContra);
      const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      const ds = teamCharts.main.data.datasets;
      ds[0].label = isFavor ? 'A favor' : 'En contra';
      ds[0].data  = vals;
      ds[0].backgroundColor = vals.map(v =>
        isFavor
          ? (v >= avg * 1.1 ? 'rgba(0,208,132,0.75)' : 'rgba(77,166,255,0.65)')
          : (v <= avg * 0.9 ? 'rgba(0,208,132,0.75)' : 'rgba(255,77,77,0.65)')
      );
      ds[1].data  = new Array(vals.length).fill(parseFloat(avg.toFixed(1)));
      ds[1].label = 'Promedio';
      teamCharts.main.update();
      const titleEl = document.getElementById('teamChartTitle');
      if (titleEl) titleEl.textContent = `${isFavor ? 'Puntos anotados' : 'Puntos recibidos'} — últimos ${games.length} partidos`;
      document.querySelectorAll('.team-stat-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.stat === key)
      );
    }

    // ===== HELPER: extrae los partidos completados del schedule ESPN =====
    // Funciona igual para NBA y MLB porque la estructura de respuesta es idéntica
    function parseTeamSchedule(events, teamId) {
      return events
        .filter(e => e.competitions?.[0]?.status?.type?.state === 'post')
        .map(e => {
          const comp = e.competitions[0];
          // El competidor cuyo id coincide es nuestro equipo
          const mine = comp.competitors.find(c => String(c.team?.id) === String(teamId));
          const opp  = comp.competitors.find(c => String(c.team?.id) !== String(teamId));
          // ESPN devuelve score como objeto {value:113, displayValue:"113"} en el schedule
        // y como string "113" en el scoreboard — manejamos los dos casos
        const parseScore = s => Number(s?.value ?? s) || 0;
        return {
            date:      e.date,
            opponent:  opp?.team?.abbreviation || '?',
            isHome:    mine?.homeAway === 'home',
            ptsFavor:  parseScore(mine?.score),
            ptsContra: parseScore(opp?.score),
            won:       mine?.winner === true
          };
        })
        .reverse(); // más recientes primero
    }

    // ===== HELPER: calcula estadísticas de resumen a partir de los partidos =====
    function calcTeamStats(all, last10, teamId) {
      const wins  = all.filter(g => g.won).length;
      const losses = all.length - wins;
      const homeG = all.filter(g => g.isHome);
      const awayG = all.filter(g => !g.isHome);
      const homeW = homeG.filter(g => g.won).length;
      const awayW = awayG.filter(g => g.won).length;
      const avgFavor  = n => n.length ? (n.reduce((a,g) => a+g.ptsFavor,  0)/n.length) : null;
      const avgContra = n => n.length ? (n.reduce((a,g) => a+g.ptsContra, 0)/n.length) : null;
      const last10W = last10.filter(g => g.won).length;
      // Racha actual (empieza desde el partido más reciente)
      let streak = 0, streakType = '';
      for (const g of all) {
        if (!streakType) streakType = g.won ? 'G' : 'P';
        if ((g.won && streakType==='G') || (!g.won && streakType==='P')) streak++;
        else break;
      }
      return { wins, losses, homeG, awayG, homeW, awayW, last10W, streak, streakType,
               ppgFavor: avgFavor(all), ppgContra: avgContra(all),
               homeFavor: avgFavor(homeG), homeContra: avgContra(homeG),
               awayFavor: avgFavor(awayG), awayContra: avgContra(awayG),
               l10Favor: avgFavor(last10), l10Contra: avgContra(last10) };
    }

    // ===== HELPER: construye el HTML del detalle (compartido NBA y MLB) =====
    function renderTeamDetailHTML(team, sport, st, all, last10) {
      const logo = team.logos?.[0]?.href || '';
      const rec  = `${st.wins}-${st.losses}`;
      const homeRec = `${st.homeW}-${st.homeG.length - st.homeW}`;
      const awayRec = `${st.awayW}-${st.awayG.length - st.awayW}`;
      const diff = st.ppgFavor != null ? (st.ppgFavor - st.ppgContra).toFixed(1) : '—';
      const streakStr = st.streak > 0 ? `${st.streak}${st.streakType}` : '—';
      const isMlb = sport === 'mlb';
      // Etiquetas: NBA usa "puntos", MLB usa "carreras"
      const ptLbl    = isMlb ? 'R/J'   : 'PPG';
      const ptLblOpp = isMlb ? 'RA/J'  : 'OPPG';
      const diffLbl  = isMlb ? 'Dif R' : 'Dif';
      const chartLbl = isMlb ? 'Carreras anotadas' : 'Puntos anotados';
      const tableLbl = isMlb ? 'Carreras' : 'PTS';

      const fmt = v => v != null ? v.toFixed(1) : '—';

      // Gráfica: orden cronológico (oldest → newest)
      const chrono = [...last10].reverse();
      const chartDates     = chrono.map(g => { const d=new Date(g.date); return `${d.getMonth()+1}/${d.getDate()}`; });
      const chartFavor     = chrono.map(g => g.ptsFavor);
      const avgFavorChart  = st.l10Favor || 0;

      return { rec, homeRec, awayRec, diff, streakStr, ptLbl, ptLblOpp, diffLbl, chartLbl, tableLbl, fmt,
               chrono, chartDates, chartFavor, avgFavorChart,
               html: `
        <div class="team-detail-header">
          <div class="team-detail-logo-wrap">
            ${logo
              ? `<img class="team-detail-logo" src="${logo}" alt="${team.displayName}" onerror="this.style.display='none'">`
              : `<div class="team-logo-fallback" style="width:84px;height:84px;font-size:1.2rem">${team.abbreviation}</div>`}
          </div>
          <div>
            <div class="team-detail-name">${team.displayName}</div>
            <div class="player-meta">
              <span class="player-meta-item">${team.location || ''}</span>
              <span class="player-meta-item">${sport.toUpperCase()}</span>
              <span class="player-meta-item record-badge">${rec}</span>
            </div>
          </div>
        </div>

        <div class="stats-grid">
          ${[
            ['Record',       rec,       'var(--accent-green)'],
            ['Casa',         homeRec],
            ['Ruta',         awayRec],
            ['Últimos 10',   `${st.last10W}-${last10.length-st.last10W}`],
            ['Racha',        streakStr, st.streak>=3?(st.streakType==='G'?'var(--accent-green)':'var(--accent-red)'):''],
            [ptLbl,          fmt(st.ppgFavor),  'var(--accent-blue)'],
            [ptLblOpp,       fmt(st.ppgContra), st.ppgContra!=null&&st.ppgContra<st.ppgFavor?'var(--accent-green)':'var(--accent-red)'],
            [diffLbl,        parseFloat(diff)>0?`+${diff}`:diff, parseFloat(diff)>0?'var(--accent-green)':'var(--accent-red)'],
            ['PJ',           all.length],
          ].map(([l,v,c]) => `
            <div class="stat-box">
              <div class="stat-box-value" ${c?`style="color:${c}"`:''}>${v}</div>
              <div class="stat-box-label">${l}</div>
            </div>`).join('')}
        </div>

        <div class="chart-card">
          <div class="chart-card-title" id="teamChartTitle">${chartLbl} — últimos ${last10.length} juegos</div>
          <div class="stat-filter-btns">
            <button class="stat-filter-btn team-stat-btn active" data-stat="PTS_FAVOR"  onclick="switchTeamStat('PTS_FAVOR')">A FAVOR</button>
            <button class="stat-filter-btn team-stat-btn"        data-stat="PTS_CONTRA" onclick="switchTeamStat('PTS_CONTRA')">EN CONTRA</button>
          </div>
          <div class="chart-canvas-wrapper"><canvas id="teamMainChart"></canvas></div>
        </div>

        <div class="table-card">
          <div class="table-card-title">Últimos ${last10.length} juegos</div>
          <table class="stats-table">
            <thead><tr><th>Fecha</th><th>Rival</th><th>L/V</th><th>${tableLbl}</th><th>Contra</th><th>R</th></tr></thead>
            <tbody>${last10.map(g => {
              const d = new Date(g.date);
              return `<tr>
                <td>${d.getMonth()+1}/${d.getDate()}</td>
                <td>${g.isHome?'vs':'@'} ${g.opponent}</td>
                <td>${g.isHome?'Casa':'Ruta'}</td>
                <td><strong style="color:${g.ptsFavor>g.ptsContra?'var(--accent-green)':'inherit'}">${g.ptsFavor}</strong></td>
                <td>${g.ptsContra}</td>
                <td>${g.won?'<span class="result-w">W</span>':'<span class="result-l">L</span>'}</td>
              </tr>`;}).join('')}
            </tbody>
          </table>
        </div>

        <div class="splits-row">
          <div class="split-card">
            <div class="split-card-title">Casa vs Ruta</div>
            <div class="split-row" style="color:var(--text-muted);font-size:0.74rem">Casa (${st.homeG.length} juegos)</div>
            <div class="split-row"><span class="split-label">Record</span><span class="split-value">${homeRec}</span></div>
            <div class="split-row"><span class="split-label">${ptLbl}</span><span class="split-value">${fmt(st.homeFavor)}</span></div>
            <div class="split-row"><span class="split-label">${ptLblOpp}</span><span class="split-value">${fmt(st.homeContra)}</span></div>
            <div class="split-row" style="color:var(--text-muted);font-size:0.74rem;margin-top:8px">Ruta (${st.awayG.length} juegos)</div>
            <div class="split-row"><span class="split-label">Record</span><span class="split-value">${awayRec}</span></div>
            <div class="split-row"><span class="split-label">${ptLbl}</span><span class="split-value">${fmt(st.awayFavor)}</span></div>
            <div class="split-row"><span class="split-label">${ptLblOpp}</span><span class="split-value">${fmt(st.awayContra)}</span></div>
          </div>
          <div class="split-card">
            <div class="split-card-title">Últimos 10 juegos</div>
            <div class="split-row">
              <span class="split-label">Record</span>
              <span class="split-value" style="color:${st.last10W>=7?'var(--accent-green)':st.last10W<=3?'var(--accent-red)':'var(--accent-yellow)'}">${st.last10W}-${last10.length-st.last10W}</span>
            </div>
            <div class="split-row"><span class="split-label">${ptLbl} (L10)</span><span class="split-value">${fmt(st.l10Favor)}</span></div>
            <div class="split-row"><span class="split-label">${ptLblOpp} (L10)</span><span class="split-value">${fmt(st.l10Contra)}</span></div>
            <div class="split-row" style="margin-top:8px">
              <span class="split-label">Racha</span>
              <span class="split-value" style="color:${st.streakType==='G'?'var(--accent-green)':'var(--accent-red)'}">${streakStr}</span>
            </div>
            <div class="split-row">
              <span class="split-label">Diferencial ${isMlb?'R/J':'PPG'}</span>
              <span class="split-value" style="color:${parseFloat(diff)>0?'var(--accent-green)':'var(--accent-red)'}">
                ${parseFloat(diff)>0?'+':''}${diff}
              </span>
            </div>
          </div>
        </div>`
      };
    }

    // ===== CARGAR EQUIPO NBA =====
    async function loadNBATeamData(id) {
      try {
        const [teamR, schedR] = await Promise.all([
          fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${id}`),
          fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${id}/schedule`)
        ]);
        if (!teamR.ok) throw new Error(`HTTP ${teamR.status}`);
        const team = (await teamR.json()).team;
        document.getElementById('teamBreadcrumb').textContent = `NBA › ${team.displayName}`;
        const events = schedR.ok ? (await schedR.json()).events || [] : [];
        const all    = parseTeamSchedule(events, id);
        const last10 = all.slice(0, 10);
        const st     = calcTeamStats(all, last10, id);
        const render = renderTeamDetailHTML(team, 'nba', st, all, last10);
        document.getElementById('teamDetailContent').innerHTML = render.html;
        currentTeamChartData = { games: render.chrono, sport: 'nba' };
        if (last10.length) buildTeamChart(render.chartDates, render.chartFavor, render.avgFavorChart, 'Puntos anotados');
      } catch(e) {
        document.getElementById('teamDetailContent').innerHTML =
          `<div class="error-container"><p>Error cargando equipo NBA</p><p style="font-size:0.8rem;color:var(--text-muted)">${e.message}</p></div>`;
      }
    }

    // ===== CARGAR EQUIPO MLB =====
    async function loadMLBTeamData(id) {
      try {
        const [teamR, schedR] = await Promise.all([
          fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${id}`),
          fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${id}/schedule`)
        ]);
        if (!teamR.ok) throw new Error(`HTTP ${teamR.status}`);
        const team = (await teamR.json()).team;
        document.getElementById('teamBreadcrumb').textContent = `MLB › ${team.displayName}`;
        const events = schedR.ok ? (await schedR.json()).events || [] : [];
        const all    = parseTeamSchedule(events, id);
        const last10 = all.slice(0, 10);
        const st     = calcTeamStats(all, last10, id);
        const render = renderTeamDetailHTML(team, 'mlb', st, all, last10);
        document.getElementById('teamDetailContent').innerHTML = render.html;
        currentTeamChartData = { games: render.chrono, sport: 'mlb' };
        if (last10.length) buildTeamChart(render.chartDates, render.chartFavor, render.avgFavorChart, 'Carreras anotadas');
      } catch(e) {
        document.getElementById('teamDetailContent').innerHTML =
          `<div class="error-container"><p>Error cargando equipo MLB</p><p style="font-size:0.8rem;color:var(--text-muted)">${e.message}</p></div>`;
      }
    }

    // ===== CREAR GRÁFICA DEL EQUIPO =====
    // Se crea una vez; switchTeamStat la muta sin recrearla (mismo patrón que jugadores)
    function buildTeamChart(labels, data, avg, label) {
      teamCharts.main = new Chart(
        document.getElementById('teamMainChart').getContext('2d'), {
          type: 'bar',
          data: {
            labels,
            datasets: [
              { label, data, borderRadius: 4, borderWidth: 0, order: 2,
                backgroundColor: data.map(v => v >= avg * 1.1 ? 'rgba(0,208,132,0.75)' : 'rgba(77,166,255,0.65)') },
              { label: 'Promedio', data: new Array(labels.length).fill(parseFloat(avg.toFixed(1))),
                type: 'line', order: 1,
                borderColor: 'rgba(255,215,0,0.8)', borderWidth: 2, borderDash: [5,5],
                pointRadius: 0, fill: false }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#a0a0a0', font: { size: 11 }, boxWidth: 12 } } },
            scales: {
              x: { ticks: { color: '#606060', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
              y: { beginAtZero: false, ticks: { color: '#606060' }, grid: { color: 'rgba(255,255,255,0.06)' } }
            }
          }
        });
    }


    // =====================================================================
