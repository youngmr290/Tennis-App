/* 
==========================================================
🎾 SUNDAY TENNIS ROTATION APP — CORE LOGIC
==========================================================

High level:

1) Sit-out fairness (top priority)
   - Fewest sits
   - Avoid back-to-back sits
   - Happy-to-sit preferred (at equal fairness)
   - More games → more likely to sit
   - If fairness is tied across possible sit-out COMBOS,
     we break ties using:
       • Pairing mode outcomes
       • Skill mode outcomes
       • Court uniqueness (same 4 people on court)
     with their ordering controlled by "Uniqueness importance".

2) Group players into courts of 4
   - Uses:
       • Pairing mode (always > skill mode)
       • Skill mode
       • Uniqueness importance (how much we care about variety)

   Pairing mode:
     • "same-gender" → prefer single-gender courts
     • "mixed"       → prefer 2M + 2F courts
     • "random"      → no gender preference

   Skill mode:
     • "same-skill"  → 4 players with similar levels on each court
     • "balanced"    → random courts; skill only used later to make pairs

   Uniqueness:
     • Based on how often pairs of players have shared a court.
     • For sit-outs we ask: does this sit-out choice leave a pool 
       that supports fresh courts?
     • For grouping we pick quartets that minimise re-used co-court pairs.

3) Make pairs inside each court
   - ONLY skill matters:
     • Of the 3 possible pairings inside 4 players,
       pick the one where the two teams' total skills are closest.
   - No gender or uniqueness is used at this stage.

==========================================================
*/


// ===========================
//  STATE & PERSISTENCE
// ===========================

const STORAGE_KEY = 'tennis-fixtures-state';

let state = loadState();

function defaultState() {
  return {
    players: [],          // { id, name, gender, skill, isPresent, happyToSit, gamesPlayed, sits, isArchived }
    rounds: [],           // { roundNumber, courts:[{courtNumber, players:[ids], pairs:[[id,id],[id,id]]}], sitOut:[ids], debug? }
    nextPlayerId: 1,
    nextRoundNumber: 1,

    // Controls
    pairingMode: 'random',      // 'same-gender' | 'mixed' | 'random'
    skillMode: 'balanced',      // 'same-skill' | 'balanced'
    uniquenessImportance: 3,    // 1 = low, 2 = medium, 3 = high

    debugTooltips: true
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed.players || !Array.isArray(parsed.players)) return defaultState();

    parsed.players.forEach(p => {
      if (typeof p.gamesPlayed !== 'number') p.gamesPlayed = 0;
      if (typeof p.sits !== 'number') p.sits = 0;
      if (typeof p.happyToSit !== 'boolean') p.happyToSit = false;
      if (typeof p.isPresent !== 'boolean') p.isPresent = false;
      if (typeof p.skill !== 'number') p.skill = 5;
      if (!p.gender) p.gender = 'O';
      if (typeof p.isArchived !== 'boolean') p.isArchived = false;
    });

    if (typeof parsed.nextPlayerId !== 'number') {
      parsed.nextPlayerId =
        (parsed.players.reduce((max, p) => Math.max(max, p.id || 0), 0) || 0) + 1;
    }
    if (typeof parsed.nextRoundNumber !== 'number') {
      parsed.nextRoundNumber = (parsed.rounds?.length || 0) + 1;
    }

    // Migrate / normalise pairing mode
    if (!parsed.pairingMode) parsed.pairingMode = 'random';
    if (parsed.pairingMode === 'neutral') parsed.pairingMode = 'random';
    if (parsed.pairingMode === 'mixed-priority') parsed.pairingMode = 'mixed';
    if (!['same-gender', 'mixed', 'random'].includes(parsed.pairingMode)) {
      parsed.pairingMode = 'random';
    }

    // Migrate / normalise skill mode
    if (!parsed.skillMode) parsed.skillMode = 'balanced';
    if (parsed.skillMode === 'clustered') parsed.skillMode = 'same-skill';
    if (parsed.skillMode === 'random') parsed.skillMode = 'balanced';
    if (!['same-skill', 'balanced'].includes(parsed.skillMode)) {
      parsed.skillMode = 'balanced';
    }

    if (typeof parsed.uniquenessImportance !== 'number') {
      parsed.uniquenessImportance = 2;
    }
    if (typeof parsed.debugTooltips !== 'boolean') parsed.debugTooltips = true;

    return parsed;
  } catch (e) {
    console.error('Error loading state', e);
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}


