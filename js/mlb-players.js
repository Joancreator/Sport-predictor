// =====================================================================
// MLB PLAYERS — perfiles de bateadores y pitchers MLB
// =====================================================================
// Funciones: búsqueda de pitcher rival, splits L/R, gráficas de bateador/pitcher

    // =====================================================================

    // Estado global del bateador activo: permite cambiar ventana y stat sin re-fetch
    let currentBatterData = null;

    // Calcula stats agregadas para una ventana de N juegos (o todos los logs).
    // Devuelve totales + promedios por juego + tasas (% de juegos con ≥1 hit, etc).
    function calcBatterWindow(logs, n) {
      const arr = n ? logs.slice(0, n) : logs;
      const games = arr.length || 1;
      const sum = (k) => arr.reduce((a, g) => a + (g.stat?.[k] || 0), 0);
      const hits = sum('hits'), ab = sum('atBats'), hr = sum('homeRuns');
      const rbi = sum('rbi'),  bb = sum('baseOnBalls'), k = sum('strikeOuts');
      const tb  = sum('totalBases'), pa = sum('plateAppearances') || (ab + bb);
      const slg = ab > 0 ? tb / ab : 0;
      const obp = pa > 0 ? (hits + bb) / pa : 0;
      const avg = ab > 0 ? hits / ab : 0;
      // Cantidad de juegos con al menos N de cada stat → tasa de "props"
      const rate = (key, threshold = 1) =>
        arr.length ? arr.filter(g => (g.stat?.[key] || 0) >= threshold).length / arr.length : 0;
      return {
        games: arr.length,
        // Totales
        hits, ab, hr, rbi, bb, k, tb,
        // Triple slash de la ventana
        avg: avg.toFixed(3).replace(/^0/, ''),
        obp: obp.toFixed(3).replace(/^0/, ''),
        slg: slg.toFixed(3).replace(/^0/, ''),
        ops: (obp + slg).toFixed(3).replace(/^0/, ''),
        // Promedios por juego
        hpg:   (hits / games).toFixed(2),
        hrpg:  (hr / games).toFixed(2),
        bbpg:  (bb / games).toFixed(2),
        kpg:   (k / games).toFixed(2),
        rbipg: (rbi / games).toFixed(2),
        tbpg:  (tb / games).toFixed(2),
        // Tasas de props (% de juegos)
        rate1H:  rate('hits', 1),
        rate2H:  rate('hits', 2),
        rate1HR: rate('homeRuns', 1),
        rate1BB: rate('baseOnBalls', 1),
        rate1RBI: rate('rbi', 1),
        rate1K:  rate('strikeOuts', 1)
      };
    }

    // Encuentra el partido de hoy del bateador y devuelve el pitcher abridor opositor.
    // Devuelve null si su equipo no juega hoy.
    // OJO: el ID que devuelve es el ID de ESPN — para usarlo con MLB Stats API hay que
    // resolverlo a través de resolveMLBPitcherId() que busca por nombre.
    function findTodaysOpposingPitcher(player) {
      // Comparar nombres ignorando mayúsculas/acentos
      const teamName = (player.currentTeam?.name || '').toLowerCase();
      if (!teamName || !allTodayGames.mlb?.length) return null;
      for (const game of allTodayGames.mlb) {
        const comps = game.competitions?.[0]?.competitors || [];
        const mine  = comps.find(c => (c.team?.displayName || '').toLowerCase() === teamName);
        if (!mine) continue;
        const opp = comps.find(c => c !== mine);
        const probable = opp?.probables?.[0];
        if (!probable?.athlete?.fullName) continue;
        return {
          espnId:   probable.athlete.id,                              // ID de ESPN (no sirve para MLB API)
          fullName: probable.athlete.fullName,                        // nombre completo para buscar en MLB
          name:     probable.athlete.shortName || probable.athlete.fullName,
          record:   probable.record || ''
        };
      }
      return null;
    }

    // Resuelve el ID oficial de MLB Stats API buscando por nombre.
    // Necesario porque ESPN usa sus propios IDs (4918155) que no coinciden con MLB (681347).
    async function resolveMLBPitcherId(fullName) {
      const info = await resolveMLBPitcherInfo(fullName);
      return info?.id || null;
    }

    // Versión extendida: id, mano (L/R), K/9, BB/9 y FIP de la temporada.
    // Busca al pitcher por nombre, luego pide sus stats del año para calcular FIP.
    // FIP = (13*HR + 3*BB - 2*K) / IP + 3.20  (constante de liga estándar)
    async function resolveMLBPitcherInfo(fullName) {
      try {
        const r = await fetch(
          `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(fullName)}&sportId=1`
        );
        if (!r.ok) return null;
        const d = await r.json();
        const people = d.people || [];
        const active = people.find(p => p.active);
        const p = active || people[0];
        if (!p) return null;

        // Pedir stats de temporada para K/9, BB/9, FIP
        let kPer9 = null, bbPer9 = null, fip = null;
        try {
          const season = new Date().getFullYear();
          const sr = await fetch(
            `https://statsapi.mlb.com/api/v1/people/${p.id}/stats?stats=season&season=${season}&sportId=1&group=pitching`
          );
          if (sr.ok) {
            const sd = await sr.json();
            const stat = sd.stats?.[0]?.splits?.[0]?.stat;
            if (stat) {
              const k9  = parseFloat(stat.strikeoutsPer9Inn);
              const bb9 = parseFloat(stat.walksPer9Inn);
              const k   = stat.strikeOuts      || 0;
              const bb  = stat.baseOnBalls     || 0;
              const hr  = stat.homeRuns        || 0;
              // inningsPitched viene como "32.2" (32 innings + 2 outs = 32.667)
              const ipStr   = String(stat.inningsPitched || '0');
              const [full, outs] = ipStr.split('.').map(Number);
              const ipNum = full + (outs || 0) / 3;
              kPer9  = isFinite(k9)  ? Math.round(k9  * 10) / 10 : null;
              bbPer9 = isFinite(bb9) ? Math.round(bb9 * 10) / 10 : null;
              if (ipNum > 5) fip = Math.round(((13*hr + 3*bb - 2*k) / ipNum + 3.20) * 100) / 100;
            }
          }
        } catch { /* stats no críticas, continuar sin ellas */ }

        return {
          id:        p.id,
          pitchHand: p.pitchHand?.code || null,  // "L" o "R"
          kPer9,
          bbPer9,
          fip
        };
      } catch { return null; }
    }

    // Cache de mapping nombre-de-equipo-ESPN → id-equipo-MLB-Stats-API.
    // Las dos APIs usan IDs distintos para los mismos equipos.
    let mlbTeamIdCache = null;
    async function getMLBTeamIdMap() {
      if (mlbTeamIdCache) return mlbTeamIdCache;
      try {
        const r = await fetch('https://statsapi.mlb.com/api/v1/teams?sportId=1');
        const d = await r.json();
        mlbTeamIdCache = {};
        for (const t of (d.teams || [])) {
          // Indexamos por nombre completo y por última palabra (ej: "Yankees")
          // para tolerar diferencias de formato entre ESPN y MLB.
          const last = teamLastWord(t.name);
          mlbTeamIdCache[t.name.toLowerCase()] = t.id;
          if (!mlbTeamIdCache[last]) mlbTeamIdCache[last] = t.id;
        }
        return mlbTeamIdCache;
      } catch { return {}; }
    }

    async function getMLBTeamId(displayName) {
      const map = await getMLBTeamIdMap();
      return map[displayName.toLowerCase()] || map[teamLastWord(displayName)] || null;
    }

    // Splits ofensivos del equipo vs pitchers zurdos/derechos.
    // Devuelve { vsL: {avg,obp,slg,ops}, vsR: {avg,obp,slg,ops} }.
    async function fetchTeamHittingSplits(mlbTeamId) {
      if (!mlbTeamId) return null;
      const season = new Date().getFullYear();
      try {
        const url = `https://statsapi.mlb.com/api/v1/teams/${mlbTeamId}/stats` +
          `?stats=statSplits&group=hitting&season=${season}&sitCodes=vl,vr&sportId=1`;
        const r = await fetch(url);
        if (!r.ok) return null;
        const d = await r.json();
        const splits = d.stats?.[0]?.splits || [];
        const out = { vsL: null, vsR: null };
        for (const s of splits) {
          const code = s.split?.code;
          const st   = s.stat || {};
          const data = {
            avg: parseFloat(st.avg) || 0,
            obp: parseFloat(st.obp) || 0,
            slg: parseFloat(st.slg) || 0,
            ops: parseFloat(st.ops) || 0,
            hr:  parseInt(st.homeRuns) || 0,
            ab:  parseInt(st.atBats)   || 0
          };
          if (code === 'vl') out.vsL = data;
          if (code === 'vr') out.vsR = data;
        }
        return out;
      } catch { return null; }
    }

    async function loadMLBPlayer(id) {
      const season = new Date().getFullYear();
      try {
        const [infoR, statsR, logR] = await Promise.all([
          fetch(`https://statsapi.mlb.com/api/v1/people/${id}?hydrate=currentTeam`),
          fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=season&season=${season}&sportId=1&group=hitting,pitching`),
          fetch(`https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&season=${season}&sportId=1`)
        ]);
        const [info, stats, log] = await Promise.all([infoR.json(), statsR.json(), logR.json()]);
        const player = info.people?.[0];
        if (!player) throw new Error('Jugador no encontrado');

        const isPitcher = player.primaryPosition?.type === 'Pitcher';
        const group = isPitcher ? 'pitching' : 'hitting';

        const seasonSplit = stats.stats?.find(s => s.group?.displayName === group)?.splits?.[0]?.stat || null;
        const logStat = log.stats?.find(s => s.group?.displayName === group);
        const allLogs = logStat?.splits || [];
        const gameLogs = allLogs.slice(0, isPitcher ? 5 : 10);
        const homeLogs = allLogs.filter(g => g.isHome);
        const awayLogs = allLogs.filter(g => !g.isHome);

        document.getElementById('playerBreadcrumb').textContent = `MLB › ${player.fullName}`;

        if (isPitcher) {
          renderMLBPitcher(player, seasonSplit, gameLogs, homeLogs, awayLogs);
        } else {
          // Identifica si el equipo del jugador juega hoy y contra qué pitcher
          const todayPitcher = findTodaysOpposingPitcher(player);

          // CRÍTICO: ESPN y MLB Stats API usan IDs distintos. Para BvP necesitamos
          // el ID oficial de MLB, que resolvemos buscando por nombre.
          let mlbPitcherId = null;
          if (todayPitcher?.fullName) {
            mlbPitcherId = await resolveMLBPitcherId(todayPitcher.fullName);
            if (mlbPitcherId) todayPitcher.mlbId = mlbPitcherId;
          }

          // Cargamos splits vs zurdo/derecho + BvP (si aplica) en paralelo
          const splitsURL = `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=statSplits&season=${season}&group=hitting&gameType=R`;
          const bvpURL = mlbPitcherId
            ? `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=vsPlayer&opposingPlayerId=${mlbPitcherId}&sportId=1&group=hitting`
            : null;

          const [splitsR, bvpR] = await Promise.all([
            fetch(splitsURL),
            bvpURL ? fetch(bvpURL) : Promise.resolve(null)
          ]);
          const splitsD = await splitsR.json();
          const allSplits = splitsD.stats?.[0]?.splits || [];

          let bvpData = null;
          if (bvpR) {
            const bvpJson = await bvpR.json();
            const career = bvpJson.stats?.find(s => s.type?.displayName === 'vsPlayerTotal')?.splits?.[0]?.stat;
            const seasons = bvpJson.stats?.find(s => s.type?.displayName === 'vsPlayer')?.splits || [];
            bvpData = { career, seasons, pitcher: todayPitcher };
          }

          // Guardamos todo en estado global para que los botones puedan recalcular
          currentBatterData = {
            player, seasonStat: seasonSplit, allLogs, allSplits, bvpData,
            currentWindow: 10, currentChartStat: 'hits'
          };
          renderMLBBatter();
        }
      } catch(e) {
        document.getElementById('playerContent').innerHTML =
          `<div class="error-container"><p>No se pudieron cargar los datos</p><p style="font-size:0.8rem;color:var(--text-muted)">${e.message}</p></div>`;
      }
    }

    // ===== RENDERIZAR BATEADOR MLB =====
    // Lee de currentBatterData (estado global) — así los botones de ventana
    // pueden re-renderizar sin volver a hacer fetch de datos.
    function renderMLBBatter() {
      const { player, seasonStat: s, allLogs, allSplits: splits,
              bvpData, currentWindow, currentChartStat } = currentBatterData;
      const name = player.fullName;
      const isSwitch = player.batSide?.code === 'S';
      const bats = player.batSide?.code === 'L' ? 'Zurdo' :
                   player.batSide?.code === 'R' ? 'Derecho' : 'Ambidiestro';
      // Logs de la ventana activa (5/10/20 o todos)
      const logs     = currentWindow ? allLogs.slice(0, currentWindow) : allLogs;
      const homeLogs = logs.filter(g => g.isHome);
      const awayLogs = logs.filter(g => !g.isHome);

      // Tendencia: comparar OPS últimos 5 vs OPS de temporada
      const last5 = allLogs.slice(0, 5);
      const avgOPS5 = last5.reduce((a,g) => a + parseFloat(g.stat?.ops || 0), 0) / Math.max(last5.length, 1);
      const seasonOPS = parseFloat(s?.ops || 0);
      const trend = !s ? '' :
        avgOPS5 > seasonOPS * 1.1 ? '<span class="trend-badge trend-hot">↑ Racha caliente</span>' :
        avgOPS5 < seasonOPS * 0.85 ? '<span class="trend-badge trend-cold">↓ Bajando</span>' :
        '<span class="trend-badge trend-neutral">→ Estable</span>';

      // Stats agregadas de la ventana activa (totales + promedios + tasas)
      const w = calcBatterWindow(allLogs, currentWindow);

      // Splits home/away SIMPLES (mostrados al final)
      const calcLogs = (arr) => {
        const h = arr.reduce((a,g) => a+(g.stat?.hits||0), 0);
        const ab = arr.reduce((a,g) => a+(g.stat?.atBats||0), 0);
        const hr = arr.reduce((a,g) => a+(g.stat?.homeRuns||0), 0);
        const rbi = arr.reduce((a,g) => a+(g.stat?.rbi||0), 0);
        return { avg: ab>0 ? (h/ab).toFixed(3).replace(/^0/,'') : '.000', hr, rbi, g: arr.length };
      };
      const home = calcLogs(homeLogs);
      const away = calcLogs(awayLogs);

      // Splits vs LHP/RHP del endpoint statSplits
      const vsL = splits.find(x => x.split?.description === 'vs. Left')?.stat;
      const vsR = splits.find(x => x.split?.description === 'vs. Right')?.stat;

      // Etiquetas correctas para switch hitters (cambian de lado según pitcher)
      const lblL = isSwitch ? 'Como derecho (vs LHP)' : 'vs. Zurdo';
      const lblR = isSwitch ? 'Como zurdo (vs RHP)'   : 'vs. Derecho';

      // Datos para el gráfico — depende del stat seleccionado
      const statKeyMap = {
        hits: 'hits', hr: 'homeRuns', bb: 'baseOnBalls',
        k: 'strikeOuts', rbi: 'rbi', tb: 'totalBases'
      };
      const statLabelMap = {
        hits: 'Hits', hr: 'HR', bb: 'BB', k: 'K', rbi: 'RBI', tb: 'Bases totales'
      };
      const sk = statKeyMap[currentChartStat] || 'hits';
      const chartDates = logs.map(g => { const d=new Date(g.date); return `${d.getMonth()+1}/${d.getDate()}`; }).reverse();
      const chartVals  = logs.map(g => g.stat?.[sk] ?? 0).reverse();

      // Helper para colorear tasas: verde si ≥60%, rojo si ≤30%
      const rateCls = (r) => r >= 0.60 ? 'var(--accent-green)' : r <= 0.30 ? 'var(--accent-red)' : 'var(--text-primary)';
      const fmtR = (r) => `${Math.round(r * 100)}%`;

      // CARD BvP — solo si el equipo juega hoy y hay datos
      const bvpCard = (() => {
        if (!bvpData?.pitcher) return '';
        const c = bvpData.career;
        const seasons = bvpData.seasons || [];
        const noData = !c || c.atBats === 0;
        return `
          <div class="bvp-card">
            <div class="bvp-card-header">
              <div>
                <div class="bvp-card-title">Bateador vs Pitcher de hoy</div>
                <div class="bvp-pitcher-name">${bvpData.pitcher.name} ${bvpData.pitcher.record ? `<span style="color:var(--text-muted);font-weight:400">${bvpData.pitcher.record}</span>` : ''}</div>
              </div>
              <span class="bvp-badge">CAREER</span>
            </div>
            ${noData ? `
              <div class="bvp-empty">No hay enfrentamientos previos registrados entre estos dos jugadores.</div>
            ` : `
              <div class="bvp-stats-grid">
                ${[
                  ['AVG', c.avg, 'var(--accent-green)'],
                  ['OPS', c.ops, 'var(--accent-blue)'],
                  ['AB',  c.atBats],
                  ['H',   c.hits],
                  ['HR',  c.homeRuns, c.homeRuns > 0 ? 'var(--accent-red)' : ''],
                  ['BB',  c.baseOnBalls],
                  ['K',   c.strikeOuts, c.strikeOuts >= 5 ? 'var(--accent-red)' : ''],
                  ['PA',  c.plateAppearances]
                ].map(([l, v, col]) => `
                  <div class="bvp-stat">
                    <div class="bvp-stat-val" ${col ? `style="color:${col}"` : ''}>${v ?? '—'}</div>
                    <div class="bvp-stat-lbl">${l}</div>
                  </div>`).join('')}
              </div>
              ${seasons.length ? `
                <table class="stats-table" style="margin-top:10px">
                  <thead><tr><th>Año</th><th>AB</th><th>H</th><th>HR</th><th>BB</th><th>K</th><th>AVG</th><th>OPS</th></tr></thead>
                  <tbody>${seasons.map(sp => {
                    const st = sp.stat || {};
                    return `<tr>
                      <td>${sp.season || '—'}</td>
                      <td>${st.atBats??'—'}</td><td>${st.hits??'—'}</td>
                      <td>${st.homeRuns??'—'}</td><td>${st.baseOnBalls??'—'}</td>
                      <td>${st.strikeOuts??'—'}</td>
                      <td>${st.avg??'—'}</td><td>${st.ops??'—'}</td>
                    </tr>`;}).join('')}
                  </tbody>
                </table>` : ''}
            `}
          </div>`;
      })();

      // Tabs de stat para el chart (Hits, HR, BB, K, RBI, TB)
      const chartStatBtns = Object.entries(statLabelMap).map(([key, lbl]) =>
        `<button class="stat-filter-btn batter-stat-btn ${key === currentChartStat ? 'active' : ''}"
                 data-stat="${key}" onclick="switchBatterStat('${key}')">${lbl}</button>`
      ).join('');

      // Tabs de ventana
      const windowBtns = [
        [5, 'Últ. 5'], [10, 'Últ. 10'], [20, 'Últ. 20'], [null, 'Temporada']
      ].map(([n, lbl]) =>
        `<button class="stat-filter-btn batter-window-btn ${n === currentWindow ? 'active' : ''}"
                 data-window="${n}" onclick="switchBatterWindow(${n})">${lbl}</button>`
      ).join('');

      const winLabel = currentWindow ? `últimos ${w.games} juegos` : `temporada (${w.games} juegos)`;

      document.getElementById('playerContent').innerHTML = `
        <div class="player-header-card mlb">
          <div class="player-avatar">${getInitials(name)}</div>
          <div>
            <div class="player-full-name">${name}</div>
            <div class="player-meta">
              <span class="player-meta-item">${player.currentTeam?.name||'—'}</span>
              <span class="player-meta-item">${player.primaryPosition?.abbreviation||'—'}</span>
              <span class="player-meta-item">Batea: ${bats}${isSwitch ? ' (ambidiestro)' : ''}</span>
              <span class="player-meta-item">${s?.gamesPlayed??0} juegos temporada</span>
              ${trend}
            </div>
          </div>
        </div>

        <!-- Stats de TEMPORADA (siempre visibles) -->
        <div class="chart-card-title" style="margin-bottom:6px">Estadísticas de temporada</div>
        <div class="stats-grid">
          ${[
            ['AVG', s?.avg||'.000','var(--accent-green)'],
            ['OBP', s?.obp||'.000'],
            ['SLG', s?.slg||'.000'],
            ['OPS', s?.ops||'.000','var(--accent-blue)'],
            ['HR',  s?.homeRuns??0,'var(--accent-red)'],
            ['RBI', s?.rbi??0],
            ['Hits', s?.hits??0],
            ['AB',  s?.atBats??0],
            ['BB',  s?.baseOnBalls??0],
            ['K',   s?.strikeOuts??0],
            ['SB',  s?.stolenBases??0],
          ].map(([lbl,val,col])=>`
            <div class="stat-box">
              <div class="stat-box-value" ${col?`style="color:${col}"`:''}>${val}</div>
              <div class="stat-box-label">${lbl}</div>
            </div>`).join('')}
        </div>

        <!-- BvP card -->
        ${bvpCard}

        <!-- Selector de ventana -->
        <div class="window-selector-bar">
          <span class="window-selector-label">Ventana de análisis:</span>
          <div class="stat-filter-btns">${windowBtns}</div>
        </div>

        <!-- Promedios por juego -->
        <div class="chart-card-title" style="margin-top:14px;margin-bottom:6px">Promedios por juego — ${winLabel}</div>
        <div class="stats-grid">
          ${[
            ['H/J',   w.hpg,  'var(--accent-green)'],
            ['HR/J',  w.hrpg, 'var(--accent-red)'],
            ['BB/J',  w.bbpg],
            ['K/J',   w.kpg],
            ['RBI/J', w.rbipg],
            ['TB/J',  w.tbpg, 'var(--accent-blue)'],
            ['AVG',   w.avg],
            ['OPS',   w.ops, 'var(--accent-blue)'],
          ].map(([lbl,val,col])=>`
            <div class="stat-box">
              <div class="stat-box-value" ${col?`style="color:${col}"`:''}>${val}</div>
              <div class="stat-box-label">${lbl}</div>
            </div>`).join('')}
        </div>

        <!-- TASAS DE PROPS — % de juegos que cumplen cada threshold -->
        <div class="props-card">
          <div class="props-card-title">Probabilidad histórica para props (${winLabel})</div>
          <div class="props-grid">
            ${[
              ['≥1 Hit',  w.rate1H],
              ['≥2 Hits', w.rate2H],
              ['≥1 HR',   w.rate1HR],
              ['≥1 BB',   w.rate1BB],
              ['≥1 RBI',  w.rate1RBI],
              ['≥1 K',    w.rate1K]
            ].map(([lbl, r]) => `
              <div class="prop-stat">
                <div class="prop-stat-val" style="color:${rateCls(r)}">${fmtR(r)}</div>
                <div class="prop-stat-lbl">${lbl}</div>
                <div class="prop-stat-bar"><div class="prop-stat-bar-fill" style="width:${Math.round(r*100)}%;background:${rateCls(r)}"></div></div>
              </div>`).join('')}
          </div>
        </div>

        <!-- Chart con selector de stat -->
        <div class="chart-card">
          <div class="chart-card-title" id="batterChartTitle">${statLabelMap[currentChartStat]} por partido — ${winLabel}</div>
          <div class="stat-filter-btns">${chartStatBtns}</div>
          <div class="chart-canvas-wrapper"><canvas id="mlbBatterChart"></canvas></div>
        </div>

        <!-- Tabla -->
        <div class="table-card">
          <div class="table-card-title">${winLabel.charAt(0).toUpperCase() + winLabel.slice(1)}</div>
          <table class="stats-table">
            <thead><tr><th>Fecha</th><th>Rival</th><th>L/V</th><th>AB</th><th>H</th><th>HR</th><th>RBI</th><th>BB</th><th>K</th><th>TB</th><th>AVG</th><th>R</th></tr></thead>
            <tbody>${logs.map(g => {
              const d=new Date(g.date); const st=g.stat||{};
              return `<tr>
                <td>${d.getMonth()+1}/${d.getDate()}</td>
                <td>${g.opponent?.abbreviation||'—'}</td>
                <td>${g.isHome?'Casa':'Ruta'}</td>
                <td>${st.atBats??'—'}</td><td>${st.hits??'—'}</td>
                <td>${st.homeRuns??'—'}</td><td>${st.rbi??'—'}</td>
                <td>${st.baseOnBalls??'—'}</td><td>${st.strikeOuts??'—'}</td>
                <td>${st.totalBases??'—'}</td>
                <td>${st.avg??'—'}</td>
                <td>${g.isWin?'<span class="result-w">W</span>':'<span class="result-l">L</span>'}</td>
              </tr>`;}).join('')}
            </tbody>
          </table>
        </div>

        <div class="splits-row">
          <div class="split-card">
            <div class="split-card-title">Casa vs Ruta (${winLabel})</div>
            ${[['Casa ('+home.g+' juegos)','',true],['AVG',home.avg],['HR',home.hr],['RBI',home.rbi],
               ['Ruta ('+away.g+' juegos)','',true],['AVG',away.avg],['HR',away.hr],['RBI',away.rbi]]
              .map(([l,v,h])=>h?`<div class="split-row" style="color:var(--text-muted);font-size:0.75rem;margin-top:${l.startsWith('Ruta')?'8px':'0'}">${l}</div>`
                :`<div class="split-row"><span class="split-label">${l}</span><span class="split-value">${v}</span></div>`).join('')}
          </div>
          <div class="split-card">
            <div class="split-card-title">${isSwitch ? 'Como zurdo / Como derecho' : 'Vs Zurdo / Vs Derecho'}</div>
            ${vsL ? `<div class="split-row" style="color:var(--text-muted);font-size:0.75rem">${lblL}</div>
              ${[['AVG',vsL.avg||'—'],['OBP',vsL.obp||'—'],['OPS',vsL.ops||'—'],['HR',vsL.homeRuns??'—'],['AB',vsL.atBats??'—']].map(([l,v])=>
                `<div class="split-row"><span class="split-label">${l}</span><span class="split-value">${v}</span></div>`).join('')}`
              : `<p style="color:var(--text-muted);font-size:0.82rem">Sin datos ${lblL}</p>`}
            ${vsR ? `<div class="split-row" style="color:var(--text-muted);font-size:0.75rem;margin-top:8px">${lblR}</div>
              ${[['AVG',vsR.avg||'—'],['OBP',vsR.obp||'—'],['OPS',vsR.ops||'—'],['HR',vsR.homeRuns??'—'],['AB',vsR.atBats??'—']].map(([l,v])=>
                `<div class="split-row"><span class="split-label">${l}</span><span class="split-value">${v}</span></div>`).join('')}`
              : `<p style="color:var(--text-muted);font-size:0.82rem;margin-top:8px">Sin datos ${lblR}</p>`}
          </div>
        </div>`;

      if (logs.length) {
        // Destruir chart previo si existe
        if (playerCharts.mlbBatter) { playerCharts.mlbBatter.destroy(); playerCharts.mlbBatter = null; }
        playerCharts.mlbBatter = new Chart(
          document.getElementById('mlbBatterChart').getContext('2d'), {
            type: 'bar',
            data: { labels: chartDates, datasets: [{
              label: statLabelMap[currentChartStat], data: chartVals, borderRadius: 4, borderWidth: 0,
              backgroundColor: chartVals.map(v => v>=3?'rgba(0,208,132,0.75)':v>=2?'rgba(77,166,255,0.7)':v>=1?'rgba(255,215,0,0.5)':'rgba(160,160,160,0.4)')
            }]},
            options: { responsive:true, maintainAspectRatio:false,
              plugins:{legend:{display:false}},
              scales:{
                x:{ticks:{color:'#606060',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'}},
                y:{beginAtZero:true,ticks:{color:'#606060',stepSize:1},grid:{color:'rgba(255,255,255,0.06)'}}
              }}
          });
      }
    }

    // Cambia la ventana de análisis (5/10/20/Temporada). Re-renderiza todo el bateador
    // usando los mismos datos en memoria (sin volver a fetchear).
    function switchBatterWindow(n) {
      if (!currentBatterData) return;
      currentBatterData.currentWindow = n;
      renderMLBBatter();
    }

    // Cambia la stat mostrada en el gráfico (Hits/HR/BB/K/RBI/TB).
    // Muta el dataset existente sin recrear el chart, igual al patrón de NBA.
    function switchBatterStat(key) {
      if (!currentBatterData) return;
      currentBatterData.currentChartStat = key;
      const labelMap = { hits:'Hits', hr:'HR', bb:'BB', k:'K', rbi:'RBI', tb:'Bases totales' };
      const statKeyMap = { hits:'hits', hr:'homeRuns', bb:'baseOnBalls', k:'strikeOuts', rbi:'rbi', tb:'totalBases' };
      const winN = currentBatterData.currentWindow;
      const logs = winN ? currentBatterData.allLogs.slice(0, winN) : currentBatterData.allLogs;
      const sk = statKeyMap[key];
      const vals = logs.map(g => g.stat?.[sk] ?? 0).reverse();
      if (playerCharts.mlbBatter) {
        const ds = playerCharts.mlbBatter.data.datasets[0];
        ds.label = labelMap[key];
        ds.data  = vals;
        ds.backgroundColor = vals.map(v =>
          v>=3?'rgba(0,208,132,0.75)':v>=2?'rgba(77,166,255,0.7)':v>=1?'rgba(255,215,0,0.5)':'rgba(160,160,160,0.4)'
        );
        playerCharts.mlbBatter.update();
      }
      // Actualizar título y botones activos
      const winLabel = winN ? `últimos ${logs.length} juegos` : `temporada (${logs.length} juegos)`;
      const titleEl = document.getElementById('batterChartTitle');
      if (titleEl) titleEl.textContent = `${labelMap[key]} por partido — ${winLabel}`;
      document.querySelectorAll('.batter-stat-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.stat === key)
      );
    }

    // ===== RENDERIZAR PITCHER MLB =====
    function renderMLBPitcher(player, s, logs, homeLogs, awayLogs) {
      const name = player.fullName;
      const throwsLabel = player.pitchHand?.code==='L'?'Zurdo':'Derecho';

      // K/9 y BB/9 (inningsPitched puede ser "6.2" → 6 + 2/3 innings)
      function ipToNum(ip) {
        const [w,d='0'] = String(ip||0).split('.');
        return parseInt(w)+(parseInt(d)/3);
      }
      const ipNum = ipToNum(s?.inningsPitched);
      const k9  = ipNum>0 ? ((s.strikeOuts/ipNum)*9).toFixed(1) : '—';
      const bb9 = ipNum>0 ? ((s.baseOnBalls/ipNum)*9).toFixed(1) : '—';

      // ERA desde logs home/away
      const eraFromLogs = (arr) => {
        const er = arr.reduce((a,g)=>a+(g.stat?.earnedRuns||0),0);
        const ip = arr.reduce((a,g)=>a+ipToNum(g.stat?.inningsPitched),0);
        return ip>0 ? ((er/ip)*9).toFixed(2) : '—';
      };

      const chartDates = logs.map(g=>{const d=new Date(g.date);return `${d.getMonth()+1}/${d.getDate()}`;}).reverse();
      const chartER = logs.map(g=>g.stat?.earnedRuns??0).reverse();

      document.getElementById('playerContent').innerHTML = `
        <div class="player-header-card mlb">
          <div class="player-avatar">${getInitials(name)}</div>
          <div>
            <div class="player-full-name">${name}</div>
            <div class="player-meta">
              <span class="player-meta-item">${player.currentTeam?.name||'—'}</span>
              <span class="player-meta-item">Pitcher · ${throwsLabel}</span>
              <span class="player-meta-item">${s?.gamesStarted??0} aperturas</span>
            </div>
          </div>
        </div>

        <div class="stats-grid">
          ${[
            ['ERA',  s?.era||'—', parseFloat(s?.era)<3.5?'var(--accent-green)':parseFloat(s?.era)>5?'var(--accent-red)':'var(--accent-yellow)'],
            ['WHIP', s?.whip||'—'],
            ['W-L',  `${s?.wins??0}-${s?.losses??0}`],
            ['IP',   s?.inningsPitched||'0.0'],
            ['K/9',  k9, 'var(--accent-blue)'],
            ['BB/9', bb9],
            ['K',    s?.strikeOuts??0],
            ['BB',   s?.baseOnBalls??0],
            ['HR',   s?.homeRuns??0,'var(--accent-red)'],
          ].map(([l,v,c])=>`
            <div class="stat-box">
              <div class="stat-box-value" ${c?`style="color:${c}"`:''}>${v}</div>
              <div class="stat-box-label">${l}</div>
            </div>`).join('')}
        </div>

        <div class="chart-card">
          <div class="chart-card-title">Carreras limpias por salida — últimas ${logs.length}</div>
          <div class="chart-canvas-wrapper"><canvas id="mlbPitcherChart"></canvas></div>
        </div>

        <div class="table-card">
          <div class="table-card-title">Últimas ${logs.length} salidas</div>
          <table class="stats-table">
            <thead><tr><th>Fecha</th><th>Rival</th><th>L/V</th><th>IP</th><th>H</th><th>ER</th><th>BB</th><th>K</th><th>HR</th><th>R</th></tr></thead>
            <tbody>${logs.map(g=>{
              const d=new Date(g.date); const st=g.stat||{};
              return `<tr>
                <td>${d.getMonth()+1}/${d.getDate()}</td>
                <td>${g.opponent?.abbreviation||'—'}</td>
                <td>${g.isHome?'Casa':'Ruta'}</td>
                <td>${st.inningsPitched??'—'}</td><td>${st.hits??'—'}</td>
                <td>${st.earnedRuns??'—'}</td><td>${st.baseOnBalls??'—'}</td>
                <td>${st.strikeOuts??'—'}</td><td>${st.homeRuns??'—'}</td>
                <td>${g.isWin?'<span class="result-w">W</span>':'<span class="result-l">L</span>'}</td>
              </tr>`;}).join('')}
            </tbody>
          </table>
        </div>

        <div class="splits-row">
          <div class="split-card">
            <div class="split-card-title">ERA Casa vs Ruta (temporada)</div>
            <div class="split-row"><span class="split-label">ERA en casa</span><span class="split-value">${eraFromLogs(homeLogs)}</span></div>
            <div class="split-row"><span class="split-label">ERA de ruta</span><span class="split-value">${eraFromLogs(awayLogs)}</span></div>
            <div class="split-row"><span class="split-label">IP totales</span><span class="split-value">${s?.inningsPitched||'0'}</span></div>
          </div>
          <div class="split-card">
            <div class="split-card-title">Totales temporada</div>
            ${[['Hits permitidos',s?.hits??0],['Bases por bolas',s?.baseOnBalls??0],['Ponches',s?.strikeOuts??0],['HR permitidos',s?.homeRuns??0]]
              .map(([l,v])=>`<div class="split-row"><span class="split-label">${l}</span><span class="split-value">${v}</span></div>`).join('')}
          </div>
        </div>`;

      if (logs.length) {
        playerCharts.mlbPitcher = new Chart(
          document.getElementById('mlbPitcherChart').getContext('2d'), {
            type: 'bar',
            data: { labels: chartDates, datasets:[{
              label:'ER permitidas', data:chartER, borderRadius:4, borderWidth:0,
              backgroundColor: chartER.map(e=>e<=1?'rgba(0,208,132,0.7)':e<=3?'rgba(255,215,0,0.6)':'rgba(255,77,77,0.65)')
            }]},
            options:{responsive:true,maintainAspectRatio:false,
              plugins:{legend:{display:false}},
              scales:{
                x:{ticks:{color:'#606060',font:{size:10}},grid:{color:'rgba(255,255,255,0.04)'}},
                y:{beginAtZero:true,ticks:{color:'#606060',stepSize:1},grid:{color:'rgba(255,255,255,0.06)'}}
              }}
          });
      }
    }

    // =====================================================================
    // NBA — CARGAR Y RENDERIZAR (datos oficiales de ESPN)
    // =====================================================================
