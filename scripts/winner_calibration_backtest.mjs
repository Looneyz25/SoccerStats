// Offline backtest for winner home/away recalibration (read-only).
// Recomputes the winner pipeline from stored predictions.factors under candidate
// home/away lambda deltas + shrink priors and measures calibration vs actuals
// across all settled matches. Use to re-tune HOME_LAMBDA_ADV / AWAY_LAMBDA_ADJ
// in scripts/soccer_routine.py. Run: node scripts/winner_calibration_backtest.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(`${ROOT}/match_data.json`, 'utf8'));
const cal = JSON.parse(fs.readFileSync(`${ROOT}/docs/agent-system/outputs/model_calibration.json`, 'utf8'));

// --- replicate constants (stored lambdas already bake in the home/away adj) ---
const WINNER_BLEND = 0.40;

function calibrationTrust(league) {
  let trust = 1.0;
  const m = (cal.market_adjustments || {}).winner;
  if (m) trust *= Number(m.trust_factor || 1.0);
  const lm = (cal.league_market_adjustments || {})[`${league}|winner`];
  if (lm) trust *= Number(lm.trust_factor || 1.0);
  return Math.max(0.65, Math.min(1.0, trust));
}
const norm3 = (h, d, a) => { const t = h + d + a; return t > 0 ? [h / t, d / t, a / t] : [1 / 3, 1 / 3, 1 / 3]; };
const pmf = (k, l) => Math.exp(-l) * Math.pow(l, k) / fact(k);
function fact(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }

function rawWinner(lh, la, rho) {
  const grid = [];
  for (let i = 0; i < 7; i++) { grid[i] = []; for (let j = 0; j < 7; j++) grid[i][j] = pmf(i, lh) * pmf(j, la); }
  grid[0][0] *= (1 - lh * la * rho);
  grid[1][0] *= (1 + la * rho);
  grid[0][1] *= (1 + lh * rho);
  grid[1][1] *= (1 - rho);
  let tot = 0; for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) tot += grid[i][j];
  if (tot > 0) for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) grid[i][j] /= tot;
  let ph = 0, pd = 0, pa = 0;
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
    if (i > j) ph += grid[i][j]; else if (i === j) pd += grid[i][j]; else pa += grid[i][j];
  }
  return norm3(ph, pd, pa);
}

function shrink(p, trust, neutral) { return neutral + (p - neutral) * trust; }

// Collect settled matches with factors
const rows = [];
for (const L of data.leagues || []) {
  for (const x of L.matches || []) {
    if (x.status !== 'FT' && x.status !== 'resulted') continue;
    if (x.home?.goals == null || x.away?.goals == null) continue;
    const f = x.predictions?.factors, w = x.predictions?.winner;
    if (!f || !Number.isFinite(f.lambda_home)) continue;
    const outcome = x.home.goals > x.away.goals ? 'h' : (x.away.goals > x.home.goals ? 'a' : 'd');
    rows.push({
      league: L.name, lh: f.lambda_home, la: f.lambda_away,
      rho: Number.isFinite(f.dixon_coles_rho) ? f.dixon_coles_rho : -0.10,
      blendW: Number.isFinite(f.winner_bookmaker_blend) ? f.winner_bookmaker_blend : WINNER_BLEND,
      book: w?.bookmaker_probabilities || null,
      storedFinal: w?.probabilities || null,
      storedTrust: w?.calibration?.trust_factor,
      outcome,
    });
  }
}