// ===========================
//  GENERAL HELPERS
// ===========================

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pairKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function getPlayerById(id) {
  return state.players.find(p => p.id === id) || null;
}

// Tooltip helper
function makeTooltip(element, text) {
  element.classList.add('tooltip-target');
  element.dataset.tooltip = text;
}

// Uniqueness priority ordering
// Returns an array of keys describing the order we consider:
// 'pairing', 'skill', 'uniqueness'
function getUniquenessPriorityOrder() {
  const importance = state.uniquenessImportance || 2;
  if (importance === 1) {
    // uniqueness low
    return ['pairing', 'skill', 'uniqueness'];
  }
  if (importance === 3) {
    // uniqueness high
    return ['uniqueness', 'pairing', 'skill'];
  }
  // medium
  return ['pairing', 'uniqueness', 'skill'];
}


// ===========================
//  DOM ELEMENTS
// ===========================

const addPlayerForm = document.getElementById('add-player-form');
const playerNameInput = document.getElementById('player-name');
const playerGenderSelect = document.getElementById('player-gender');
const playerSkillInput = document.getElementById('player-skill');
const playersTableBody = document.getElementById('players-table-body');

const clearDayBtn = document.getElementById('clear-day-btn');
const generateRoundBtn = document.getElementById('generate-round-btn');
const roundsContainer = document.getElementById('rounds-container');

const skillModeSelect = document.getElementById('skill-mode');
const pairingModeSelect = document.getElementById('pairing-mode');
const uniquenessSelect = document.getElementById('uniqueness-importance');
const debugTooltipsToggle = document.getElementById('debug-tooltips-toggle');


// ===========================
//  RENDERING
// ===========================

function renderPlayers() {
  playersTableBody.innerHTML = '';
  const players = state.players
    .filter(p => !p.isArchived)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const p of players) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = p.name;

    const genderTd = document.createElement('td');
    genderTd.textContent = p.gender;

    const skillTd = document.createElement('td');
    skillTd.textContent = p.skill;

    const presentTd = document.createElement('td');
    presentTd.classList.add('center-cell', 'checkbox-col');
    const presentCheckbox = document.createElement('input');
    presentCheckbox.type = 'checkbox';
    presentCheckbox.checked = !!p.isPresent;
    presentCheckbox.addEventListener('change', () => {
      p.isPresent = presentCheckbox.checked;
      saveState();
    });
    presentTd.appendChild(presentCheckbox);

    const happyTd = document.createElement('td');
    happyTd.classList.add('center-cell', 'checkbox-col');
    const happyCheckbox = document.createElement('input');
    happyCheckbox.type = 'checkbox';
    happyCheckbox.checked = !!p.happyToSit;
    happyCheckbox.addEventListener('change', () => {
      p.happyToSit = happyCheckbox.checked;
      saveState();
    });
    happyTd.appendChild(happyCheckbox);

    const playedTd = document.createElement('td');
    playedTd.textContent = p.gamesPlayed ?? 0;

    const sitsTd = document.createElement('td');
    sitsTd.textContent = p.sits ?? 0;

    const deleteTd = document.createElement('td');
    deleteTd.classList.add('center-cell', 'delete-col');
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.className = 'danger-btn';
    deleteBtn.title = 'Delete player';
    deleteBtn.addEventListener('click', () => {
      const ok = confirm(`Delete player "${p.name}"? They will be removed from the list but kept in old rounds.`);
      if (!ok) return;
      p.isArchived = true;
      p.isPresent = false;
      saveState();
      renderPlayers();
    });
    deleteTd.appendChild(deleteBtn);

    tr.appendChild(nameTd);
    tr.appendChild(genderTd);
    tr.appendChild(skillTd);
    tr.appendChild(presentTd);
    tr.appendChild(happyTd);
    tr.appendChild(playedTd);
    tr.appendChild(sitsTd);
    tr.appendChild(deleteTd);

    playersTableBody.appendChild(tr);
  }
}

