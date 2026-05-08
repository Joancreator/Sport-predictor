// =====================================================================
// PREDICTIONS — motor de 12 señales + UI de cards de predicción
// =====================================================================
// Contiene: matemática de probabilidad, ELO, fetches de stats/lesiones/H2H,
// calcPrediction (motor), props players, top picks, renderPredCard, initPredictions

    function americanToProb(ml) {
      if (ml == null || ml === 0) return null;
      if (ml > 0) return 100 / (ml + 100);
      return (-ml) / (-ml + 100);
    }

    // Normaliza dos probabilidades para quitar el juice de la casa
    function normalizeProbs(pA, pB) {
      const total = pA + pB;
      if (!total) return [0.5, 0.5];
      return [pA / total, pB / total];
    }

    // Formatea una probabilidad como porcentaje entero
    function fmtPct(p) { return p != null ? `${Math.round(p * 100)}%` : '—'; }

    // Parsea el summary "60-22" → { wins, losses, total, rate }
    function parseRecord(summary) {
      if (!summary) return null;
      const parts = summary.split('-').map(Number);
      if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
      const wins = parts[0], losses = parts[1];
      const total = wins + losses;
      return total >= 5 ? { wins, losses, total, rate: wins / total } : null;
    }

    // ===== CACHÉ COMPARTIDA DE SCHEDULES =====
    // El schedule de cada equipo se usa para H2H y para calcular días de descanso.
    const scheduleCache = new Map();

    async function fetchTeamSchedule(teamId, sport) {
      const key = `${sport}-sched-${teamId}`;
      if (scheduleCache.has(key)) return scheduleCache.get(key);
      try {
        const base = sport === 'nba'
          ? 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams'
          : 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams';
        const r = await fetch(`${base}/${teamId}/schedule`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        const events = data.events || [];
        scheduleCache.set(key, events);
        return events;
      } catch {
        scheduleCache.set(key, []);
        return [];
      }
    }

    // ===== STANDINGS CON LAST-10 =====
    // ESPN standings incluye "Last Ten Games" por equipo (ej. "8-2").
    // Cargamos una sola vez por liga y construimos un mapa teamId → last10.
    // Usamos un "promise cache" para que múltiples llamadas en paralelo no
    // disparen N fetches — todas esperan la misma promesa.
    const standingsPromiseCache = {};

    async function fetchLeagueStandingsMap(sport) {
      if (!standingsPromiseCache[sport]) {
        standingsPromiseCache[sport] = (async () => {
          const sportPath = sport === 'nba' ? 'basketball/nba' : 'baseball/mlb';
          const year = new Date().getFullYear();
          try {
            const r = await fetch(
              `https://site.api.espn.com/apis/v2/sports/${sportPath}/standings?season=${year}`
            );
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            const map = {};
            for (const child of data.children || []) {
              for (const entry of child.standings?.entries || []) {
                const teamId = String(entry.team?.id);
                const stats  = entry.stats || [];
                const get    = name => stats.find(s => s.name === name);
                const l10raw = get('Last Ten Games')?.displayValue;
                let last10 = null;
                if (l10raw) {
                  const parts = l10raw.split('-').map(Number);
                  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                    const [w, l] = parts;
                    const total  = w + l;
                    if (total >= 5) last10 = { wins: w, losses: l, rate: w / total };
                  }
                }
                map[teamId] = { last10 };
              }
            }
            // Caduca después de 30 min para que no usemos datos de ayer
            setTimeout(() => { delete standingsPromiseCache[sport]; }, 30 * 60 * 1000);
            return map;
          } catch { return {}; }
        })();
      }
      return standingsPromiseCache[sport];
    }

    // Forma reciente: last-10 de standings + días de descanso del schedule.
    // last-10 viene de standings (un fetch cubre toda la liga).
    // restDays viene del schedule limitado — solo necesitamos la fecha del último partido.
    async function fetchTeamRecentForm(teamId, sport) {
      const [standMap, events] = await Promise.all([
        fetchLeagueStandingsMap(sport),
        fetchTeamSchedule(teamId, sport)
      ]);

      const last10 = standMap[String(teamId)]?.last10 ?? null;

      // Días de descanso: el schedule devuelve ~7 eventos — suficiente para la fecha reciente.
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const lastGameDate = events
        .filter(ev => ev.competitions?.[0]?.status?.type?.state === 'post')
        .map(ev => { const d = new Date(ev.date); d.setHours(0, 0, 0, 0); return d; })
        .filter(d => d <= today)
        .sort((a, b) => b - a)[0] ?? null;

      let restDays = null;
      if (lastGameDate) {
        const daysDiff = Math.round((today - lastGameDate) / 86400000);
        restDays = Math.max(0, Math.min(7, daysDiff - 1));
      }

      return { last10, restDays };
    }

    // ===== HEAD-TO-HEAD =====
    // Historial directo entre dos equipos en la temporada actual.
    // Usa fetchTeamSchedule (caché compartida) — sin fetch extra.
    const h2hCache = new Map();

    async function fetchH2H(homeTeamId, awayTeamId, sport) {
      const key = `${sport}-h2h-${homeTeamId}-${awayTeamId}`;
      if (h2hCache.has(key)) return h2hCache.get(key);
      try {
        const events = await fetchTeamSchedule(homeTeamId, sport);
        const meetings = events
          .filter(ev => {
            const comp = ev.competitions?.[0];
            if (comp?.status?.type?.state !== 'post') return false;
            return (comp.competitors || []).some(c => String(c.team?.id) === String(awayTeamId));
          })
          .map(ev => {
            const comp = ev.competitions[0];
            const us = (comp.competitors || []).find(c => String(c.team?.id) === String(homeTeamId));
            return { won: us?.winner === true };
          });
        const result = meetings.length >= 2
          ? { homeWins: meetings.filter(m => m.won).length, total: meetings.length }
          : null;
        h2hCache.set(key, result);
        return result;
      } catch {
        h2hCache.set(key, null);
        return null;
      }
    }

    // ===== LESIONES =====
    // Cache en memoria para evitar pedir el endpoint de lesiones en cada render.
    // ESPN devuelve la lista completa de la liga, así que con un solo fetch tenemos
    // todos los equipos. La cache vive 30 minutos.
    const injuriesCache = { nba: null, mlb: null };
    const INJURIES_TTL_MS = 30 * 60 * 1000;

    // Devuelve un mapa: teamId → array de lesiones { name, position, status, severity }.
    // severity: 'out' (Out / 60-IL) | 'il' (10/15-IL) | 'dtd' (Day-To-Day).
    // Filtramos suspensiones, paternidad y bereavement (no son lesiones de juego).
    async function fetchInjuries(league) {
      const cached = injuriesCache[league];
      if (cached && (Date.now() - cached.ts < INJURIES_TTL_MS)) return cached.map;

      const sportPath = league === 'nba' ? 'basketball/nba' : 'baseball/mlb';
      const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/injuries`;
      const map = new Map();
      try {
        const res = await fetch(url);
        const data = await res.json();
        (data.injuries || []).forEach(team => {
          const teamId = String(team.id);
          const list = (team.injuries || [])
            .map(inj => {
              const status = inj.status || '';
              const sev = classifyInjurySeverity(status);
              if (!sev) return null;
              return {
                name: inj.athlete?.shortName || inj.athlete?.displayName || '—',
                position: inj.athlete?.position?.abbreviation || '',
                status,
                severity: sev
              };
            })
            .filter(Boolean)
            .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
          if (list.length) map.set(teamId, list);
        });
      } catch (e) {
        console.warn('No se pudieron cargar lesiones', league, e);
      }
      injuriesCache[league] = { ts: Date.now(), map };
      return map;
    }

    function classifyInjurySeverity(status) {
      const s = (status || '').toLowerCase();
      if (s === 'out' || s === '60-day-il') return 'out';
      if (s === '10-day-il' || s === '15-day-il') return 'il';
      if (s === 'day-to-day') return 'dtd';
      return null;
    }
    function severityRank(sev) {
      return sev === 'out' ? 3 : sev === 'il' ? 2 : sev === 'dtd' ? 1 : 0;
    }
    function injuryStatusShort(status) {
      const map = {
        'Out': 'OUT', 'Day-To-Day': 'DTD',
        '10-Day-IL': '10-IL', '15-Day-IL': '15-IL', '60-Day-IL': '60-IL'
      };
      return map[status] || status;
    }

    // Extrae datos del probable pitcher abridor (solo MLB).
    // ESPN incluye W-L, ERA y WHIP directamente en el scoreboard, en comp.probables[].
    // pitchQuality = ERA*0.6 + WHIP*4.5*0.4 (escala ERA). WHIP<1.20 = bueno, ERA<3.5 = bueno.
    function extractPitcher(comp) {
      const p = comp.probables?.[0];
      if (!p) return null;
      const stats = p.statistics || [];
      const era  = parseFloat(stats.find(s => s.name === 'ERA')?.displayValue);
      const whip = parseFloat(stats.find(s => s.name === 'WHIP' || s.name === 'whip')?.displayValue);
      const w    = parseInt(stats.find(s => s.name === 'wins')?.displayValue);
      const l    = parseInt(stats.find(s => s.name === 'losses')?.displayValue);
      const eraVal  = isFinite(era)  ? era  : null;
      const whipVal = isFinite(whip) ? whip : null;
      // Métrica compuesta: si tenemos WHIP lo combinamos con ERA para mayor precisión.
      // WHIP * 4.5 convierte a escala ERA (un WHIP de 1.30 ≈ ERA de 5.85, etc.).
      const pitchQuality = (eraVal != null && whipVal != null)
        ? eraVal * 0.6 + whipVal * 4.5 * 0.4
        : eraVal;
      return {
        id:           p.athlete?.id || null,
        name:         p.athlete?.shortName || p.athlete?.fullName || 'TBD',
        fullName:     p.athlete?.fullName  || p.athlete?.shortName || '',
        era:          eraVal,
        whip:         whipVal,
        pitchQuality, // métrica compuesta ERA+WHIP (menor = mejor)
        wins:         isFinite(w) ? w : null,
        losses:       isFinite(l) ? l : null,
        record:       p.record || ''
      };
    }

    // Expectativa Pythagorean (Bill James): predice winRate desde puntos anotados/permitidos.
    // Es uno de los mejores indicadores en deportes — captura la "verdadera" calidad del equipo
    // cuando hay suerte en los resultados (ganar muchos juegos por 1 pt, etc).
    // Exponente: 14 para NBA (Daryl Morey), 1.83 para MLB (Bill James original).
    function pythagorean(pf, pa, exp) {
      if (pf == null || pa == null || pf <= 0 || pa <= 0) return null;
      const num = Math.pow(pf, exp);
      return num / (num + Math.pow(pa, exp));
    }

    // ===== SISTEMA ELO =====
    // Ranking dinámico que refleja la potencia acumulada del equipo en la temporada.
    // Se actualiza cada vez que se reconcilia un partido terminado.
    // Base 1500 = equipo de media de liga. K=20 NBA, K=15 MLB (MLB más conservador por temporada larga).
    function loadEloRatings() {
      try { eloRatings = JSON.parse(localStorage.getItem(ELO_STORAGE_KEY) || '{}'); }
      catch { eloRatings = {}; }
    }
    function saveEloRatings() {
      localStorage.setItem(ELO_STORAGE_KEY, JSON.stringify(eloRatings));
    }
    function getElo(teamId, sport) {
      return (eloRatings[sport] || {})[String(teamId)] ?? 1500;
    }
    // Actualiza ELO tras conocer el resultado de un partido
    function updateElo(winnerId, loserId, sport) {
      const wId = String(winnerId), lId = String(loserId);
      if (!eloRatings[sport]) eloRatings[sport] = {};
      const K  = sport === 'nba' ? 20 : 15;
      const rW = getElo(wId, sport);
      const rL = getElo(lId, sport);
      const expW = 1 / (1 + Math.pow(10, (rL - rW) / 400));
      eloRatings[sport][wId] = rW + K * (1 - expW);
      eloRatings[sport][lId] = rL - K * (1 - expW);
      saveEloRatings();
    }
    // Devuelve la probabilidad ELO del equipo local (0–1)
    function getEloSignal(homeTeamId, awayTeamId, sport) {
      const rH = getElo(homeTeamId, sport);
      const rA = getElo(awayTeamId, sport);
      return 1 / (1 + Math.pow(10, (rA - rH) / 400));
    }

    // Descarga las stats completas de un equipo desde /teams/{id} + forma reciente.
    // En paralelo: stats de temporada (records, puntos, Pythagorean) + últimos 10 juegos + descanso.
    async function fetchTeamFullStats(id, sport, comp) {
      const base = sport === 'nba'
        ? 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams'
        : 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams';
      try {
        const [r, recentFormData] = await Promise.all([
          fetchWithTimeout(`${base}/${id}`),
          fetchTeamRecentForm(id, sport)
        ]);
        if (!r.ok) return null;
        const d = await r.json();
        const items = d.team?.record?.items || [];
        const total = parseRecord(items.find(i => i.type === 'total')?.summary);
        const home  = parseRecord(items.find(i => i.type === 'home')?.summary);
        const road  = parseRecord(items.find(i => i.type === 'road')?.summary);
        if (!total) return null;
        const stats = items.find(i => i.type === 'total')?.stats || [];
        const get   = name => stats.find(s => s.name === name)?.value ?? null;
        const pf    = get('avgPointsFor');
        const pa    = get('avgPointsAgainst');
        const exp   = sport === 'nba' ? 14 : 1.83;
        // Si ESPN no devuelve `differential` pero sí pf y pa, lo calculamos.
        const diffStat = get('differential');
        const diff     = diffStat ?? (pf != null && pa != null ? pf - pa : null);
        return {
          total, home, road,
          pf, pa,
          diff,
          streak:     get('streak'),         // positivo = victorias, negativo = derrotas
          pyth:       pythagorean(pf, pa, exp),
          teamName:   comp.team?.shortDisplayName || comp.team?.displayName || '',
          recentForm: recentFormData?.last10  ?? null,  // { wins, losses, rate, games[] }
          restDays:   recentFormData?.restDays ?? null   // 0=B2B, 1=1día, 2+=descansado
        };
      } catch { return null; }
    }

    // Extracción rápida solo del scoreboard (fallback si el fetch /teams/{id} falla).
    function extractTeamRecord(comp, isHome) {
      const recs = comp.records || [];
      const total = parseRecord(recs.find(r => r.type === 'total')?.summary);
      const home  = parseRecord(recs.find(r => r.type === 'home')?.summary);
      const road  = parseRecord(recs.find(r => r.type === 'road')?.summary);
      if (!total) return null;
      return {
        total, home, road,
        pf: null, pa: null, diff: null, streak: null, pyth: null,
        teamName: comp.team?.shortDisplayName || comp.team?.displayName || '',
        recentForm: null, restDays: null
      };
    }

    // Stats extendidos NBA (sólo para el modal de Análisis): FG%, 3P%, FT%,
    // asistencias, rebotes, robos, tapones, pérdidas. ESPN expone esto en
    // /statistics — más detallado que /teams/{id} (que sólo trae records).
    async function fetchNBAExtendedStats(teamId) {
      try {
        const r = await fetchWithTimeout(
          `https://site.web.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/statistics`
        );
        if (!r.ok) return null;
        const d = await r.json();
        const cats = d.results?.stats?.categories || [];
        const flat = {};
        cats.forEach(c => (c.stats || []).forEach(s => { flat[s.name] = s.value ?? parseFloat(s.displayValue); }));
        const num = k => isFinite(flat[k]) ? flat[k] : null;
        return {
          gamesPlayed: num('gamesPlayed'),
          fgPct:    num('fieldGoalPct'),
          threePct: num('threePointFieldGoalPct'),
          ftPct:    num('freeThrowPct'),
          ppg:      num('avgPoints'),
          apg:      num('avgAssists'),
          rpg:      num('avgRebounds'),
          orpg:     num('avgOffensiveRebounds'),
          drpg:     num('avgDefensiveRebounds'),
          spg:      num('avgSteals'),
          bpg:      num('avgBlocks'),
          tov:      num('avgTurnovers'),
          astTo:    num('assistTurnoverRatio'),
          fouls:    num('avgFouls'),
          // Ratings de eficiencia (puntos por 100 posesiones)
          ortg:     num('offensiveRating'),
          drtg:     num('defensiveRating'),
          netRating: num('netRating')
        };
      } catch { return null; }
    }

    // Extrae los líderes del partido del scoreboard (top scorer/reb/ast por equipo).
    // ESPN ya los incluye en comp.competitors[i].leaders sin pedir nada extra.
    function extractTeamLeaders(comp) {
      const ls = comp.leaders || [];
      const pick = name => {
        const cat = ls.find(c => c.name === name);
        const top = cat?.leaders?.[0];
        if (!top) return null;
        return {
          id:    top.athlete?.id || null,
          name:  top.athlete?.shortName || top.athlete?.displayName || '',
          value: top.displayValue || ''
        };
      };
      return {
        points:   pick('points')   || pick('pointsPerGame'),
        rebounds: pick('rebounds') || pick('reboundsPerGame'),
        assists:  pick('assists')  || pick('assistsPerGame')
      };
    }

    // Devuelve hasta n jugadores únicos top del equipo, cubriendo múltiples roles
    // (anotador, reboteador, asistente). Útil para props: distintos jugadores
    // generan distintas oportunidades de mercado.
    function extractTeamTopScorers(comp, n = 3) {
      const ls = comp.leaders || [];
      const priority = ['points', 'pointsPerGame', 'rebounds', 'reboundsPerGame', 'assists', 'assistsPerGame'];
      const out = [];
      const seen = new Set();
      for (const catName of priority) {
        const cat = ls.find(c => c.name === catName);
        if (!cat) continue;
        for (const top of (cat.leaders || [])) {
          const id = top.athlete?.id;
          const name = top.athlete?.shortName || top.athlete?.displayName;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          out.push({ id: String(id), name: name || '' });
          if (out.length >= n) return out;
        }
      }
      return out;
    }

    // Equivalente para MLB: top n bateadores únicos de un equipo. Las categorías
    // de líderes pre-juego que ESPN expone para MLB cubren AVG, HR, RBI, hits, OBP.
    // De-dup por athlete id para no repetir al mismo jugador entre categorías.
    function extractTeamTopBatters(comp, n = 2) {
      const ls = comp.leaders || [];
      const priority = ['hits', 'homeRuns', 'RBIs', 'runsBattedIn', 'battingAverage', 'avg', 'onBasePercentage', 'OPS'];
      const out = [];
      const seen = new Set();
      for (const catName of priority) {
        const cat = ls.find(c => c.name === catName);
        if (!cat) continue;
        for (const top of (cat.leaders || [])) {
          const id = top.athlete?.id;
          const name = top.athlete?.shortName || top.athlete?.displayName;
          // Excluimos pitchers — ya van por su propio camino.
          const pos = top.athlete?.position?.abbreviation || top.athlete?.position?.name;
          if (pos && /^(P|SP|RP|Pitcher)$/i.test(pos)) continue;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          out.push({ id: String(id), name: name || '' });
          if (out.length >= n) return out;
        }
      }
      return out;
    }

    // Calcula el pick combinando MÚLTIPLES señales con pesos (modelo ensemble).
    // Cada señal vota una probabilidad para el equipo de casa; el resultado final
    // es un promedio ponderado. Esto es más robusto que cualquier señal sola.
    // Para MLB también incorpora el pitcher abridor (ERA), que explica ~30-40% del
    // resultado del juego. Para ambas ligas hay un bonus explícito de localía (HCA).
    function calcPrediction({
      homeRec, awayRec, homeOdds, awayOdds,
      total: totalLine, spreadHome,
      sport, homePitcher, awayPitcher,
      homeInjuries = [], awayInjuries = [],
      h2h = null,
      homeTeamId = null, awayTeamId = null,
      homeLineMoveSignal = null  // odds de apertura vs actuales para movimiento de línea
    }) {
      if (!homeRec || !awayRec) {
        return { confidence: 'none', pick: null, signals: [],
          reason: 'Datos insuficientes — no se encontraron records de temporada.' };
      }

      // === SEÑAL 1: Record total ajustado por localía (35% del peso) ===
      // El record total es el ancla, ajustado por cómo el equipo se desempeña en casa/ruta
      const adjRate = (rec, isHome) => {
        const loc = isHome ? rec.home : rec.road;
        return loc ? rec.total.rate * 0.6 + loc.rate * 0.4 : rec.total.rate;
      };
      const recH = adjRate(homeRec, true);
      const recA = adjRate(awayRec, false);
      const [recPH] = normalizeProbs(recH, recA);

      // === SEÑAL 2: Pythagorean (50% del peso si está disponible) ===
      // Predice winRate desde puntos anotados/permitidos — captura calidad real del equipo
      let pythPH = null;
      if (homeRec.pyth != null && awayRec.pyth != null) {
        [pythPH] = normalizeProbs(homeRec.pyth, awayRec.pyth);
      }

      // === SEÑAL 3: Racha actual (15% del peso) ===
      // Una racha positiva grande sugiere mejor forma; negativa lo contrario.
      // Cap a ±10 pts de probabilidad para no sobreajustar.
      const sH = homeRec.streak ?? 0;
      const sA = awayRec.streak ?? 0;
      const streakDiff   = (sH - sA) * 0.012;
      const streakPH     = 0.5 + Math.max(-0.10, Math.min(0.10, streakDiff));

      // === SEÑAL 4: Home Court / Field Advantage (HCA) explícito ===
      // En NBA, jugar en casa equivale a ~3 puntos (≈57% baseline win prob).
      // En MLB el efecto es mucho menor (≈54%). Lo añadimos como señal separada
      // porque la ventaja de localía existe incluso entre equipos parejos.
      const hcaPH = sport === 'nba' ? 0.57 : 0.54;

      // === SEÑAL 5: Pitcher abridor (solo MLB) ===
      // Usamos pitchQuality (ERA+WHIP compuesto) si está disponible, o ERA solo como fallback.
      // Menor pitchQuality = mejor pitcher. Diferencia capped a ±20% de prob.
      let pitchPH = null;
      if (sport === 'mlb') {
        const hQ = homePitcher?.pitchQuality ?? homePitcher?.era;
        const aQ = awayPitcher?.pitchQuality ?? awayPitcher?.era;
        if (hQ != null && aQ != null) {
          // Diferencia positiva = home tiene mejor calidad (menor índice = mejor)
          const pitchDiff = aQ - hQ;
          pitchPH = 0.5 + Math.max(-0.20, Math.min(0.20, pitchDiff * 0.05));
        }
      }

      // === SEÑAL 6: Impacto de lesiones ===
      // No sabemos si el lesionado es titular, así que asignamos un peso conservador:
      //   Out / 60-IL = -3% prob por jugador
      //   10/15-IL    = -2% prob por jugador
      //   Day-To-Day  = -0.5% prob por jugador
      // Máximo -10% por equipo (un equipo lesionado no se vuelve un fantasma).
      // injDiff: diferencia entre el daño del local y el del visitante. Si home está
      // más lesionado, injDiff es negativo y baja su probabilidad.
      const injuryImpact = (list) => {
        if (!list || !list.length) return 0;
        let impact = 0;
        for (const inj of list) {
          if      (inj.severity === 'out') impact -= 0.03;
          else if (inj.severity === 'il')  impact -= 0.02;
          else if (inj.severity === 'dtd') impact -= 0.005;
        }
        return Math.max(-0.10, impact);
      };
      const homeInjImpact = injuryImpact(homeInjuries);
      const awayInjImpact = injuryImpact(awayInjuries);
      const injDiff = homeInjImpact - awayInjImpact;  // negativo = home más golpeado
      let injPH = null;
      if (homeInjuries.length || awayInjuries.length) {
        injPH = 0.5 + Math.max(-0.10, Math.min(0.10, injDiff));
      }

      // === SEÑAL 7: Head-to-Head (historial directo esta temporada) ===
      // Tasa de victoria del local vs el visitante en duelos previos.
      // Capped a ±15% para no sobreponderar muestras pequeñas (2-6 partidos).
      // Solo entra si hay al menos 2 encuentros completados entre ellos.
      let h2hPH = null;
      if (h2h && h2h.total >= 2) {
        const rate = h2h.homeWins / h2h.total;
        h2hPH = 0.5 + Math.max(-0.15, Math.min(0.15, rate - 0.5));
      }

      // === SEÑAL 8: Forma reciente (últimos 10 juegos) ===
      // Más predictivo que el record de temporada a corto plazo.
      // Un equipo 8-2 en sus últimos 10 tiene más momentum real que uno 45-20 en decline.
      // Requiere al menos 5 juegos completados para ser confiable.
      let recentFormPH = null;
      if (homeRec.recentForm != null && awayRec.recentForm != null) {
        const [rfH] = normalizeProbs(
          homeRec.recentForm.rate || 0.5,
          awayRec.recentForm.rate || 0.5
        );
        recentFormPH = rfH;
      }

      // === SEÑAL 9: Días de descanso / Back-to-back ===
      // En NBA, jugar sin descanso (B2B) reduce el rendimiento ~3-5% en win prob.
      // El diferencial importa: 0 días vs 2+ días es una ventaja real.
      // En MLB el efecto es menor (los pitchers rotan, los posicionistas aguantan más).
      let restPH = null;
      if (homeRec.restDays != null && awayRec.restDays != null) {
        const effectPerDay = sport === 'nba' ? 0.022 : 0.010;
        const restDiff     = homeRec.restDays - awayRec.restDays;
        const homeBtb      = homeRec.restDays === 0 ? -0.05 : 0;  // local en B2B
        const awayBtb      = awayRec.restDays === 0 ?  0.05 : 0;  // rival en B2B
        const rawEffect    = restDiff * effectPerDay + homeBtb + awayBtb;
        restPH = 0.5 + Math.max(-0.10, Math.min(0.10, rawEffect));
      }

      // === SEÑAL 10: ELO (Power Rating dinámico) ===
      // Acumula resultados reales de la temporada con el método ELO estándar.
      // Base 1500 = equipo promedio. Se actualiza al reconciliar cada partido.
      // Si no hay historial ELO previo ambos equipos tienen 1500 → señal neutra.
      let eloPH = null;
      if (homeTeamId && awayTeamId) {
        const raw = getEloSignal(homeTeamId, awayTeamId, sport);
        // Solo usamos ELO como señal si hay suficiente divergencia (no ambos 1500)
        const hElo = getElo(homeTeamId, sport);
        const aElo = getElo(awayTeamId, sport);
        if (Math.abs(hElo - aElo) >= 20) eloPH = raw;
      }

      // === SEÑAL 11: Diferencial de puntos/carreras (Point Differential) ===
      // El margen de victoria promedio es uno de los mejores predictores reales.
      // Equipos que ganan por mucho tienden a ser mejores que su record indica.
      // Normalizado: diff +8 pts → +9.6% prob; diff -8 pts → -9.6% prob. Cap ±18%.
      let diffPH = null;
      if (homeRec.diff != null && awayRec.diff != null) {
        const diffGap = homeRec.diff - awayRec.diff;
        diffPH = 0.5 + Math.max(-0.18, Math.min(0.18, diffGap * 0.012));
      }

      // === SEÑAL 12: Movimiento de línea (Market Signal) ===
      // Si las odds de apertura se movieron significativamente, indica dinero inteligente.
      // Moneyline moviéndose ≥15 cents en una dirección = señal de mercado.
      let lineMoveP = null;
      if (homeLineMoveSignal != null) {
        // homeLineMoveSignal > 0 = línea se movió a favor del local
        // homeLineMoveSignal < 0 = línea se movió contra el local
        const capped = Math.max(-0.08, Math.min(0.08, homeLineMoveSignal));
        if (Math.abs(homeLineMoveSignal) >= 0.02) lineMoveP = 0.5 + capped;
      }

      // === SEÑAL 13: Eficiencia defensiva NBA (puntos permitidos / juego) ===
      // Equipos que permiten menos puntos tienen ventaja real defensiva.
      // Solo NBA — en MLB el diferencial ya captura la defensa via carreras.
      // awayRec.pa > homeRec.pa → local permite menos → drtgPH > 0.5
      // Diferencia de 3 pts/juego ≈ +12% para el equipo con mejor defensa.
      let drtgPH = null;
      if (sport === 'nba' && homeRec.pa != null && awayRec.pa != null) {
        const drtgGap = awayRec.pa - homeRec.pa; // positivo = local tiene mejor defensa
        drtgPH = 0.5 + Math.max(-0.12, Math.min(0.12, drtgGap * 0.04));
      }

      // === ENSEMBLE: combinar señales con pesos según deporte ===
      // Pesos revisados: ELO y Diferencial añadidos; Pythagorean reducido ligeramente.
      // MLB pondera más al pitcher; NBA pondera más ELO/Forma reciente.
      const wRec        = sport === 'mlb' ? 0.14 : 0.17;
      const wPyth       = pythPH  != null ? (sport === 'mlb' ? 0.18 : 0.22) : 0;
      const wStreak     = (homeRec.streak != null && awayRec.streak != null) ? 0.06 : 0;
      const wHCA        = 0.10;
      const wPitch      = pitchPH != null ? 0.26 : 0;
      const wInj        = injPH   != null ? 0.07 : 0;
      const wH2H        = h2hPH   != null ? 0.07 : 0;
      const wRecentForm = recentFormPH != null ? (sport === 'mlb' ? 0.13 : 0.18) : 0;
      const wRest       = restPH  != null ? 0.06 : 0;
      const wElo        = eloPH   != null ? (sport === 'mlb' ? 0.08 : 0.10) : 0;
      const wDiff       = diffPH  != null ? (sport === 'mlb' ? 0.08 : 0.10) : 0;
      const wLineMove   = lineMoveP != null ? 0.05 : 0;
      const wDrtg       = drtgPH  != null ? 0.07 : 0;
      const wTotal  = wRec + wPyth + wStreak + wHCA + wPitch + wInj + wH2H +
                      wRecentForm + wRest + wElo + wDiff + wLineMove + wDrtg;
      const homeEstPRaw = (
        recPH               * wRec +
        (pythPH       ?? 0) * wPyth +
        streakPH            * wStreak +
        hcaPH               * wHCA +
        (pitchPH      ?? 0) * wPitch +
        (injPH        ?? 0) * wInj +
        (h2hPH        ?? 0) * wH2H +
        (recentFormPH ?? 0) * wRecentForm +
        (restPH       ?? 0) * wRest +
        (eloPH        ?? 0) * wElo +
        (diffPH       ?? 0) * wDiff +
        (lineMoveP    ?? 0) * wLineMove +
        (drtgPH       ?? 0) * wDrtg
      ) / wTotal;
      const [homeEstP, awayEstP] = normalizeProbs(homeEstPRaw, 1 - homeEstPRaw);

      // === Probabilidad implícita de las cuotas ===
      let homeImpP = null, awayImpP = null;
      const hasOdds = homeOdds != null && awayOdds != null;
      if (hasOdds) {
        const rawH = americanToProb(homeOdds), rawA = americanToProb(awayOdds);
        if (rawH && rawA) [homeImpP, awayImpP] = normalizeProbs(rawH, rawA);
      }

      // === PICK & EDGE ===
      const favTeam = homeEstP >= awayEstP ? 'home' : 'away';
      const favEstP = favTeam === 'home' ? homeEstP : awayEstP;
      const favImpP = favTeam === 'home' ? homeImpP : awayImpP;
      const favRec  = favTeam === 'home' ? homeRec  : awayRec;
      const edge    = (hasOdds && favImpP != null) ? favEstP - favImpP : null;

      // === SEÑALES INDIVIDUALES PARA MOSTRAR EN UI ===
      const signals = [];
      signals.push({ name: 'Record (loc)', homeP: recPH, weight: wRec });
      if (pythPH    != null) signals.push({ name: 'Pythagorean',        homeP: pythPH,    weight: wPyth });
      if (diffPH    != null) signals.push({ name: 'Diferencial pts',    homeP: diffPH,    weight: wDiff });
      if (eloPH     != null) signals.push({ name: 'ELO (power)',        homeP: eloPH,     weight: wElo });
      if (wStreak   >  0)    signals.push({ name: 'Racha',              homeP: streakPH,  weight: wStreak });
      if (recentFormPH != null) signals.push({ name: 'Forma reciente ×10', homeP: recentFormPH, weight: wRecentForm });
      if (pitchPH   != null) {
        const pitchLabel = (homePitcher?.whip != null || awayPitcher?.whip != null)
          ? 'Pitcher (ERA+WHIP)' : 'Pitcher (ERA)';
        signals.push({ name: pitchLabel, homeP: pitchPH, weight: wPitch });
      }
      if (injPH     != null) signals.push({ name: 'Lesiones',          homeP: injPH,     weight: wInj });
      if (h2hPH     != null) signals.push({ name: 'H2H (directo)',      homeP: h2hPH,     weight: wH2H });
      if (restPH    != null) signals.push({ name: 'Descanso / B2B',    homeP: restPH,     weight: wRest });
      if (lineMoveP != null) signals.push({ name: 'Movimiento línea',  homeP: lineMoveP,  weight: wLineMove });
      if (drtgPH   != null) signals.push({ name: 'Defensa (pts/jgo)', homeP: drtgPH,     weight: wDrtg });
      signals.push({ name: 'Localía (HCA)', homeP: hcaPH, weight: wHCA });

      // === CONFIANZA: peso de las señales que coinciden con el pick ===
      // Excluimos HCA del cómputo porque es constante (siempre favorece al local
      // independientemente del partido) y siempre vota a favor cuando el pick es local.
      // Usamos peso ponderado en lugar de contar señales — Pythagorean (~32%)
      // coincidiendo pesa mucho más que B2B (~7%).
      const dataSignals = signals.filter(s => s.name !== 'Localía (HCA)');
      const totalDataWeight = dataSignals.reduce((sum, s) => sum + s.weight, 0);
      const agreementWeight = dataSignals
        .filter(s => (favTeam === 'home' && s.homeP > 0.5) || (favTeam === 'away' && s.homeP < 0.5))
        .reduce((sum, s) => sum + s.weight, 0);
      const agreementRatio = totalDataWeight > 0 ? agreementWeight / totalDataWeight : 0;

      // El favorito debe tener un record fuerte (>= 58%). El bug previo aceptaba
      // <= 42% también, lo que es absurdo: un favorito no puede tener record débil.
      const winRateStrong = favRec.total.rate >= 0.58;
      const pythStrong    = favRec.pyth != null && favRec.pyth >= 0.58;
      const edgeBig       = edge != null && edge >= 0.07;
      const edgeMedium    = edge != null && edge >= 0.03;
      // Edge muy negativo: la casa nos contradice fuerte. Aún podemos acertar el side,
      // pero el bet es -EV. Bajamos confianza para que el usuario lo perciba como riesgoso.
      const edgeStronglyNeg = edge != null && edge <= -0.05;

      // Contamos cuántas señales reales (no HCA) aportaron datos
      const realSignalCount = dataSignals.length;

      let confidence;
      if (edgeStronglyNeg) {
        // Casa fuertemente en contra → riesgo alto
        confidence = 'low';
      } else if (
        realSignalCount >= 5 &&
        agreementRatio >= 0.88 &&
        edgeBig &&
        pythStrong &&
        winRateStrong
      ) {
        // ALTA: necesita convergencia muy fuerte de múltiples señales + edge real
        confidence = 'high';
      } else if (
        realSignalCount >= 4 &&
        agreementRatio >= 0.72 &&
        (edgeBig || (edgeMedium && pythStrong && winRateStrong))
      ) {
        confidence = 'medium';
      } else if (
        realSignalCount >= 3 &&
        agreementRatio >= 0.65 &&
        edgeMedium
      ) {
        confidence = 'medium';
      } else {
        confidence = 'low';
      }

      // === TEXTO DE JUSTIFICACIÓN ===
      const reasons = [];
      const { wins, losses, rate } = favRec.total;
      if (rate >= 0.65)      reasons.push(`record sólido (${wins}-${losses})`);
      else if (rate >= 0.55) reasons.push(`mejor record (${wins}-${losses})`);
      else                   reasons.push(`record ligeramente mejor (${wins}-${losses})`);

      if (favRec.diff != null && favRec.diff >= 3)
        reasons.push(`diferencial +${favRec.diff.toFixed(1)} pts/juego`);
      else if (favRec.pyth != null && favRec.pyth >= 0.60)
        reasons.push(`Pythagorean ${Math.round(favRec.pyth * 100)}% (calidad sostenida)`);

      if (favRec.streak != null && favRec.streak >= 3)
        reasons.push(`racha de ${favRec.streak} victorias`);
      else if (favRec.streak != null && favRec.streak <= -3 && favTeam !== 'home')
        reasons.push(`oponente en racha de ${-favRec.streak} derrotas`);

      // Razón por pitcher en MLB (importante en este deporte)
      if (sport === 'mlb' && pitchPH != null) {
        const favPitcher = favTeam === 'home' ? homePitcher : awayPitcher;
        const oppPitcher = favTeam === 'home' ? awayPitcher : homePitcher;
        if (favPitcher?.era != null && oppPitcher?.era != null) {
          if (favPitcher.era < oppPitcher.era - 1.5)
            reasons.push(`mejor pitcher abridor (${favPitcher.name} ERA ${favPitcher.era} vs ${oppPitcher.era})`);
          else if (favPitcher.era < 3.0)
            reasons.push(`abridor sólido ${favPitcher.name} (ERA ${favPitcher.era})`);
        }
      }

      if (edge != null && edge >= 0.05)
        reasons.push(`edge +${Math.round(edge * 100)}% vs cuotas`);

      // Razón por lesiones: si el oponente del favorito está más golpeado,
      // o si el favorito tiene poca afectación, lo mencionamos.
      if (injPH != null) {
        const favInj = favTeam === 'home' ? homeInjuries : awayInjuries;
        const oppInj = favTeam === 'home' ? awayInjuries : homeInjuries;
        const oppOut = oppInj.filter(i => i.severity === 'out' || i.severity === 'il').length;
        const favOut = favInj.filter(i => i.severity === 'out' || i.severity === 'il').length;
        if (oppOut >= 2 && oppOut > favOut)
          reasons.push(`oponente con ${oppOut} bajas importantes`);
      }

      const rawReason = reasons.slice(0, 2).join(', ') + '.';

      // === PREDICCIÓN DE TOTAL (Over/Under) ===
      let totalPred = null, totalPick = null, totalEdge = null;
      if (homeRec.pf != null && awayRec.pf != null && homeRec.pa != null && awayRec.pa != null) {
        // Total base: promedio de la suma de ofensiva y defensiva de ambos equipos.
        // Si home anota 117 y permite 110, away anota 105 y permite 112 → esperado ≈ 111
        totalPred = (homeRec.pf + homeRec.pa + awayRec.pf + awayRec.pa) / 2;

        // === AJUSTE DE RITMO (pace) para NBA ===
        // Si un equipo juega muy rápido (PPG alto) y el otro muy lento (PPG bajo),
        // el total tiende a acercarse al ritmo del equipo más lento.
        // Proxy de pace: promedio de puntos anotados + permitidos por equipo.
        if (sport === 'nba') {
          const homePace = (homeRec.pf + homeRec.pa) / 2;
          const awayPace = (awayRec.pf + awayRec.pa) / 2;
          const paceRatio = Math.min(homePace, awayPace) / Math.max(homePace, awayPace);
          // Si diferencia de ritmo > 10% entre equipos, ajustamos el total
          if (paceRatio < 0.92) {
            // El juego tenderá a parecerse más al equipo lento (60%) que al rápido (40%)
            const slowPace  = Math.min(homePace, awayPace);
            const fastPace  = Math.max(homePace, awayPace);
            const adjustedAvg = slowPace * 0.60 + fastPace * 0.40;
            totalPred = adjustedAvg * 2;  // × 2 porque es suma de ambos equipos
          }
        }

        // En MLB, ajustamos el total con el ERA combinado de los abridores.
        // Pitcher cubre ~6 de 9 innings (~67%). Si los dos pitchers promedian ERA 3.0
        // vs media de liga ~4.20, el total esperado baja ~1.6 carreras.
        if (sport === 'mlb' && homePitcher?.era != null && awayPitcher?.era != null) {
          const avgERA       = (homePitcher.era + awayPitcher.era) / 2;
          // Pitchers contribuyen ~67% de innings; bullpen y ofensiva el resto.
          const pitcherTotal = avgERA * 2 * (6 / 9);  // 2 equipos, 6 innings cada uno
          const bullpenTotal = totalPred * (3 / 9);   // 3 innings de bullpen total
          totalPred = pitcherTotal + bullpenTotal;
        }

        if (totalLine != null) {
          totalEdge = totalPred - totalLine;
          // En MLB el threshold es menor (carreras enteras), en NBA más holgado
          const threshold = sport === 'mlb' ? 0.5 : 1.5;
          if (Math.abs(totalEdge) >= threshold) totalPick = totalEdge > 0 ? 'OVER' : 'UNDER';
        }
      }

      // === PREDICCIÓN DE SPREAD ===
      // SRS (Simple Rating System): margen esperado entre A y B en cancha neutra
      // ≈ ratingA − ratingB, donde "rating" ≈ point differential por juego.
      // Sumamos el HCA explícito (~3 pts NBA, ~0.3 carreras MLB) porque el local juega en casa.
      let spreadPred = null, spreadPick = null;
      if (homeRec.diff != null && awayRec.diff != null) {
        const hcaPts = sport === 'nba' ? 3.0 : 0.3;
        spreadPred = homeRec.diff - awayRec.diff + hcaPts;
        if (spreadHome != null) {
          // spreadHome es negativo cuando el local es favorito (-3.5 = local favorito por 3.5)
          // Lo "vence" si gana por más que ese margen
          const requiredMargin = -spreadHome;  // margen que necesita el local
          const spreadDiff = spreadPred - requiredMargin;
          // Threshold por liga: NBA usa 2 pts, MLB 0.5 carreras (mucho más estrecho)
          const spreadThreshold = sport === 'nba' ? 2 : 0.5;
          if (Math.abs(spreadDiff) >= spreadThreshold)
            spreadPick = spreadDiff > 0 ? 'home' : 'away';
        }
      }

      return {
        confidence, pick: favTeam,
        pickName: favRec.teamName,
        reason: rawReason.charAt(0).toUpperCase() + rawReason.slice(1),
        homeEstP, awayEstP, homeImpP, awayImpP, edge, edgeTeam: favTeam,
        signals,                  // array de {name, homeP, weight} para mostrar en UI
        totalPred, totalPick, totalEdge, totalLine,
        spreadPred, spreadPick, spreadHome
      };
    }

    // ===== PLAYER PROPS — carga lazy en cada card =====
    // Caché en memoria para no re-fetchear el mismo gamelog si el usuario abre y cierra.
    const propsCache = new Map();  // key: `${sport}-${id}` → array de props

    // Calcula props sugeridas a partir de un gamelog NBA.
    // Para PTS / REB / AST: línea = floor(promedio últimos 10) - 0.5
    // Solo devolvemos props con hit rate ≥ 60% (Over) o ≤ 40% (Under).
    function computeNBAProps(games) {
      if (!games || games.length < 5) return [];
      const last10 = games.slice(0, 10);
      const stats = [
        { key: 'PTS', label: 'PTS', name: 'puntos' },
        { key: 'REB', label: 'REB', name: 'rebotes' },
        { key: 'AST', label: 'AST', name: 'asistencias' }
      ];
      const props = [];
      for (const s of stats) {
        const values = last10.map(g => g[s.key]).filter(v => typeof v === 'number');
        if (values.length < 5) continue;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const line = Math.max(0.5, Math.floor(avg) - 0.5);
        const overHits = values.filter(v => v > line).length;
        const overRate = overHits / values.length;
        const isOver = overRate >= 0.5;
        const winRate = isOver ? overRate : (1 - overRate);
        if (winRate < 0.6) continue;
        props.push({
          stat: s.label,
          unit: s.name,
          line,
          direction: isOver ? 'OVER' : 'UNDER',
          hits: isOver ? overHits : (values.length - overHits),
          total: values.length,
          hitRate: winRate,
          avg
        });
      }
      return props;
    }

    // Fetch gamelog NBA: devuelve { games, position }. El gamelog endpoint NO
    // incluye metadata del athlete, así que la posición la sacamos en paralelo
    // del endpoint de perfil. Posiciones ESPN simplificadas: G/F/C.
    async function fetchNBAGamelog(athleteId) {
      const key = `nba-${athleteId}`;
      if (propsCache.has(key)) return propsCache.get(key);
      try {
        const [logRes, profileRes] = await Promise.all([
          fetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${athleteId}/gamelog`),
          fetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${athleteId}`)
        ]);
        if (!logRes.ok) throw new Error(`HTTP ${logRes.status}`);
        const log = await logRes.json();
        const events = log?.events || {};
        const games = [];
        (log?.seasonTypes || []).forEach(st => {
          (st.categories || []).forEach(cat => {
            if (cat.type === 'event' && Array.isArray(cat.events)) {
              cat.events.forEach(e => {
                const stats = parseGameStats(e.stats);
                const info = events[e.eventId];
                if (stats && info) games.push({ ...stats, gameDate: info.gameDate });
              });
            }
          });
        });
        games.sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));
        let position = null;
        if (profileRes.ok) {
          const prof = await profileRes.json();
          position = prof?.athlete?.position?.abbreviation || null;
        }
        const result = { games, position };
        propsCache.set(key, result);
        return result;
      } catch (e) {
        console.warn('Error fetch NBA gamelog', athleteId, e);
        return { games: [], position: null };
      }
    }

    // ===== DEFENSA POR POSICIÓN (NBA) =====
    // Idea: para una prop de jugador, queremos saber si el rival es débil
    // defendiendo a su posición. ESPN no expone esto directamente, así que lo
    // derivamos de los últimos N box scores del rival: agrupamos minutos/puntos/
    // rebotes/asistencias permitidos por posición del oponente y promediamos.
    //
    // Posiciones ESPN simplificadas: G (guard), F (forward), C (center). No
    // diferencia PG/SG ni SF/PF — más samples por bucket = menos ruido.

    // Caché separado de boxscores: la misma respuesta sirve para los dos equipos.
    const boxscoreCache = new Map();   // eventId → boxscore.players (array de teams)
    const teamDefenseCache = new Map(); // teamId → { G:{pts,reb,ast,n}, F:{...}, C:{...}, samples }

    // Devuelve los IDs de los últimos N juegos completados de un equipo.
    async function fetchTeamRecentEventIds(teamId, n = 5) {
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/schedule`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const completed = (j.events || [])
          .filter(e => e.competitions?.[0]?.status?.type?.completed)
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .slice(0, n);
        return completed.map(e => e.id);
      } catch (e) {
        console.warn('Error fetch team schedule', teamId, e);
        return [];
      }
    }

    // Devuelve el boxscore (boxscore.players[]) de un evento. Cacheado.
    async function fetchGameBoxscore(eventId) {
      if (boxscoreCache.has(eventId)) return boxscoreCache.get(eventId);
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const teams = j.boxscore?.players || [];
        boxscoreCache.set(eventId, teams);
        return teams;
      } catch (e) {
        console.warn('Error fetch boxscore', eventId, e);
        return [];
      }
    }

    // Calcula la defensa por posición de un equipo: para cada uno de sus últimos
    // N juegos, suma las stats de los jugadores del OTRO equipo agrupados por
    // posición (G/F/C). Promedia por juego para obtener "permitidos a [pos]".
    async function computeOppDefenseByPosition(teamId, n = 5) {
      if (teamDefenseCache.has(teamId)) return teamDefenseCache.get(teamId);
      const eventIds = await fetchTeamRecentEventIds(teamId, n);
      if (!eventIds.length) {
        const empty = { G:null, F:null, C:null, samples: 0 };
        teamDefenseCache.set(teamId, empty);
        return empty;
      }
      const boxscores = await Promise.all(eventIds.map(fetchGameBoxscore));

      // Por cada juego, encontramos el TOP rival de cada posición (el que más
      // anotó). Promediamos esos máximos a través de los juegos. Esto representa
      // mejor lo que enfrenta un jugador-prop específico: la prop suele ser de
      // un titular, así que comparamos contra "el mejor anotador de su posición
      // en juegos recientes contra este rival".
      const buckets = { G: [], F: [], C: [] };
      let games = 0;

      for (const teams of boxscores) {
        if (!teams || teams.length < 2) continue;
        const opp = teams.find(t => String(t.team?.id) !== String(teamId));
        if (!opp) continue;
        const stats = opp.statistics?.[0];
        if (!stats || !Array.isArray(stats.athletes)) continue;
        const labels = stats.labels || [];
        const idx = lab => labels.indexOf(lab);
        const iPts = idx('PTS'), iReb = idx('REB'), iAst = idx('AST'), iMin = idx('MIN');
        if (iPts < 0) continue;
        games++;
        const topByPos = { G: null, F: null, C: null };
        for (const a of stats.athletes) {
          const pos = a.athlete?.position?.abbreviation;
          const bucket = pos === 'C' ? 'C' : pos === 'F' ? 'F' : pos === 'G' ? 'G' : null;
          if (!bucket) continue;
          const s = a.stats || [];
          const min = +s[iMin] || 0;
          if (min < 12) continue;  // descarta DNPs y jugadores marginales
          const pts = +s[iPts] || 0, reb = +s[iReb] || 0, ast = +s[iAst] || 0;
          if (!topByPos[bucket] || pts > topByPos[bucket].pts) {
            topByPos[bucket] = { pts, reb, ast };
          }
        }
        for (const k of ['G', 'F', 'C']) {
          if (topByPos[k]) buckets[k].push(topByPos[k]);
        }
      }

      const avg = arr => arr.length ? {
        pts: arr.reduce((s,x)=>s+x.pts,0) / arr.length,
        reb: arr.reduce((s,x)=>s+x.reb,0) / arr.length,
        ast: arr.reduce((s,x)=>s+x.ast,0) / arr.length,
        gamesUsed: arr.length
      } : null;

      const out = { samples: games, G: avg(buckets.G), F: avg(buckets.F), C: avg(buckets.C) };
      teamDefenseCache.set(teamId, out);
      return out;
    }

    // Fetch unificado de gamelog MLB desde ESPN (sirve tanto bateadores como
    // pitchers). Devuelve array de objetos con stats indexados por label
    // ("K", "H", "HR", "RBI", "ER", etc.) más gameDate.
    //
    // Importante: usamos el endpoint de ESPN porque las IDs de athletes MLB
    // que aparecen en `comp.leaders`/`comp.probables` son IDs internas de ESPN,
    // NO IDs de MLB Stats API. Llamar a statsapi.mlb.com con esas IDs devuelve
    // splits vacíos. ESPN cubre las dos disciplinas con el mismo endpoint.
    async function fetchMLBESPNGamelog(athleteId) {
      const key = `mlb-espn-${athleteId}`;
      if (propsCache.has(key)) return propsCache.get(key);
      try {
        const r = await fetch(`https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${athleteId}/gamelog`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        const labels = j.labels || [];
        const events = j.events || {};
        const games = [];
        (j.seasonTypes || []).forEach(st => {
          (st.categories || []).forEach(cat => {
            if (cat.type !== 'event' || !Array.isArray(cat.events)) return;
            cat.events.forEach(e => {
              const stats = e.stats;
              if (!Array.isArray(stats) || stats.length !== labels.length) return;
              const obj = {};
              labels.forEach((lab, i) => { obj[lab] = stats[i]; });
              const info = events[e.eventId];
              obj.gameDate = info?.gameDate || null;
              games.push(obj);
            });
          });
        });
        games.sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate));
        propsCache.set(key, games);
        return games;
      } catch (e) {
        console.warn('Error fetch MLB ESPN gamelog', athleteId, e);
        return [];
      }
    }

    // Wrappers para mantener nombres descriptivos en el call site.
    const fetchMLBPitcherGamelog = fetchMLBESPNGamelog;
    const fetchMLBBatterGamelog  = fetchMLBESPNGamelog;

    // Pitcher MLB: tendencias de K's y carreras limpias (ER) sobre la línea.
    // Labels esperados: K (ponches), ER (carreras limpias).
    function computeMLBPitcherProps(logs) {
      if (!logs || logs.length < 4) return [];
      const last10 = logs.slice(0, 10);
      const targets = [
        { key: 'K',  label: 'K',  name: 'ponches' },
        { key: 'ER', label: 'ER', name: 'carreras limpias' }
      ];
      const props = [];
      for (const t of targets) {
        const values = last10.map(g => +(g[t.key] ?? 0)).filter(v => !isNaN(v));
        if (values.length < 4) continue;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const line = Math.max(0.5, Math.round(avg) - 0.5);
        const overHits = values.filter(v => v > line).length;
        const overRate = overHits / values.length;
        const isOver = overRate >= 0.5;
        const winRate = isOver ? overRate : (1 - overRate);
        if (winRate < 0.6) continue;
        props.push({
          stat: t.label, unit: t.name, line,
          direction: isOver ? 'OVER' : 'UNDER',
          hits: isOver ? overHits : (values.length - overHits),
          total: values.length, hitRate: winRate, avg
        });
      }
      return props;
    }

    // Bateador MLB: hits, total bases, HR, RBI, K. Línea = floor(promedio)-0.5
    // (mín 0.5). Reportamos la dirección con tasa ≥60%, mismo criterio que NBA.
    // Total bases se calcula: H + 2B + 2·(3B) + 3·HR (H ya incluye dobles/HR).
    function computeMLBBatterProps(logs) {
      if (!logs || logs.length < 5) return [];
      const last10 = logs.slice(0, 10);
      const tb = g => (+g.H || 0) + (+g['2B'] || 0) + 2 * (+g['3B'] || 0) + 3 * (+g.HR || 0);
      const targets = [
        { label: 'H',   name: 'hits',          getter: g => +g.H   || 0 },
        { label: 'TB',  name: 'bases totales', getter: tb },
        { label: 'HR',  name: 'HR',            getter: g => +g.HR  || 0 },
        { label: 'RBI', name: 'RBI',           getter: g => +g.RBI || 0 },
        { label: 'K',   name: 'ponches',       getter: g => +g.SO  || 0 }
      ];
      const props = [];
      for (const t of targets) {
        const values = last10.map(t.getter);
        if (values.length < 5) continue;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const line = Math.max(0.5, Math.floor(avg) - 0.5);
        const overHits = values.filter(v => v > line).length;
        const overRate = overHits / values.length;
        const isOver = overRate >= 0.5;
        const winRate = isOver ? overRate : (1 - overRate);
        if (winRate < 0.6) continue;
        props.push({
          stat: t.label, unit: t.name, line,
          direction: isOver ? 'OVER' : 'UNDER',
          hits: isOver ? overHits : (values.length - overHits),
          total: values.length, hitRate: winRate, avg
        });
      }
      return props;
    }

    // Construye el bloque de contexto defensivo de un jugador. NBA only por
    // ahora: muestra cuánto le permite el rival a su posición en últimos 5
    // juegos. El veredicto (ALTA/NORMAL/BAJA) compara contra umbrales
    // empíricos de NBA actual: pos G/F ~25 ppg, pos C ~20 ppg.
    function buildDefenseContext(position, oppDef, oppName) {
      if (!position || !oppDef || !oppDef.samples) return null;
      const bucket = position === 'C' ? 'C' : (position === 'G' || position === 'PG' || position === 'SG') ? 'G' : 'F';
      const stats = oppDef[bucket];
      if (!stats) return null;
      // Umbrales aproximados para el TOP anotador rival de esa posición por juego
      // (no agregado de toda la posición). Por encima del high = defensa débil.
      const benchmark = bucket === 'C' ? { low: 14, high: 21 } : { low: 18, high: 26 };
      const verdict = stats.pts >= benchmark.high ? 'weak'
                    : stats.pts <= benchmark.low ? 'strong'
                    : 'normal';
      return { position: bucket, oppName, stats, samples: oppDef.samples, verdict };
    }

    // Renderiza un grupo de props para un jugador (HTML interno del panel).
    // ctx (opcional): objeto de buildDefenseContext con la defensa rival a la
    // posición. Si está presente, se muestra como sub-bloque encima de las props.
    function renderPlayerPropsBlock(playerName, teamAbbr, props, ctx = null) {
      const ctxBlock = ctx ? `
        <div class="props-def-ctx props-def-${ctx.verdict}">
          <span class="props-def-label">vs def. de ${escapeHtml(ctx.oppName)} a ${ctx.position}</span>
          <span class="props-def-vals">${ctx.stats.pts.toFixed(1)} pts · ${ctx.stats.reb.toFixed(1)} reb · ${ctx.stats.ast.toFixed(1)} ast</span>
          <span class="props-def-tag">${ctx.verdict === 'weak' ? 'defensa débil' : ctx.verdict === 'strong' ? 'defensa fuerte' : 'defensa media'}<span class="props-def-n"> · últimos ${ctx.samples}</span></span>
        </div>` : '';

      if (!props.length) {
        return `<div class="props-player-block">
          <div class="props-player-name">${escapeHtml(playerName)} <span class="props-player-team">${escapeHtml(teamAbbr)}</span></div>
          ${ctxBlock}
          <div class="props-empty" style="padding:6px 0;text-align:left">Sin tendencia clara en sus últimos juegos.</div>
        </div>`;
      }
      const items = props.map(p => {
        const arrow = p.direction === 'OVER' ? '↑' : '↓';
        const cls = p.hitRate >= 0.75 ? 'hot' : p.hitRate >= 0.65 ? 'warm' : '';
        const ratePct = Math.round(p.hitRate * 100);
        return `<div class="prop-item ${cls}">
          <div class="prop-item-text">
            <span class="prop-arrow">${arrow}</span>${p.direction} ${p.line} ${p.stat}
          </div>
          <div class="prop-item-avg">prom ${p.avg.toFixed(1)}</div>
          <div class="prop-item-rate">${p.hits}/${p.total} (${ratePct}%)</div>
        </div>`;
      }).join('');
      return `<div class="props-player-block">
        <div class="props-player-name">${escapeHtml(playerName)} <span class="props-player-team">${escapeHtml(teamAbbr)}</span></div>
        ${ctxBlock}
        <div class="props-list">${items}</div>
      </div>`;
    }

    // =====================================================================
    // ALINEACIÓN VS PITCHER (MLB)
    // Muestra los stats de carrera de cada bateador del equipo visitante
    // contra el pitcher local, y viceversa — usando MLB Stats API.
    // Carga lazy (igual patrón que loadGameProps).
    // =====================================================================

    const lineupVsPitcherCache = new Map();

    // Descarga el roster activo de un equipo MLB y devuelve solo los bateadores
    // (excluye pitchers). Máx 9 por defecto (la alineación titular típica).
    async function fetchTeamRosterBatters(mlbTeamId, n = 9) {
      try {
        const r = await fetch(`https://statsapi.mlb.com/api/v1/teams/${mlbTeamId}/roster/Active`);
        if (!r.ok) return [];
        const d = await r.json();
        return (d.roster || [])
          .filter(p => p.position?.type !== 'Pitcher' && p.position?.code !== '1')
          .slice(0, n)
          .map(p => ({ id: p.person.id, name: p.person.fullName, pos: p.position?.abbreviation || '' }));
      } catch { return []; }
    }

    // Stats de CARRERA de un bateador específico vs un pitcher específico.
    // Endpoint: /people/{batterId}/stats?stats=vsPlayer&opposingPlayerId={pitcherId}
    async function fetchBatterVsPitcher(batterId, pitcherId) {
      const key = `lvp-${batterId}-${pitcherId}`;
      if (lineupVsPitcherCache.has(key)) return lineupVsPitcherCache.get(key);
      try {
        const r = await fetch(
          `https://statsapi.mlb.com/api/v1/people/${batterId}/stats` +
          `?stats=vsPlayer&opposingPlayerId=${pitcherId}&sportId=1&group=hitting`
        );
        if (!r.ok) { lineupVsPitcherCache.set(key, null); return null; }
        const d = await r.json();
        const career = d.stats?.find(s => s.type?.displayName === 'vsPlayerTotal')?.splits?.[0]?.stat || null;
        lineupVsPitcherCache.set(key, career);
        return career;
      } catch { lineupVsPitcherCache.set(key, null); return null; }
    }

    // Genera el HTML de una tabla para un equipo vs su pitcher rival
    function renderLineupVsTable(batters, pitcherName, isHome) {
      const hdrColor = isHome ? 'var(--accent-blue)' : 'var(--accent-red)';
      const sideLabel = isHome ? 'Local' : 'Visitante';
      const rows = batters.map(b => {
        if (!b.vs || !parseInt(b.vs.atBats || 0)) {
          return `<tr>
            <td>${escapeHtml(b.name)}</td>
            <td style="color:var(--text-muted)">${b.pos}</td>
            <td colspan="6" style="color:var(--text-muted);font-style:italic;font-size:0.72rem">Sin historial</td>
          </tr>`;
        }
        const ab  = parseInt(b.vs.atBats    || 0);
        const h   = parseInt(b.vs.hits      || 0);
        const hr  = parseInt(b.vs.homeRuns  || 0);
        const rbi = parseInt(b.vs.rbi       || 0);
        const so  = parseInt(b.vs.strikeOuts|| 0);
        const avg = b.vs.avg || (ab > 0 ? (h / ab).toFixed(3) : '.000');
        const avgNum = parseFloat(avg);
        const avgColor = avgNum >= 0.300 ? 'var(--accent-green)'
                       : avgNum <= 0.200 ? 'var(--accent-red)' : 'var(--text-primary)';
        return `<tr>
          <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(b.name)}</td>
          <td style="color:var(--text-muted)">${b.pos}</td>
          <td>${ab}</td>
          <td><strong style="color:${avgColor}">${avg}</strong></td>
          <td>${h}</td>
          <td>${hr > 0 ? `<strong style="color:var(--accent-yellow)">${hr}</strong>` : 0}</td>
          <td>${rbi}</td>
          <td style="color:var(--text-muted)">${so}</td>
        </tr>`;
      }).join('');

      return `<div class="lvp-block">
        <div class="lvp-section-title" style="color:${hdrColor}">
          ${sideLabel} — vs ${escapeHtml(pitcherName)}
        </div>
        <div style="overflow-x:auto">
          <table class="lvp-table">
            <thead>
              <tr><th>Bateador</th><th>Pos</th><th>AB</th><th>AVG</th><th>H</th><th>HR</th><th>RBI</th><th>K</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    }

    // Punto de entrada: carga lazy del matchup histórico de la alineación vs pitcher
    async function loadLineupVsPitcher(btn) {
      const content = btn.nextElementSibling;
      const labelOpen  = '⚾ Alineación vs pitcher ▼';
      const labelClose = 'Ocultar alineación vs pitcher ▲';
      if (content.dataset.loaded === '1') {
        content.classList.toggle('open');
        btn.textContent = content.classList.contains('open') ? labelClose : labelOpen;
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Buscando historial vs pitcher…';
      content.classList.add('open');
      content.innerHTML = `<div class="props-loading">Cargando alineaciones y stats históricas…</div>`;

      const homeName      = btn.dataset.homeName;
      const awayName      = btn.dataset.awayName;
      const hPitcherName  = btn.dataset.homePitcherName;   // pitcher local (enfrenta a visitantes)
      const aPitcherName  = btn.dataset.awayPitcherName;   // pitcher visitante (enfrenta a locales)
      const homeAbbr      = btn.dataset.homeAbbr;
      const awayAbbr      = btn.dataset.awayAbbr;

      try {
        // IDs de equipos MLB y pitchers en paralelo
        const [homeMLBId, awayMLBId, hPitcherMLBId, aPitcherMLBId] = await Promise.all([
          getMLBTeamId(homeName),
          getMLBTeamId(awayName),
          hPitcherName && hPitcherName !== 'TBD' ? resolveMLBPitcherId(hPitcherName) : Promise.resolve(null),
          aPitcherName && aPitcherName !== 'TBD' ? resolveMLBPitcherId(aPitcherName) : Promise.resolve(null)
        ]);

        // Rosters de ambos equipos en paralelo
        const [homeRoster, awayRoster] = await Promise.all([
          homeMLBId ? fetchTeamRosterBatters(homeMLBId) : Promise.resolve([]),
          awayMLBId ? fetchTeamRosterBatters(awayMLBId) : Promise.resolve([])
        ]);

        // Stats carrera vs pitcher en paralelo
        // Visitantes baten vs PITCHER LOCAL (hPitcherMLBId)
        // Locales baten vs PITCHER VISITANTE (aPitcherMLBId)
        const [awayBatters, homeBatters] = await Promise.all([
          hPitcherMLBId
            ? Promise.all(awayRoster.map(b => fetchBatterVsPitcher(b.id, hPitcherMLBId).then(vs => ({ ...b, vs }))))
            : Promise.resolve(awayRoster.map(b => ({ ...b, vs: null }))),
          aPitcherMLBId
            ? Promise.all(homeRoster.map(b => fetchBatterVsPitcher(b.id, aPitcherMLBId).then(vs => ({ ...b, vs }))))
            : Promise.resolve(homeRoster.map(b => ({ ...b, vs: null })))
        ]);

        const blocks = [];

        if (hPitcherName && hPitcherName !== 'TBD' && awayBatters.length)
          blocks.push(renderLineupVsTable(awayBatters, hPitcherName, false));

        if (aPitcherName && aPitcherName !== 'TBD' && homeBatters.length)
          blocks.push(renderLineupVsTable(homeBatters, aPitcherName, true));

        if (!blocks.length) {
          content.innerHTML = `<div class="props-empty">
            No hay pitchers confirmados o no se pudo cargar la alineación.
          </div>`;
        } else {
          content.innerHTML = `
            <div class="props-honest-note">
              Stats de <strong>carrera histórica</strong> del bateador vs el pitcher específico.
              "Sin historial" = nunca se han enfrentado en MLB.
              AVG ≥ .300 en verde, ≤ .200 en rojo.
            </div>
            <div style="padding:0 2px">${blocks.join('')}</div>`;
        }
        content.dataset.loaded = '1';
        btn.textContent = labelClose;
      } catch(e) {
        content.innerHTML = `<div class="props-error">Error cargando alineación: ${escapeHtml(e.message)}</div>`;
        btn.textContent = '⚾ Reintentar ▼';
      } finally {
        btn.disabled = false;
      }
    }

    // Punto de entrada cuando el usuario hace click en "Ver tendencias".
    // Lee los IDs guardados en data-attrs del botón y carga en paralelo.
    // Para NBA: hasta 3 jugadores únicos por equipo (anotador/reboteador/asistente).
    async function loadGameProps(btn) {
      const content = btn.nextElementSibling;
      const labelOpen  = '🎯 Ver tendencias de jugadores ▼';
      const labelClose = 'Ocultar tendencias ▲';
      // Toggle si ya está abierto y cargado
      if (content.dataset.loaded === '1') {
        const willOpen = !content.classList.contains('open');
        content.classList.toggle('open');
        btn.textContent = willOpen ? labelClose : labelOpen;
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Cargando tendencias…';
      content.classList.add('open');
      content.innerHTML = `<div class="props-loading">Analizando últimos 10 juegos...</div>`;

      const sport = btn.dataset.sport;
      const homeAbbr = btn.dataset.homeAbbr, awayAbbr = btn.dataset.awayAbbr;
      try {
        const blocks = [];
        if (sport === 'nba') {
          const parse = s => { try { return JSON.parse(s || '[]'); } catch { return []; } };
          const homeScorers = parse(btn.dataset.homeScorers);
          const awayScorers = parse(btn.dataset.awayScorers);
          const homeTeamId  = btn.dataset.homeTeamId;
          const awayTeamId  = btn.dataset.awayTeamId;
          const homeName    = btn.dataset.homeName || homeAbbr;
          const awayName    = btn.dataset.awayName || awayAbbr;

          // Disparamos en paralelo: gamelogs de cada jugador + defensa por
          // posición de cada equipo (lo "pesado": 5 boxscores por team).
          // Para los jugadores away, su rival defensivo es homeTeam, y viceversa.
          const playerTasks = [
            ...awayScorers.map(p => fetchNBAGamelog(p.id).then(r => ({ p, ...r, side: 'away' }))),
            ...homeScorers.map(p => fetchNBAGamelog(p.id).then(r => ({ p, ...r, side: 'home' })))
          ];
          const [results, homeDef, awayDef] = await Promise.all([
            Promise.all(playerTasks),
            homeTeamId ? computeOppDefenseByPosition(homeTeamId, 5) : Promise.resolve(null),
            awayTeamId ? computeOppDefenseByPosition(awayTeamId, 5) : Promise.resolve(null)
          ]);

          for (const { p, games, position, side } of results) {
            if (!games?.length) continue;
            const trends = computeNBAProps(games);
            const abbr = side === 'home' ? homeAbbr : awayAbbr;
            // El rival defensivo del jugador: si es local, juega contra away;
            // si es visitante, contra home.
            const oppDef    = side === 'home' ? awayDef    : homeDef;
            const oppName   = side === 'home' ? awayName   : homeName;
            const ctx = buildDefenseContext(position, oppDef, oppName);
            blocks.push(renderPlayerPropsBlock(p.name, abbr, trends, ctx));
          }
        } else if (sport === 'mlb') {
          const parse = s => { try { return JSON.parse(s || '[]'); } catch { return []; } };
          const homePitcherId = btn.dataset.homePitcherId, awayPitcherId = btn.dataset.awayPitcherId;
          const homePitcherName = btn.dataset.homePitcherName, awayPitcherName = btn.dataset.awayPitcherName;
          const homeBatters = parse(btn.dataset.homeBatters);
          const awayBatters = parse(btn.dataset.awayBatters);

          // Disparamos pitchers + bateadores en paralelo. Cada bateador es 1 fetch
          // a MLB Stats API (gratuito), cacheado para no repetir.
          const tasks = {
            homePitcher: homePitcherId ? fetchMLBPitcherGamelog(homePitcherId) : Promise.resolve([]),
            awayPitcher: awayPitcherId ? fetchMLBPitcherGamelog(awayPitcherId) : Promise.resolve([]),
            awayBatters: Promise.all(awayBatters.map(b => fetchMLBBatterGamelog(b.id).then(log => ({ b, log })))),
            homeBatters: Promise.all(homeBatters.map(b => fetchMLBBatterGamelog(b.id).then(log => ({ b, log }))))
          };
          const [hPLog, aPLog, aBatLogs, hBatLogs] = await Promise.all([
            tasks.homePitcher, tasks.awayPitcher, tasks.awayBatters, tasks.homeBatters
          ]);

          // Orden de despliegue: visitante primero (pitcher → bateadores), luego local.
          if (awayPitcherName && aPLog.length) blocks.push(renderPlayerPropsBlock(awayPitcherName + ' (P)', awayAbbr, computeMLBPitcherProps(aPLog)));
          for (const { b, log } of aBatLogs) {
            if (!log.length) continue;
            blocks.push(renderPlayerPropsBlock(b.name, awayAbbr, computeMLBBatterProps(log)));
          }
          if (homePitcherName && hPLog.length) blocks.push(renderPlayerPropsBlock(homePitcherName + ' (P)', homeAbbr, computeMLBPitcherProps(hPLog)));
          for (const { b, log } of hBatLogs) {
            if (!log.length) continue;
            blocks.push(renderPlayerPropsBlock(b.name, homeAbbr, computeMLBBatterProps(log)));
          }
        }
        if (!blocks.length) {
          content.innerHTML = `<div class="props-empty">No hay datos suficientes de jugadores para este partido.</div>`;
        } else {
          content.innerHTML = `<div class="props-honest-note">Líneas estimadas a partir del promedio L10 — no reflejan la línea real de casa de apuestas. Sirven para identificar <strong>tendencias</strong>, no edge de mercado.</div>` + blocks.join('');
        }
        content.dataset.loaded = '1';
        btn.textContent = labelClose;
      } catch (e) {
        content.innerHTML = `<div class="props-error">Error cargando tendencias: ${escapeHtml(e.message)}</div>`;
        btn.textContent = '🎯 Reintentar ▼';
      } finally {
        btn.disabled = false;
      }
    }

    // ===== LEYENDA DE APUESTAS =====
    // Panel plegable que explica los términos a alguien que apenas empieza.
    function renderPredLegend() {
      return `<div class="pred-legend">
        <button class="pred-legend-toggle" onclick="togglePredLegend(this)">
          <span><span class="legend-icon">🛈</span> ¿Qué significa cada tipo de apuesta?</span>
          <span class="legend-arrow">▼</span>
        </button>
        <div class="pred-legend-content">
          <div class="legend-item">
            <div class="legend-item-title"><span class="legend-tag">MONEYLINE</span>¿Quién gana el partido?</div>
            <div class="legend-item-desc">La apuesta más simple: eliges qué equipo ganará. Las cuotas (ej. +120 o -150) indican cuánto pagan: positivo = paga más porque es menos probable; negativo = paga menos porque es favorito.</div>
            <div class="legend-item-example">Ejemplo: "Lakers ML +120" = si apuestas $100 y los Lakers ganan, te llevas $120 de ganancia.</div>
          </div>
          <div class="legend-item">
            <div class="legend-item-title"><span class="legend-tag">TOTAL (O/U)</span>¿Se anotará MÁS o MENOS de X?</div>
            <div class="legend-item-desc">No importa quién gane, importa cuántos puntos (NBA) o carreras (MLB) se anoten entre los dos equipos juntos. OVER = más que la línea; UNDER = menos.</div>
            <div class="legend-item-example">Ejemplo: línea 213 puntos NBA. Si la suma final es 220, gana el OVER. Si es 200, gana el UNDER.</div>
          </div>
          <div class="legend-item">
            <div class="legend-item-title"><span class="legend-tag">SPREAD</span>¿Por cuánto gana?</div>
            <div class="legend-item-desc">El equipo favorito necesita ganar por MÁS de cierto margen para que tu apuesta gane. El equipo perdedor puede perder por menos del margen y aún así cubrir.</div>
            <div class="legend-item-example">Ejemplo: "Lakers -5.5" = los Lakers deben ganar por 6 o más puntos. Si ganan 110-106, pierdes la apuesta aunque hayan ganado el partido.</div>
          </div>
          <div class="legend-item">
            <div class="legend-item-title"><span class="legend-tag">EDGE</span>¿Qué es la "ventaja" o "edge"?</div>
            <div class="legend-item-desc">La diferencia entre lo que el modelo estima y lo que las cuotas implican. Si el modelo dice 58% de ganar pero las cuotas pagan como si fuera 53%, tienes un edge del +5% — apostar tiene valor matemático esperado positivo.</div>
            <div class="legend-item-example">Cuanto mayor el edge, más valor tiene la apuesta. Edge negativo significa que las cuotas ya tienen incorporada toda la ventaja.</div>
          </div>
          <div class="legend-item">
            <div class="legend-item-title"><span class="legend-tag">CONFIANZA</span>Cómo se calcula el nivel de confianza</div>
            <div class="legend-item-desc">El modelo usa hasta <strong>13 señales estadísticas</strong> (récord, Pythagorean, ELO, forma reciente, pitcher, lesiones, H2H, descanso, diferencial, defensa y más). La confianza mide cuántas señales coinciden y qué tan fuerte es la ventaja contra las cuotas.</div>
            <div class="legend-item-example">
              <div style="display:grid;gap:6px;margin-top:6px">
                <div><strong style="color:var(--accent-green)">ALTA (80-100)</strong> — 5+ señales alineadas · 88%+ acuerdo · edge ≥7% · Pythagorean ≥58%</div>
                <div><strong style="color:var(--accent-yellow)">MEDIA (65-79)</strong> — 4+ señales · 72%+ acuerdo · edge ≥3% (o 3 señales + 65% acuerdo)</div>
                <div><strong style="color:var(--accent-red)">BAJA (50-64)</strong> — Señales contradictorias o edge negativo — apostar bajo tu propio criterio</div>
                <div><strong style="color:var(--text-muted)">SIN PICK</strong> — Datos insuficientes — el modelo no recomienda apostar</div>
              </div>
              <div style="margin-top:8px;color:var(--text-muted);font-size:.8rem">
                La confianza es honesta, no marketing. Un edge negativo siempre resulta en nivel BAJO sin importar cuántas señales coincidan.
              </div>
            </div>
          </div>
        </div>
      </div>`;
    }

    function togglePredLegend(btn) {
      const content = btn.nextElementSibling;
      const isOpen = content.classList.toggle('open');
      btn.querySelector('.legend-arrow').textContent = isOpen ? '▲' : '▼';
    }

    // Calcula el tamaño de apuesta óptimo con Kelly/4 (fracción conservadora).
    // Devuelve { pct, units } donde pct es fracción del bankroll (0–1) y units
    // es el monto sugerido si el usuario configuró su bankroll.
    function calcKelly(estProb, mlOdds) {
      if (estProb == null || estProb <= 0 || estProb >= 1) return null;
      const b = calcBetPayout(mlOdds);   // ganancia por unidad apostada
      const p = estProb;
      const q = 1 - p;
      const kelly = (b * p - q) / b;    // Kelly completo
      const fractional = kelly / 4;      // Kelly/4 = conservador
      if (fractional <= 0.004) return null;  // <0.4% = edge insuficiente para apostar
      const pct = Math.min(fractional, 0.05); // cap 5% por seguridad
      const units = userBankroll > 0 ? (pct * userBankroll).toFixed(0) : null;
      return { pct: (pct * 100).toFixed(1), units };
    }

    // ===== TOP PICKS DEL DÍA =====
    // Convierte la predicción de un partido en 0-3 picks accionables y rankeados.
    // Cada pick tiene un "score" para ordenarlos contra los de los demás partidos.
    // Solo entran picks con edge real — los "Sin Edge" se descartan.
    function buildTopPicksForGame(game, pred, odds, homeName, awayName) {
      const picks = [];
      const league = game.league;
      const gameLabel = `${awayName} @ ${homeName}`;
      const fmtML = v => v != null ? (v > 0 ? `+${v}` : `${v}`) : '—';
      const confBoost = c => c === 'high' ? 30 : c === 'medium' ? 15 : 0;

      // Moneyline — entra si edge ≥ 1% y hay confianza real
      if (pred.pick && pred.confidence !== 'none' && pred.edge != null) {
        const edgePct = Math.round(pred.edge * 100);
        if (edgePct >= 1) {
          const mlOdds = pred.pick === 'home' ? odds.mlHome : odds.mlAway;
          const strength = edgePct >= 6 ? 'strong' : edgePct >= 3 ? 'medium' : 'weak';
          const kelly = calcKelly(pred.pick === 'home' ? pred.homeEstP : pred.awayEstP, mlOdds);
          picks.push({
            league, type: 'Moneyline',
            gameLabel,
            main: `${pred.pickName} ML ${fmtML(mlOdds)}`,
            edgeDisplay: `+${edgePct}% edge`,
            kellyDisplay: kelly ? `Kelly/4: ${kelly.pct}%${kelly.units ? ` (~$${kelly.units})` : ''}` : null,
            strength,
            score: edgePct * 10 + confBoost(pred.confidence)
          });
        }
      }

      // Total — entra si edge supera el threshold mínimo
      if (pred.totalPick && pred.totalLine != null && pred.totalEdge != null) {
        const edgeAbs = Math.abs(pred.totalEdge);
        const thr = league === 'mlb' ? { strong: 1.5, ok: 0.5 } : { strong: 5, ok: 2 };
        if (edgeAbs >= thr.ok) {
          const arrow = pred.totalPick === 'OVER' ? '↑' : '↓';
          const unit = league === 'mlb' ? 'C' : 'pts';
          const strength = edgeAbs >= thr.strong ? 'strong' : 'medium';
          const score = league === 'mlb' ? edgeAbs * 35 : edgeAbs * 12;
          picks.push({
            league, type: 'Total',
            gameLabel,
            main: `${arrow} ${pred.totalPick} ${pred.totalLine}`,
            edgeDisplay: `${pred.totalEdge > 0 ? '+' : ''}${pred.totalEdge.toFixed(1)} ${unit}`,
            strength,
            score
          });
        }
      }

      // Spread — threshold depende del deporte (NBA en pts, MLB en carreras enteras)
      if (pred.spreadPick && pred.spreadHome != null && pred.spreadPred != null) {
        const requiredMargin = -pred.spreadHome;
        const spreadDiff = pred.spreadPred - requiredMargin;
        const diffAbs = Math.abs(spreadDiff);
        const sprT = league === 'mlb' ? { strong: 1.0, ok: 0.5 } : { strong: 4, ok: 2 };
        if (diffAbs >= sprT.ok) {
          const teamFull = pred.spreadPick === 'home' ? homeName : awayName;
          const teamSpread = pred.spreadPick === 'home' ? pred.spreadHome : -pred.spreadHome;
          const strength = diffAbs >= sprT.strong ? 'strong' : 'medium';
          const unit = league === 'mlb' ? 'C' : 'pts';
          // MLB usa scores menores; subimos el factor para que sus picks compitan con NBA.
          const score = league === 'mlb' ? diffAbs * 30 : diffAbs * 15;
          picks.push({
            league, type: 'Spread',
            gameLabel,
            main: `${teamFull} ${teamSpread > 0 ? '+' : ''}${teamSpread}`,
            edgeDisplay: `${spreadDiff > 0 ? '+' : ''}${spreadDiff.toFixed(1)} ${unit} vs línea`,
            strength,
            score
          });
        }
      }

      return picks;
    }

    // Renderiza el panel "Top Picks del Día" con los N picks de mayor score.
    function renderTopPicksPanel(picks, max = 8) {
      const top = picks.slice(0, max);
      if (!top.length) {
        return `<div class="top-picks-panel">
          <div class="top-picks-header">
            <div class="top-picks-title"><span class="trophy">🏆</span> Top Picks del Día</div>
          </div>
          <div class="top-picks-empty">Aún no hay picks con edge significativo. Revisa más tarde cuando se actualicen las cuotas.</div>
        </div>`;
      }
      const rows = top.map((p, i) => {
        const rank = i + 1;
        const rankCls = rank <= 3 ? `rank-${rank}` : '';
        const strengthLbl = p.strength === 'strong' ? 'FUERTE' : 'EDGE';
        return `<div class="top-pick-row ${rankCls}">
          <div class="top-pick-rank">${rank}</div>
          <div class="top-pick-body">
            <div class="top-pick-line1">
              <span class="top-pick-league-tag ${p.league}">${p.league.toUpperCase()}</span>
              <span class="top-pick-type-tag">${p.type}</span>
              <span class="top-pick-strength-tag ${p.strength}">${strengthLbl}</span>
            </div>
            <div class="top-pick-main">${escapeHtml(p.main)}</div>
            <div class="top-pick-edge">${p.edgeDisplay}</div>
            ${p.kellyDisplay ? `<div class="top-pick-kelly">${escapeHtml(p.kellyDisplay)}</div>` : ''}
            <div class="top-pick-game">${escapeHtml(p.gameLabel)}</div>
          </div>
        </div>`;
      }).join('');
      return `<div class="top-picks-panel">
        <div class="top-picks-header">
          <div class="top-picks-title"><span class="trophy">🏆</span> Top Picks del Día</div>
          <div class="top-picks-subtitle">${top.length} ${top.length === 1 ? 'pick ordenado' : 'picks ordenados'} por valor estimado</div>
        </div>
        <div class="top-picks-list">${rows}</div>
      </div>`;
    }

    // Genera el HTML de una card de predicción
    function renderPredCard(game, homeComp, awayComp, homeRec, awayRec, odds, pred, extras = {}) {
      const { homePitcher, awayPitcher, homeInjuries = [], awayInjuries = [],
              homeTopScorers = [], awayTopScorers = [],
              homeTopBatters = [], awayTopBatters = [], h2h = null,
              weatherSignal = null, lineupStatus = null } = extras;

      // Renderiza un bloque compacto de top 2 lesiones por equipo.
      // Si hay más, mostramos "+N más"; si no hay nada relevante, no mostramos nada.
      const injuriesBlock = (list) => {
        if (!list || !list.length) return '';
        const top = list.slice(0, 2);
        const extra = list.length - top.length;
        const items = top.map(inj => `
          <div class="pred-injury-item">
            <span class="pred-injury-name">${escapeHtml(inj.name)}</span>
            <span class="pred-injury-status sev-${inj.severity}">${injuryStatusShort(inj.status)}</span>
          </div>`).join('');
        return `<div class="pred-injuries">
          ${items}
          ${extra > 0 ? `<div class="pred-injury-more">+${extra} más</div>` : ''}
        </div>`;
      };
      const league  = game.league;
      const state   = game.status.type.state;
      const statusInfo = getStatusInfo(
        state === 'in' ? '2' : state === 'post' ? '3' : '1',
        game.status.type.shortDetail
      );

      const homeName = homeComp.team?.shortDisplayName || homeComp.team?.displayName || '';
      const awayName = awayComp.team?.shortDisplayName || awayComp.team?.displayName || '';
      const homeLogo = homeComp.team?.logo || '';
      const awayLogo = awayComp.team?.logo || '';
      const homeAbbr = homeComp.team?.abbreviation || homeName.slice(0,3).toUpperCase();
      const awayAbbr = awayComp.team?.abbreviation || awayName.slice(0,3).toUpperCase();

      const fmtML = v => v != null ? (v > 0 ? `+${v}` : `${v}`) : '—';

      // Badge de record de temporada: verde si >60%, rojo si <40%, gris si medio
      const recBadge = (rec) => {
        if (!rec) return '<span class="pred-form-badge">Sin datos</span>';
        const { wins, losses, rate } = rec.total;
        const cls = rate >= 0.60 ? 'hot' : rate <= 0.40 ? 'cold' : '';
        return `<span class="pred-form-badge ${cls}">${wins}-${losses}</span>`;
      };

      // Badge de racha actual: positivo (verde) = victorias, negativo (rojo) = derrotas
      const streakBadge = (rec) => {
        if (!rec || rec.streak == null || rec.streak === 0) return '';
        const s = rec.streak;
        const cls = s >= 3 ? 'hot' : s <= -3 ? 'cold' : '';
        const lbl = s > 0 ? `↑ ${s}G` : `↓ ${Math.abs(s)}P`;
        return `<span class="pred-form-badge ${cls}" style="font-size:0.65rem">${lbl}</span>`;
      };

      // Mini indicador de forma reciente (últimos 10 juegos).
      // Datos vienen de standings → solo tenemos el resumen "8-2", sin secuencia individual.
      // Mostramos el récord con color según win rate.
      const formBar = (rec) => {
        if (!rec?.recentForm) return '';
        const { wins, losses, rate } = rec.recentForm;
        const color = rate >= 0.70 ? 'var(--accent-green)'
                    : rate >= 0.50 ? 'var(--accent-yellow)'
                    : 'var(--accent-red)';
        // Barra de proporción visual: N puntos verdes / M rojos (máx 10)
        const total = Math.min(wins + losses, 10);
        const wDots = Math.round(rate * total);
        const lDots = total - wDots;
        const dots  = Array(wDots).fill('<span class="form-dot win"></span>').join('')
                    + Array(lDots).fill('<span class="form-dot loss"></span>').join('');
        return `<div class="recent-form-bar">
          <span class="form-label">Últ10</span>${dots}
          <span class="form-record" style="color:${color}">${wins}-${losses}</span>
        </div>`;
      };

      // Badge de días de descanso (B2B, Normal o Descansado)
      const restBadge = (rec) => {
        if (rec?.restDays == null) return '';
        if (rec.restDays === 0) return `<span class="rest-badge rest-b2b">B2B</span>`;
        if (rec.restDays >= 3)  return `<span class="rest-badge rest-rested">${rec.restDays}d descanso</span>`;
        return `<span class="rest-badge rest-normal">${rec.restDays}d desc</span>`;
      };

      // Badge de confianza
      const confMap = {
        high:   ['conf-high',   'ALTA'],
        medium: ['conf-medium', 'MEDIA'],
        low:    ['conf-low',    'BAJA'],
        none:   ['conf-none',   'N/D']
      };
      const [confCls, confLabel] = confMap[pred.confidence] || confMap.none;

      // Pick resaltado en verde
      const pickCls = (side) => pred.pick === side ? 'pick-winner' : '';

      // Una fila por cada señal del modelo ensemble (Record, Pythagorean, Racha)
      const signalRows = (pred.signals || []).map(s => {
        const homeP = s.homeP, awayP = 1 - s.homeP;
        const w = Math.round(s.weight * 100);
        return `<div class="pred-prob-row">
          <span class="pred-prob-label">${s.name} <span style="color:var(--text-muted);font-size:0.68rem">(${w}%)</span></span>
          <div class="pred-prob-values">
            <span class="pred-prob-team">${awayAbbr} ${fmtPct(awayP)}</span>
            <span class="pred-prob-team">${homeAbbr} ${fmtPct(homeP)}</span>
          </div>
        </div>`;
      }).join('');

      // ===== 3 PICKS ACCIONABLES =====
      // Cada apuesta (ML / Total / Spread) se muestra como una card con:
      // pick específico, fuerza del edge, y una línea de razón concreta.

      // Helper: clasifica fuerza según magnitud del edge
      const classify = (val, strong, ok) => {
        if (val == null) return { cls: 'strength-none', label: 'SIN EDGE' };
        const a = Math.abs(val);
        if (a >= strong) return { cls: 'strength-strong', label: 'FUERTE' };
        if (a >= ok)     return { cls: 'strength-ok',     label: 'EDGE' };
        return { cls: 'strength-weak', label: 'DÉBIL' };
      };

      // 1) MONEYLINE — apuesta directa: ¿quién gana el partido?
      const mlPick = (() => {
        if (!pred.pick || pred.confidence === 'none') {
          return { cls: 'strength-none', label: 'SIN VALOR',
            main: 'Sin datos suficientes',
            meta: 'No tenemos información para calcular un pick fiable en este partido.' };
        }
        const edgePct  = pred.edge != null ? Math.round(pred.edge * 100) : null;
        const mlOdds   = pred.pick === 'home' ? odds.mlHome : odds.mlAway;
        const teamFull = pred.pickName;
        const oddsStr  = mlOdds != null ? fmtML(mlOdds) : '—';
        const modeloPct = pred.pick === 'home' ? Math.round(pred.homeEstP * 100) : Math.round(pred.awayEstP * 100);
        const cuotasP   = pred.pick === 'home' ? pred.homeImpP : pred.awayImpP;
        // Sin línea moneyline disponible: no podemos calcular edge ni comparar.
        if (cuotasP == null) {
          return { cls: 'strength-none', label: 'SIN ODDS',
            main: `${teamFull}`,
            meta: `El modelo proyecta a <strong>${teamFull}</strong> con <strong>${modeloPct}%</strong> de ganar, pero no hay moneyline publicado para comparar.` };
        }
        const strength = classify(edgePct, 6, 3);
        if (edgePct != null && edgePct < 1) {
          return { cls: 'strength-none', label: 'SIN VALOR',
            main: 'Pasar moneyline',
            meta: 'La casa de apuestas ya tiene el partido bien evaluado. No hay ventaja para apostar.' };
        }
        const cuotasPct = Math.round(cuotasP * 100);
        const edgeStr   = `${edgePct > 0 ? '+' : ''}${edgePct}%`;
        return {
          cls: strength.cls, label: strength.label,
          main: `${teamFull} ${oddsStr}`,
          meta: `La casa paga como si <strong>${teamFull}</strong> tuviera <strong>${cuotasPct}%</strong> de ganar, pero los datos sugieren <strong>${modeloPct}%</strong>. Tu ventaja: <strong>${edgeStr}</strong>.`
        };
      })();

      // 2) TOTAL — ¿se anotará MÁS o MENOS que la línea? (suma de ambos equipos)
      const totalPick = (() => {
        if (pred.totalLine == null || pred.totalPred == null) {
          return { cls: 'strength-none', label: 'SIN VALOR',
            main: 'Sin datos para total',
            meta: 'No hay línea publicada o faltan estadísticas ofensivas para predecir.' };
        }
        const edgeAbs = Math.abs(pred.totalEdge);
        const thresholds = league === 'mlb' ? { strong: 1.5, ok: 0.5 } : { strong: 5, ok: 2 };
        const strength = classify(edgeAbs, thresholds.strong, thresholds.ok);
        const unidad = league === 'mlb' ? 'carreras' : 'puntos';
        if (!pred.totalPick) {
          return { cls: 'strength-none', label: 'SIN VALOR',
            main: `Pasar O/U ${pred.totalLine}`,
            meta: `Esperamos ~<strong>${pred.totalPred.toFixed(1)}</strong> ${unidad} y la línea está en <strong>${pred.totalLine}</strong>. Demasiado parejo para apostar.` };
        }
        const arrow    = pred.totalPick === 'OVER' ? '↑' : '↓';
        const dirText  = pred.totalPick === 'OVER' ? 'más' : 'menos';
        const diffStr  = Math.abs(pred.totalEdge).toFixed(1);
        return {
          cls: strength.cls, label: strength.label,
          main: `${arrow} ${pred.totalPick} ${pred.totalLine}`,
          meta: `El modelo proyecta <strong>${pred.totalPred.toFixed(1)}</strong> ${unidad} entre los dos equipos — <strong>${diffStr} ${dirText}</strong> que la línea de <strong>${pred.totalLine}</strong>. Buen valor en el ${pred.totalPick}.`
        };
      })();

      // 3) SPREAD — ¿gana por X o más? (margen de victoria)
      const spreadPick = (() => {
        if (pred.spreadHome == null || pred.spreadPred == null) {
          return { cls: 'strength-none', label: 'SIN VALOR',
            main: 'Sin datos para spread',
            meta: 'No hay línea de spread disponible o faltan diferenciales de equipo.' };
        }
        const requiredMargin = -pred.spreadHome;
        const spreadDiff = pred.spreadPred - requiredMargin;
        // Thresholds por liga: NBA juega con margenes más amplios que MLB (carreras enteras).
        const sprThr = league === 'mlb' ? { strong: 1.0, ok: 0.5 } : { strong: 4, ok: 2 };
        const strength = classify(spreadDiff, sprThr.strong, sprThr.ok);
        const unit = league === 'mlb' ? 'C' : 'pts';
        if (!pred.spreadPick) {
          const localMargin = pred.spreadPred > 0
            ? `gana por ${pred.spreadPred.toFixed(1)}`
            : `pierde por ${Math.abs(pred.spreadPred).toFixed(1)}`;
          return { cls: 'strength-none', label: 'SIN VALOR',
            main: `Pasar spread`,
            meta: `La línea pide que el local gane por <strong>${requiredMargin > 0 ? '+' : ''}${requiredMargin}</strong> y el modelo proyecta que ${localMargin}. Diferencia muy pequeña.` };
        }
        const teamFull = pred.spreadPick === 'home' ? homeName : awayName;
        const teamSpread = pred.spreadPick === 'home' ? pred.spreadHome : -pred.spreadHome;
        const teamSpreadStr = (teamSpread > 0 ? '+' : '') + teamSpread;
        const margenAbs = Math.abs(spreadDiff).toFixed(1);
        return {
          cls: strength.cls, label: strength.label,
          main: `${teamFull} ${teamSpreadStr}`,
          meta: `El modelo proyecta a <strong>${teamFull}</strong> ganando con <strong>${margenAbs} ${unit}</strong> más de lo que pide la línea. Margen suficiente para cubrir.`
        };
      })();

      const renderPickCard = (type, p) => `
        <div class="pick-card ${p.cls}">
          <div class="pick-card-header">
            <span class="pick-type">${type}</span>
            <span class="pick-strength-badge">${p.label}</span>
          </div>
          <div class="pick-main">${p.main}</div>
          <div class="pick-meta">${p.meta}</div>
        </div>`;

      const picksGrid = `
        <div class="pred-picks-grid">
          ${renderPickCard('Moneyline', mlPick)}
          ${renderPickCard('Total O/U', totalPick)}
          ${renderPickCard('Spread', spreadPick)}
        </div>`;

      // Bloque de probabilidades (solo si hay datos)
      const analysisBlock = pred.confidence !== 'none' ? `
        <div class="pred-analysis">
          <div class="pred-prob-row">
            <span class="pred-prob-label" style="color:var(--accent-yellow)">Prob. implícita (cuotas)</span>
            <div class="pred-prob-values">
              <span class="pred-prob-team">${awayAbbr} ${fmtPct(pred.awayImpP)}</span>
              <span class="pred-prob-team">${homeAbbr} ${fmtPct(pred.homeImpP)}</span>
            </div>
          </div>
          ${signalRows}
          <div class="pred-prob-row" style="border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;margin-top:4px">
            <span class="pred-prob-label" style="color:var(--accent-green);font-weight:700">Modelo (combinado)</span>
            <div class="pred-prob-values">
              <span class="pred-prob-team" style="color:var(--accent-green)">${awayAbbr} ${fmtPct(pred.awayEstP)}</span>
              <span class="pred-prob-team" style="color:var(--accent-green)">${homeAbbr} ${fmtPct(pred.homeEstP)}</span>
            </div>
          </div>
          ${pred.edge != null ? (() => {
            const pct  = Math.round(pred.edge * 100);
            const cls  = pct > 0 ? 'pred-edge-pos' : pct < 0 ? 'pred-edge-neg' : 'pred-edge-neu';
            const name = pred.pick === 'home' ? homeName : awayName;
            return `<div class="pred-edge-row" style="margin-top:6px">
              <span class="pred-edge-label">Edge ${name}:</span>
              <span class="${cls}">${pct > 0 ? '+' : ''}${pct}%</span>
            </div>`;
          })() : ''}
        </div>` : '';

      return `
        <div class="pred-card ${league}" data-league="${league}">

          <!-- Línea superior: liga, estado y hora -->
          <div class="pred-card-top">
            <div style="display:flex;align-items:center;gap:7px">
              <span class="pred-league-badge ${league}">${league.toUpperCase()}</span>
              <span class="status-badge ${statusInfo.css}" style="font-size:0.63rem">${statusInfo.label}</span>
              ${weatherSignal ? renderWeatherBadge(weatherSignal) : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              ${pred.confidence !== 'none' && pred.pick ? (() => {
                const _pickName = (pred.pick === 'home' ? homeName : awayName).replace(/'/g,"\\'").replace(/"/g,'&quot;');
                const _pickML   = pred.pick === 'home' ? (odds.mlHome ?? null) : (odds.mlAway ?? null);
                const _parlayId = `${league}-${game.id}-${pred.pick}`;
                return `<button class="parlay-add-btn"
                  data-parlay-id="${_parlayId}"
                  onclick="toggleParlayPick('${_parlayId}','${_pickName} ML',${_pickML},'${pred.pick}','${league}',${pred.homeEstP ?? 0.5})"
                >+ Parlay</button>`;
              })() : ''}
              <span class="pred-card-time">${formatGameTime(game.date)}</span>
            </div>
          </div>

          <!-- Equipos: visitante @ local con record + stats clave -->
          <div class="pred-teams-row">
            <div class="pred-team-info">
              ${awayLogo
                ? `<img class="pred-team-logo" src="${awayLogo}" alt="${awayName}"
                       onerror="this.style.display='none';this.nextSibling.style.display='flex'">
                   <div class="pred-team-logo-fallback" style="display:none">${awayAbbr}</div>`
                : `<div class="pred-team-logo-fallback">${awayAbbr}</div>`}
              <div class="pred-team-name ${pickCls('away')}">${awayName}</div>
              ${recBadge(awayRec)}
              ${awayRec?.pf != null
                ? `<div class="pred-ppg">${awayRec.pf.toFixed(1)} a favor / ${awayRec.pa.toFixed(1)} en contra</div>`
                : (awayRec?.road ? `<div class="pred-ppg">${awayRec.road.wins}-${awayRec.road.losses} ruta</div>` : '')}
              ${streakBadge(awayRec)}
              ${formBar(awayRec)}
              ${restBadge(awayRec)}
              ${injuriesBlock(awayInjuries)}
            </div>

            <div class="pred-vs-col">@</div>

            <div class="pred-team-info">
              ${homeLogo
                ? `<img class="pred-team-logo" src="${homeLogo}" alt="${homeName}"
                       onerror="this.style.display='none';this.nextSibling.style.display='flex'">
                   <div class="pred-team-logo-fallback" style="display:none">${homeAbbr}</div>`
                : `<div class="pred-team-logo-fallback">${homeAbbr}</div>`}
              <div class="pred-team-name ${pickCls('home')}">${homeName}</div>
              ${recBadge(homeRec)}
              ${homeRec?.pf != null
                ? `<div class="pred-ppg">${homeRec.pf.toFixed(1)} a favor / ${homeRec.pa.toFixed(1)} en contra</div>`
                : (homeRec?.home ? `<div class="pred-ppg">${homeRec.home.wins}-${homeRec.home.losses} casa</div>` : '')}
              ${streakBadge(homeRec)}
              ${formBar(homeRec)}
              ${restBadge(homeRec)}
              ${injuriesBlock(homeInjuries)}
            </div>
          </div>

          <!-- Probable pitchers (solo MLB) -->
          ${(homePitcher || awayPitcher) ? `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:0.72rem;color:var(--text-muted)">Pitchers abridores</span>
            ${lineupStatus === 'confirmed' ? `<span class="lineup-badge confirmed">✓ Alineación confirmada</span>` :
              lineupStatus === 'probable'  ? `<span class="lineup-badge probable">~ Alineación probable</span>`  : ''}
          </div>
          <div class="pred-pitchers-row">
            <div class="pred-pitcher-side">
              <div class="pred-pitcher-label">Abridor visitante</div>
              <div class="pred-pitcher-name">${awayPitcher?.name || 'TBD'}</div>
              ${awayPitcher?.era != null
                ? `<div class="pred-pitcher-stats">
                    <span class="${awayPitcher.era < 3.5 ? 'pitcher-good' : awayPitcher.era > 5 ? 'pitcher-bad' : ''}">ERA ${awayPitcher.era.toFixed(2)}</span>
                    ${awayPitcher.record ? `<span class="pred-pitcher-rec">${awayPitcher.record}</span>` : ''}
                   </div>`
                : '<div class="pred-pitcher-stats" style="color:var(--text-muted)">sin stats</div>'}
            </div>
            <div class="pred-pitcher-divider">vs</div>
            <div class="pred-pitcher-side">
              <div class="pred-pitcher-label">Abridor local</div>
              <div class="pred-pitcher-name">${homePitcher?.name || 'TBD'}</div>
              ${homePitcher?.era != null
                ? `<div class="pred-pitcher-stats">
                    <span class="${homePitcher.era < 3.5 ? 'pitcher-good' : homePitcher.era > 5 ? 'pitcher-bad' : ''}">ERA ${homePitcher.era.toFixed(2)}</span>
                    ${homePitcher.record ? `<span class="pred-pitcher-rec">${homePitcher.record}</span>` : ''}
                   </div>`
                : '<div class="pred-pitcher-stats" style="color:var(--text-muted)">sin stats</div>'}
            </div>
          </div>` : ''}

          <!-- Historial directo (H2H) de la temporada actual -->
          ${h2h ? (() => {
            const awayWins = h2h.total - h2h.homeWins;
            const favor = h2h.homeWins > awayWins ? homeName
                        : awayWins > h2h.homeWins ? awayName : null;
            const label = favor ? `${favor} domina` : 'Serie igualada';
            const cls   = favor === homeName ? 'h2h-home' : favor === awayName ? 'h2h-away' : 'h2h-even';
            return `<div class="pred-h2h-row">
              <span class="pred-h2h-label">H2H temporada</span>
              <span class="pred-h2h-record">${awayName} ${awayWins} – ${h2h.homeWins} ${homeName}</span>
              <span class="pred-h2h-tag ${cls}">${label}</span>
            </div>`;
          })() : ''}

          <!-- 3 picks accionables: Moneyline, Total, Spread -->
          ${picksGrid}

          ${pred.pick && pred.confidence !== 'none' ? `
            <div class="pred-pick-section" style="padding-top:0;">
              <div class="pred-pick-header">
                <span class="pred-pick-label">Justificación</span>
                <span class="confidence-badge ${confCls}">${confLabel}</span>
                ${pred.edge != null && pred.edge > 0.03 ? `<span class="badge-value">VALUE BET</span>` :
                  pred.edge != null && pred.edge < 0    ? `<span class="badge-risk">HIGH RISK</span>` :
                  (pred.confidence === 'medium' || pred.confidence === 'high') && pred.edge != null && pred.edge >= 0 ? `<span class="badge-safe">SAFE PICK</span>` : ''}
              </div>
              <div class="pred-pick-reason">${pred.reason}</div>
            </div>` : (pred.confidence === 'none' ? `
            <div class="pred-pick-section">
              <div class="pred-insufficient">${pred.reason}</div>
              <span class="badge-nobet">NO BET</span>
            </div>` : '')}

          <!-- Toggle de detalles avanzados (señales, probabilidades) -->
          <button class="pred-details-toggle" onclick="togglePredDetails(this)">
            Ver análisis técnico ▼
          </button>
          <div class="pred-details-content">
            ${analysisBlock}
          </div>

          <!-- Props de jugadores (lazy-load al hacer click) -->
          ${(() => {
            const hasNBAIds  = league === 'nba' && (homeTopScorers.length || awayTopScorers.length);
            const hasMLBIds  = league === 'mlb' && (homePitcher?.id || awayPitcher?.id || homeTopBatters.length || awayTopBatters.length);
            if (!hasNBAIds && !hasMLBIds) return '';
            // Serializamos arrays como JSON para no inflar el DOM con 6 atributos por jugador.
            const homeScorersJSON = escapeHtml(JSON.stringify(homeTopScorers));
            const awayScorersJSON = escapeHtml(JSON.stringify(awayTopScorers));
            const homeBattersJSON = escapeHtml(JSON.stringify(homeTopBatters));
            const awayBattersJSON = escapeHtml(JSON.stringify(awayTopBatters));
            return `<button class="pred-props-toggle"
              onclick="loadGameProps(this)"
              data-sport="${league}"
              data-home-scorers='${homeScorersJSON}'
              data-away-scorers='${awayScorersJSON}'
              data-home-batters='${homeBattersJSON}'
              data-away-batters='${awayBattersJSON}'
              data-home-pitcher-id="${homePitcher?.id || ''}"
              data-away-pitcher-id="${awayPitcher?.id || ''}"
              data-home-pitcher-name="${escapeHtml(homePitcher?.name || '')}"
              data-away-pitcher-name="${escapeHtml(awayPitcher?.name || '')}"
              data-home-team-id="${homeComp.team?.id || ''}"
              data-away-team-id="${awayComp.team?.id || ''}"
              data-home-name="${escapeHtml(homeComp.team?.shortDisplayName || homeAbbr)}"
              data-away-name="${escapeHtml(awayComp.team?.shortDisplayName || awayAbbr)}"
              data-home-abbr="${homeAbbr}"
              data-away-abbr="${awayAbbr}"
            >🎯 Ver tendencias de jugadores ▼</button>
            <div class="pred-props-content"></div>
            ${league === 'mlb' && ((homePitcher?.fullName && homePitcher.fullName !== 'TBD') || (awayPitcher?.fullName && awayPitcher.fullName !== 'TBD')) ? `
            <button class="pred-props-toggle"
              onclick="loadLineupVsPitcher(this)"
              style="border-top:none;background:rgba(255,215,0,0.05);color:var(--accent-yellow)"
              data-home-name="${escapeHtml(homeComp.team?.displayName || homeName)}"
              data-away-name="${escapeHtml(awayComp.team?.displayName || awayName)}"
              data-home-pitcher-name="${escapeHtml(homePitcher?.fullName || '')}"
              data-away-pitcher-name="${escapeHtml(awayPitcher?.fullName || '')}"
              data-home-abbr="${homeAbbr}"
              data-away-abbr="${awayAbbr}"
            >⚾ Alineación vs pitcher ▼</button>
            <div class="pred-props-content"></div>` : ''}`;
          })()}

        </div>`;
    }

    // Mostrar/ocultar el bloque técnico (señales del modelo + probabilidades)
    function togglePredDetails(btn) {
      const content = btn.nextElementSibling;
      const isOpen = content.classList.toggle('open');
      btn.textContent = isOpen ? 'Ocultar análisis técnico ▲' : 'Ver análisis técnico ▼';
    }

    // Filtra las cards por deporte (botones Todos / NBA / MLB)
    function filterPredictions(league, btn) {
      document.querySelectorAll('.pred-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.pred-card').forEach(card => {
        card.style.display = (league === 'all' || card.dataset.league === league) ? '' : 'none';
      });
    }

    // Punto de entrada de predicciones.
    // 1. Muestra cards iniciales con records del scoreboard (instantáneo)
    // 2. En paralelo, descarga stats avanzadas de cada equipo y re-renderiza con análisis completo
    async function initPredictions() {
      predictionsInitialized = true;
      const container = document.getElementById('predictionsContainer');

      // Pre-rellenar el input de clave de clima si ya está guardada
      const wxInput = document.getElementById('weatherKeyInput');
      if (wxInput && getWeatherKey()) wxInput.value = getWeatherKey();

      const allGames = [
        ...allTodayGames.nba.map(g => ({ ...g, league: 'nba' })),
        ...allTodayGames.mlb.map(g => ({ ...g, league: 'mlb' }))
      ];

      if (!allGames.length) {
        container.innerHTML = `<div class="coming-soon">
          <h3>Sin partidos hoy</h3>
          <p>No hay juegos programados para analizar.</p></div>`;
        return;
      }

      container.innerHTML = `<div class="loading-container">
        <div class="spinner"></div>
        <div class="loading-text">Analizando ${allGames.length} partidos con estadísticas avanzadas...</div></div>`;

      // === FETCH PARALELO de stats completas para todos los equipos únicos ===
      const teamFetches = {};
      allGames.forEach(game => {
        (game.competitions?.[0]?.competitors || []).forEach(comp => {
          const id = comp.team?.id;
          const key = `${game.league}-${id}`;
          if (id && !teamFetches[key]) {
            teamFetches[key] = { id, sport: game.league, comp };
          }
        });
      });

      const statsResults = {};
      const leaguesPresent = new Set(allGames.map(g => g.league));
      const injuriesByLeague = {};
      const h2hResults = {};
      const weatherResults = {};  // game.id → weatherSignal (solo MLB outdoor)
      try {
        await Promise.all([
          ...Object.entries(teamFetches).map(async ([key, { id, sport, comp }]) => {
            statsResults[key] = await fetchTeamFullStats(id, sport, comp);
          }),
          ...[...leaguesPresent].map(async lg => {
            injuriesByLeague[lg] = await fetchInjuries(lg);
          }),
          ...allGames.map(async game => {
            const comps    = game.competitions?.[0]?.competitors || [];
            const homeComp = comps.find(c => c.homeAway === 'home');
            const awayComp = comps.find(c => c.homeAway === 'away');
            if (homeComp?.team?.id && awayComp?.team?.id) {
              h2hResults[game.id] = await fetchH2H(
                homeComp.team.id, awayComp.team.id, game.league
              );
            }
            // Clima: solo MLB, solo si hay clave OpenWeather configurada
            if (game.league === 'mlb' && getWeatherKey()) {
              const homeName = homeComp?.team?.displayName || '';
              const stadCoords = typeof getStadiumCoords === 'function'
                ? getStadiumCoords(homeName) : null;
              if (stadCoords && !stadCoords.roof) {
                const wx = await fetchWeather(stadCoords.lat, stadCoords.lon);
                if (wx) weatherResults[game.id] = calcWeatherSignal(wx, stadCoords);
              }
            }
          })
        ]);
      } catch (fetchErr) {
        // Si fallan los fetches, continuamos con lo que tengamos (fallback al scoreboard).
        // Solo un error catastrófico (red caída) haría fallar esto por completo.
        console.warn('Algunos datos no cargaron, usando datos del scoreboard:', fetchErr.message);
      }

      // === Construimos las cards con todas las señales ===
      const allTopPicks = [];
      const cards = allGames.map(game => {
        const comps    = game.competitions?.[0]?.competitors || [];
        const homeComp = comps.find(c => c.homeAway === 'home');
        const awayComp = comps.find(c => c.homeAway === 'away');
        if (!homeComp || !awayComp) return '';

        // Si el fetch falló, caemos al record básico del scoreboard
        const homeRec = statsResults[`${game.league}-${homeComp.team?.id}`]
                     || extractTeamRecord(homeComp, true);
        const awayRec = statsResults[`${game.league}-${awayComp.team?.id}`]
                     || extractTeamRecord(awayComp, false);

        // Buscar odds del partido en los datos crudos guardados por loadOdds()
        const oddsRaw  = allTodayOddsRaw[game.league] || [];
        const homeName = homeComp.team?.displayName || '';
        const awayName = awayComp.team?.displayName || '';
        const oddsGame = oddsRaw.find(og =>
          teamLastWord(og.home_team) === teamLastWord(homeName) &&
          teamLastWord(og.away_team) === teamLastWord(awayName)
        );

        let spreadAway = null, spreadHome = null, mlAway = null, mlHome = null, total = null;
        if (oddsGame?.bookmakers?.length) {
          const bk        = oddsGame.bookmakers[0];
          const spreadMkt = bk.markets.find(m => m.key === 'spreads');
          const h2hMkt    = bk.markets.find(m => m.key === 'h2h');
          const totalMkt  = bk.markets.find(m => m.key === 'totals');
          if (spreadMkt) {
            const aS = spreadMkt.outcomes.find(o => teamLastWord(o.name) === teamLastWord(oddsGame.away_team));
            const hS = spreadMkt.outcomes.find(o => teamLastWord(o.name) === teamLastWord(oddsGame.home_team));
            if (aS) spreadAway = aS.point;
            if (hS) spreadHome = hS.point;
          }
          if (h2hMkt) {
            const aML = h2hMkt.outcomes.find(o => teamLastWord(o.name) === teamLastWord(oddsGame.away_team));
            const hML = h2hMkt.outcomes.find(o => teamLastWord(o.name) === teamLastWord(oddsGame.home_team));
            if (aML) mlAway = aML.price;
            if (hML) mlHome = hML.price;
          }
          if (totalMkt) {
            const over = totalMkt.outcomes.find(o => o.name === 'Over');
            if (over) total = over.point;
          }
        }

        // Probable pitchers abridores (solo aplica MLB)
        const homePitcher = game.league === 'mlb' ? extractPitcher(homeComp) : null;
        const awayPitcher = game.league === 'mlb' ? extractPitcher(awayComp) : null;

        // Confirmación de alineación: si ambos pitchers están presentes la alineación
        // es al menos probable; si el partido ya está en juego es confirmada.
        const gameState = game.status?.type?.state;
        const lineupStatus = game.league === 'mlb'
          ? (gameState === 'in' || gameState === 'post' ? 'confirmed'
            : (homePitcher?.id && awayPitcher?.id ? 'probable' : 'unknown'))
          : null;

        const injMap = injuriesByLeague[game.league];
        const homeInjuries = injMap?.get(String(homeComp.team?.id)) || [];
        const awayInjuries = injMap?.get(String(awayComp.team?.id)) || [];

        const h2h  = h2hResults[game.id] || null;

        // Movimiento de línea: compara odds de apertura del día vs actuales
        let homeLineMoveSignal = null;
        const openKey = `${game.league}-${game.id}`;
        const oddsOpenGame = allTodayOddsOpen[openKey];
        if (oddsOpenGame && oddsGame) {
          const openBk   = oddsOpenGame.bookmakers?.[0];
          const currBk   = oddsGame.bookmakers?.[0];
          const openH2H  = openBk?.markets?.find(m => m.key === 'h2h');
          const currH2H  = currBk?.markets?.find(m => m.key === 'h2h');
          const openHome = openH2H?.outcomes?.find(o => teamLastWord(o.name) === teamLastWord(homeName));
          const currHome = currH2H?.outcomes?.find(o => teamLastWord(o.name) === teamLastWord(homeName));
          if (openHome?.price != null && currHome?.price != null) {
            const openImp = americanToProb(openHome.price);
            const currImp = americanToProb(currHome.price);
            if (openImp && currImp) homeLineMoveSignal = currImp - openImp;
          }
        }

        const homeTeamId = homeComp.team?.id || null;
        const awayTeamId = awayComp.team?.id || null;
        const pred = calcPrediction({
          homeRec, awayRec,
          homeOdds: mlHome, awayOdds: mlAway,
          total, spreadHome,
          sport: game.league, homePitcher, awayPitcher,
          homeInjuries, awayInjuries, h2h,
          homeTeamId, awayTeamId, homeLineMoveSignal
        });

        // Persistimos para el Historial (se ignora si no hay confianza real)
        savePrediction(game, homeComp.team?.displayName || '', awayComp.team?.displayName || '',
          pred, { homeML: mlHome, awayML: mlAway, spreadHome, total },
          homeTeamId, awayTeamId);

        // Recolectamos los picks accionables de este partido para el ranking global
        const oddsObj = { spreadAway, spreadHome, mlAway, mlHome, total };
        const homeFull = homeComp.team?.displayName || homeComp.team?.shortDisplayName || '';
        const awayFull = awayComp.team?.displayName || awayComp.team?.shortDisplayName || '';
        allTopPicks.push(...buildTopPicksForGame(game, pred, oddsObj, homeFull, awayFull));

        // Top jugadores por equipo para props lazy-loaded.
        // NBA: 3 únicos cubriendo anotador/reboteador/asistente.
        // MLB: 2 bateadores top (hits/HR/RBI/AVG) excluyendo pitchers.
        const homeTopScorers = game.league === 'nba' ? extractTeamTopScorers(homeComp, 3) : [];
        const awayTopScorers = game.league === 'nba' ? extractTeamTopScorers(awayComp, 3) : [];
        const homeTopBatters = game.league === 'mlb' ? extractTeamTopBatters(homeComp, 2) : [];
        const awayTopBatters = game.league === 'mlb' ? extractTeamTopBatters(awayComp, 2) : [];

        const weatherSignal = weatherResults[game.id] || null;
        const html = renderPredCard(game, homeComp, awayComp, homeRec, awayRec, oddsObj,
          pred, { homePitcher, awayPitcher, homeInjuries, awayInjuries,
                  homeTopScorers, awayTopScorers,
                  homeTopBatters, awayTopBatters, h2h, weatherSignal, lineupStatus });
        return html ? { html, confidence: pred.confidence, edge: pred.edge } : null;
      }).filter(Boolean);

      // === CLASIFICAR POR CONFIANZA: Best Bets / Safe Picks / No Bet ===
      const bestBets  = cards.filter(c => c.confidence === 'high');
      const safePicks = cards.filter(c => c.confidence === 'medium');
      const noBet     = cards.filter(c => c.confidence === 'low' || c.confidence === 'none' || !c.confidence);

      const buildPicksSection = (cls, emoji, title, subtitle, items, startCollapsed = false) => {
        if (!items.length) return '';
        const collClass = startCollapsed ? 'collapsed' : '';
        return `
          <div class="picks-section ${cls} ${collClass}">
            <div class="picks-section-header" onclick="this.closest('.picks-section').classList.toggle('collapsed')">
              <div class="picks-section-title">
                <span class="section-emoji">${emoji}</span>
                <span>${title}</span>
                <span class="picks-section-count">${items.length} partido${items.length !== 1 ? 's' : ''}</span>
              </div>
              <span class="picks-section-arrow">▾</span>
            </div>
            <div class="picks-section-body">
              ${subtitle ? `<div class="no-bet-notice">${subtitle}</div>` : ''}
              <div class="predictions-grid">${items.map(c => c.html).join('')}</div>
            </div>
          </div>`;
      };

      const bestBetsHTML = buildPicksSection(
        'best-bets', '🏆', 'Best Bets',
        bestBets.length ? '' : '<em>Hoy no hay picks de alta confianza.</em>',
        bestBets
      );
      const safePicksHTML = buildPicksSection(
        'safe-picks', '🛡️', 'Safe Picks',
        '', safePicks
      );
      const noBetHTML = buildPicksSection(
        'no-bet', '⏸️', 'Sin Pick Recomendado',
        `<strong>No apostar.</strong> Estos partidos tienen señales contradictorias o datos insuficientes. Se muestran por transparencia.`,
        noBet, true  // empieza colapsado
      );

      // Ordenamos picks top por score descendente
      allTopPicks.sort((a, b) => b.score - a.score);
      const topPicksPanel = renderTopPicksPanel(allTopPicks, 8);
      const legendPanel = renderPredLegend();

      const picksHTML = bestBetsHTML + safePicksHTML + noBetHTML;
      container.innerHTML = legendPanel + topPicksPanel + picksHTML;
    }


    // =====================================================================
