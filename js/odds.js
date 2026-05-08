// =====================================================================
// ODDS — fuente de cuotas (spreads, moneylines, totales) desde ESPN
// =====================================================================
// Este módulo se carga PRIMERO. También define fetchWithTimeout,
// una utilidad compartida por todos los módulos siguientes.
// =====================================================================

    // ===== FETCH CON TIMEOUT =====
    // fetch() nativo no tiene timeout — si ESPN tarda mucho, la app se congela.
    // fetchWithTimeout aborta automáticamente después de ms milisegundos.
    async function fetchWithTimeout(url, ms = 8000) {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), ms);
      try {
        return await fetch(url, { signal: ctrl.signal });
      } catch (e) {
        if (e.name === 'AbortError') throw new Error(`Timeout al conectar (${ms}ms): ${url.split('/').pop()}`);
        throw e;
      } finally {
        clearTimeout(id);
      }
    }

    // =====================================================================
    // ODDS — vienen del endpoint /summary de ESPN (gratis, sin cuota).
    // El primer bookmaker disponible suele ser DraftKings.
    // =====================================================================

    // Extrae la última palabra de un nombre de equipo (ej: "Los Angeles Lakers" → "lakers")
    function teamLastWord(name) {
      return (name || '').trim().toLowerCase().split(' ').pop();
    }

    function fmtOdds(price) { return price > 0 ? `+${price}` : `${price}`; }

    // ===== ODDS DESDE ESPN (gratis, sin cuota) =====
    // ESPN expone los odds del primer bookmaker (DraftKings) en
    // /summary?event={id}.pickcenter. Hacemos un fetch por partido en paralelo
    // y los mapeamos al mismo formato que usaba The Odds API para no tocar
    // los consumidores (predicciones, IA, applyOddsToDOM).
    async function loadOdds(league, games) {
      if (!games.length) return;
      const sportPath = league === 'nba' ? 'basketball/nba' : 'baseball/mlb';

      const results = await Promise.all(games.map(async game => {
        const comp = game.competitions?.[0];
        if (!comp) return null;
        const homeComp = comp.competitors.find(c => c.homeAway === 'home');
        const awayComp = comp.competitors.find(c => c.homeAway === 'away');
        const homeName = homeComp?.team?.displayName || '';
        const awayName = awayComp?.team?.displayName || '';
        try {
          const r = await fetchWithTimeout(
            `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${game.id}`
          );
          if (!r.ok) return null;
          const d = await r.json();
          return mapPickcenterToOddsShape(d.pickcenter, homeName, awayName);
        } catch { return null; }
      }));

      const oddsData = results.filter(Boolean);
      allTodayOddsRaw[league] = oddsData;

      // Guardamos odds de apertura la primera vez que cargamos del día
      // Usamos gameId como key para poder comparar en initPredictions()
      games.forEach((game, i) => {
        const key = `${league}-${game.id}`;
        if (!allTodayOddsOpen[key] && results[i]) {
          allTodayOddsOpen[key] = results[i];
        }
      });

      applyOddsToDOM(league, games, oddsData);
    }

    // Convierte el pickcenter de ESPN al shape que esperan los consumidores
    // (mismo formato que devolvía The Odds API). El "favorito" se infiere por
    // el signo del moneyLine: negativo = favorito, recibe -spread.
    function mapPickcenterToOddsShape(pickcenter, homeName, awayName) {
      const pc = pickcenter?.[0];
      if (!pc) return null;

      const homeML = pc.homeTeamOdds?.moneyLine;
      const awayML = pc.awayTeamOdds?.moneyLine;
      const spreadAbs = pc.spread != null ? Math.abs(pc.spread) : null;
      const homeIsFav = homeML != null && homeML < 0;
      const homeSpread = spreadAbs != null ? (homeIsFav ? -spreadAbs : spreadAbs) : null;
      const awaySpread = spreadAbs != null ? -homeSpread : null;
      const total = pc.overUnder;

      const markets = [];
      if (homeSpread != null) {
        markets.push({
          key: 'spreads',
          outcomes: [
            { name: homeName, point: homeSpread, price: -110 },
            { name: awayName, point: awaySpread, price: -110 }
          ]
        });
      }
      if (homeML != null && awayML != null) {
        markets.push({
          key: 'h2h',
          outcomes: [
            { name: homeName, price: homeML },
            { name: awayName, price: awayML }
          ]
        });
      }
      if (total != null) {
        markets.push({
          key: 'totals',
          outcomes: [
            { name: 'Over',  point: total, price: pc.overOdds  ?? -110 },
            { name: 'Under', point: total, price: pc.underOdds ?? -110 }
          ]
        });
      }
      if (!markets.length) return null;

      return {
        home_team: homeName,
        away_team: awayName,
        bookmakers: [{
          key:   (pc.provider?.name || 'espn').toLowerCase().replace(/\s+/g, ''),
          title: pc.provider?.name || 'ESPN',
          markets
        }]
      };
    }

    // Escribe los odds en los slots del DOM para una lista de juegos.
    // Aceptamos `oddsData` por separado para poder repintar desde caché
    // cuando el scoreboard se reconstruyó pero la API está agotada.
    function applyOddsToDOM(league, games, oddsData) {
      games.forEach(game => {
        const comps = game.competitions?.[0];
        if (!comps) return;

        const awayComp = comps.competitors.find(c => c.homeAway === 'away');
        const homeComp = comps.competitors.find(c => c.homeAway === 'home');
        const homeName = homeComp?.team?.displayName || '';
        const awayName = awayComp?.team?.displayName || '';

        const oddsGame = (oddsData || []).find(og => {
          const homeMatch = teamLastWord(og.home_team) === teamLastWord(homeName);
          const awayMatch = teamLastWord(og.away_team) === teamLastWord(awayName);
          return homeMatch && awayMatch;
        });

        const container = document.getElementById(`odds-${league}-${game.id}`);
        if (!container) return;

        const get = key => container.querySelector(`[data-odds="${key}"]`);

        if (!oddsGame || !oddsGame.bookmakers?.length) {
          container.querySelectorAll('.odds-value').forEach(el => {
            el.textContent = !oddsData?.length ? '—' : 'N/D';
            el.classList.remove('odds-loading');
          });
          return;
        }

        const bk = oddsGame.bookmakers[0];
        const spreadMkt = bk.markets.find(m => m.key === 'spreads');
        const h2hMkt    = bk.markets.find(m => m.key === 'h2h');
        const totalMkt  = bk.markets.find(m => m.key === 'totals');

        if (spreadMkt) {
          const awayS = spreadMkt.outcomes.find(o => teamLastWord(o.name) === teamLastWord(oddsGame.away_team));
          const homeS = spreadMkt.outcomes.find(o => teamLastWord(o.name) === teamLastWord(oddsGame.home_team));
          if (awayS) { get('away-spread').textContent = fmtOdds(awayS.point); get('away-spread').classList.remove('odds-loading'); }
          if (homeS) { get('home-spread').textContent = fmtOdds(homeS.point); get('home-spread').classList.remove('odds-loading'); }
        }

        if (h2hMkt) {
          const awayML = h2hMkt.outcomes.find(o => teamLastWord(o.name) === teamLastWord(oddsGame.away_team));
          const homeML = h2hMkt.outcomes.find(o => teamLastWord(o.name) === teamLastWord(oddsGame.home_team));
          if (awayML) { get('away-ml').textContent = fmtOdds(awayML.price); get('away-ml').classList.remove('odds-loading'); }
          if (homeML) { get('home-ml').textContent = fmtOdds(homeML.price); get('home-ml').classList.remove('odds-loading'); }
        }

        if (totalMkt) {
          const over = totalMkt.outcomes.find(o => o.name === 'Over');
          if (over) { get('total').textContent = `${over.point}`; get('total').classList.remove('odds-loading'); }
        }
      });
    }