function renderRounds() {
  roundsContainer.innerHTML = '';

  if (state.rounds.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No rounds generated yet.';
    roundsContainer.appendChild(p);
    return;
  }

  for (let i = state.rounds.length - 1; i >= 0; i--) {
    const round = state.rounds[i];
    const card = document.createElement('div');
    card.className = 'round-card';

    const title = document.createElement('div');
    title.className = 'round-title';
    title.textContent = `Round ${round.roundNumber}`;
    card.appendChild(title);

    const ul = document.createElement('ul');
    ul.className = 'courts-list';

    // courts
    for (const court of round.courts) {
      const li = document.createElement('li');

      const [pair1, pair2] = court.pairs;
      const p1a = getPlayerById(pair1[0]);
      const p1b = getPlayerById(pair1[1]);
      const p2a = getPlayerById(pair2[0]);
      const p2b = getPlayerById(pair2[1]);

      const text = `Court ${court.courtNumber}: ${p1a?.name ?? '?'} & ${p1b?.name ?? '?'}  vs  ${p2a?.name ?? '?'} & ${p2b?.name ?? '?'}`;
      li.textContent = text;

      if (state.debugTooltips && round.debug && round.debug.courtReasons) {
        const reason = round.debug.courtReasons[court.courtNumber] || '';
        if (reason) {
          const info = document.createElement('span');
          info.textContent = ' ⓘ';
          makeTooltip(info, reason);
          li.appendChild(info);
        }
      }

      ul.appendChild(li);
    }

    // sit-outs
    if (round.sitOut && round.sitOut.length > 0) {
      const liSit = document.createElement('li');
      const names = round.sitOut
        .map(id => getPlayerById(id)?.name)
        .filter(Boolean)
        .join(', ');
      liSit.textContent = `Sitting out: ${names || '?'}`;

      if (state.debugTooltips && round.debug && round.debug.sitOutReasons) {
        const lines = round.debug.sitOutReasons.map(x => `${x.name}: ${x.reason}`).join('\n');
        if (lines) {
          const info = document.createElement('span');
          info.textContent = ' ⓘ';
          makeTooltip(info, lines);
          liSit.appendChild(info);
        }
      }

      ul.appendChild(liSit);
    }

    card.appendChild(ul);
    roundsContainer.appendChild(card);
  }
}


// ===========================
//  SETTINGS INIT
// ===========================

if (skillModeSelect) {
  skillModeSelect.value = state.skillMode || 'balanced';
  skillModeSelect.addEventListener('change', () => {
    state.skillMode = skillModeSelect.value;
    saveState();
  });
}

if (pairingModeSelect) {
  pairingModeSelect.value = state.pairingMode || 'random';
  pairingModeSelect.addEventListener('change', () => {
    state.pairingMode = pairingModeSelect.value;
    saveState();
  });
}

if (uniquenessSelect) {
  uniquenessSelect.value = String(state.uniquenessImportance || 2);
  uniquenessSelect.addEventListener('change', () => {
    const val = parseInt(uniquenessSelect.value, 10);
    state.uniquenessImportance = [1, 2, 3].includes(val) ? val : 2;
    saveState();
  });
}

if (debugTooltipsToggle) {
  debugTooltipsToggle.checked = !!state.debugTooltips;
  debugTooltipsToggle.addEventListener('change', () => {
    state.debugTooltips = debugTooltipsToggle.checked;
    saveState();
    renderRounds();
  });
}


