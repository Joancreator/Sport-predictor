// =====================================================================
// PARLAY BUILDER — bandeja flotante para construir parlays multi-pick
// =====================================================================
// Estado: parlaySlips[] — array de picks añadidos.
// Cada slip: { id, label, odds, pick, league, homeEstP }
// =====================================================================

let parlaySlips = [];
let parlayTrayOpen = false;

// Convierte moneyline americano a decimal (para multiplicar probabilidades)
function americanToDecimal(ml) {
  if (ml == null) return null;
  return ml > 0 ? (ml / 100 + 1) : (100 / Math.abs(ml) + 1);
}

// Convierte probabilidad decimal combinada de vuelta a moneyline americano
function combinedProbToAmerican(prob) {
  if (prob <= 0 || prob >= 1) return null;
  const dec = 1 / prob;
  // Convertir decimal a americano (casa: incluye -110 vig implícito)
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

// Añade o quita un pick del parlay
function toggleParlayPick(id, label, odds, pick, league, homeEstP) {
  const idx = parlaySlips.findIndex(s => s.id === id);
  if (idx >= 0) {
    parlaySlips.splice(idx, 1);
  } else {
    if (parlaySlips.length >= 8) {
      alert('Máximo 8 picks en un parlay.');
      return;
    }
    parlaySlips.push({ id, label, odds, pick, league, homeEstP });
  }
  renderParlayTray();
  updateParlayButtons();
}

// Actualiza el estado visual (in-parlay) de todos los botones "+"
function updateParlayButtons() {
  document.querySelectorAll('.parlay-add-btn').forEach(btn => {
    const inParlay = parlaySlips.some(s => s.id === btn.dataset.parlayId);
    btn.classList.toggle('in-parlay', inParlay);
    btn.textContent = inParlay ? '✓ En parlay' : '+ Parlay';
  });
}

function clearParlay() {
  parlaySlips = [];
  renderParlayTray();
  updateParlayButtons();
}

function toggleParlayTray() {
  parlayTrayOpen = !parlayTrayOpen;
  const body = document.getElementById('parlayTrayBody');
  const chevron = document.getElementById('parlayChevron');
  if (body) body.style.display = parlayTrayOpen ? 'flex' : 'none';
  if (chevron) chevron.textContent = parlayTrayOpen ? '▲' : '▼';
}

function renderParlayTray() {
  const tray = document.getElementById('parlayTray');
  const countEl = document.getElementById('parlayCount');
  const bodyEl = document.getElementById('parlayTrayBody');
  if (!tray || !bodyEl) return;

  const n = parlaySlips.length;
  if (countEl) countEl.textContent = n;

  if (n === 0) {
    tray.classList.add('hidden');
    parlayTrayOpen = false;
    return;
  }

  tray.classList.remove('hidden');
  if (!parlayTrayOpen) {
    bodyEl.style.display = 'none';
  }

  // Calcular probabilidad combinada y payout
  let combinedProb = 1;
  let allHaveOdds = true;
  for (const slip of parlaySlips) {
    const dec = americanToDecimal(slip.odds);
    if (dec == null) { allHaveOdds = false; break; }
    combinedProb *= (1 / dec); // probabilidad implícita de cada leg
  }

  // Detectar picks contradictorios (mismo partido, lados opuestos)
  const ids = parlaySlips.map(s => s.id.replace(/-home$|-away$/, ''));
  const hasDupe = ids.length !== new Set(ids).size;

  const payoutMultiplier = allHaveOdds
    ? parlaySlips.reduce((acc, s) => acc * (americanToDecimal(s.odds) || 1), 1)
    : null;

  const combinedML = allHaveOdds ? combinedProbToAmerican(combinedProb) : null;
  const combinedStr = combinedML == null ? '—'
    : combinedML > 0 ? `+${combinedML}` : `${combinedML}`;

  const payoutStr = payoutMultiplier == null ? '—'
    : `${payoutMultiplier.toFixed(2)}x`;

  const legs = parlaySlips.map(slip => `
    <div class="parlay-leg">
      <div class="parlay-leg-text">${slip.label}</div>
      ${slip.odds != null ? `<div class="parlay-leg-odds">${slip.odds > 0 ? '+' : ''}${slip.odds}</div>` : ''}
      <button class="parlay-leg-remove"
        onclick="toggleParlayPick('${slip.id}','${slip.label.replace(/'/g,"\\'")}',${slip.odds},'${slip.pick}','${slip.league}',${slip.homeEstP})"
        title="Quitar del parlay">×</button>
    </div>
  `).join('');

  const summary = `
    <div class="parlay-summary">
      <div class="parlay-summary-item">Legs: <strong>${n}</strong></div>
      ${allHaveOdds ? `<div class="parlay-summary-item">Cuota combinada: <strong>${combinedStr}</strong></div>` : ''}
      ${payoutMultiplier != null ? `<div class="parlay-summary-item">Payout por $100: <strong>$${(payoutMultiplier * 100).toFixed(0)}</strong></div>` : ''}
      ${hasDupe ? `<div class="parlay-warning">⚠ Picks contradictorios detectados</div>` : ''}
      ${n > 4 ? `<div class="parlay-warning">⚠ Parlays de ${n}+ legs son muy difíciles de acertar</div>` : ''}
    </div>
  `;

  bodyEl.innerHTML = legs + summary;
}
