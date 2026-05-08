    // =====================================================================
    // JAVASCRIPT: El "cerebro" de la app.
    // Si HTML es la estructura (paredes) y CSS el diseño (pintura),
    // JavaScript es la electricidad que lo hace funcionar.
    // =====================================================================


    // ===== UTILIDAD: muestra la fecha de hoy en la barra de navegación =====
    function setTodayDate() {
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      // new Date() = la fecha de ahora mismo
      const today = new Date().toLocaleDateString('es-ES', options);
      document.getElementById('navDate').textContent = today;
    }


    // ===== NAVEGACIÓN =====
    function showSection(name, linkElement) {
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById('section-' + name).classList.add('active');
      // La sección "player" no tiene botón en la nav, así que no marcamos nada
      document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
      if (linkElement) linkElement.classList.add('active');
      // Carga secciones perezosas la primera vez que el usuario las visita
      if (name === 'equipos'      && !equiposInitialized)     initEquipos();
      if (name === 'predictions'  && !predictionsInitialized) initPredictions();
      if (name === 'history')                                  initHistory();
      return false;
    }


    // ===== FORMATEAR HORA =====
    // Los partidos llegan en formato UTC (hora internacional).
    // Esta función la convierte a la hora local del usuario.
    function formatGameTime(isoString) {
      if (!isoString) return 'Hora TBD';
      try {
        const date = new Date(isoString);
        return date.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short'
        });
      } catch (e) {
        return 'Hora TBD';
      }
    }


    // ===== ESTADO DEL PARTIDO =====
    // Transforma los códigos de la API ("STATUS_IN_PROGRESS") en texto legible
    function getStatusInfo(statusState, statusDetail) {
      if (statusState === '1') return { label: 'Programado', css: 'status-scheduled' };
      if (statusState === '2') return { label: statusDetail || 'EN VIVO', css: 'status-live' };
      if (statusState === '3') return { label: 'Final', css: 'status-final' };
      return { label: statusDetail || '—', css: 'status-scheduled' };
    }


    // ===== CREAR HTML DE UNA CARD DE PARTIDO =====
    // Esta función recibe los datos de un partido y devuelve el HTML listo para mostrar.
    function createGameCard(game, league) {
      const comp0 = game.competitions?.[0];
      if (!comp0) return '';
      const homeTeam = comp0.competitors?.find(c => c.homeAway === 'home');
      const awayTeam = comp0.competitors?.find(c => c.homeAway === 'away');

      if (!homeTeam || !awayTeam) return '';

      const statusState = game.status?.type?.state;
      const statusInfo = getStatusInfo(
        statusState === 'in' ? '2' :
        statusState === 'post' ? '3' : '1',
        game.status?.type?.shortDetail
      );

      const isLive = statusState === 'in';
      const isFinal = statusState === 'post';

      // Marcador: si está en vivo o terminó, mostramos puntos; si no, "VS"
      let scoreHTML = '';
      if (isLive || isFinal) {
        scoreHTML = `
          <div class="score-display">${awayTeam.score || '0'} - ${homeTeam.score || '0'}</div>
          <div class="score-period">${game.status?.type?.shortDetail || ''}</div>
        `;
      } else {
        scoreHTML = `
          <div class="score-vs-text">VS</div>
          <div class="score-period">${formatGameTime(game.date)}</div>
        `;
      }

      // Intentamos cargar el logo del equipo desde ESPN
      const homeLogo = homeTeam.team.logo
        ? `<img class="team-logo" src="${homeTeam.team.logo}" alt="${homeTeam.team.displayName}" onerror="this.style.display='none'; this.nextSibling.style.display='flex'">`
        : '';
      const homeLogoFallback = `<div class="team-logo-fallback" style="display:${homeTeam.team.logo ? 'none' : 'flex'}">${homeTeam.team.abbreviation || '?'}</div>`;

      const awayLogo = awayTeam.team.logo
        ? `<img class="team-logo" src="${awayTeam.team.logo}" alt="${awayTeam.team.displayName}" onerror="this.style.display='none'; this.nextSibling.style.display='flex'">`
        : '';
      const awayLogoFallback = `<div class="team-logo-fallback" style="display:${awayTeam.team.logo ? 'none' : 'flex'}">${awayTeam.team.abbreviation || '?'}</div>`;

      // Nombre de la sede (estadio/arena)
      const venue = comp0.venue ? comp0.venue.fullName : '';

      return `
        <div class="game-card ${league}" data-game-id="${game.id}" data-league="${league}">

          <div class="game-status">
            <span class="status-badge ${statusInfo.css}">${statusInfo.label}</span>
            <span class="game-time">${venue}</span>
          </div>

          <div class="teams-container">
            <!-- Equipo visitante (izquierda) -->
            <div class="team">
              ${awayLogo}${awayLogoFallback}
              <div class="team-name">${awayTeam.team.shortDisplayName || awayTeam.team.displayName}</div>
              <div class="team-record">${awayTeam.records ? awayTeam.records[0]?.summary || '' : ''}</div>
            </div>

            <!-- Marcador o VS (centro) -->
            <div class="score-vs">
              ${scoreHTML}
            </div>

            <!-- Equipo local (derecha) -->
            <div class="team">
              ${homeLogo}${homeLogoFallback}
              <div class="team-name">${homeTeam.team.shortDisplayName || homeTeam.team.displayName}</div>
              <div class="team-record">${homeTeam.records ? homeTeam.records[0]?.summary || '' : ''}</div>
            </div>
          </div>

          <!-- Líneas de apuestas: se cargarán desde The Odds API -->
          <div class="odds-container" id="odds-${league}-${game.id}">
            <div class="odds-item">
              <span class="odds-label">Spread</span>
              <span class="odds-value odds-loading" data-odds="away-spread">—</span>
              <span class="odds-value odds-loading" data-odds="home-spread">—</span>
            </div>
            <div class="odds-item">
              <span class="odds-label">Moneyline</span>
              <span class="odds-value odds-loading" data-odds="away-ml">—</span>
              <span class="odds-value odds-loading" data-odds="home-ml">—</span>
            </div>
            <div class="odds-item">
              <span class="odds-label">O/U</span>
              <span class="odds-value odds-loading" data-odds="total">—</span>
            </div>
          </div>

          <!-- Botones -->
          <div class="card-actions">
            <button class="btn btn-primary" onclick="openGameAnalysis('${game.id}', '${league}')">
              Ver Análisis
            </button>
            <button class="btn btn-ai" onclick="openAIAnalysis('${game.id}', '${league}')">
              IA
            </button>
          </div>

        </div>
      `;
    }


    // ===== CARGAR PARTIDOS NBA DESDE ESPN =====
    // "fetch" es como enviarle una carta a un servidor y esperar su respuesta.
    // "async/await" significa que esperamos la respuesta antes de continuar.
    async function loadNBAGames() {
      const container = document.getElementById('nbaGames');

      try {
        // Construimos la fecha de hoy en formato AAAAMMDD (ejemplo: 20260424)
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');  // getMonth() empieza en 0
        const dd = String(today.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}${mm}${dd}`;

        // Llamamos a la ESPN API de NBA
        const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`;
        const response = await fetchWithTimeout(url);

        // Si la respuesta no es buena, lanzamos un error
        if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);

        // Convertimos la respuesta a un objeto JavaScript que podemos usar
        const data = await response.json();
        const games = data.events || [];

        // Actualizar contador
        document.getElementById('nbaCount').textContent = games.length;

        if (games.length === 0) {
          container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
              No hay partidos NBA programados para hoy
            </div>
          `;
          return games;
        }

        // Generamos el HTML de cada card y lo unimos
        container.innerHTML = games.map(g => createGameCard(g, 'nba')).join('');
        return games;

      } catch (error) {
        console.error('Error cargando NBA:', error);
        container.innerHTML = `
          <div class="error-container" style="grid-column: 1/-1">
            <p>No se pudieron cargar los partidos de NBA</p>
            <p style="color: var(--text-muted); font-size: 0.8rem">${error.message}</p>
          </div>
        `;
        return [];
      }
    }


    // ===== CARGAR PARTIDOS MLB DESDE ESPN =====
    // Igual que la NBA pero con la URL de béisbol
    async function loadMLBGames() {
      const container = document.getElementById('mlbGames');

      try {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}${mm}${dd}`;

        const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${dateStr}`;
        const response = await fetchWithTimeout(url);

        if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);

        const data = await response.json();
        const games = data.events || [];

        // Actualizar contador
        document.getElementById('mlbCount').textContent = games.length;

        if (games.length === 0) {
          container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
              No hay partidos MLB programados para hoy
            </div>
          `;
          return games;
        }

        container.innerHTML = games.map(g => createGameCard(g, 'mlb')).join('');
        return games;

      } catch (error) {
        console.error('Error cargando MLB:', error);
        container.innerHTML = `
          <div class="error-container" style="grid-column: 1/-1">
            <p>No se pudieron cargar los partidos de MLB</p>
            <p style="color: var(--text-muted); font-size: 0.8rem">${error.message}</p>
          </div>
        `;
        return [];
      }
    }


    // ===== ACTUALIZAR CONTADORES DEL RESUMEN =====
    async function updateSummary(nbaGames, mlbGames) {
      const allGames = [...nbaGames, ...mlbGames];
      document.getElementById('totalGames').textContent = allGames.length;

      // Contar cuántos están en vivo ahora mismo
      const live = allGames.filter(g => g.status && g.status.type.state === 'in').length;
      document.getElementById('liveCount').textContent = live;
    }


    // =====================================================================
    // MODAL DE ANÁLISIS — "Ver Análisis" y botón "IA"
    // =====================================================================
    // El modal se abre encima de cualquier sección. Recibe gameId+league y
    // construye un análisis completo combinando scoreboard + stats de equipos
    // + pitchers (MLB). El botón IA usa la Claude API si hay key guardada.

    function findGameById(gameId, league) {
      const list = allTodayGames[league] || [];
      return list.find(g => String(g.id) === String(gameId));
    }

    function openAnalysisModal(titleHtml) {
      document.getElementById('analysisModalTitle').innerHTML = titleHtml;
      document.getElementById('analysisModalBody').innerHTML =
        '<div class="loading-container"><div class="spinner"></div><div class="loading-text">Cargando análisis...</div></div>';
      document.getElementById('analysisModal').classList.add('active');
    }

    function closeAnalysisModal() {
      document.getElementById('analysisModal').classList.remove('active');
    }

    // ===== VER ANÁLISIS — análisis completo del partido =====
    async function openGameAnalysis(gameId, league) {
      const game = findGameById(gameId, league);
      if (!game) return alert('No se encontró el partido.');

      const comp     = game.competitions?.[0];
      const homeComp = comp.competitors.find(c => c.homeAway === 'home');
      const awayComp = comp.competitors.find(c => c.homeAway === 'away');
      const homeName = homeComp?.team?.displayName || 'Local';
      const awayName = awayComp?.team?.displayName || 'Visitante';

      openAnalysisModal(`<span>${awayName}</span><span class="modal-vs">@</span><span>${homeName}</span>`);

      try {
        // Trae stats completas de ambos equipos en paralelo
        const [homeStats, awayStats] = await Promise.all([
          fetchTeamFullStats(homeComp.id, league, homeComp),
          fetchTeamFullStats(awayComp.id, league, awayComp)
        ]);

        const homePitcher = league === 'mlb' ? extractPitcher(homeComp) : null;
        const awayPitcher = league === 'mlb' ? extractPitcher(awayComp) : null;

        // Estado de la serie de playoffs (si aplica). ESPN lo expone en
        // comp.series cuando el partido es de post-temporada — lo usamos para
        // mostrar quién lidera la serie y avisar que las stats de la sección
        // "Temporada regular" están congeladas al cierre del calendario.
        const isPlayoff = (game.season?.slug === 'post-season') || (comp.series?.type === 'playoff');
        let seriesInfo = null;
        if (isPlayoff && comp.series) {
          const sc = comp.series.competitors || [];
          const homeS = sc.find(s => s.id === homeComp.id);
          const awayS = sc.find(s => s.id === awayComp.id);
          seriesInfo = {
            summary: comp.series.summary || '',
            title:   comp.series.title   || 'Serie',
            homeWins: homeS?.wins ?? null,
            awayWins: awayS?.wins ?? null,
            bestOf:  comp.series.totalCompetitions || 7,
            completed: !!comp.series.completed
          };
        }

        // Para NBA: stats avanzados (FG%, 3P%, etc.) + líderes del partido.
        let nbaExtras = null;
        if (league === 'nba') {
          const [homeExt, awayExt] = await Promise.all([
            fetchNBAExtendedStats(homeComp.id),
            fetchNBAExtendedStats(awayComp.id)
          ]);
          nbaExtras = {
            homeExt, awayExt,
            homeLeaders: extractTeamLeaders(homeComp),
            awayLeaders: extractTeamLeaders(awayComp)
          };
        }

        // Para MLB: resolvemos la mano de cada pitcher y los splits ofensivos
        // de cada equipo vs LHP/RHP. Todo en paralelo para no añadir latencia.
        let handedness = null;
        if (league === 'mlb') {
          const [homeP, awayP, homeMLBId, awayMLBId] = await Promise.all([
            homePitcher?.fullName ? resolveMLBPitcherInfo(homePitcher.fullName) : null,
            awayPitcher?.fullName ? resolveMLBPitcherInfo(awayPitcher.fullName) : null,
            getMLBTeamId(homeName),
            getMLBTeamId(awayName)
          ]);
          if (homeP && homePitcher) {
            homePitcher.hand   = homeP.pitchHand;
            if (homeP.kPer9  != null) homePitcher.kPer9  = homeP.kPer9;
            if (homeP.bbPer9 != null) homePitcher.bbPer9 = homeP.bbPer9;
            if (homeP.fip    != null) homePitcher.fip    = homeP.fip;
          }
          if (awayP && awayPitcher) {
            awayPitcher.hand   = awayP.pitchHand;
            if (awayP.kPer9  != null) awayPitcher.kPer9  = awayP.kPer9;
            if (awayP.bbPer9 != null) awayPitcher.bbPer9 = awayP.bbPer9;
            if (awayP.fip    != null) awayPitcher.fip    = awayP.fip;
          }

          const [homeSplits, awaySplits] = await Promise.all([
            fetchTeamHittingSplits(homeMLBId),
            fetchTeamHittingSplits(awayMLBId)
          ]);
          handedness = { homeSplits, awaySplits };
        }

        const venue = comp.venue?.fullName || '';
        const city  = comp.venue?.address?.city || '';
        const state = comp.venue?.address?.state || '';
        const dateStr = new Date(game.date).toLocaleString('es-ES', {
          dateStyle: 'long', timeStyle: 'short'
        });

        document.getElementById('analysisModalBody').innerHTML =
          renderGameAnalysis({
            league, homeName, awayName, homeStats, awayStats,
            homePitcher, awayPitcher, handedness, nbaExtras,
            seriesInfo, isPlayoff,
            venue, city, state, dateStr, gameId
          });
      } catch (err) {
        document.getElementById('analysisModalBody').innerHTML =
          `<div class="ai-narrative-box error">Error cargando análisis: ${err.message}</div>`;
      }
    }

    // Renderiza el contenido del modal Ver Análisis (4 bloques)
    function renderGameAnalysis(d) {
      const teamCard = (name, stats) => {
        if (!stats) return `
          <div class="analysis-side-card">
            <div class="analysis-side-name">${name}</div>
            <div class="analysis-side-meta">Datos no disponibles</div>
          </div>`;
        const fmt = (v, dec=2) => v == null ? '—' : Number(v).toFixed(dec);
        const recStr = stats.total ? `${stats.total.wins}-${stats.total.losses}` : '—';
        const homeRec = stats.home  ? `${stats.home.wins}-${stats.home.losses}`  : '—';
        const roadRec = stats.road  ? `${stats.road.wins}-${stats.road.losses}`  : '—';
        const streakLabel = stats.streak == null ? '—'
          : stats.streak > 0 ? `Ganando ${stats.streak}` : `Perdiendo ${Math.abs(stats.streak)}`;
        // En playoffs la racha viene del calendario regular y confunde — la ocultamos.
        const streakRow = d.isPlayoff ? '' :
          `<div class="analysis-stat-row"><span class="label">Racha</span><span class="value">${streakLabel}</span></div>`;
        const pythPct = stats.pyth != null ? (stats.pyth*100).toFixed(1) + '%' : '—';
        const pfLabel = d.league === 'nba' ? 'Pts/Juego' : 'Carreras/Juego';
        const paLabel = d.league === 'nba' ? 'Pts permitidos' : 'Carreras permitidas';
        return `
          <div class="analysis-side-card">
            <div class="analysis-side-name">${name}</div>
            <div class="analysis-side-meta">Récord temporada: ${recStr}</div>
            <div class="analysis-stat-row"><span class="label">Casa</span><span class="value">${homeRec}</span></div>
            <div class="analysis-stat-row"><span class="label">Visitante</span><span class="value">${roadRec}</span></div>
            <div class="analysis-stat-row"><span class="label">${pfLabel}</span><span class="value">${fmt(stats.pf)}</span></div>
            <div class="analysis-stat-row"><span class="label">${paLabel}</span><span class="value">${fmt(stats.pa)}</span></div>
            <div class="analysis-stat-row"><span class="label">Diferencial</span><span class="value">${fmt(stats.diff)}</span></div>
            ${streakRow}
            <div class="analysis-stat-row"><span class="label">Pythagorean</span><span class="value">${pythPct}</span></div>
          </div>`;
      };

      const pitcherCard = (label, p) => {
        if (!p) return `
          <div class="analysis-side-card">
            <div class="analysis-side-name">${label}</div>
            <div class="analysis-side-meta">No confirmado</div>
          </div>`;
        const recStr   = (p.wins != null && p.losses != null) ? `${p.wins}-${p.losses}` : (p.record || '—');
        const era      = p.era   != null ? p.era.toFixed(2)   : '—';
        const whip     = p.whip  != null ? p.whip.toFixed(2)  : '—';
        const k9       = p.kPer9 != null ? p.kPer9.toFixed(1) : '—';
        const bb9      = p.bbPer9 != null ? p.bbPer9.toFixed(1) : '—';
        const fip      = p.fip   != null ? p.fip.toFixed(2)   : '—';
        const handStr  = p.hand === 'L' ? 'Zurdo (LHP)' : p.hand === 'R' ? 'Derecho (RHP)' : '—';
        // Verde = bueno, rojo = malo según umbrales MLB estándar
        const clr = (v, lo, hi) => v == null ? '' : v < lo ? 'color:var(--accent-green)' : v > hi ? 'color:var(--accent-red)' : '';
        return `
          <div class="analysis-side-card">
            <div class="analysis-side-name">${p.name}</div>
            <div class="analysis-side-meta">${label}</div>
            <div class="analysis-stat-row"><span class="label">Mano</span><span class="value">${handStr}</span></div>
            <div class="analysis-stat-row"><span class="label">Récord</span><span class="value">${recStr}</span></div>
            <div class="analysis-stat-row"><span class="label">ERA</span><span class="value" style="${clr(p.era,3.5,4.5)}">${era}</span></div>
            <div class="analysis-stat-row"><span class="label">WHIP</span><span class="value" style="${clr(p.whip,1.2,1.4)}">${whip}</span></div>
            <div class="analysis-stat-row"><span class="label">FIP</span><span class="value" style="${clr(p.fip,3.5,4.5)}">${fip}</span></div>
            <div class="analysis-stat-row"><span class="label">K/9</span><span class="value">${k9}</span></div>
            <div class="analysis-stat-row"><span class="label">BB/9</span><span class="value">${bb9}</span></div>
          </div>`;
      };

      // Bloque MLB: cómo batea cada equipo vs la mano del pitcher contrario.
      // Si el pitcher rival es zurdo, mostramos el split del equipo "vs LHP".
      const handednessBlock = (() => {
        if (d.league !== 'mlb' || !d.handedness) return '';
        const teamSplitCard = (teamName, opposingHand, splits) => {
          if (!opposingHand) return `
            <div class="analysis-side-card">
              <div class="analysis-side-name">${teamName}</div>
              <div class="analysis-side-meta">Mano del pitcher rival no disponible</div>
            </div>`;
          const split = opposingHand === 'L' ? splits?.vsL : splits?.vsR;
          const handLabel = opposingHand === 'L' ? 'vs LHP (zurdo)' : 'vs RHP (derecho)';
          if (!split) return `
            <div class="analysis-side-card">
              <div class="analysis-side-name">${teamName}</div>
              <div class="analysis-side-meta">Bateo ${handLabel}</div>
              <div class="analysis-stat-row"><span class="label">Sin datos del split</span><span class="value">—</span></div>
            </div>`;
          const fmt3 = v => v == null ? '—' : v.toFixed(3).replace(/^0/, '');
          // Color: AVG vs liga típica ~.245
          const avgColor = split.avg >= 0.260 ? 'color:var(--accent-green)'
                        : split.avg <= 0.230 ? 'color:var(--accent-red)' : '';
          const opsColor = split.ops >= 0.760 ? 'color:var(--accent-green)'
                        : split.ops <= 0.680 ? 'color:var(--accent-red)' : '';
          return `
            <div class="analysis-side-card">
              <div class="analysis-side-name">${teamName}</div>
              <div class="analysis-side-meta">Bateo ${handLabel}</div>
              <div class="analysis-stat-row"><span class="label">AVG</span><span class="value" style="${avgColor}">${fmt3(split.avg)}</span></div>
              <div class="analysis-stat-row"><span class="label">OBP</span><span class="value">${fmt3(split.obp)}</span></div>
              <div class="analysis-stat-row"><span class="label">SLG</span><span class="value">${fmt3(split.slg)}</span></div>
              <div class="analysis-stat-row"><span class="label">OPS</span><span class="value" style="${opsColor}">${fmt3(split.ops)}</span></div>
              <div class="analysis-stat-row"><span class="label">HR</span><span class="value">${split.hr}</span></div>
            </div>`;
        };
        // El equipo visitante batea contra el pitcher LOCAL → usamos d.homePitcher.hand
        // El equipo local batea contra el pitcher VISITANTE → usamos d.awayPitcher.hand
        return `
          <div class="analysis-block">
            <div class="analysis-block-title">Bateo vs mano del pitcher rival</div>
            <div class="analysis-teams-grid">
              ${teamSplitCard(d.awayName, d.homePitcher?.hand, d.handedness.awaySplits)}
              ${teamSplitCard(d.homeName, d.awayPitcher?.hand, d.handedness.homeSplits)}
            </div>
          </div>`;
      })();

      // Comparación lado a lado de equipos
      const compareRow = (label, hVal, aVal, lowerBetter=false) => {
        if (hVal == null && aVal == null) return '';
        let hClass = '', aClass = '';
        if (hVal != null && aVal != null) {
          const hBetter = lowerBetter ? hVal < aVal : hVal > aVal;
          hClass = hBetter ? 'style="color:var(--accent-green)"' : '';
          aClass = !hBetter ? 'style="color:var(--accent-green)"' : '';
        }
        const fmtV = v => v == null ? '—' : (typeof v === 'number' ? v.toFixed(2) : v);
        return `
          <div class="analysis-stat-row">
            <span class="value" ${aClass}>${fmtV(aVal)}</span>
            <span class="label">${label}</span>
            <span class="value" ${hClass}>${fmtV(hVal)}</span>
          </div>`;
      };

      const pitchersBlock = d.league === 'mlb' ? `
        <div class="analysis-block">
          <div class="analysis-block-title">Pitchers abridores</div>
          <div class="analysis-pitchers-grid">
            ${pitcherCard(`Visitante — ${d.awayName}`, d.awayPitcher)}
            ${pitcherCard(`Local — ${d.homeName}`, d.homePitcher)}
          </div>
        </div>` : '';

      // ===== NBA: bloques avanzados =====
      const nbaEfficiencyBlock = (() => {
        if (d.league !== 'nba' || !d.nbaExtras) return '';
        const { homeExt, awayExt } = d.nbaExtras;
        const card = (name, ext) => {
          if (!ext) return `
            <div class="analysis-side-card">
              <div class="analysis-side-name">${name}</div>
              <div class="analysis-side-meta">Datos no disponibles</div>
            </div>`;
          const fmtPct = v => v == null ? '—' : v.toFixed(1) + '%';
          const fmtN   = v => v == null ? '—' : v.toFixed(1);
          // Color: 3P% bueno >37%, malo <33%; FG% bueno >47%, malo <43%
          const c3 = ext.threePct == null ? '' : ext.threePct >= 37 ? 'color:var(--accent-green)' : ext.threePct <= 33 ? 'color:var(--accent-red)' : '';
          const cFG = ext.fgPct == null ? '' : ext.fgPct >= 47 ? 'color:var(--accent-green)' : ext.fgPct <= 43 ? 'color:var(--accent-red)' : '';
          const sample = ext.gamesPlayed ? `${ext.gamesPlayed} juegos` : '';
          return `
            <div class="analysis-side-card">
              <div class="analysis-side-name">${name}</div>
              <div class="analysis-side-meta">Eficiencia ofensiva${sample ? ' · ' + sample : ''}</div>
              <div class="analysis-stat-row"><span class="label">FG%</span><span class="value" style="${cFG}">${fmtPct(ext.fgPct)}</span></div>
              <div class="analysis-stat-row"><span class="label">3P%</span><span class="value" style="${c3}">${fmtPct(ext.threePct)}</span></div>
              <div class="analysis-stat-row"><span class="label">FT%</span><span class="value">${fmtPct(ext.ftPct)}</span></div>
              <div class="analysis-stat-row"><span class="label">PPG</span><span class="value">${fmtN(ext.ppg)}</span></div>
              <div class="analysis-stat-row"><span class="label">Asistencias/G</span><span class="value">${fmtN(ext.apg)}</span></div>
              <div class="analysis-stat-row"><span class="label">Pérdidas/G</span><span class="value">${fmtN(ext.tov)}</span></div>
              <div class="analysis-stat-row"><span class="label">Ratio Ast/TO</span><span class="value">${fmtN(ext.astTo)}</span></div>
            </div>`;
        };
        return `
          <div class="analysis-block">
            <div class="analysis-block-title">Eficiencia ofensiva</div>
            <div class="analysis-teams-grid">
              ${card(d.awayName, awayExt)}
              ${card(d.homeName, homeExt)}
            </div>
          </div>`;
      })();

      const nbaDefenseBlock = (() => {
        if (d.league !== 'nba' || !d.nbaExtras) return '';
        const { homeExt, awayExt } = d.nbaExtras;
        const card = (name, ext) => {
          if (!ext) return '';
          const fmtN = v => v == null ? '—' : v.toFixed(1);
          return `
            <div class="analysis-side-card">
              <div class="analysis-side-name">${name}</div>
              <div class="analysis-side-meta">Tablero y defensa</div>
              <div class="analysis-stat-row"><span class="label">Rebotes/G</span><span class="value">${fmtN(ext.rpg)}</span></div>
              <div class="analysis-stat-row"><span class="label">Reb. Defensivos</span><span class="value">${fmtN(ext.drpg)}</span></div>
              <div class="analysis-stat-row"><span class="label">Reb. Ofensivos</span><span class="value">${fmtN(ext.orpg)}</span></div>
              <div class="analysis-stat-row"><span class="label">Robos/G</span><span class="value">${fmtN(ext.spg)}</span></div>
              <div class="analysis-stat-row"><span class="label">Tapones/G</span><span class="value">${fmtN(ext.bpg)}</span></div>
              <div class="analysis-stat-row"><span class="label">Faltas/G</span><span class="value">${fmtN(ext.fouls)}</span></div>
            </div>`;
        };
        if (!homeExt && !awayExt) return '';
        return `
          <div class="analysis-block">
            <div class="analysis-block-title">Tablero y defensa</div>
            <div class="analysis-teams-grid">
              ${card(d.awayName, awayExt)}
              ${card(d.homeName, homeExt)}
            </div>
          </div>`;
      })();

      const nbaLeadersBlock = (() => {
        if (d.league !== 'nba' || !d.nbaExtras) return '';
        const { homeLeaders, awayLeaders } = d.nbaExtras;
        const empty = l => !l || (!l.points && !l.rebounds && !l.assists);
        if (empty(homeLeaders) && empty(awayLeaders)) return '';
        const card = (name, ld) => {
          if (empty(ld)) return `
            <div class="analysis-side-card">
              <div class="analysis-side-name">${name}</div>
              <div class="analysis-side-meta">Sin datos de líderes</div>
            </div>`;
          const row = (label, item) => item
            ? `<div class="analysis-stat-row"><span class="label">${label}</span><span class="value">${item.name} · ${item.value}</span></div>`
            : '';
          return `
            <div class="analysis-side-card">
              <div class="analysis-side-name">${name}</div>
              <div class="analysis-side-meta">Líderes del partido / serie</div>
              ${row('Puntos', ld.points)}
              ${row('Rebotes', ld.rebounds)}
              ${row('Asistencias', ld.assists)}
            </div>`;
        };
        return `
          <div class="analysis-block">
            <div class="analysis-block-title">Líderes</div>
            <div class="analysis-teams-grid">
              ${card(d.awayName, awayLeaders)}
              ${card(d.homeName, homeLeaders)}
            </div>
          </div>`;
      })();

      // Bloque de estado de la serie de playoffs (sólo si aplica)
      const seriesBlock = (() => {
        if (!d.seriesInfo) return '';
        const s = d.seriesInfo;
        const homeW = s.homeWins ?? '?';
        const awayW = s.awayWins ?? '?';
        const winsToWin = Math.ceil(s.bestOf / 2);
        const status = s.completed ? 'Serie terminada' : `Al mejor de ${s.bestOf} (primero a ${winsToWin})`;
        return `
          <div class="analysis-block">
            <div class="analysis-block-title">Estado de la serie</div>
            <div class="analysis-side-card" style="text-align:center;">
              <div style="font-size:1.1rem;font-weight:600;color:var(--accent-yellow);margin-bottom:6px;">
                ${s.summary || `${d.awayName} ${awayW} — ${homeW} ${d.homeName}`}
              </div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${status}</div>
            </div>
          </div>`;
      })();

      const seasonStatsTitle = d.isPlayoff
        ? 'Stats de temporada regular (referencia histórica)'
        : 'Forma reciente y stats de temporada';

      return `
        ${seriesBlock}
        ${pitchersBlock}
        ${handednessBlock}
        ${nbaEfficiencyBlock}
        ${nbaDefenseBlock}
        ${nbaLeadersBlock}

        <div class="analysis-block">
          <div class="analysis-block-title">${seasonStatsTitle}</div>
          <div class="analysis-teams-grid">
            ${teamCard(d.awayName, d.awayStats)}
            ${teamCard(d.homeName, d.homeStats)}
          </div>
        </div>

        <div class="analysis-block">
          <div class="analysis-block-title">Comparación directa</div>
          <div class="analysis-side-card">
            <div class="analysis-stat-row" style="border-bottom:1px solid var(--border); padding-bottom:8px; margin-bottom:6px;">
              <span class="label" style="font-weight:600;color:var(--text-primary)">${d.awayName}</span>
              <span class="label">vs</span>
              <span class="label" style="font-weight:600;color:var(--text-primary)">${d.homeName}</span>
            </div>
            ${compareRow('Win %', d.homeStats?.total?.rate, d.awayStats?.total?.rate)}
            ${compareRow('Diferencial', d.homeStats?.diff, d.awayStats?.diff)}
            ${compareRow('Pythagorean', d.homeStats?.pyth, d.awayStats?.pyth)}
            ${d.isPlayoff ? '' : compareRow('Racha', d.homeStats?.streak, d.awayStats?.streak)}
          </div>
        </div>

        <div class="analysis-block">
          <div class="analysis-block-title">Sede y horario</div>
          <div class="analysis-venue">
            ${d.venue ? `<strong>${d.venue}</strong>${d.city ? ` · ${d.city}${d.state ? ', ' + d.state : ''}` : ''}` : 'Sede no disponible'}
            <br><span style="color:var(--text-muted); font-size:0.8rem">${d.dateStr}</span>
          </div>
        </div>

        <div class="analysis-block">
          <button class="btn btn-ai" style="width:100%; padding:10px;"
            onclick="openAIAnalysis('${d.gameId}', '${d.league}')">
            ✨ Pedir narrativa con IA
          </button>
        </div>
      `;
    }

    // ===== IA — narrativa generada por Claude API =====
    // Guardamos la API key del usuario en localStorage. Nunca la mandamos a
    // ningún servidor que no sea api.anthropic.com directamente.
    const AI_KEY_STORAGE = 'sports_predictor_anthropic_key';

    function getAIKey() {
      return localStorage.getItem(AI_KEY_STORAGE) || '';
    }

    function saveAIKey() {
      const v = document.getElementById('aiKeyInput')?.value?.trim();
      if (!v) return;
      localStorage.setItem(AI_KEY_STORAGE, v);
      // re-disparar el análisis de IA con los mismos datos
      const { gameId, league } = window._lastAIGame || {};
      if (gameId) openAIAnalysis(gameId, league);
    }

    async function openAIAnalysis(gameId, league) {
      const game = findGameById(gameId, league);
      if (!game) return alert('No se encontró el partido.');

      window._lastAIGame = { gameId, league };

      const comp     = game.competitions?.[0];
      const homeComp = comp.competitors.find(c => c.homeAway === 'home');
      const awayComp = comp.competitors.find(c => c.homeAway === 'away');
      const homeName = homeComp?.team?.displayName || 'Local';
      const awayName = awayComp?.team?.displayName || 'Visitante';

      openAnalysisModal(`<span>✨ IA</span><span class="modal-vs">·</span><span>${awayName} @ ${homeName}</span>`);

      const apiKey = getAIKey();
      if (!apiKey) {
        document.getElementById('analysisModalBody').innerHTML = `
          <div class="ai-key-prompt">
            <div style="margin-bottom:10px;color:var(--text-primary);font-weight:600;">
              Conectar Claude API
            </div>
            <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:8px;">
              La narrativa con IA usa tu propia API key de Anthropic. Se guarda solo en tu navegador (localStorage) y se envía únicamente a api.anthropic.com.
            </p>
            <input type="password" id="aiKeyInput" placeholder="sk-ant-..." />
            <button onclick="saveAIKey()">Guardar y generar</button>
            <small>Conseguir una key: console.anthropic.com/settings/keys</small>
          </div>`;
        return;
      }

      // Recolectar contexto en paralelo
      try {
        const body = document.getElementById('analysisModalBody');
        body.innerHTML = `<div class="ai-narrative-box loading">Recolectando datos del partido...</div>`;

        const [homeStats, awayStats] = await Promise.all([
          fetchTeamFullStats(homeComp.id, league, homeComp),
          fetchTeamFullStats(awayComp.id, league, awayComp)
        ]);

        const homePitcher = league === 'mlb' ? extractPitcher(homeComp) : null;
        const awayPitcher = league === 'mlb' ? extractPitcher(awayComp) : null;

        // Buscar odds en el cache
        const oddsRaw = allTodayOddsRaw[league] || [];
        const oddsGame = oddsRaw.find(og =>
          teamLastWord(og.home_team) === teamLastWord(homeName) &&
          teamLastWord(og.away_team) === teamLastWord(awayName)
        );
        let oddsSummary = 'No disponibles';
        if (oddsGame?.bookmakers?.[0]) {
          const bk = oddsGame.bookmakers[0];
          const h2h = bk.markets.find(m => m.key === 'h2h');
          const sp  = bk.markets.find(m => m.key === 'spreads');
          const tot = bk.markets.find(m => m.key === 'totals');
          oddsSummary = `Moneyline: ${h2h?.outcomes.map(o=>`${o.name} ${fmtOdds(o.price)}`).join(' / ') || '—'}
Spread: ${sp?.outcomes.map(o=>`${o.name} ${fmtOdds(o.point)}`).join(' / ') || '—'}
Total O/U: ${tot?.outcomes[0]?.point || '—'}`;
        }

        const ctx = {
          deporte: league.toUpperCase(),
          partido: `${awayName} @ ${homeName}`,
          fecha: new Date(game.date).toLocaleString('es-ES'),
          sede: comp.venue?.fullName || 'No disponible',
          local: homeStats ? {
            equipo: homeName,
            record: homeStats.total ? `${homeStats.total.wins}-${homeStats.total.losses}` : null,
            recordCasa: homeStats.home ? `${homeStats.home.wins}-${homeStats.home.losses}` : null,
            promAnotado: homeStats.pf,
            promPermitido: homeStats.pa,
            diferencial: homeStats.diff,
            racha: homeStats.streak,
            pythagorean: homeStats.pyth
          } : null,
          visitante: awayStats ? {
            equipo: awayName,
            record: awayStats.total ? `${awayStats.total.wins}-${awayStats.total.losses}` : null,
            recordRuta: awayStats.road ? `${awayStats.road.wins}-${awayStats.road.losses}` : null,
            promAnotado: awayStats.pf,
            promPermitido: awayStats.pa,
            diferencial: awayStats.diff,
            racha: awayStats.streak,
            pythagorean: awayStats.pyth
          } : null,
          pitcherLocal:    homePitcher,
          pitcherVisitante: awayPitcher,
          odds: oddsSummary
        };

        body.innerHTML = `<div class="ai-narrative-box loading">✨ Generando análisis con Claude...</div>`;

        const narrative = await callClaudeAPI(apiKey, ctx);

        body.innerHTML = `
          <div class="ai-narrative-box">${escapeHtml(narrative)}</div>
          <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;">
            <button class="btn btn-ai" style="padding:6px 12px;font-size:0.8rem;" onclick="forgetAIKey()">Olvidar API key</button>
          </div>`;

      } catch (err) {
        document.getElementById('analysisModalBody').innerHTML =
          `<div class="ai-narrative-box error">Error: ${err.message}</div>
           <div style="margin-top:14px;"><button class="btn btn-ai" onclick="forgetAIKey()">Cambiar API key</button></div>`;
      }
    }

    function forgetAIKey() {
      localStorage.removeItem(AI_KEY_STORAGE);
      const { gameId, league } = window._lastAIGame || {};
      if (gameId) openAIAnalysis(gameId, league);
    }

    function escapeHtml(s) {
      return String(s ?? '')
        .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    }

    // Llama a la Claude API directamente desde el navegador.
    // Anthropic permite esto si pasamos el header anthropic-dangerous-direct-browser-access.
    async function callClaudeAPI(apiKey, ctx) {
      const systemPrompt = `Eres un analista deportivo experto en MLB y NBA. Generas análisis honestos y basados en datos reales para apuestas deportivas. Escribes en español neutro, claro y conciso. NUNCA inventas estadísticas. Si los datos son insuficientes para una conclusión, lo dices abiertamente. Tu objetivo es ayudar al usuario a entender el partido, no convencerlo de apostar.`;

      const userPrompt = `Analiza este partido y dame una narrativa de 3-5 párrafos cortos cubriendo:
1. Estado actual de cada equipo (forma, racha)
2. Factor clave del partido (pitcher dominante / mismatch ofensivo / localía / etc.)
3. Lo que dicen las odds vs lo que sugieren los números
4. Tu lectura honesta — incluye cualquier "red flag" o duda

Datos:
${JSON.stringify(ctx, null, 2)}`;

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const data = await resp.json();
      return data.content?.[0]?.text || 'Sin respuesta';
    }

    // =====================================================================
    // AUTO-REFRESH — dos capas
    // =====================================================================
    // CAPA RÁPIDA (hot, cada 5 min): refresca scoreboard y odds. Ligero.
    // CAPA LENTA (cold, cada 30 min): además resetea las predicciones
    // para que se recalculen con datos frescos (records, pitchers).
    // El usuario también puede forzar un refresh haciendo click en el indicador.

    // Tres ritmos distintos según costo de la fuente:
    //  - HOT (scoreboards ESPN, gratis): cada 5 min
    //  - ODDS (The Odds API, free tier 500/mes): cada 30 min
    //  - COLD (recalcular predicciones): cada 30 min
    // Separar el refresh de odds del de scoreboards evita quemar la cuota.
    const HOT_REFRESH_MS  = 5  * 60 * 1000;
    const ODDS_REFRESH_MS = 30 * 60 * 1000;
    const COLD_REFRESH_MS = 30 * 60 * 1000;
    let lastRefreshTimestamp = Date.now();
    let oddsRefreshCounter = 0;
    let coldRefreshCounter = 0;

    function setupAutoRefresh() {
      setInterval(refreshHotData, HOT_REFRESH_MS);
      setInterval(updateRefreshLabel, 30 * 1000);
      updateRefreshLabel();
    }

    async function refreshHotData(forceOdds = false) {
      const indicator = document.getElementById('refreshIndicator');
      indicator?.classList.add('refreshing');
      document.getElementById('refreshLabel').textContent = 'Actualizando...';

      try {
        // 1. Refresh ESPN (gratis): siempre que toque hot
        const [nbaGames, mlbGames] = await Promise.all([
          loadNBAGames(),
          loadMLBGames()
        ]);
        allTodayGames.nba = nbaGames;
        allTodayGames.mlb = mlbGames;
        updateSummary(nbaGames, mlbGames);

        // Repintar el sidebar del Dashboard (marcadores y estado en vivo)
        renderDashboardSidebar();

        // 2. Repintar odds: si toca refresh de odds llamamos la API,
        //    si no, repintamos desde caché (las cards se reescribieron).
        oddsRefreshCounter += HOT_REFRESH_MS;
        const shouldRefreshOdds = forceOdds || oddsRefreshCounter >= ODDS_REFRESH_MS;
        if (shouldRefreshOdds) {
          oddsRefreshCounter = 0;
          await Promise.all([loadOdds('nba', nbaGames), loadOdds('mlb', mlbGames)]);
        } else {
          applyOddsToDOM('nba', nbaGames, allTodayOddsRaw.nba || []);
          applyOddsToDOM('mlb', mlbGames, allTodayOddsRaw.mlb || []);
        }

        // 3. Refresh frío de predicciones
        coldRefreshCounter += HOT_REFRESH_MS;
        if (coldRefreshCounter >= COLD_REFRESH_MS) {
          coldRefreshCounter = 0;
          predictionsInitialized = false;
          const visible = document.querySelector('#section-predictions.active');
          if (visible) initPredictions();
        }

        lastRefreshTimestamp = Date.now();
      } catch (err) {
        console.error('Error en auto-refresh:', err);
      } finally {
        indicator?.classList.remove('refreshing');
        updateRefreshLabel();
      }
    }

    function manualRefresh() {
      // Manual = fuerza también refresh de odds y predicciones
      coldRefreshCounter = COLD_REFRESH_MS;
      refreshHotData(true);
    }

    function updateRefreshLabel() {
      const el = document.getElementById('refreshLabel');
      if (!el) return;
      const diffMs = Date.now() - lastRefreshTimestamp;
      const min = Math.floor(diffMs / 60000);
      el.textContent = min < 1 ? 'Actualizado' : `Hace ${min} min`;
    }


    // Variables globales del módulo de jugadores
    let searchDebounceTimer = null;
    let playerCharts = {};
    let lastPlayerSection = 'home';

    // ===== INICIALES PARA EL AVATAR (ej: "LeBron James" → "LJ") =====
    function getInitials(fullName) {
      return (fullName || '').split(' ').slice(0,2).map(n => n[0] || '').join('').toUpperCase();
    }

    // =====================================================================
    // ESPN NBA API — datos oficiales sin proxy ni API keys
    // =====================================================================
    // ESPN sirve la misma data que la NBA con CORS abierto, sin
    // restricciones. Es la fuente que usa la propia web de ESPN.

    // Convierte "8-20" (made-attempted) en {made:8, attempted:20}
    function parseMA(str) {
      const [m, a] = (str || '0-0').split('-').map(Number);
      return { made: m||0, attempted: a||0 };
    }

    // ESPN devuelve las stats de cada partido como un array. El orden está
    // en `labels`: [MIN, FG, FG%, 3PT, 3P%, FT, FT%, REB, AST, BLK, STL, PF, TO, PTS]
    function parseGameStats(statsArr) {
      if (!statsArr || statsArr.length < 14) return null;
      const fg = parseMA(statsArr[1]);
      const tp = parseMA(statsArr[3]);
      const ft = parseMA(statsArr[5]);
      return {
        MIN: parseFloat(statsArr[0]) || 0,
        FGM: fg.made, FGA: fg.attempted, FG_PCT: (parseFloat(statsArr[2])||0)/100,
        FG3M: tp.made, FG3A: tp.attempted, FG3_PCT: (parseFloat(statsArr[4])||0)/100,
        FTM: ft.made, FTA: ft.attempted, FT_PCT: (parseFloat(statsArr[6])||0)/100,
        REB: parseInt(statsArr[7])||0,
        AST: parseInt(statsArr[8])||0,
        BLK: parseInt(statsArr[9])||0,
        STL: parseInt(statsArr[10])||0,
        PF:  parseInt(statsArr[11])||0,
        TO:  parseInt(statsArr[12])||0,
        PTS: parseInt(statsArr[13])||0
      };
    }

    // ===== TRUE SHOOTING % =====
    function calcTS(pts, fga, fta) {
      const d = 2 * ((fga || 0) + 0.44 * (fta || 0));
      return d > 0 ? pts / d : null;
    }

    // ===== DESTRUIR CHARTS ANTERIORES (evita error "canvas already in use") =====
    function destroyPlayerCharts() {
      Object.values(playerCharts).forEach(c => { if (c && c.destroy) c.destroy(); });
      playerCharts = {};
    }

    // ===== VOLVER ATRÁS DESDE JUGADOR =====
    function goBackFromPlayer() {
      document.getElementById('playerSearchInput').value = '';
      showSection(lastPlayerSection, null);
    }
    function getCurrentSection() {
      const a = document.querySelector('.section.active');
      return a ? a.id.replace('section-','') : 'home';
    }

    // =====================================================================
    // BUSCADOR DE JUGADORES
    // =====================================================================
    function setupSearch() {
      const input = document.getElementById('playerSearchInput');
      const dropdown = document.getElementById('searchDropdown');

      input.addEventListener('input', function() {
        const q = this.value.trim();
        clearTimeout(searchDebounceTimer);
        if (q.length < 3) { dropdown.classList.remove('visible'); return; }
        dropdown.innerHTML = '<div class="search-loading">Buscando...</div>';
        dropdown.classList.add('visible');
        searchDebounceTimer = setTimeout(() => {
          const sport = document.getElementById('searchSport').value;
          doSearch(q, sport);
        }, 400);
      });

      // Cerrar dropdown al hacer clic fuera
      document.addEventListener('click', e => {
        if (!e.target.closest('.nav-search-wrapper')) dropdown.classList.remove('visible');
      });
    }

    async function doSearch(query, sport) {
      const dropdown = document.getElementById('searchDropdown');
      try {
        const results = sport === 'mlb'
          ? await searchMLBPlayers(query)
          : await searchNBAPlayers(query);

        if (!results.length) {
          dropdown.innerHTML = '<div class="search-no-results">No se encontraron jugadores</div>';
          return;
        }
        dropdown.innerHTML = results.map(p => `
          <div class="search-result-item" onclick="selectPlayer('${p.id}','${sport}','${p.name.replace(/'/g,"\\'")}')">
            <div class="search-result-avatar">${p.initials}</div>
            <div>
              <div class="search-result-name">${p.name}</div>
              <div class="search-result-meta">${p.team} · ${p.pos}</div>
            </div>
          </div>`).join('');
      } catch(e) {
        dropdown.innerHTML = `<div class="search-no-results">Error: ${e.message}</div>`;
      }
    }

    async function searchMLBPlayers(q) {
      const r = await fetch(`https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(q)}&sportId=1`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      return (d.people || []).slice(0,8).map(p => ({
        id: p.id, name: p.fullName,
        team: p.currentTeam?.name || '—',
        pos: p.primaryPosition?.abbreviation || '—',
        initials: getInitials(p.fullName)
      }));
    }

    async function searchNBAPlayers(q) {
      const r = await fetch(
        `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(q)}&limit=20&type=player`
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      // results[0] es el bloque de jugadores
      const players = d.results?.find(rt => rt.type === 'player')?.contents || [];
      return players
        .filter(p => p.defaultLeagueSlug === 'nba')
        .slice(0, 8)
        .map(p => {
          // uid: "s:40~l:46~a:1966" — el ID del atleta está después de "~a:"
          const id = (p.uid || '').split('~a:')[1];
          return {
            id,
            name: p.displayName,
            team: p.subtitle || '—',
            pos: '—', // ESPN no devuelve posición en la búsqueda; se ve en el perfil
            initials: getInitials(p.displayName)
          };
        });
    }

    function selectPlayer(id, sport, name) {
      document.getElementById('searchDropdown').classList.remove('visible');
      document.getElementById('playerSearchInput').value = name;
      lastPlayerSection = getCurrentSection();
      showSection('player', null);
      loadPlayerProfile(id, sport);
    }

    // =====================================================================
    // PUNTO DE ENTRADA: cargar perfil de jugador
    // =====================================================================
    async function loadPlayerProfile(playerId, sport) {
      const loadEl = document.getElementById('playerLoadingState');
      document.getElementById('playerContent').innerHTML = '';
      loadEl.style.display = 'flex';
      destroyPlayerCharts();
      document.getElementById('playerBreadcrumb').textContent = `${sport.toUpperCase()} › cargando...`;

      if (sport === 'nba') {
        await loadNBAPlayer(playerId);
      } else {
        await loadMLBPlayer(playerId);
      }
      loadEl.style.display = 'none';
    }

    // =====================================================================
    // MLB — CARGAR Y RENDERIZAR
    async function init() {
      setTodayDate();
      loadEloRatings();

      try {
        const [nbaGames, mlbGames] = await Promise.all([
          loadNBAGames(),
          loadMLBGames()
        ]);

        allTodayGames.nba = nbaGames;
        allTodayGames.mlb = mlbGames;

        updateSummary(nbaGames, mlbGames);
        renderDashboardSidebar();

        await Promise.all([
          loadOdds('nba', nbaGames),
          loadOdds('mlb', mlbGames)
        ]);
      } catch (err) {
        // Si ESPN no responde (timeout, red caída), mostramos un mensaje claro.
        const sidebar = document.getElementById('dashboardSidebar') || document.getElementById('section-home');
        if (sidebar) {
          sidebar.innerHTML = `
            <div class="coming-soon" style="padding:2rem;text-align:center">
              <div style="font-size:2rem;margin-bottom:.5rem">📡</div>
              <h3 style="color:var(--accent-red)">No se pudo conectar</h3>
              <p style="color:var(--text-secondary);margin:.5rem 0">ESPN no respondió. Verifica tu conexión e intenta de nuevo.</p>
              <button class="filter-btn active" style="margin-top:1rem" onclick="location.reload()">Reintentar</button>
            </div>`;
        }
        console.error('Error cargando partidos:', err.message);
      }
    }

    // Arranca la app
    init();
    setupSearch();
    setupAutoRefresh();
