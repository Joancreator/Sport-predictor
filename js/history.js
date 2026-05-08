// =====================================================================
// HISTORY — guardado, reconciliación y métricas del historial de picks
// =====================================================================

    // HISTORIAL DE PREDICCIONES
    // =====================================================================
    // Guardamos cada predicción cuando se calcula y luego, cuando el partido
    // termina, comparamos contra el resultado real (ESPN scoreboard) para
    // medir honestamente la tasa de acierto del modelo.
    const HISTORY_STORAGE_KEY = 'sp_predictions_history_v1';
    let historyFilter = 'all';
    let historyPeriodFilter = 'all';  // 'all' | '30d' | '7d'

    function loadHistory() {
      try { return JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '{}'); }
      catch { return {}; }
    }

    function saveHistory(h) {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(h));
    }

    function savePrediction(game, homeName, awayName, pred, odds, homeTeamId = null, awayTeamId = null) {
      // Sólo guardamos predicciones con confianza real. Las de "datos
      // insuficientes" no aportan nada al historial y ensucian las stats.
      if (!pred || pred.confidence === 'none' || !pred.pick) return;
      const h = loadHistory();
      const gameDate = (game.date || '').slice(0, 10); // YYYY-MM-DD
      const key = `${game.league}-${game.id}`;
      // Si ya existe y ya está reconciliado, no lo sobreescribimos (preservamos result).
      const existing = h[key];
      if (existing?.result) return;
      h[key] = {
        gameId: String(game.id),
        league: game.league,
        gameDate,
        gameStart: game.date || null,        // ISO completo, lo necesitamos para CLV
        homeName, awayName,
        homeTeamId: homeTeamId ? String(homeTeamId) : null,
        awayTeamId: awayTeamId ? String(awayTeamId) : null,
        pick: pred.pick,                  // 'home' | 'away'
        pickName: pred.pickName,
        confidence: pred.confidence,
        homeEstP: pred.homeEstP,
        edge: pred.edge,
        odds: odds || null,
        // CLV: línea capturada cerca del cierre del partido (se llena luego).
        oddsClose: existing?.oddsClose || null,
        closingCapturedAt: existing?.closingCapturedAt || null,
        // Total y Spread: guardamos el pick para poder reconciliar luego
        totalPick: pred.totalPick  || null,  // 'OVER' | 'UNDER' | null
        totalLine: pred.totalLine  ?? null,
        spreadPick: pred.spreadPick || null, // 'home' | 'away' | null
        spreadHome: pred.spreadHome ?? null, // línea del local (ej. -5.5)
        savedAt: new Date().toISOString(),
        result: existing?.result || null  // se llena en reconcileHistory
      };
      saveHistory(h);
    }

    // Reconciliación: para cada predicción sin resultado y de fecha pasada,
    // pegamos al scoreboard de ese día y, si el partido terminó, marcamos
    // ganador y si la predicción acertó.
    async function reconcileHistory() {
      const h = loadHistory();
      const today = new Date().toISOString().slice(0, 10);
      // Agrupamos pendientes por (liga, fecha) para hacer 1 fetch por día/liga
      // También incluimos entradas que ya tienen resultado ML pero aún no tienen
      // totalCorrect/spreadCorrect (guardadas antes del fix de tracking completo).
      const pending = Object.values(h).filter(e =>
        e.gameDate && e.gameDate <= today &&
        (!e.result || (e.result && (e.totalPick && e.result.totalCorrect === undefined)))
      );
      if (!pending.length) return h;

      const groups = {};
      pending.forEach(e => {
        const k = `${e.league}|${e.gameDate}`;
        (groups[k] = groups[k] || []).push(e);
      });

      await Promise.all(Object.entries(groups).map(async ([k, entries]) => {
        const [league, date] = k.split('|');
        const sportPath = league === 'nba' ? 'basketball/nba' : 'baseball/mlb';
        const dateStr = date.replaceAll('-', ''); // ESPN espera YYYYMMDD
        try {
          const r = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?dates=${dateStr}`
          );
          if (!r.ok) return;
          const d = await r.json();
          const events = d.events || [];
          for (const e of entries) {
            const ev = events.find(ev => String(ev.id) === e.gameId);
            if (!ev) continue;
            const completed = ev.status?.type?.completed;
            if (!completed) continue;
            const comp = ev.competitions?.[0];
            const homeC = comp?.competitors.find(c => c.homeAway === 'home');
            const awayC = comp?.competitors.find(c => c.homeAway === 'away');
            const homeScore = parseInt(homeC?.score) || 0;
            const awayScore = parseInt(awayC?.score) || 0;
            const winner  = homeScore > awayScore ? 'home' : 'away';
            const correct = e.pick === winner;

            // Total: suma real vs línea guardada
            let totalCorrect = null;
            if (e.totalPick && e.totalLine != null) {
              const actual = homeScore + awayScore;
              totalCorrect = e.totalPick === 'OVER' ? actual > e.totalLine : actual < e.totalLine;
            }

            // Spread: margen real vs línea guardada
            // spreadHome negativo = local favorito (ej. -5.5 → local debe ganar por >5.5)
            let spreadCorrect = null;
            if (e.spreadPick && e.spreadHome != null) {
              const margin = homeScore - awayScore;  // positivo = gana local
              const threshold = -e.spreadHome;       // -(-5.5) = 5.5
              spreadCorrect = e.spreadPick === 'home'
                ? margin > threshold
                : margin < threshold;
            }

            h[`${league}-${e.gameId}`].result = {
              homeScore, awayScore, winner, correct,
              totalCorrect, spreadCorrect,
              reconciledAt: new Date().toISOString()
            };
            // Actualizar ELO con el resultado real del partido
            if (e.homeTeamId && e.awayTeamId) {
              const winnerId = winner === 'home' ? e.homeTeamId : e.awayTeamId;
              const loserId  = winner === 'home' ? e.awayTeamId : e.homeTeamId;
              updateElo(winnerId, loserId, league);
            }
          }
        } catch (err) {
          console.warn(`Error reconciliando ${k}:`, err);
        }
      }));

      saveHistory(h);
      return h;
    }

    // ===== CLV (Closing Line Value) =====
    // Idea: si guardas un pick a -110 y al cierre la línea está -130, "ganaste"
    // probabilidad antes de saber el resultado. Tu CLV promedio es el indicador
    // más honesto de si tu modelo realmente bate al mercado a largo plazo.
    function americanToImpliedProb(odds) {
      if (odds == null || isNaN(odds)) return null;
      return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
    }

    // Devuelve el price (cuota americana) del lado del pick (home/away) en el
    // mercado h2h (moneyline) de la estructura `odds` que ya guardas.
    function getMoneylinePriceForSide(odds, side, homeName, awayName) {
      if (!odds?.bookmakers?.length) return null;
      const market = odds.bookmakers[0].markets?.find(m => m.key === 'h2h');
      if (!market) return null;
      const targetName = side === 'home' ? homeName : awayName;
      const outcome = market.outcomes?.find(o => o.name === targetName);
      return outcome?.price ?? null;
    }

    // Calcula CLV (en puntos porcentuales de probabilidad implícita).
    // Positivo = línea cerró peor para tu lado → tu pick fue inteligente.
    function computeCLV(entry) {
      if (!entry?.odds || !entry?.oddsClose || !entry.pick) return null;
      const open  = getMoneylinePriceForSide(entry.odds,      entry.pick, entry.homeName, entry.awayName);
      const close = getMoneylinePriceForSide(entry.oddsClose, entry.pick, entry.homeName, entry.awayName);
      const openP  = americanToImpliedProb(open);
      const closeP = americanToImpliedProb(close);
      if (openP == null || closeP == null) return null;
      // CLV positivo = la prob implícita del cierre es MENOR que la de apertura
      // para tu lado (cuota cerró peor → entraste a mejor número).
      return openP - closeP;
    }

    // Captura línea de cierre para predicciones pendientes. Pega al pickcenter
    // de ESPN del partido. Se considera "cerca del cierre" cuando faltan ≤90
    // min para el inicio o el partido ya empezó pero no terminó.
    async function captureClosingLines() {
      const h = loadHistory();
      const now = Date.now();
      const targets = Object.values(h).filter(e => {
        if (e.oddsClose) return false;             // ya capturado
        if (e.result)   return false;              // ya terminó (lo intentamos abajo)
        if (!e.gameStart) return false;
        const startMs = new Date(e.gameStart).getTime();
        if (isNaN(startMs)) return false;
        const minsToStart = (startMs - now) / 60000;
        // Captura desde 90 min antes hasta 4 horas después del inicio (ventana segura)
        return minsToStart <= 90 && minsToStart >= -240;
      });
      if (!targets.length) return h;

      await Promise.all(targets.map(async e => {
        const sportPath = e.league === 'nba' ? 'basketball/nba' : 'baseball/mlb';
        try {
          const r = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/summary?event=${e.gameId}`
          );
          if (!r.ok) return;
          const d = await r.json();
          const shaped = mapPickcenterToOddsShape(d.pickcenter, e.homeName, e.awayName);
          if (!shaped) return;
          const key = `${e.league}-${e.gameId}`;
          if (h[key]) {
            h[key].oddsClose = shaped;
            h[key].closingCapturedAt = new Date().toISOString();
          }
        } catch (err) {
          console.warn(`Error capturando cierre ${e.gameId}:`, err);
        }
      }));

      saveHistory(h);
      return h;
    }

    function filterHistory(filter, btn) {
      historyFilter = filter;
      document.querySelectorAll('.history-filter-tab:not(.history-period-tab)').forEach(b => b.classList.remove('active'));
      btn?.classList.add('active');
      renderHistoryTable(applyPeriodFilter(loadHistory()));
    }

    function filterHistoryPeriod(period, btn) {
      historyPeriodFilter = period;
      document.querySelectorAll('.history-period-tab').forEach(b => b.classList.remove('active'));
      btn?.classList.add('active');
      const h = loadHistory();
      renderHistoryStats(applyPeriodFilter(h));
      renderHistoryTable(applyPeriodFilter(h));
    }

    // Filtra el objeto historial según el período seleccionado
    function applyPeriodFilter(h) {
      if (historyPeriodFilter === 'all') return h;
      const now = new Date();
      const days = historyPeriodFilter === '7d' ? 7 : 30;
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const filtered = {};
      for (const [key, entry] of Object.entries(h)) {
        if ((entry.gameDate || '') >= cutoff) filtered[key] = entry;
      }
      return filtered;
    }

    async function reconcileHistoryAndRender() {
      const btn = document.querySelector('.history-refresh-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Actualizando...'; }
      // Capturamos cierres antes de reconciliar para que el CLV quede congelado
      // tan cerca como sea posible del momento del partido.
      await captureClosingLines();
      const h = await reconcileHistory();
      const hFiltered = applyPeriodFilter(h);
      renderHistoryStats(hFiltered);
      renderHistoryTable(hFiltered);
      if (btn) { btn.disabled = false; btn.textContent = '↻ Actualizar resultados'; }
    }

    function renderHistoryStats(h) {
      const all = Object.values(h);
      const completed = all.filter(e => e.result);
      const correct   = completed.filter(e => e.result.correct).length;
      const wrong     = completed.length - correct;
      const pending   = all.length - completed.length;
      const accuracy  = completed.length ? Math.round(correct / completed.length * 100) : null;
      const accColor  = accuracy == null ? 'var(--text-primary)'
        : accuracy >= 60 ? 'var(--accent-green)'
        : accuracy >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)';

      // CLV promedio: solo cuenta picks con apertura Y cierre capturados.
      // Es el indicador más honesto de si tu modelo bate al mercado.
      const withClv  = all.map(e => ({ e, clv: computeCLV(e) })).filter(x => x.clv != null);
      const clvAvg   = withClv.length
        ? withClv.reduce((s, x) => s + x.clv, 0) / withClv.length
        : null;
      const clvColor = clvAvg == null ? 'var(--text-primary)'
        : clvAvg > 0.005 ? 'var(--accent-green)'
        : clvAvg < -0.005 ? 'var(--accent-red)' : 'var(--accent-yellow)';
      const clvStr   = clvAvg == null ? '—'
        : `${clvAvg >= 0 ? '+' : ''}${(clvAvg * 100).toFixed(1)}%`;

      // Desglose por nivel de confianza
      const confStats = (level) => {
        const group = completed.filter(e => e.confidence === level);
        const w = group.filter(e => e.result.correct).length;
        const l = group.length - w;
        const pct = group.length ? Math.round(w / group.length * 100) : null;
        return { w, l, total: group.length, pct };
      };
      const high = confStats('high');
      const med  = confStats('medium');
      const low  = confStats('low');

      const confCard = (label, s, color) => `
        <div class="history-conf-card">
          <div class="history-conf-label" style="color:${color}">${label}</div>
          ${s.total === 0
            ? `<div class="history-conf-empty">Sin datos</div>`
            : `<div class="history-conf-record">${s.w}-${s.l}</div>
               <div class="history-conf-pct" style="color:${color}">${s.pct}%</div>`}
        </div>`;

      // Desglose por tipo de apuesta (ML / Total / Spread)
      const betStats = (field) => {
        const group = completed.filter(e => e.result[field] != null);
        const w = group.filter(e => e.result[field] === true).length;
        const l = group.length - w;
        const pct = group.length ? Math.round(w / group.length * 100) : null;
        return { w, l, total: group.length, pct };
      };
      const mlSt     = { w: correct, l: wrong, total: completed.length,
                         pct: accuracy };
      const totalSt  = betStats('totalCorrect');
      const spreadSt = betStats('spreadCorrect');

      const betColor = pct => pct == null ? 'var(--text-muted)'
        : pct >= 60 ? 'var(--accent-green)'
        : pct >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)';

      // ===== RACHA ACTUAL =====
      const sortedCompleted = [...completed].sort((a, b) =>
        (b.gameDate || '').localeCompare(a.gameDate || ''));
      let streak = 0, streakType = null;
      for (const e of sortedCompleted) {
        const res = e.result?.correct;
        if (res == null) continue;
        if (streakType === null) { streakType = res; streak = 1; }
        else if (res === streakType) streak++;
        else break;
      }
      const streakLabel = streak === 0 ? '—'
        : streakType ? `${streak}G` : `${streak}F`;
      const streakColor = streak === 0 ? 'var(--text-muted)'
        : streakType ? 'var(--accent-green)' : 'var(--accent-red)';

      // ===== CALIBRACIÓN POR EDGE Y DEPORTE =====
      // ROI corregido: usa las cuotas reales guardadas en cada pick (no asume -110).
      // Simula apostar 1 unidad por pick y calcula ganancia/pérdida neta en unidades.
      const roiCalcReal = (group) => {
        if (!group.length) return null;
        let units = 0;
        for (const e of group) {
          // Buscar las cuotas del lado del pick (moneyline)
          const mlOdds = e.pick === 'home'
            ? (e.odds?.homeML ?? e.odds?.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')
                ?.outcomes?.find(o => teamLastWord(o.name) === teamLastWord(e.homeName))?.price)
            : (e.odds?.awayML ?? e.odds?.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h')
                ?.outcomes?.find(o => teamLastWord(o.name) === teamLastWord(e.awayName))?.price);
          const payout = calcBetPayout(mlOdds);
          units += e.result?.correct ? payout : -1;
        }
        return units.toFixed(2);
      };
      // Versión simplificada para grupos con buckets de edge (sin acceso a odds individuales)
      const roiCalc = (wins, total) => {
        if (!total) return null;
        return (wins * 0.9091 - (total - wins)).toFixed(2);
      };
      const accBar = (pct, total) => {
        if (!total) return '';
        const w = Math.max(4, Math.round(pct * 0.7));  // max 70px visual
        const color = pct >= 60 ? 'var(--accent-green)' : pct >= 52 ? 'var(--accent-yellow)' : 'var(--accent-red)';
        return `<span class="calib-acc-bar" style="width:${w}px;background:${color}"></span>`;
      };
      const verdictLabel = (pct, total) => {
        if (!total || total < 5) return `<span class="calib-no-data">pocos datos</span>`;
        if (pct >= 60) return `<span class="calib-verdict-good">Muy bueno</span>`;
        if (pct >= 55) return `<span class="calib-verdict-good">Bueno</span>`;
        if (pct >= 52) return `<span class="calib-verdict-warn">Aceptable</span>`;
        if (pct >= 48) return `<span class="calib-verdict-warn">Moneda al aire</span>`;
        return `<span class="calib-verdict-bad">Bajo el azar</span>`;
      };
      const edgeBuckets = [
        { label: 'Edge ≥ 7%',  filter: e => e.edge != null && e.edge >= 0.07,              hint: 'Señal más fuerte' },
        { label: 'Edge 3–7%',  filter: e => e.edge != null && e.edge >= 0.03 && e.edge < 0.07, hint: 'Señal moderada' },
        { label: 'Edge 0–3%',  filter: e => e.edge != null && e.edge >= 0    && e.edge < 0.03, hint: 'Señal débil' },
        { label: 'Edge < 0%',  filter: e => e.edge != null && e.edge < 0,                   hint: 'Modelo desfavorable' },
        { label: 'Sin odds',   filter: e => e.edge == null,                                  hint: 'Sin línea disponible' },
      ];
      const edgeRows = edgeBuckets.map(b => {
        const group  = completed.filter(b.filter);
        const wins   = group.filter(e => e.result.correct).length;
        const total  = group.length;
        const pct    = total ? Math.round(wins / total * 100) : null;
        const roi    = roiCalc(wins, total);
        const roiStr = roi == null ? '—'
          : `<span class="${+roi >= 0 ? 'calib-roi-pos' : 'calib-roi-neg'}">${+roi >= 0 ? '+' : ''}${roi}u</span>`;
        return `<tr>
          <td><strong>${b.label}</strong> <span style="color:var(--text-muted);font-size:0.72rem">${b.hint}</span></td>
          <td style="color:var(--text-muted)">${total}</td>
          <td>${pct == null ? '—' : `${accBar(pct, total)}${pct}%`}</td>
          <td>${verdictLabel(pct, total)}</td>
          <td>${roiStr}</td>
        </tr>`;
      }).join('');

      // Desglose por deporte
      const sportStats = (league) => {
        const g = completed.filter(e => e.league === league);
        const w = g.filter(e => e.result.correct).length;
        const t = g.length;
        const p = t ? Math.round(w / t * 100) : null;
        return { w, t, p, roi: roiCalc(w, t) };
      };
      const nbaS = sportStats('nba');
      const mlbS = sportStats('mlb');
      const sportRows = [
        { label: 'NBA', ...nbaS, color: 'var(--nba-color)' },
        { label: 'MLB', ...mlbS, color: 'var(--accent-blue)' },
      ].map(s => {
        const roiStr = s.roi == null ? '—'
          : `<span class="${+s.roi >= 0 ? 'calib-roi-pos' : 'calib-roi-neg'}">${+s.roi >= 0 ? '+' : ''}${s.roi}u</span>`;
        return `<tr>
          <td><strong style="color:${s.color}">${s.label}</strong></td>
          <td style="color:var(--text-muted)">${s.t}</td>
          <td>${s.p == null ? '—' : `${accBar(s.p, s.t)}${s.p}%`}</td>
          <td>${verdictLabel(s.p, s.t)}</td>
          <td>${roiStr}</td>
        </tr>`;
      }).join('');

      // ROI real usando odds guardadas
      const realRoiVal = roiCalcReal(completed);
      const realRoiColor = realRoiVal == null ? 'var(--text-primary)'
        : parseFloat(realRoiVal) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
      const realRoiStr = realRoiVal == null ? '—'
        : `${parseFloat(realRoiVal) >= 0 ? '+' : ''}${realRoiVal}u`;

      document.getElementById('historyStats').innerHTML = `
        <div class="history-stat-card">
          <div class="history-stat-num">${all.length}</div>
          <div class="history-stat-label">Predicciones</div>
        </div>
        <div class="history-stat-card">
          <div class="history-stat-num" style="color: var(--accent-green)">${correct}</div>
          <div class="history-stat-label">Aciertos</div>
        </div>
        <div class="history-stat-card">
          <div class="history-stat-num" style="color: var(--accent-red)">${wrong}</div>
          <div class="history-stat-label">Fallos</div>
        </div>
        <div class="history-stat-card">
          <div class="history-stat-num" style="color: var(--accent-yellow)">${pending}</div>
          <div class="history-stat-label">Pendientes</div>
        </div>
        <div class="history-stat-card">
          <div class="history-stat-num" style="color: ${accColor}">${accuracy == null ? '—' : accuracy + '%'}</div>
          <div class="history-stat-label">Acierto ML</div>
        </div>
        <div class="history-stat-card" title="ROI real calculado con las cuotas exactas guardadas. 1 unidad = 1 apuesta estándar.">
          <div class="history-stat-num" style="color: ${realRoiColor}">${realRoiStr}</div>
          <div class="history-stat-label">ROI (unidades)</div>
          <div class="history-stat-sub">cuotas reales</div>
        </div>
        <div class="history-stat-card" title="Racha actual de resultados consecutivos">
          <div class="history-stat-num" style="color: ${streakColor}">${streakLabel}</div>
          <div class="history-stat-label">Racha</div>
          <div class="history-stat-sub">${streak === 0 ? 'sin datos' : streakType ? 'victorias' : 'derrotas'}</div>
        </div>
        <div class="history-stat-card" title="Closing Line Value: diferencia promedio entre la probabilidad implícita al guardar el pick y al cierre del partido. Positivo = bates al mercado.">
          <div class="history-stat-num" style="color: ${clvColor}">${clvStr}</div>
          <div class="history-stat-label">CLV promedio</div>
          <div class="history-stat-sub">${withClv.length} pick${withClv.length === 1 ? '' : 's'}</div>
        </div>

        ${completed.length >= 3 ? `
        <div class="history-conf-section" style="width:100%">
          <div class="history-conf-title">Curva de rentabilidad (unidades acumuladas)</div>
          <div style="position:relative;height:120px;margin-top:8px">
            <canvas id="pnlChart" style="width:100%;height:120px"></canvas>
          </div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px">
            <span style="color:var(--accent-green)">—</span> Todos los picks &nbsp;
            <span style="color:var(--accent-yellow)">—</span> Solo picks Alta confianza
          </div>
        </div>` : ''}

        <div class="history-conf-section">
          <div class="history-conf-title">Acierto por nivel de confianza</div>
          <div class="history-conf-grid">
            ${confCard('Alta', high, 'var(--accent-green)')}
            ${confCard('Media', med,  'var(--accent-yellow)')}
            ${confCard('Baja',  low,  'var(--accent-red)')}
          </div>
        </div>
        <div class="history-conf-section">
          <div class="history-conf-title">Acierto por tipo de apuesta</div>
          <div class="history-conf-grid">
            <div class="history-conf-card">
              <div class="history-conf-label" style="color:var(--text-secondary)">Moneyline</div>
              ${mlSt.total === 0
                ? `<div class="history-conf-empty">Sin datos</div>`
                : `<div class="history-conf-record">${mlSt.w}-${mlSt.l}</div>
                   <div class="history-conf-pct" style="color:${betColor(mlSt.pct)}">${mlSt.pct}%</div>`}
            </div>
            <div class="history-conf-card">
              <div class="history-conf-label" style="color:var(--text-secondary)">Total O/U</div>
              ${totalSt.total === 0
                ? `<div class="history-conf-empty">Sin datos aún</div>`
                : `<div class="history-conf-record">${totalSt.w}-${totalSt.l}</div>
                   <div class="history-conf-pct" style="color:${betColor(totalSt.pct)}">${totalSt.pct}%</div>`}
            </div>
            <div class="history-conf-card">
              <div class="history-conf-label" style="color:var(--text-secondary)">Spread</div>
              ${spreadSt.total === 0
                ? `<div class="history-conf-empty">Sin datos aún</div>`
                : `<div class="history-conf-record">${spreadSt.w}-${spreadSt.l}</div>
                   <div class="history-conf-pct" style="color:${betColor(spreadSt.pct)}">${spreadSt.pct}%</div>`}
            </div>
          </div>
        </div>

        ${completed.length >= 5 ? `
        <div class="history-conf-section">
          <div class="history-conf-title">Análisis de rendimiento</div>
          <div class="calib-title" style="margin-bottom:8px">Por ventaja del modelo</div>
          <table class="calib-table">
            <thead><tr><th>Ventaja detectada</th><th>Picks</th><th>Acierto</th><th>Resultado</th><th>ROI (u.)</th></tr></thead>
            <tbody>${edgeRows}</tbody>
          </table>
          <div class="calib-title" style="margin-top:18px;margin-bottom:8px">Por liga</div>
          <table class="calib-table">
            <thead><tr><th>Liga</th><th>Picks</th><th>Acierto</th><th>Resultado</th><th>ROI (u.)</th></tr></thead>
            <tbody>${sportRows}</tbody>
          </table>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:8px">
            ROI en unidades (1u = 1 apuesta). Edge calculado vs odds implícitas al guardar el pick.
          </div>
        </div>
        ` : `
        <div class="history-conf-section" style="color:var(--text-muted);font-size:0.82rem">
          El análisis de rendimiento aparecerá cuando haya al menos 5 predicciones con resultado.
          Visita Predicciones para que el modelo empiece a registrar picks.
        </div>
        `}

        ${completed.length >= 3 ? `<div id="pnlChartInitScript"></div>` : ''}
      `;

      // Renderizar gráfica P&L si hay suficientes datos
      if (completed.length >= 3) {
        requestAnimationFrame(() => {
          const canvas = document.getElementById('pnlChart');
          if (!canvas) return;
          // Ordenar por fecha ascendente para la curva
          const chronological = [...completed].sort((a, b) =>
            (a.gameDate || '').localeCompare(b.gameDate || ''));
          const labels = [], allUnits = [], highUnits = [];
          let cumAll = 0, cumHigh = 0;
          for (const e of chronological) {
            const mlOdds = e.pick === 'home'
              ? (e.odds?.homeML ?? e.odds?.bookmakers?.[0]?.markets
                  ?.find(m => m.key === 'h2h')?.outcomes
                  ?.find(o => teamLastWord(o.name) === teamLastWord(e.homeName))?.price)
              : (e.odds?.awayML ?? e.odds?.bookmakers?.[0]?.markets
                  ?.find(m => m.key === 'h2h')?.outcomes
                  ?.find(o => teamLastWord(o.name) === teamLastWord(e.awayName))?.price);
            const payout = calcBetPayout(mlOdds);
            const profit = e.result?.correct ? payout : -1;
            cumAll += profit;
            labels.push(e.gameDate?.slice(5) || '');
            allUnits.push(parseFloat(cumAll.toFixed(2)));
            if (e.confidence === 'high') { cumHigh += profit; }
            highUnits.push(parseFloat(cumHigh.toFixed(2)));
          }
          if (window._pnlChart) { window._pnlChart.destroy(); }
          window._pnlChart = new Chart(canvas, {
            type: 'line',
            data: {
              labels,
              datasets: [
                {
                  label: 'Todos los picks',
                  data: allUnits,
                  borderColor: '#00d084',
                  backgroundColor: 'rgba(0,208,132,0.08)',
                  borderWidth: 2,
                  pointRadius: 2,
                  tension: 0.3,
                  fill: true
                },
                {
                  label: 'Solo Alta confianza',
                  data: highUnits,
                  borderColor: '#ffd700',
                  backgroundColor: 'transparent',
                  borderWidth: 1.5,
                  pointRadius: 0,
                  borderDash: [4, 3],
                  tension: 0.3
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: '#606060', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                y: { ticks: { color: '#606060', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' },
                     zero: true }
              }
            }
          });
        });
      }
    }

    function renderHistoryTable(h) {
      const all = Object.values(h);
      let filtered = all;
      if (historyFilter === 'nba')      filtered = all.filter(e => e.league === 'nba');
      else if (historyFilter === 'mlb') filtered = all.filter(e => e.league === 'mlb');
      else if (historyFilter === 'correct') filtered = all.filter(e => e.result?.correct === true);
      else if (historyFilter === 'wrong')   filtered = all.filter(e => e.result?.correct === false);
      else if (historyFilter === 'pending') filtered = all.filter(e => !e.result);

      // Más reciente primero
      filtered.sort((a, b) => (b.gameDate || '').localeCompare(a.gameDate || ''));

      const cont = document.getElementById('historyTableContainer');
      if (!filtered.length) {
        cont.innerHTML = `
          <div class="history-empty">
            <p>No hay predicciones en este filtro.</p>
            <p style="font-size:0.8rem; margin-top:8px;">Visita la sección Predicciones para que el modelo guarde sus pronósticos.</p>
          </div>`;
        return;
      }

      const fmtConf = c => c === 'high' ? 'Alta' : c === 'medium' ? 'Media' : c === 'low' ? 'Baja' : '—';
      const mkBadge = (label, correct) => {
        if (correct == null) return '';
        const cls = correct ? 'correct' : 'wrong';
        const icon = correct ? '✓' : '✗';
        return `<span class="hist-pick-badge ${cls}">${icon} ${label}</span>`;
      };
      const rows = filtered.map(e => {
        let status = '<span class="history-status-badge history-status-pending">⏳ Pendiente</span>';
        let resultStr = '—';
        let extraBadges = '';
        if (e.result) {
          resultStr = `${e.result.awayScore} — ${e.result.homeScore}`;
          status = e.result.correct
            ? '<span class="history-status-badge history-status-correct">✓ ML</span>'
            : '<span class="history-status-badge history-status-wrong">✗ ML</span>';
          const tb = mkBadge('Total',  e.result.totalCorrect);
          const sb = mkBadge('Spread', e.result.spreadCorrect);
          if (tb || sb) extraBadges = `<div class="hist-pick-badges">${tb}${sb}</div>`;
        }
        const edgeStr = e.edge != null ? `${e.edge > 0 ? '+' : ''}${Math.round(e.edge * 100)}%` : '—';
        // CLV: solo se muestra cuando ya tenemos línea de cierre capturada.
        const clv = computeCLV(e);
        const clvStr = clv == null
          ? '<span style="color:var(--text-muted)">—</span>'
          : `<span style="color:${clv > 0.005 ? 'var(--accent-green)' : clv < -0.005 ? 'var(--accent-red)' : 'var(--accent-yellow)'};font-weight:600">${clv >= 0 ? '+' : ''}${(clv * 100).toFixed(1)}%</span>`;
        return `
          <tr>
            <td>${e.gameDate}</td>
            <td><span style="color:${e.league==='nba'?'var(--nba-color)':'var(--accent-blue)'}; font-weight:600;">${e.league.toUpperCase()}</span></td>
            <td>${e.awayName} @ ${e.homeName}</td>
            <td><strong>${e.pickName}</strong></td>
            <td>${fmtConf(e.confidence)}</td>
            <td>${edgeStr}</td>
            <td>${clvStr}</td>
            <td>${resultStr}</td>
            <td>${status}${extraBadges}</td>
          </tr>`;
      }).join('');

      cont.innerHTML = `
        <table class="history-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Liga</th>
              <th>Partido</th>
              <th>Pick</th>
              <th>Confianza</th>
              <th>Edge</th>
              <th title="Closing Line Value: cambio en probabilidad implícita entre apertura y cierre. Positivo = mejor línea que el cierre.">CLV</th>
              <th>Resultado</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    async function initHistory() {
      historyFilter = 'all';
      // Rellenar el input de bankroll con el valor guardado
      const brInput = document.getElementById('bankrollInput');
      if (brInput && userBankroll > 0) brInput.value = userBankroll;
      const h = loadHistory();
      const hFiltered = applyPeriodFilter(h);
      renderHistoryStats(hFiltered);
      renderHistoryTable(hFiltered);
      // En segundo plano: capturamos cierres de líneas (para CLV) y reconciliamos.
      await captureClosingLines();
      const updated = await reconcileHistory();
      const updatedFiltered = applyPeriodFilter(updated);
      renderHistoryStats(updatedFiltered);
      renderHistoryTable(updatedFiltered);
    }


    // =====================================================================
