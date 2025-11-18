/* 
==========================================================
🔄 MATCH GENERATION PRIORITY LOGIC (v2)
==========================================================

This app generates doubles rounds for a tennis club. People arrive,
mark themselves present, and the app builds rounds trying to:

1) Be fair about who sits out.
2) Respect the chosen pairing mode (same-gender / mixed / neutral).
3) Rotate people so they see new partners/opponents where possible.
4) Respect skill settings for court balance, with a user-choice
   "rotation focus" setting controlling how strongly we care about
   variety vs skill.

-----------------------------------------
Sitting-out fairness (highest priority)
-----------------------------------------
When we need sit-outs this round, we:

 1. Prefer players with FEWEST total sits to *keep sits balanced*.
 2. Avoid repeat sit-outs (someone who sat last round) if possible.
 3. Among equals, prefer players who tick “Happy to sit”.
 4. If still tied, we look at games played (more games → more likely to sit).
 5. As a final tie-break, we consider pairing mode / gender structure,
    and then alphabetical order for deterministic behavior.

We also do a small search over combinations of sitters (for 1–3 sit-outs)
to choose the combo that best supports fairness + gender structure.

-----------------------------------------
Pairing mode enforcement
-----------------------------------------
After sit-outs are chosen, we:

  • "Same-gender" → try to make as many all-M or all-F courts as possible.
  • "Mixed-priority" → try to encourage mixed doubles (M+F pairs) where we can.
  • "Neutral" → no strong gender constraint.

If gender constraints conflict with fairness, fairness is king.

-----------------------------------------
Rotation vs Skill (user setting)
-----------------------------------------
We expose a "Rotation focus" setting:

  • "Variety"      → more weight on NEW partners & spread.
  • "Balanced"     → mix of variety + skill fairness.
  • "Skill first"  → keeps matches more even at the cost of variety.

This primarily affects how we choose pairings within a court of 4.

-----------------------------------------
Partner uniqueness
-----------------------------------------
Within each court of 4 players, there are 3 ways to split into two pairs.
We score each option by:

  • How often those pairs have played together before (we avoid repeats).
  • Skill gap between the sides.
  • Gender pattern vs pairing mode (e.g. prefer mixed or same-gender).

Lower scored options are chosen.

-----------------------------------------
Debug tooltips
-----------------------------------------
If "Show reasoning tooltips" is ON, we attach short explanations to:

  • Sit-out list (why these players sat).
  • Each court line (what the system was trying to do).

Tooltips are compact, not full forensic logs.

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
    pairingMode: 'neutral',
    skillMode: 'balanced',
    rotationMode: 'balanced',    // 'variety' | 'balanced' | 'skill-first'
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

    if (!parsed.pairingMode) parsed.pairingMode = 'neutral';
    if (!parsed.skillMode) parsed.skillMode = 'balanced';
    if (!parsed.rotationMode) parsed.rotationMode = 'balanced';
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

function quartetKey(ids) {
  const sorted = ids.slice().sort((a, b) => a - b);
  return sorted.join('-');
}

// partner counts across all past rounds
function buildPartnerCounts() {
  const counts = {};
  for (const round of state.rounds) {
    for (const court of round.courts) {
      for (const pair of court.pairs) {
        const key = pairKey(pair[0], pair[1]);
        counts[key] = (counts[key] || 0) + 1;
      }
    }
  }
  return counts;
}

// court (quartet) counts across all past rounds
function buildQuartetCounts() {
  const counts = {};
  for (const round of state.rounds) {
    for (const court of round.courts) {
      if (!court.players || court.players.length !== 4) continue;
      const key = quartetKey(court.players);
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

function getPlayerById(id) {
  return state.players.find(p => p.id === id) || null;
}

// Simple tooltip helper
function makeTooltip(element, text) {
  element.classList.add('tooltip-target');
  element.dataset.tooltip = text;
}

// rotation weight helper for pairing scoring
function getRotationWeights() {
  const mode = state.rotationMode || 'balanced';
  if (mode === 'variety') {
    return {
      partnerRepeatWeight: 6,
      skillGapWeight: 2
    };
  }
  if (mode === 'skill-first') {
    return {
      partnerRepeatWeight: 3,
      skillGapWeight: 7
    };
  }
  // balanced
  return {
    partnerRepeatWeight: 5,
    skillGapWeight: 5
  };
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
const rotationModeSelect = document.getElementById('rotation-mode');
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
  pairingModeSelect.value = state.pairingMode || 'neutral';
  pairingModeSelect.addEventListener('change', () => {
    state.pairingMode = pairingModeSelect.value;
    saveState();
  });
}

if (rotationModeSelect) {
  rotationModeSelect.value = state.rotationMode || 'balanced';
  rotationModeSelect.addEventListener('change', () => {
    state.rotationMode = rotationModeSelect.value;
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
//  SITTING-OUT LOGIC
// ===========================

function getLastSitSet() {
  if (!state.rounds.length) return new Set();
  const last = state.rounds[state.rounds.length - 1];
  return new Set(last.sitOut || []);
}

// score a single player as a sitter
function scoreSitCandidate(player, lastSitSet) {
  let score = 0;
  const details = [];

  // 1) fewest sits (more sits → less likely to sit now)
  score += player.sits * 10;
  details.push(`sits=${player.sits}`);

  // 2) avoid repeat sit if possible
  if (lastSitSet.has(player.id)) {
    score += 8;
    details.push('sat last round (penalty)');
  } else {
    details.push('did not sit last round');
  }

  // 3) happy to sit
  if (player.happyToSit) {
    score -= 5;
    details.push('happy to sit (bonus)');
  }

  // 4) games played (more games → more likely to sit)
  score += player.gamesPlayed * 1;
  details.push(`games=${player.gamesPlayed}`);

  return { score, details };
}

// Utility: compute how many pure-gender courts we *could* form from toPlay
function estimatePureGenderCourts(players) {
  const m = players.filter(p => p.gender === 'M').length;
  const f = players.filter(p => p.gender === 'F').length;
  return Math.floor(m / 4) + Math.floor(f / 4);
}

// Choose the best combination of sit-outs using fairness + gender-aware scoring
function pickSitOutPlayers(activePlayers, numSit, pairingMode) {
  if (numSit <= 0) {
    return { players: [], debug: [] };
  }

  const n = activePlayers.length;
  if (numSit >= n) {
    return {
      players: activePlayers.slice(),
      debug: activePlayers.map(p => ({ name: p.name, reason: 'All must sit (edge case)' }))
    };
  }

  const lastSitSet = getLastSitSet();
  const baseScores = activePlayers.map(p => scoreSitCandidate(p, lastSitSet));

  // combinatorial search is safe because numSit is small in this app
  let bestCombo = null;
  let bestScore = Infinity;

  const indices = activePlayers.map((_, idx) => idx);

  function search(start, chosen) {
    if (chosen.length === numSit) {
      const sitIndices = new Set(chosen);
      const toSit = [];
      const toPlay = [];

      activePlayers.forEach((p, idx) => {
        if (sitIndices.has(idx)) toSit.push(p);
        else toPlay.push(p);
      });

      // sum of base scores
      let total = 0;
      for (const idx of chosen) {
        total += baseScores[idx].score;
      }

      // gender / pairingMode adjustment
      if (pairingMode === 'same-gender') {
        const pureCourts = estimatePureGenderCourts(toPlay);
        // more pure-gender courts => better (lower score)
        total -= pureCourts * 5;
      }

      if (total < bestScore) {
        bestScore = total;
        bestCombo = chosen.slice();
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

  if (!bestCombo) {
    // fallback: just sort by base score
    const sorted = activePlayers.slice().sort((a, b) => {
      const sa = scoreSitCandidate(a, lastSitSet).score;
      const sb = scoreSitCandidate(b, lastSitSet).score;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });
    const chosen = sorted.slice(0, numSit);
    const debug = chosen.map(p => {
      const s = scoreSitCandidate(p, lastSitSet);
      return { name: p.name, reason: s.details.join(', ') };
    });
    return { players: chosen, debug };
  }

  const sitPlayers = bestCombo.map(i => activePlayers[i]);
  const debug = sitPlayers.map(p => {
    const s = scoreSitCandidate(p, lastSitSet);
    return { name: p.name, reason: s.details.join(', ') };
  });

  return { players: sitPlayers, debug };
}


// ===========================
//  GROUPING PLAYERS INTO COURTS
// ===========================

function groupPlayersBySkillMode(playersToPlay) {
  const numCourts = playersToPlay.length / 4;
  const groups = [];
  const mode = state.skillMode || 'balanced';

  if (mode === 'random') {
    const shuffled = shuffle(playersToPlay);
    for (let i = 0; i < shuffled.length; i += 4) {
      const group = shuffled.slice(i, i + 4);
      if (group.length === 4) groups.push(group);
    }
    return groups;
  }

  if (mode === 'clustered') {
    const sorted = playersToPlay.slice().sort((a, b) => b.skill - a.skill);
    for (let i = 0; i < sorted.length; i += 4) {
      const group = sorted.slice(i, i + 4);
      if (group.length === 4) groups.push(group);
    }
    return groups;
  }

  // balanced: snake distribution
  const sorted = playersToPlay.slice().sort((a, b) => b.skill - a.skill);
  const courts = Array.from({ length: numCourts }, () => []);

  for (let i = 0; i < sorted.length; i++) {
    const block = Math.floor(i / numCourts);
    const pos = i % numCourts;
    const courtIndex = (block % 2 === 0) ? pos : (numCourts - 1 - pos);
    courts[courtIndex].push(sorted[i]);
  }

  courts.forEach(c => {
    if (c.length === 4) groups.push(c);
  });

  return groups;
}

function groupPlayersSameGenderFirst(playersToPlay) {
  const males = playersToPlay.filter(p => p.gender === 'M');
  const females = playersToPlay.filter(p => p.gender === 'F');
  const others = playersToPlay.filter(p => p.gender !== 'M' && p.gender !== 'F');

  const mList = shuffle(males);
  const fList = shuffle(females);
  const oList = shuffle(others);

  const groups = [];
  let mIndex = 0;
  let fIndex = 0;

  const mCourts = Math.floor(mList.length / 4);
  const fCourts = Math.floor(fList.length / 4);

  for (let i = 0; i < mCourts; i++) {
    const g = mList.slice(mIndex, mIndex + 4);
    if (g.length === 4) groups.push(g);
    mIndex += 4;
  }

  for (let i = 0; i < fCourts; i++) {
    const g = fList.slice(fIndex, fIndex + 4);
    if (g.length === 4) groups.push(g);
    fIndex += 4;
  }

  const remaining = []
    .concat(mList.slice(mIndex))
    .concat(fList.slice(fIndex))
    .concat(oList);

  if (remaining.length > 0) {
    const leftoverGroups = groupPlayersBySkillMode(remaining);
    groups.push(...leftoverGroups);
  }

  return groups;
}


// ===========================
//  PAIRING INSIDE A COURT OF 4
// ===========================

function getPairGenderInfo(pair) {
  const pa = getPlayerById(pair[0]);
  const pb = getPlayerById(pair[1]);
  const ga = pa?.gender;
  const gb = pb?.gender;
  const isMixed = !!(ga && gb && ga !== gb);
  const isSame = !!(ga && gb && ga === gb);
  return { isMixed, isSame };
}

function choosePairsForGroup(group, partnerCounts, pairingMode) {
  const [a, b, c, d] = group;

  const options = [
    [[a.id, b.id], [c.id, d.id]],
    [[a.id, c.id], [b.id, d.id]],
    [[a.id, d.id], [b.id, c.id]]
  ];

  const weights = getRotationWeights();

  function scoreOption(opt) {
    const [p1, p2] = opt;

    const key1 = pairKey(p1[0], p1[1]);
    const key2 = pairKey(p2[0], p2[1]);

    const partnerRepeatScore = (partnerCounts[key1] || 0) + (partnerCounts[key2] || 0);

    const p1a = getPlayerById(p1[0]);
    const p1b = getPlayerById(p1[1]);
    const p2a = getPlayerById(p2[0]);
    const p2b = getPlayerById(p2[1]);
    const s1 = (p1a?.skill || 0) + (p1b?.skill || 0);
    const s2 = (p2a?.skill || 0) + (p2b?.skill || 0);
    const skillGap = Math.abs(s1 - s2);

    // gender pattern
    const g1 = getPairGenderInfo(p1);
    const g2 = getPairGenderInfo(p2);
    let genderPenalty = 0;

    if (pairingMode === 'mixed-priority') {
      // want mixed pairs where possible
      const mixedCount = (g1.isMixed ? 1 : 0) + (g2.isMixed ? 1 : 0);
      genderPenalty += (2 - mixedCount) * 3;
    } else if (pairingMode === 'same-gender') {
      // prefer same-gender pairs in pure-gender courts
      const genders = group.map(p => p.gender);
      const numM = genders.filter(g => g === 'M').length;
      const numF = genders.filter(g => g === 'F').length;
      const allSame = (numM === 4 || numF === 4);
      if (allSame) {
        const sameCount = (g1.isSame ? 1 : 0) + (g2.isSame ? 1 : 0);
        genderPenalty += (2 - sameCount) * 3;
      }
    }

    return (
      partnerRepeatScore * weights.partnerRepeatWeight +
      skillGap * weights.skillGapWeight +
      genderPenalty
    );
  }

  let best = options[0];
  let bestScore = Infinity;
  for (const opt of options) {
    const s = scoreOption(opt);
    if (s < bestScore) {
      bestScore = s;
      best = opt;
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

  // only use multiples of 4, cap at 5 courts
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
  const pairingMode = state.pairingMode || 'neutral';

  // 1) choose who sits out
  const sitResult = pickSitOutPlayers(activePlayers, numSit, pairingMode);
  const sitOutPlayers = sitResult.players;
  const sitOutIds = new Set(sitOutPlayers.map(p => p.id));

  let playersToPlay = activePlayers.filter(p => !sitOutIds.has(p.id));
  if (playersToPlay.length !== maxPlayersInRound) {
    console.warn('Mismatch in playersToPlay vs expected; adjusting.');
    playersToPlay = playersToPlay.slice(0, maxPlayersInRound);
  }

  // 2) group into courts
  let groups;
  if (pairingMode === 'same-gender') {
    groups = groupPlayersSameGenderFirst(playersToPlay);
  } else {
    groups = groupPlayersBySkillMode(playersToPlay);
  }

  const partnerCounts = buildPartnerCounts();
  const quartetCounts = buildQuartetCounts();
  const courts = [];
  let courtNumber = 1;
  const courtReasons = {};

  // 3) choose pairs within each court
  for (const group of groups) {
    if (group.length < 4) continue;
    const bestPairs = choosePairsForGroup(group, partnerCounts, pairingMode);

    for (const pair of bestPairs) {
      const key = pairKey(pair[0], pair[1]);
      partnerCounts[key] = (partnerCounts[key] || 0) + 1;
    }

    const playerIds = group.map(p => p.id);
    const qKey = quartetKey(playerIds);
    const timesCourtSeen = quartetCounts[qKey] || 0;
    quartetCounts[qKey] = timesCourtSeen + 1;

    let reason = `Court ${courtNumber}: `;
    if (pairingMode === 'same-gender') {
      reason += 'same-gender mode; ';
    } else if (pairingMode === 'mixed-priority') {
      reason += 'mixed-priority mode; ';
    } else {
      reason += 'neutral mode; ';
    }
    if (timesCourtSeen > 0) {
      reason += `this group of 4 has played together ${timesCourtSeen} time(s) before; `;
    } else {
      reason += 'new combination of 4 players; ';
    }
    reason += `rotation focus: ${state.rotationMode}.`;

    courts.push({
      courtNumber: courtNumber,
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