// ===========================
//  HISTORY FOR UNIQUENESS
// ===========================

// Co-court counts: how many times each pair of players has shared a court
function buildCoCourtCounts() {
  const counts = {};
  for (const round of state.rounds) {
    for (const court of round.courts || []) {
      if (!court.players || court.players.length < 2) continue;
      const ids = court.players;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = pairKey(ids[i], ids[j]);
          counts[key] = (counts[key] || 0) + 1;
        }
      }
    }
  }
  return counts;
}


// ===========================
//  SITTING-OUT LOGIC
// ===========================

function getLastSitSet() {
  if (!state.rounds.length) return new Set();
  const last = state.rounds[state.rounds.length - 1];
  return new Set(last.sitOut || []);
}

// score a single player as a sitter based on fairness only
// lower score = MORE likely to be chosen to sit
function scoreSitCandidate(player, lastSitSet, context) {
  const { avgSitRate, maxGames } = context;
  let score = 0;
  const details = [];

  const sits = player.sits || 0;
  const games = player.gamesPlayed || 0;

  // A) Ratio fairness: sits vs expected sits
  if (avgSitRate > 0 && games > 0) {
    const expectedSits = games * avgSitRate;
    const sitDelta = sits - expectedSits; // negative = under-sat (owes sits)

    // Weight this strongly so one "extra" or "missing" sit is meaningful
    score += sitDelta * 20;
    details.push(
      `sitDelta=${sitDelta.toFixed(2)} (sits=${sits}, expected=${expectedSits.toFixed(2)}, avgRate=${avgSitRate.toFixed(3)})`
    );
  } else {
    // No meaningful average yet → fall back to raw sits
    score += sits * 10;
    details.push(`no avgSitRate yet, using sits=${sits}`);
  }

  // B) Avoid back-to-back sits
  if (lastSitSet.has(player.id)) {
    score += 8;
    details.push('sat last round (penalty)');
  } else {
    details.push('did not sit last round');
  }

  // C) Happy to sit = small bonus
  if (player.happyToSit) {
    score -= 5;
    details.push('happy to sit (bonus)');
  }

  // D) Game-lag protection: people far behind in games should not sit yet
  if (maxGames > 0) {
    const gameLag = maxGames - games;
    if (gameLag >= 2) {
      const lagPenalty = gameLag * 3; // tune if needed
      score += lagPenalty;
      details.push(`protected by game lag: ${gameLag} behind max (penalty +${lagPenalty})`);
    } else {
      details.push(`game lag acceptable (max=${maxGames}, this=${games})`);
    }
  } else {
    details.push('no game history yet (everyone at 0)');
  }

  return { score, details };
}

// Pool-level pairing metric for sit-out decisions (lower is better)
function computePairingPoolMetric(players, pairingMode) {
  const count = players.length;
  if (count < 4) return 0;
  const totalCourts = Math.floor(count / 4);
  if (totalCourts <= 0) return 0;

  const males = players.filter(p => p.gender === 'M').length;
  const females = players.filter(p => p.gender === 'F').length;

  if (pairingMode === 'same-gender') {
    const pureCourts = Math.floor(males / 4) + Math.floor(females / 4);
    const badness = totalCourts - pureCourts;
    return badness < 0 ? 0 : badness;
  }

  if (pairingMode === 'mixed') {
    const mixedCourts = Math.min(
      Math.floor(males / 2),
      Math.floor(females / 2),
      totalCourts
    );
    const badness = totalCourts - mixedCourts;
    return badness < 0 ? 0 : badness;
  }

  // random
  return 0;
}

// Pool-level skill metric (for same-skill mode)
// lower variance = better clustering
function computeSkillPoolMetric(players, skillMode) {
  if (skillMode !== 'same-skill') return 0;
  if (!players || players.length <= 1) return 0;

  const skills = players.map(p => p.skill || 0);
  const n = skills.length;
  const mean = skills.reduce((a, b) => a + b, 0) / n;
  const variance = skills.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / n;
  return variance;
}