function run({ dH = 0, dA = 0, neutral = 'uniform', trustOverride = null } = {}) {
  const PRIOR = neutral === 'uniform' ? [1 / 3, 1 / 3, 1 / 3] : neutral; // [h,d,a]
  let n = 0, ph = 0, pd = 0, pa = 0, ah = 0, ad = 0, aa = 0, ll = 0, correct = 0;
  let reproErr = 0, reproN = 0;
  for (const r of rows) {
    const lh = Math.max(0.20, r.lh + dH), la = Math.max(0.20, r.la + dA);
    let [rh, rd, ra] = rawWinner(lh, la, r.rho);
    const trust = trustOverride != null ? trustOverride
      : (Number.isFinite(r.storedTrust) ? r.storedTrust : calibrationTrust(r.league));
    let mh = shrink(rh, trust, PRIOR[0]), md = shrink(rd, trust, PRIOR[1]), ma = shrink(ra, trust, PRIOR[2]);
    [mh, md, ma] = norm3(mh, md, ma);
    let fh = mh, fd = md, fa = ma;
    if (r.book) {
      fh = mh * (1 - r.blendW) + r.book.home * r.blendW;
      fd = md * (1 - r.blendW) + r.book.draw * r.blendW;
      fa = ma * (1 - r.blendW) + r.book.away * r.blendW;
      [fh, fd, fa] = norm3(fh, fd, fa);
    }
    // reproduction check (baseline params only)
    if (dH === 0 && dA === 0 && neutral === 'uniform' && r.storedFinal && Number.isFinite(r.storedFinal.home)) {
      reproErr += Math.abs(fh - r.storedFinal.home) + Math.abs(fd - r.storedFinal.draw) + Math.abs(fa - r.storedFinal.away);
      reproN++;
    }
    n++; ph += fh; pd += fd; pa += fa;
    ah += r.outcome === 'h' ? 1 : 0; ad += r.outcome === 'd' ? 1 : 0; aa += r.outcome === 'a' ? 1 : 0;
    const pc = r.outcome === 'h' ? fh : (r.outcome === 'd' ? fd : fa);
    ll += -Math.log(Math.max(1e-9, pc));
    // raw argmax (not the production choose_winner_side draw-rule) — fine for relative comparison
    const pick = fh >= fd && fh >= fa ? 'h' : (fa >= fd ? 'a' : 'd');
    if (pick === r.outcome) correct++;
  }
  return {
    n, predH: ph / n, predD: pd / n, predA: pa / n, actH: ah / n, actD: ad / n, actA: aa / n,
    gapH: (ph - ah) / n, gapD: (pd - ad) / n, gapA: (pa - aa) / n,
    logloss: ll / n, pickAcc: correct / n,
    reproMAE: reproN ? reproErr / reproN / 3 : null,
  };
}

const pct = v => (v * 100).toFixed(1) + '%';
const sp = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1);
function show(label, p) {
  console.log(`${label}`);
  console.log(`  H ${pct(p.predH)}/${pct(p.actH)} (${sp(p.gapH)})  D ${pct(p.predD)}/${pct(p.actD)} (${sp(p.gapD)})  A ${pct(p.predA)}/${pct(p.actA)} (${sp(p.gapA)})  | logloss ${p.logloss.toFixed(4)} pickAcc ${pct(p.pickAcc)}`);
}

const base = run();
console.log(`rows=${base.n}  reproduction MAE vs stored final = ${(base.reproMAE * 100).toFixed(3)} pts/side\n`);
show('BASELINE (dH=0,dA=0,uniform)', base);
console.log('\n--- home-advantage sweep (symmetric dH=+x, dA=-x) ---');
for (const x of [0.05, 0.10, 0.13, 0.15, 0.18, 0.20, 0.25]) show(`dH=+${x}, dA=-${x}`, run({ dH: x, dA: -x }));
console.log('\n--- empirical prior shrink (neutral=[.45,.27,.28]) ---');
show('prior only (dH=0)', run({ neutral: [0.45, 0.27, 0.28] }));
for (const x of [0.08, 0.10, 0.13, 0.15]) show(`prior + dH=+${x}/dA=-${x}`, run({ dH: x, dA: -x, neutral: [0.45, 0.27, 0.28] }));

console.log('\n--- ROBUSTNESS: chosen dH=+0.10/dA=-0.10 at low trust (auto-learner floor 0.85) ---');
const PR = [0.45, 0.27, 0.28];
show('trust=0.92 uniform', run({ dH: 0.10, dA: -0.10, trustOverride: 0.92 }));
show('trust=0.85 uniform', run({ dH: 0.10, dA: -0.10, trustOverride: 0.85 }));
show('trust=0.85 PRIOR  ', run({ dH: 0.10, dA: -0.10, neutral: PR, trustOverride: 0.85 }));
show('trust=0.70 uniform', run({ dH: 0.10, dA: -0.10, trustOverride: 0.70 }));
show('trust=0.70 PRIOR  ', run({ dH: 0.10, dA: -0.10, neutral: PR, trustOverride: 0.70 }));
