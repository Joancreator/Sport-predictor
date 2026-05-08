// =====================================================================
// NBA PLAYERS — perfiles de jugadores NBA con gamelog y gráficas
// =====================================================================

    async function loadNBAPlayer(id) {
      try {
        // En paralelo: perfil + game log de toda la temporada
        const [profR, logR] = await Promise.all([
          fetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}`),
          fetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}/gamelog`)
        ]);
        if (!profR.ok) throw new Error(`Perfil HTTP ${profR.status}`);
        const profile = await profR.json();
        const log = logR.ok ? await logR.json() : null;

        const player = profile.athlete;
        if (!player) throw new Error('Jugador no encontrado');

        // Extraer partidos de TODOS los tipos de temporada (regular + playoffs)
        const eventsDict = log?.events || {};
        const seasonTypes = log?.seasonTypes || [];

        const allGames = [];
        seasonTypes.forEach(st => {
          const isPlayoffs = /(post|playoff)/i.test(st.displayName || '');
          st.categories?.forEach(cat => {
            if (cat.type === 'event' && Array.isArray(cat.events)) {
              cat.events.forEach(e => {
                const stats = parseGameStats(e.stats);
                const info = eventsDict[e.eventId];
                if (stats && info) allGames.push({ ...stats, event: info, isPlayoffs });
              });
            }
          });
        });
        // Más recientes primero
        allGames.sort((a, b) => new Date(b.event.gameDate) - new Date(a.event.gameDate));
        const games = allGames.slice(0, 15);

        document.getElementById('playerBreadcrumb').textContent = `NBA › ${player.displayName}`;
        renderNBAPlayer(player, allGames, games);

      } catch(e) {
        document.getElementById('playerContent').innerHTML = `
          <div class="error-container">
            <p>No se pudieron cargar los datos del jugador NBA</p>
            <p style="font-size:0.8rem;color:var(--text-muted)">${e.message}</p>
          </div>`;
      }
    }

    // Promedio de un campo numérico de un array de juegos
    function avgField(arr, key) {
      if (!arr.length) return 0;
      return arr.reduce((s, g) => s + (g[key] || 0), 0) / arr.length;
    }

    // Guarda los juegos del jugador actual para que switchNBAStat pueda acceder
    let currentNBAGamesData = { games: [], avgs: {} };

    function switchNBAStat(key) {
      if (!playerCharts.nba) return;
      const { games, avgs } = currentNBAGamesData;
      const vals = games.map(g => g[key] || 0).reverse();
      const avg  = avgs[key] || 0;
      const ds   = playerCharts.nba.data.datasets;
      ds[0].label = key;
      ds[0].data  = vals;
      ds[0].backgroundColor = vals.map(v =>
        v >= avg * 1.2 ? 'rgba(0,208,132,0.75)' : 'rgba(77,166,255,0.65)'
      );
      ds[1].data = new Array(vals.length).fill(parseFloat(avg.toFixed(1)));
      ds[1].label = `Promedio ${key}`;
      playerCharts.nba.update();
      const titleEl = document.getElementById('nbaChartTitle');
      if (titleEl) titleEl.textContent = `${key} por partido — últimos ${games.length} juegos`;
      document.querySelectorAll('.stat-filter-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.stat === key)
      );
    }

    function renderNBAPlayer(player, allGames, games) {
      const name = player.displayName;
      const teamFull = player.team?.displayName || '—';

      // Promedios de TODA la temporada (calculados desde el game log oficial)
      const gp = allGames.length;
      const ppg = avgField(allGames, 'PTS');
      const rpg = avgField(allGames, 'REB');
      const apg = avgField(allGames, 'AST');
      const spg = avgField(allGames, 'STL');
      const bpg = avgField(allGames, 'BLK');
      const mpg = avgField(allGames, 'MIN');
      const fgPct  = avgField(allGames, 'FG_PCT');
      const fg3Pct = avgField(allGames, 'FG3_PCT');
      const ftPct  = avgField(allGames, 'FT_PCT');
      const fga = avgField(allGames, 'FGA');
      const fta = avgField(allGames, 'FTA');
      const ts = calcTS(ppg, fga, fta);

      const fmt1 = v => v ? v.toFixed(1) : '—';
      const fmtPct = v => v ? (v*100).toFixed(1)+'%' : '—';

      const pts = fmt1(ppg);
      const reb = fmt1(rpg);
      const ast = fmt1(apg);
      const stl = fmt1(spg);
      const blk = fmt1(bpg);
      const fg  = fmtPct(fgPct);
      const fg3 = fmtPct(fg3Pct);
      const ft  = fmtPct(ftPct);
      const mpgStr = fmt1(mpg);
      const tsStr  = ts ? (ts*100).toFixed(1)+'%' : '—';

      // Tendencia: puntos últimos 5 vs promedio
      const last5 = games.slice(0,5);
      const avg5 = last5.length ? avgField(last5, 'PTS') : null;
      const trend = avg5===null || !ppg ? '' :
        avg5 > ppg*1.15 ? '<span class="trend-badge trend-hot">↑ Racha caliente</span>' :
        avg5 < ppg*0.80 ? '<span class="trend-badge trend-cold">↓ Bajando</span>' :
        '<span class="trend-badge trend-neutral">→ Estable</span>';

      // % de victorias cuando anota ≥ su promedio. ESPN da event.gameResult "W"/"L"
      const aboveAvg = games.filter(g => (g.PTS||0) >= ppg);
      const wins = aboveAvg.filter(g => g.event?.gameResult === 'W');
      const winRate = aboveAvg.length ? Math.round(wins.length/aboveAvg.length*100) : null;

      // ESPN: event.atVs === "vs" (casa) o "@" (ruta)
      const isHomeGame = g => g.event?.atVs === 'vs';
      const homeG = games.filter(isHomeGame);
      const awayG = games.filter(g => !isHomeGame(g));
      const avgS = (arr, k) => arr.length ? avgField(arr, k).toFixed(1) : '—';

      // Datos para el chart (orden cronológico ascendente)
      const chartDates = games.map(g => {
        const d = new Date(g.event?.gameDate);
        return `${d.getMonth()+1}/${d.getDate()}`;
      }).reverse();
      const chartPts = games.map(g => g.PTS||0).reverse();
      const avgLine  = new Array(chartDates.length).fill(ppg||0);

      const fmtMin = m => m == null ? '—' : Math.round(m);

      // Campos del perfil ESPN: position.abbreviation, jersey, displayHeight, displayWeight
      const pos    = player.position?.abbreviation || player.position?.displayName || '—';
      const jersey = player.jersey || '—';
      const height = player.displayHeight || player.height || '—';
      const weight = player.displayWeight || (player.weight ? player.weight + ' lbs' : '—');

      document.getElementById('playerContent').innerHTML = `
        <div class="player-header-card nba">
          <div class="player-avatar">${getInitials(name)}</div>
          <div>
            <div class="player-full-name">${name}</div>
            <div class="player-meta">
              <span class="player-meta-item">${teamFull}</span>
              <span class="player-meta-item">${pos}</span>
              <span class="player-meta-item">#${jersey}</span>
              <span class="player-meta-item">${height}</span>
              <span class="player-meta-item">${weight}</span>
              <span class="player-meta-item">${gp} partidos</span>
              ${trend}
            </div>
            ${winRate!==null ? `<div style="margin-top:9px;font-size:0.82rem;color:var(--text-secondary)">
              Su equipo gana el <strong style="color:var(--accent-green)">${winRate}%</strong>
              cuando anota ≥ ${Math.round(ppg)} pts (últimos ${games.length} partidos)
            </div>` : ''}
          </div>
        </div>

        <div class="stats-grid">
          ${[
            ['PPG',pts,'var(--accent-green)'],['RPG',reb],['APG',ast],
            ['SPG',stl],['BPG',blk],['FG%',fg],['3P%',fg3],['FT%',ft],
            ['TS%',tsStr,'var(--accent-blue)'],['MPG',mpgStr],
          ].map(([l,v,c])=>`
            <div class="stat-box">
              <div class="stat-box-value" ${c?`style="color:${c}"`:''}>${v}</div>
              <div class="stat-box-label">${l}${l==='TS%'?'<br><span class="stat-box-sublabel">True Shooting</span>':''}</div>
            </div>`).join('')}
        </div>

        <div class="chart-card">
          <div class="chart-card-title" id="nbaChartTitle">PTS por partido — últimos ${games.length} juegos</div>
          <div class="stat-filter-btns">
            ${['PTS','REB','AST','STL','BLK'].map(s =>
              `<button class="stat-filter-btn${s==='PTS'?' active':''}" data-stat="${s}" onclick="switchNBAStat('${s}')">${s}</button>`
            ).join('')}
          </div>
          <div class="chart-canvas-wrapper"><canvas id="nbaPtsChart"></canvas></div>
        </div>

        <div class="table-card">
          <div class="table-card-title">Últimos ${games.length} partidos</div>
          <table class="stats-table">
            <thead><tr><th>Fecha</th><th>Rival</th><th>L/V</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th><th>R</th></tr></thead>
            <tbody>${games.map(g => {
              const isHome = isHomeGame(g);
              const rival = g.event?.opponent?.abbreviation || '?';
              const d = new Date(g.event?.gameDate);
              const won = g.event?.gameResult === 'W';
              const poBadge = g.isPlayoffs ? '<span class="po-badge">PO</span>' : '';
              return `<tr>
                <td>${d.getMonth()+1}/${d.getDate()}${poBadge}</td>
                <td>${isHome?'vs':'@'} ${rival}</td>
                <td>${isHome?'Casa':'Ruta'}</td>
                <td>${fmtMin(g.MIN)}</td>
                <td><strong>${g.PTS??'—'}</strong></td>
                <td>${g.REB??'—'}</td><td>${g.AST??'—'}</td>
                <td>${g.STL??'—'}</td><td>${g.BLK??'—'}</td>
                <td>${g.FGM??'?'}/${g.FGA??'?'}</td>
                <td>${won?'<span class="result-w">W</span>':'<span class="result-l">L</span>'}</td>
              </tr>`;}).join('')}
            </tbody>
          </table>
        </div>

        <div class="splits-row">
          <div class="split-card">
            <div class="split-card-title">Casa vs Ruta (últimos ${games.length})</div>
            <div class="split-row" style="color:var(--text-muted);font-size:0.74rem">Casa (${homeG.length} juegos)</div>
            ${[['PTS',avgS(homeG,'PTS')],['REB',avgS(homeG,'REB')],['AST',avgS(homeG,'AST')]]
              .map(([l,v])=>`<div class="split-row"><span class="split-label">${l}</span><span class="split-value">${v}</span></div>`).join('')}
            <div class="split-row" style="color:var(--text-muted);font-size:0.74rem;margin-top:8px">Ruta (${awayG.length} juegos)</div>
            ${[['PTS',avgS(awayG,'PTS')],['REB',avgS(awayG,'REB')],['AST',avgS(awayG,'AST')]]
              .map(([l,v])=>`<div class="split-row"><span class="split-label">${l}</span><span class="split-value">${v}</span></div>`).join('')}
          </div>
          <div class="split-card">
            <div class="split-card-title">Temporada vs Últimos 5</div>
            ${[['PTS',pts,avg5?avg5.toFixed(1):'—'],['REB',reb,avgS(games.slice(0,5),'REB')],['AST',ast,avgS(games.slice(0,5),'AST')]]
              .map(([l,t,r])=>`
                <div class="split-row"><span class="split-label">${l} temporada</span><span class="split-value">${t}</span></div>
                <div class="split-row"><span class="split-label">${l} últimos 5</span>
                  <span class="split-value" style="color:${parseFloat(r)>parseFloat(t)?'var(--accent-green)':'var(--accent-red)'}">${r}</span>
                </div>`).join('')}
          </div>
        </div>`;

      // Guardar datos para switchNBAStat
      currentNBAGamesData = {
        games,
        avgs: { PTS: ppg, REB: rpg, AST: apg, STL: spg, BLK: bpg }
      };

      if (games.length) {
        playerCharts.nba = new Chart(
          document.getElementById('nbaPtsChart').getContext('2d'), {
            type: 'bar',
            data: { labels: chartDates, datasets: [
              { label:'PTS', data:chartPts, borderRadius:4, borderWidth:0, order:2,
                backgroundColor: chartPts.map(p=>p>=ppg*1.2?'rgba(0,208,132,0.75)':'rgba(77,166,255,0.65)') },
              { label:'Promedio PTS', data:avgLine, type:'line', order:1,
                borderColor:'rgba(255,215,0,0.8)', borderWidth:2, borderDash:[5,5],
                pointRadius:0, fill:false }
            ]},
            options:{responsive:true,maintainAspectRatio:false,
              plugins:{legend:{labels:{color:'#a0a0a0',font:{size:11},boxWidth:12}}},
              scales:{
                x:{ticks:{color:'#606060',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'}},
                y:{beginAtZero:true,ticks:{color:'#606060'},grid:{color:'rgba(255,255,255,0.06)'}}
              }}
          });
      }
    }


    // SECCIÓN PREDICCIONES
    // Combina forma reciente de equipos + probabilidad implícita de las cuotas
    // para calcular un pick con nivel de confianza (Alto / Medio / Bajo).
    // Principio: si no hay datos suficientes, mostramos "Datos insuficientes".
    // =====================================================================

    // Convierte moneyline americano a probabilidad bruta (0-1)