// Pool-level uniqueness metric for sit-out decisions
// sum of co-court counts for all pairs in the pool; lower is fresher
function computeUniquenessPoolMetric(players, coCourtCounts) {
  if (!players || players.length <= 1) return 0;
  let total = 0;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const key = pairKey(players[i].id, players[j].id);
      total += coCourtCounts[key] || 0;
    }
  }
  return total;
}

// Choose the best combination of sit-outs using fairness + pool structure
function pickSitOutPlayers(activePlayers, numSit, pairingMode, skillMode, coCourtCounts) {
  if (numSit <= 0) {
    return { players: [], debug: [] };
  }

  const n = activePlayers.length;
  if (numSit >= n) {
    return {
      players: activePlayers.slice(),
      debug: activePlayers.map(p => ({
        name: p.name,
        reason: 'All must sit (edge case)'
      }))
    };
  }

  const lastSitSet = getLastSitSet();

  // Global stats for fairness
  const totalGames = activePlayers.reduce(
    (sum, p) => sum + (p.gamesPlayed || 0),
    0
  );
  const totalSits = activePlayers.reduce(
    (sum, p) => sum + (p.sits || 0),
    0
  );
  const avgSitRate = totalGames > 0 ? totalSits / totalGames : 0;

  const maxGames = activePlayers.reduce(
    (max, p) => Math.max(max, p.gamesPlayed || 0),
    0
  );

  const baseScores = activePlayers.map(p =>
    scoreSitCandidate(p, lastSitSet, { avgSitRate, maxGames })
  );
  const priorityOrder = getUniquenessPriorityOrder();

  function buildTuple(chosenIndices) {
    const sitIndexSet = new Set(chosenIndices);
    const toSit = [];
    const toPlay = [];

    activePlayers.forEach((p, idx) => {
      if (sitIndexSet.has(idx)) toSit.push(p);
      else toPlay.push(p);
    });

    // Fairness: sum base scores of sitters
    let fairness = 0;
    for (const idx of chosenIndices) {
      fairness += baseScores[idx].score;
    }

    // Pool structure metrics
    const pairingMetric = computePairingPoolMetric(toPlay, pairingMode);
    const skillMetric = computeSkillPoolMetric(toPlay, skillMode);
    const uniquenessMetric = computeUniquenessPoolMetric(toPlay, coCourtCounts);

    const metrics = {
      pairing: pairingMetric,
      skill: skillMetric,
      uniqueness: uniquenessMetric
    };

    const m1 = metrics[priorityOrder[0]];
    const m2 = metrics[priorityOrder[1]];
    const m3 = metrics[priorityOrder[2]];

    // Alphabetical tie-break on sitter names
    const alphaKey = toSit
      .map(p => p.name || '')
      .sort((a, b) => a.localeCompare(b))
      .join('|');

    return { fairness, m1, m2, m3, alphaKey, toSit };
  }

  function isBetterTuple(a, b) {
    if (!b) return true;
    if (a.fairness !== b.fairness) return a.fairness < b.fairness;
    if (a.m1 !== b.m1) return a.m1 < b.m1;
    if (a.m2 !== b.m2) return a.m2 < b.m2;
    if (a.m3 !== b.m3) return a.m3 < b.m3;
    return a.alphaKey.localeCompare(b.alphaKey) < 0;
  }

  let bestTuple = null;
  let bestChosen = null;

  function search(start, chosen) {
    if (chosen.length === numSit) {
      const tuple = buildTuple(chosen);
      if (isBetterTuple(tuple, bestTuple)) {
        bestTuple = tuple;
        bestChosen = chosen.slice();
      }
      return;
    }
    for (let i = start; i < n; i++) {
      chosen.push(i);
      search(i + 1, chosen);
      chosen.pop();
    }
  }

  search(0, []);

  if (!bestChosen) {
    // Fallback: fairness only, alphabetical within fairness
    const sorted = activePlayers.slice().sort((a, b) => {
      const sa = scoreSitCandidate(a, lastSitSet, { avgSitRate, maxGames }).score;
      const sb = scoreSitCandidate(b, lastSitSet, { avgSitRate, maxGames }).score;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });
    const chosen = sorted.slice(0, numSit);
    const debug = chosen.map(p => {
      const s = scoreSitCandidate(p, lastSitSet, { avgSitRate, maxGames });
      return { name: p.name, reason: s.details.join(', ') };
    });
    return { players: chosen, debug };
  }

  const sitPlayers = bestChosen.map(i => activePlayers[i]);
  const debug = sitPlayers.map(p => {
    const s = scoreSitCandidate(p, lastSitSet, { avgSitRate, maxGames });
    return { name: p.name, reason: s.details.join(', ') };
  });

  return { players: sitPlayers, debug };
}


