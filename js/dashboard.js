// =====================================================================
// DASHBOARD — sidebar de partidos del día + panel central de detalle
// =====================================================================

    // DASHBOARD CENTRALIZADO — sidebar de partidos + panel detalle
    // =====================================================================
    // Reemplaza la antigua vista de "grid de cards". El usuario navega los
    // partidos por la izquierda y ve toda la info del seleccionado a la
    // derecha (header + predicción + análisis + IA), sin abrir modales.

    let dashboardFilter   = 'all';   // 'all' | 'nba' | 'mlb'
    let selectedGameKey   = null;    // `${league}-${id}` del partido activo
    let activePanelTab    = 'analisis';

    // Construye el item HTML de un partido en el sidebar
    function dashboardSidebarItem(game, league) {
      const comp     = game.competitions?.[0];
      const homeComp = comp?.competitors?.find(c => c.homeAway === 'home');
      const awayComp = comp?.competitors?.find(c => c.homeAway === 'away');
      if (!homeComp || !awayComp) return '';

      const homeAbbr = homeComp.team?.abbreviation || homeComp.team?.shortDisplayName || '?';
      const awayAbbr = awayComp.team?.abbreviation || awayComp.team?.shortDisplayName || '?';

      const isLive  = game.status?.type?.state === 'in';
      const isFinal = game.status?.type?.state === 'post';

      // Lectura desde el historial si la predicción ya fue calculada
      const histKey = `${league}-${game.id}`;
      const pred    = (window.__predHistoryCache || {})[histKey];
      const confClass = pred?.confidence === 'high'   ? 'high'
                      : pred?.confidence === 'medium' ? 'medium'
                      : pred?.confidence === 'low'    ? 'low'
                      : '';

      let scoreOrTime = '';
      if (isLive) {
        scoreOrTime = `<span class="dashboard-game-item-score">${awayComp.score || '0'}-${homeComp.score || '0'}</span>
                       <span class="dashboard-game-item-live">EN VIVO</span>`;
      } else if (isFinal) {
        scoreOrTime = `<span class="dashboard-game-item-score">${awayComp.score || '0'}-${homeComp.score || '0'}</span>
                       <span style="color:var(--text-muted)">Final</span>`;
      } else {
        scoreOrTime = `<span class="dashboard-game-item-time">${formatGameTime(game.date)}</span>`;
      }

      const isSelected = selectedGameKey === histKey ? 'selected' : '';

      return `
        <div class="dashboard-game-item ${isSelected}"
             data-game-key="${histKey}"
             data-league="${league}"
             onclick="selectDashboardGame('${game.id}', '${league}')">
          <div class="dashboard-game-item-teams">
            <span class="dashboard-conf-dot ${confClass}" title="${pred?.confidence || 'sin predicción'}"></span>
            <span>${awayAbbr} @ ${homeAbbr}</span>
          </div>
          <div class="dashboard-game-item-meta">
            ${scoreOrTime}
          </div>
        </div>`;
    }

    // Re-renderiza la lista del sidebar desde allTodayGames
    function renderDashboardSidebar() {
      const list = document.getElementById('dashboardGameList');
      if (!list) return;

      // Cache del historial para mostrar el dot de confianza sin re-leer en cada item
      window.__predHistoryCache = loadHistory();

      const nbaGames = allTodayGames.nba || [];
      const mlbGames = allTodayGames.mlb || [];

      const showNBA = dashboardFilter === 'all' || dashboardFilter === 'nba';
      const showMLB = dashboardFilter === 'all' || dashboardFilter === 'mlb';

      let html = '';

      if (showNBA && nbaGames.length) {
        html += `<div class="dashboard-league-header">
          <span class="league-dot" style="background:var(--nba-color)"></span>NBA
        </div>`;
        html += nbaGames.map(g => dashboardSidebarItem(g, 'nba')).join('');
      }

      if (showMLB && mlbGames.length) {
        html += `<div class="dashboard-league-header">
          <span class="league-dot" style="background:var(--accent-blue)"></span>MLB
        </div>`;
        html += mlbGames.map(g => dashboardSidebarItem(g, 'mlb')).join('');
      }

      if (!html) {
        html = `<div style="padding:24px 12px; text-align:center; color:var(--text-muted); font-size:0.85rem;">
          No hay partidos para este filtro.
        </div>`;
      }

      list.innerHTML = html;

      // Actualizar contador "en vivo" en la cabecera
      const live = [...nbaGames, ...mlbGames]
        .filter(g => g.status?.type?.state === 'in').length;
      const liveBadge = document.getElementById('liveCount');
      if (liveBadge) {
        liveBadge.textContent = live > 0 ? `${live} en vivo` : `${nbaGames.length + mlbGames.length} hoy`;
        liveBadge.style.color = live > 0 ? 'var(--accent-red)' : '';
      }
    }

    // Filtro Todos / NBA / MLB
    function filterDashboard(filter, btn) {
      dashboardFilter = filter;
      document.querySelectorAll('.dashboard-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderDashboardSidebar();
    }

    // Click en un partido del sidebar → render del panel
    function selectDashboardGame(gameId, league) {
      selectedGameKey = `${league}-${gameId}`;
      const game = findGameById(gameId, league);
      if (!game) return;

      // Marcar el item seleccionado en el sidebar
      document.querySelectorAll('.dashboard-game-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.gameKey === selectedGameKey);
      });

      renderDashboardPanel(game, league);
    }

    // Renderiza el panel principal: header del partido + tabs
    function renderDashboardPanel(game, league) {
      const panel = document.getElementById('dashboardPanel');
      if (!panel) return;

      const comp     = game.competitions?.[0];
      const homeComp = comp?.competitors?.find(c => c.homeAway === 'home');
      const awayComp = comp?.competitors?.find(c => c.homeAway === 'away');
      if (!homeComp || !awayComp) {
        panel.innerHTML = `<div class="dashboard-panel-empty">
          <div class="dashboard-panel-empty-title">Datos del partido no disponibles</div>
        </div>`;
        return;
      }

      const isLive  = game.status?.type?.state === 'in';
      const isFinal = game.status?.type?.state === 'post';

      const homeName = homeComp.team?.shortDisplayName || homeComp.team?.displayName || '';
      const awayName = awayComp.team?.shortDisplayName || awayComp.team?.displayName || '';

      const homeLogo = homeComp.team?.logo
        ? `<img class="panel-game-team-logo" src="${homeComp.team.logo}" alt="${homeName}" onerror="this.style.display='none'">`
        : `<div class="team-logo-fallback">${homeComp.team?.abbreviation || '?'}</div>`;
      const awayLogo = awayComp.team?.logo
        ? `<img class="panel-game-team-logo" src="${awayComp.team.logo}" alt="${awayName}" onerror="this.style.display='none'">`
        : `<div class="team-logo-fallback">${awayComp.team?.abbreviation || '?'}</div>`;

      const homeRec = homeComp.records?.[0]?.summary || '';
      const awayRec = awayComp.records?.[0]?.summary || '';

      let centerHTML;
      if (isLive || isFinal) {
        centerHTML = `
          <div class="panel-game-score-display">${awayComp.score || '0'} - ${homeComp.score || '0'}</div>
          <div class="panel-game-score-vs" style="font-size:0.75rem; color:var(--text-muted)">
            ${game.status?.type?.shortDetail || ''}
          </div>`;
      } else {
        centerHTML = `
          <div class="panel-game-score-vs">VS</div>
          <div class="panel-game-score-vs" style="font-size:0.8rem; color:var(--text-secondary)">
            ${formatGameTime(game.date)}
          </div>`;
      }

      const venue = comp.venue?.fullName || '';

      const statusInfo = getStatusInfo(
        isLive ? '2' : isFinal ? '3' : '1',
        game.status?.type?.shortDetail
      );

      panel.innerHTML = `
        <!-- Header del partido -->
        <div class="panel-game-header ${league}">
          <div class="panel-game-meta">
            <span class="status-badge ${statusInfo.css}">${statusInfo.label}</span>
            <span class="panel-game-venue">${venue}</span>
          </div>
          <div class="panel-game-teams">
            <div class="panel-game-team">
              ${awayLogo}
              <div class="panel-game-team-name">${awayName}</div>
              <div class="panel-game-team-record">${awayRec}</div>
            </div>
            <div class="panel-game-score">
              ${centerHTML}
            </div>
            <div class="panel-game-team">
              ${homeLogo}
              <div class="panel-game-team-name">${homeName}</div>
              <div class="panel-game-team-record">${homeRec}</div>
            </div>
          </div>
        </div>

        <!-- Tabs -->
        <div class="panel-tabs">
          <button class="panel-tab ${activePanelTab==='prediccion'?'active':''}" onclick="switchPanelTab('prediccion','${game.id}','${league}')">🎯 Predicción</button>
          <button class="panel-tab ${activePanelTab==='analisis'?'active':''}"   onclick="switchPanelTab('analisis','${game.id}','${league}')">📊 Análisis</button>
          <button class="panel-tab ${activePanelTab==='ia'?'active':''}"          onclick="switchPanelTab('ia','${game.id}','${league}')">✨ IA</button>
        </div>

        <!-- Contenido del tab activo -->
        <div class="panel-tab-content" id="panelTabContent">
          <div class="loading-container"><div class="spinner"></div><div class="loading-text">Cargando...</div></div>
        </div>
      `;

      // Cargar el contenido del tab activo
      switchPanelTab(activePanelTab, game.id, league, /*skipMark=*/true);
    }

    // Cambia el tab activo y carga el contenido correspondiente
    function switchPanelTab(tab, gameId, league, skipMark) {
      activePanelTab = tab;
      if (!skipMark) {
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        const allTabs = document.querySelectorAll('.panel-tab');
        const idx = ['prediccion','analisis','ia'].indexOf(tab);
        if (allTabs[idx]) allTabs[idx].classList.add('active');
      }
      const target = document.getElementById('panelTabContent');
      if (!target) return;
      target.innerHTML = `<div class="loading-container"><div class="spinner"></div><div class="loading-text">Cargando...</div></div>`;

      if (tab === 'prediccion') return loadPanelPrediccionTab(gameId, league, target);
      if (tab === 'analisis')   return loadPanelAnalisisTab(gameId, league, target);
      if (tab === 'ia')         return loadPanelIATab(gameId, league, target);
    }

    // Tab Predicción: lee del historial (initPredictions ya guardó los picks ahí)
    async function loadPanelPrediccionTab(gameId, league, target) {
      const histKey = `${league}-${gameId}`;
      let pred = loadHistory()[histKey];

      // Si predictions aún no se inicializó, dispararlo y esperar
      if (!pred && !predictionsInitialized) {
        target.innerHTML = `<div class="panel-pred-empty">
          <div class="spinner" style="margin:0 auto 12px"></div>
          Calculando predicciones (puede tardar unos segundos)...
        </div>`;
        try {
          await initPredictions();
          pred = loadHistory()[histKey];
        } catch (e) {
          console.error('[Predicciones] Error al inicializar:', e);
          target.innerHTML = `<div class="panel-pred-empty">
            <strong>Error al calcular predicciones</strong><br>
            ${escapeHtml(e?.message || 'Error de red. Intenta recargar.')}
          </div>`;
          return;
        }
      }

      if (!pred) {
        target.innerHTML = `<div class="panel-pred-empty">
          <strong>Datos insuficientes</strong><br>
          No hay suficiente información para generar una predicción confiable
          para este partido. La integridad del modelo es prioridad —
          preferimos no inventar antes que dar un pick débil.
        </div>`;
        return;
      }

      const confLabel = pred.confidence === 'high'   ? 'Alta'
                     : pred.confidence === 'medium' ? 'Media'
                     : pred.confidence === 'low'    ? 'Baja' : '—';
      const edgeStr = pred.edge != null
        ? `${pred.edge > 0 ? '+' : ''}${(pred.edge * 100).toFixed(1)}%`
        : '—';
      const homeProb = pred.homeEstP != null ? (pred.homeEstP * 100).toFixed(0) + '%' : '—';
      const awayProb = pred.homeEstP != null ? ((1 - pred.homeEstP) * 100).toFixed(0) + '%' : '—';
      const reason = pred.reason || pred.rationale || 'El modelo combina forma reciente, odds, lesiones y H2H para generar este pick.';

      target.innerHTML = `
        <div class="panel-pred-summary">
          <div class="panel-pred-pick-card">
            <div class="panel-pred-pick-label">Pick recomendado</div>
            <div class="panel-pred-pick-value">${pred.pickName || '—'}</div>
            <div style="font-size:0.78rem; color:var(--text-muted)">Edge estimado: ${edgeStr}</div>
          </div>
          <div class="panel-pred-conf-card">
            <div class="panel-pred-pick-label">Confianza del modelo</div>
            <div class="panel-pred-conf-badge ${pred.confidence}">${confLabel}</div>
          </div>
        </div>

        <div class="panel-pred-prob-grid">
          <div class="panel-pred-prob-item">
            <div class="panel-pred-prob-item-label">${pred.awayName} ganan</div>
            <div class="panel-pred-prob-item-value">${awayProb}</div>
          </div>
          <div class="panel-pred-prob-item">
            <div class="panel-pred-prob-item-label">${pred.homeName} ganan</div>
            <div class="panel-pred-prob-item-value">${homeProb}</div>
          </div>
          <div class="panel-pred-prob-item">
            <div class="panel-pred-prob-item-label">Edge vs odds</div>
            <div class="panel-pred-prob-item-value" style="color:${pred.edge == null ? 'var(--text-muted)' : pred.edge > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">${edgeStr}</div>
          </div>
        </div>

        <div class="panel-pred-reason">
          <strong>Razón del modelo:</strong> ${escapeHtml(reason)}
        </div>

        <div style="text-align:center; margin-top:14px;">
          <button class="btn btn-primary" onclick="showSection('predictions', document.querySelector('.nav-links a[onclick*=predictions]'))" style="padding:10px 20px;">
            Ver todas las predicciones del día →
          </button>
        </div>
      `;
    }

    // Tab Análisis: reusa renderGameAnalysis() del modal
    async function loadPanelAnalisisTab(gameId, league, target) {
      const game = findGameById(gameId, league);
      if (!game) {
        target.innerHTML = `<div class="panel-pred-empty">Partido no encontrado.</div>`;
        return;
      }

      const comp     = game.competitions?.[0];
      const homeComp = comp.competitors.find(c => c.homeAway === 'home');
      const awayComp = comp.competitors.find(c => c.homeAway === 'away');
      const homeName = homeComp?.team?.displayName || 'Local';
      const awayName = awayComp?.team?.displayName || 'Visitante';

      try {
        const [homeStats, awayStats] = await Promise.all([
          fetchTeamFullStats(homeComp.id, league, homeComp),
          fetchTeamFullStats(awayComp.id, league, awayComp)
        ]);

        const homePitcher = league === 'mlb' ? extractPitcher(homeComp) : null;
        const awayPitcher = league === 'mlb' ? extractPitcher(awayComp) : null;

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

        let handedness = null;
        if (league === 'mlb') {
          const [homeP, awayP, homeMLBId, awayMLBId] = await Promise.all([
            homePitcher?.fullName ? resolveMLBPitcherInfo(homePitcher.fullName) : null,
            awayPitcher?.fullName ? resolveMLBPitcherInfo(awayPitcher.fullName) : null,
            getMLBTeamId(homeName),
            getMLBTeamId(awayName)
          ]);
          if (homeP?.pitchHand && homePitcher) homePitcher.hand = homeP.pitchHand;
          if (awayP?.pitchHand && awayPitcher) awayPitcher.hand = awayP.pitchHand;

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

        target.innerHTML = renderGameAnalysis({
          league, homeName, awayName, homeStats, awayStats,
          homePitcher, awayPitcher, handedness, nbaExtras,
          seriesInfo, isPlayoff,
          venue, city, state, dateStr, gameId
        });
      } catch (err) {
        target.innerHTML = `<div class="panel-pred-empty">Error cargando análisis: ${escapeHtml(err.message)}</div>`;
      }
    }

    // Tab IA: reusa el flujo existente de openAIAnalysis (abre modal)
    function loadPanelIATab(gameId, league, target) {
      target.innerHTML = `
        <div style="text-align:center; padding:30px 20px;">
          <div style="font-size:2.4rem; margin-bottom:12px;">✨</div>
          <h3 style="margin-bottom:10px; color:var(--accent-blue);">Narrativa generada por IA</h3>
          <p style="color:var(--text-secondary); margin-bottom:20px; line-height:1.5;">
            Genera un análisis en lenguaje natural usando Claude.<br>
            La IA combina stats, odds y forma reciente para una opinión narrativa.
          </p>
          <button class="btn btn-ai" onclick="openAIAnalysis('${gameId}','${league}')" style="padding:12px 24px; font-size:0.95rem;">
            Generar narrativa con Claude
          </button>
          <p style="margin-top:14px; font-size:0.75rem; color:var(--text-muted);">
            Requiere tu API key de Anthropic (se guarda solo en tu navegador).
          </p>
        </div>
      `;
    }


    // ===== INICIALIZAR LA APP =====
    // Todo lo que está dentro de este bloque se ejecuta cuando la página termina de cargarse.