// ===========================
//  GROUPING PLAYERS INTO COURTS
// ===========================

// Court-level metrics for a given group of 4 (lower is better)
function computeQuartetMetrics(players4, pairingMode, skillMode, coCourtCounts) {
  // Pairing metric: gender pattern vs pairingMode
  const males = players4.filter(p => p.gender === 'M').length;
  const females = players4.filter(p => p.gender === 'F').length;

  let pairingBadness = 0;
  if (pairingMode === 'same-gender') {
    const allSame = (males === 4 || females === 4);
    pairingBadness = allSame ? 0 : 1;
  } else if (pairingMode === 'mixed') {
    const twoTwo = (males === 2 && females === 2);
    if (twoTwo) {
      pairingBadness = 0;
    } else if (males === 0 || females === 0) {
      pairingBadness = 2; // worst: all one gender when we want mixed
    } else {
      pairingBadness = 1; // 3–1 pattern
    }
  } else {
    pairingBadness = 0; // random
  }

  // Skill metric: only for same-skill mode
  let skillBadness = 0;
  if (skillMode === 'same-skill') {
    const skills = players4.map(p => p.skill || 0);
    const maxSkill = Math.max(...skills);
    const minSkill = Math.min(...skills);
    skillBadness = maxSkill - minSkill; // spread; smaller = more similar
  }

  // Uniqueness: sum of co-court counts for the 6 pairs in this quartet
  let uniquenessBadness = 0;
  for (let i = 0; i < players4.length; i++) {
    for (let j = i + 1; j < players4.length; j++) {
      const key = pairKey(players4[i].id, players4[j].id);
      uniquenessBadness += coCourtCounts[key] || 0;
    }
  }

  return { pairingBadness, skillBadness, uniquenessBadness };
}

// Pick disjoint quartets from playersToPlay using a greedy search per court
function groupPlayersIntoCourts(playersToPlay, pairingMode, skillMode, coCourtCounts) {
  const numCourts = Math.floor(playersToPlay.length / 4);
  const groups = [];
  if (numCourts <= 0) return groups;

  // Base ordering: same-skill → sort by skill; balanced → shuffle
  let remaining = playersToPlay.slice();
  if (skillMode === 'same-skill') {
    remaining.sort((a, b) => b.skill - a.skill);
  } else {
    remaining = shuffle(remaining);
  }

  const priorityOrder = getUniquenessPriorityOrder();

  function isQuartetBetter(a, b) {
    if (!b) return true;
    if (a.m1 !== b.m1) return a.m1 < b.m1;
    if (a.m2 !== b.m2) return a.m2 < b.m2;
    if (a.m3 !== b.m3) return a.m3 < b.m3;
    return a.alpha < b.alpha;
  }

  for (let c = 0; c < numCourts; c++) {
    if (remaining.length < 4) break;

    let best = null;

    const len = remaining.length;
    for (let i = 0; i < len - 3; i++) {
      for (let j = i + 1; j < len - 2; j++) {
        for (let k = j + 1; k < len - 1; k++) {
          for (let l = k + 1; l < len; l++) {
            const quartet = [remaining[i], remaining[j], remaining[k], remaining[l]];
            const metrics = computeQuartetMetrics(quartet, pairingMode, skillMode, coCourtCounts);

            const map = {
              pairing: metrics.pairingBadness,
              skill: metrics.skillBadness,
              uniqueness: metrics.uniquenessBadness
            };

            const m1 = map[priorityOrder[0]];
            const m2 = map[priorityOrder[1]];
            const m3 = map[priorityOrder[2]];

            const alpha = quartet.reduce((sum, p) => sum + (p.id || 0), 0); // deterministic

            const candidate = {
              m1,
              m2,
              m3,
              alpha,
              quartet,
              indices: [i, j, k, l]
            };

            if (isQuartetBetter(candidate, best)) {
              best = candidate;
            }
          }
        }
      }
    }

    if (!best) break;

    groups.push(best.quartet);

    // Remove selected players from remaining (highest index first)
    const idxs = best.indices.slice().sort((a, b) => b - a);
    for (const idx of idxs) {
      remaining.splice(idx, 1);
    }
  }

  return groups;
}


// ===========================
//  PAIRING INSIDE A COURT OF 4
// ===========================

// Only skill balance matters here.
function choosePairsForGroup(group) {
  if (group.length !== 4) {
    throw new Error('choosePairsForGroup expects 4 players');
  }

  const [a, b, c, d] = group;

  const options = [
    [[a.id, b.id], [c.id, d.id]],
    [[a.id, c.id], [b.id, d.id]],
    [[a.id, d.id], [b.id, c.id]]
  ];

  function skillGapForOption(opt) {
    const [p1, p2] = opt;

    const p1a = getPlayerById(p1[0]);
    const p1b = getPlayerById(p1[1]);
    const p2a = getPlayerById(p2[0]);
    const p2b = getPlayerById(p2[1]);

    const s1 = (p1a?.skill || 0) + (p1b?.skill || 0);
    const s2 = (p2a?.skill || 0) + (p2b?.skill || 0);

    return Math.abs(s1 - s2);
  }

  let best = options[0];
  let bestGap = Infinity;

  for (const opt of options) {
    const gap = skillGapForOption(opt);
    if (gap < bestGap) {
      bestGap = gap;
      best = opt;
    } else if (gap === bestGap) {
      // deterministic tiebreak: smaller sum of IDs
      const sumBest = best.flat().reduce((s, id) => s + id, 0);
      const sumOpt = opt.flat().reduce((s, id) => s + id, 0);
      if (sumOpt < sumBest) {
        best = opt;
      }
    }
  }

  return best;
}


// ===========================
//  GENERATE NEXT ROUND
// ===========================

function generateNextRound() {
  const activePlayers = state.players.filter(p => p.isPresent && !p.isArchived);
  if (activePlayers.length < 4) {
    alert('Need at least 4 players marked as present to create a round.');
    return;
  }

  // Only use multiples of 4, cap at 5 courts (20 players)
  const maxCourts = 5;
  let maxPlayersInRound = Math.floor(activePlayers.length / 4) * 4;
  const courtCapPlayers = maxCourts * 4;
  if (maxPlayersInRound > courtCapPlayers) {
    maxPlayersInRound = courtCapPlayers;
  }
  if (maxPlayersInRound < 4) {
    alert('Not enough players for a full court.');
    return;
  }

  const numSit = activePlayers.length - maxPlayersInRound;
  const pairingMode = state.pairingMode || 'random';
  const skillMode = state.skillMode || 'balanced';
  const coCourtCounts = buildCoCourtCounts();

  // 1) choose who sits out
  const sitResult = pickSitOutPlayers(
    activePlayers,
    numSit,
    pairingMode,
    skillMode,
    coCourtCounts
  );
  const sitOutPlayers = sitResult.players;
  const sitOutIds = new Set(sitOutPlayers.map(p => p.id));

  let playersToPlay = activePlayers.filter(p => !sitOutIds.has(p.id));
  if (playersToPlay.length !== maxPlayersInRound) {
    console.warn('Mismatch in playersToPlay vs expected; adjusting.');
    playersToPlay = playersToPlay.slice(0, maxPlayersInRound);
  }

  // 2) group into courts of 4
  const groups = groupPlayersIntoCourts(playersToPlay, pairingMode, skillMode, coCourtCounts);

  const courts = [];
  const courtReasons = {};
  let courtNumber = 1;

  // 3) choose pairs within each court (skill only)
  for (const group of groups) {
    if (group.length < 4) continue;

    const bestPairs = choosePairsForGroup(group);
    const playerIds = group.map(p => p.id);

    // For debug: current co-court "overlap" score for this quartet
    let uniquenessScore = 0;
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const key = pairKey(playerIds[i], playerIds[j]);
        uniquenessScore += coCourtCounts[key] || 0;
      }
    }

    const skills = group.map(p => p.skill || 0);
    const maxSkill = Math.max(...skills);
    const minSkill = Math.min(...skills);
    const genderPattern = group.map(p => p.gender || '?').join('');

    let reason = `pairing mode: ${pairingMode}, skill mode: ${skillMode}, uniqueness importance: ${state.uniquenessImportance}. `;
    reason += `genders: ${genderPattern}, skill spread: ${maxSkill - minSkill}, prior same-court links: ${uniquenessScore}.`;

    courts.push({
      courtNumber,
      players: playerIds,
      pairs: bestPairs
    });
    courtReasons[courtNumber] = reason;
    courtNumber++;
  }

  if (courts.length === 0) {
    alert('Could not form any courts. Check players present.');
    return;
  }

  // 4) update stats
  const playingIds = new Set(playersToPlay.map(p => p.id));
  state.players.forEach(p => {
    if (!p.isPresent) return;
    if (playingIds.has(p.id)) {
      p.gamesPlayed = (p.gamesPlayed || 0) + 1;
    } else if (sitOutIds.has(p.id)) {
      p.sits = (p.sits || 0) + 1;
    }
  });

  const newRound = {
    roundNumber: state.nextRoundNumber++,
    courts,
    sitOut: sitOutPlayers.map(p => p.id),
    debug: {
      sitOutReasons: sitResult.debug || [],
      courtReasons
    }
  };

  state.rounds.push(newRound);
  saveState();
  renderPlayers();
  renderRounds();
}


// ===========================
//  EVENT WIRING
// ===========================

addPlayerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = playerNameInput.value.trim();
  const gender = playerGenderSelect.value;
  const skill = parseInt(playerSkillInput.value, 10);

  if (!name) {
    alert('Please enter a name.');
    return;
  }
  if (isNaN(skill) || skill < 1 || skill > 10) {
    alert('Skill must be between 1 and 10.');
    return;
  }

  state.players.push({
    id: state.nextPlayerId++,
    name,
    gender,
    skill,
    isPresent: false,
    happyToSit: false,
    gamesPlayed: 0,
    sits: 0,
    isArchived: false
  });

  saveState();
  playerNameInput.value = '';
  playerSkillInput.value = '5';
  renderPlayers();
});

clearDayBtn.addEventListener('click', () => {
  if (!confirm('Start a new day? This will clear all rounds and reset games/sits, but keep the player list.')) {
    return;
  }
  state.rounds = [];
  state.nextRoundNumber = 1;
  state.players.forEach(p => {
    p.gamesPlayed = 0;
    p.sits = 0;
    p.isPresent = false;
  });
  saveState();
  renderPlayers();
  renderRounds();
});

generateRoundBtn.addEventListener('click', () => {
  generateNextRound();
});


// ===========================
//  INITIAL RENDER
// ===========================

renderPlayers();
renderRounds();
