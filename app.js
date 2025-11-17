// ===========================
//  STATE & PERSISTENCE
// ===========================

const STORAGE_KEY = 'tennis-fixtures-state';

let state = loadState();

function defaultState() {
  return {
    players: [],          // array of { id, name, gender, skill, isPresent, happyToSit, gamesPlayed, sits }
    rounds: [],           // array of { roundNumber, courts: [ { courtNumber, players:[ids], pairs:[[id,id],[id,id]] } ], sitOut:[ids] }
    nextPlayerId: 1,
    nextRoundNumber: 1
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed.players || !Array.isArray(parsed.players)) {
      return defaultState();
    }

    // Basic sanity / backwards-compat if old objects exist
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

// Count how many times each pair has been partners across all rounds
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

function getPlayerById(id) {
  return state.players.find(p => p.id === id) || null;
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
    const presentCheckbox = document.createElement('input');
    presentCheckbox.type = 'checkbox';
    presentCheckbox.checked = !!p.isPresent;
    presentCheckbox.addEventListener('change', () => {
      p.isPresent = presentCheckbox.checked;
      saveState();
    });
    presentTd.appendChild(presentCheckbox);

    const happyTd = document.createElement('td');
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
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.className = 'danger-btn';
    deleteBtn.title = 'Delete player';
    deleteBtn.addEventListener('click', () => {
      const ok = confirm(`Delete player "${p.name}"? They will be removed from the list but kept in old rounds.`);
      if (!ok) return;
      p.isArchived = true;
      p.isPresent = false;    // make sure they aren't selected
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

    for (const court of round.courts) {
      const li = document.createElement('li');

      const [pair1, pair2] = court.pairs;
      const p1a = getPlayerById(pair1[0]);
      const p1b = getPlayerById(pair1[1]);
      const p2a = getPlayerById(pair2[0]);
      const p2b = getPlayerById(pair2[1]);

      const text = `Court ${court.courtNumber}: ${p1a?.name ?? '?'} & ${p1b?.name ?? '?'}  vs  ${p2a?.name ?? '?'} & ${p2b?.name ?? '?'}`;
      li.textContent = text;
      ul.appendChild(li);
    }

    card.appendChild(ul);
    roundsContainer.appendChild(card);
  }
}

// ===========================
//  SITTING-OUT LOGIC
//  (this is "king" and runs BEFORE gender modes)
// ===========================

function pickSitOutPlayers(activePlayers, numSit) {
  if (numSit <= 0) return [];

  // Priority:
  // 1) sits ASC  (fewest times sat out)
  // 2) happyToSit DESC (true first)
  // 3) gamesPlayed DESC (most games -> more likely to rest)
  // 4) name ASC (stable tiebreaker)
  const sorted = activePlayers.slice().sort((a, b) => {
    if (a.sits !== b.sits) return a.sits - b.sits;

    const happyA = a.happyToSit ? 1 : 0;
    const happyB = b.happyToSit ? 1 : 0;
    if (happyA !== happyB) return happyB - happyA;

    if (a.gamesPlayed !== b.gamesPlayed) return b.gamesPlayed - a.gamesPlayed;

    return a.name.localeCompare(b.name);
  });

  return sorted.slice(0, numSit);
}

// ===========================
//  GROUPING PLAYERS INTO COURTS
// ===========================

// Skill-based grouping (used in neutral / mixed priority modes,
// and for leftovers in same-gender mode)
function groupPlayersBySkillMode(playersToPlay) {
  const numCourts = playersToPlay.length / 4;
  const groups = [];

  const mode = (skillModeSelect && skillModeSelect.value) || 'balanced';

  if (mode === 'random') {
    const shuffled = shuffle(playersToPlay);
    for (let i = 0; i < shuffled.length; i += 4) {
      const group = shuffled.slice(i, i + 4);
      if (group.length === 4) groups.push(group);
    }
    return groups;
  }

  if (mode === 'clustered') {
    // Group high skill with high, low with low
    const sorted = playersToPlay.slice().sort((a, b) => b.skill - a.skill);
    for (let i = 0; i < sorted.length; i += 4) {
      const group = sorted.slice(i, i + 4);
      if (group.length === 4) groups.push(group);
    }
    return groups;
  }

  // Balanced: try to spread strong players across courts
  const sorted = playersToPlay.slice().sort((a, b) => b.skill - a.skill);
  const courts = Array.from({ length: numCourts }, () => []);

  // "Snake" distribution: 1→N then N→1 etc.
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

// Same-gender mode: build as many single-gender courts as possible,
// then group any remaining mixed players by skill.
function groupPlayersSameGenderFirst(playersToPlay) {
  const males = playersToPlay.filter(p => p.gender === 'M');
  const females = playersToPlay.filter(p => p.gender === 'F');
  const others = playersToPlay.filter(p => p.gender !== 'M' && p.gender !== 'F');

  // Randomise within gender lists a bit so the same people don't always cluster
  const mList = shuffle(males);
  const fList = shuffle(females);
  const oList = shuffle(others);

  const groups = [];

  let mIndex = 0;
  let fIndex = 0;

  const mCourts = Math.floor(mList.length / 4);
  const fCourts = Math.floor(fList.length / 4);

  // First, create all-male courts
  for (let i = 0; i < mCourts; i++) {
    const group = mList.slice(mIndex, mIndex + 4);
    if (group.length === 4) groups.push(group);
    mIndex += 4;
  }

  // Then, create all-female courts
  for (let i = 0; i < fCourts; i++) {
    const group = fList.slice(fIndex, fIndex + 4);
    if (group.length === 4) groups.push(group);
    fIndex += 4;
  }

  // Remaining players (mixed gender and/or "other") are grouped by skill mode
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

// Pair info helper
function getPairGenderInfo(pair) {
  const pa = getPlayerById(pair[0]);
  const pb = getPlayerById(pair[1]);
  const ga = pa?.gender;
  const gb = pb?.gender;
  const isMixed = !!(ga && gb && ga !== gb);
  const isSame = !!(ga && gb && ga === gb);
  return { isMixed, isSame };
}

// Choose 2 pairs from a group of 4, given partnerCounts and mode
function choosePairsForGroup(group, partnerCounts, pairingMode) {
  const [a, b, c, d] = group;

  const options = [
    [[a.id, b.id], [c.id, d.id]],
    [[a.id, c.id], [b.id, d.id]],
    [[a.id, d.id], [b.id, c.id]]
  ];

  // Basic scoring: fewer repeat partnerings -> lower score
  function partnerScoreForOption(opt) {
    const [p1, p2] = opt;
    const key1 = pairKey(p1[0], p1[1]);
    const key2 = pairKey(p2[0], p2[1]);
    return (partnerCounts[key1] || 0) + (partnerCounts[key2] || 0);
  }

  // Count mixed pairs in an option
  function mixedCountForOption(opt) {
    const [p1, p2] = opt;
    const i1 = getPairGenderInfo(p1);
    const i2 = getPairGenderInfo(p2);
    return (i1.isMixed ? 1 : 0) + (i2.isMixed ? 1 : 0);
  }

  // Quick gender summary for this group
  const genders = group.map(p => p.gender);
  const numM = genders.filter(g => g === 'M').length;
  const numF = genders.filter(g => g === 'F').length;
  const has2M2F = (numM === 2 && numF === 2);

  // ---- MODE: SAME-GENDER PRIORITY ----
  if (pairingMode === 'same-gender') {
    const allSameGender = (numM === 4 || numF === 4 || (numM + numF === 0));

    // If the group is all-male or all-female (or no M/F info), just minimise repeat partners
    if (allSameGender) {
      let best = options[0];
      let bestScore = Infinity;
      for (const opt of options) {
        const score = partnerScoreForOption(opt);
        if (score < bestScore) {
          bestScore = score;
          best = opt;
        }
      }
      return best;
    }

    // If exactly 2M + 2F in this leftover group, prefer mixed doubles: M+F vs M+F
    if (has2M2F) {
      const mixedOptions = options.filter(opt => mixedCountForOption(opt) === 2);
      if (mixedOptions.length > 0) {
        let best = mixedOptions[0];
        let bestScore = Infinity;
        for (const opt of mixedOptions) {
          const score = partnerScoreForOption(opt);
          if (score < bestScore) {
            bestScore = score;
            best = opt;
          }
        }
        return best;
      }
    }

    // Other combos (e.g. 3M1F, 1M3F) – just minimise repeat partners
    let best = options[0];
    let bestScore = Infinity;
    for (const opt of options) {
      const score = partnerScoreForOption(opt);
      if (score < bestScore) {
        bestScore = score;
        best = opt;
      }
    }
    return best;
  }

  // ---- MODE: MIXED DOUBLES FOCUS ----
  if (pairingMode === 'mixed-priority') {
    let best = options[0];
    let bestScore = Infinity;
    let bestMixed = -1;

    for (const opt of options) {
      const partnerScore = partnerScoreForOption(opt);
      const mixedCount = mixedCountForOption(opt);

      // Objective: maximise mixedCount, then minimise partnerScore
      // So we sort primarily by (-mixedCount), then by partnerScore
      const scoreTuple = { mixedCount, partnerScore };

      if (
        scoreTuple.mixedCount > bestMixed ||
        (scoreTuple.mixedCount === bestMixed && scoreTuple.partnerScore < bestScore)
      ) {
        bestMixed = scoreTuple.mixedCount;
        bestScore = scoreTuple.partnerScore;
        best = opt;
      }
    }

    return best;
  }

  // ---- MODE: NEUTRAL (no gender preference) ----
  // Just minimise repeat partners
  let best = options[0];
  let bestScore = Infinity;
  for (const opt of options) {
    const score = partnerScoreForOption(opt);
    if (score < bestScore) {
      bestScore = score;
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

  // We only use multiples of 4; others must sit out
  // Also cap at 5 courts (20 players max).
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

  // 1) SITTING OUT — this is the highest priority
  const sitOutPlayers = pickSitOutPlayers(activePlayers, numSit);
  const sitOutIds = new Set(sitOutPlayers.map(p => p.id));

  // Final list of players who will actually play this round
  let playersToPlay = activePlayers.filter(p => !sitOutIds.has(p.id));

  if (playersToPlay.length !== maxPlayersInRound) {
    console.warn('Mismatch in playersToPlay vs expected; adjusting.');
    playersToPlay = playersToPlay.slice(0, maxPlayersInRound);
  }

  // 2) GROUPING INTO COURTS
  const pairingMode = pairingModeSelect ? pairingModeSelect.value : 'neutral';

  let groups;
  if (pairingMode === 'same-gender') {
    groups = groupPlayersSameGenderFirst(playersToPlay);
  } else {
    groups = groupPlayersBySkillMode(playersToPlay);
  }

  const partnerCounts = buildPartnerCounts();
  const courts = [];
  let courtNumber = 1;

  // 3) PAIRING WITHIN EACH COURT
  for (const group of groups) {
    if (group.length < 4) continue; // safety; shouldn't happen
    const bestPairs = choosePairsForGroup(group, partnerCounts, pairingMode);

    // Update partner counts for chosen pairs
    for (const pair of bestPairs) {
      const key = pairKey(pair[0], pair[1]);
      partnerCounts[key] = (partnerCounts[key] || 0) + 1;
    }

    courts.push({
      courtNumber: courtNumber++,
      players: group.map(p => p.id),
      pairs: bestPairs
    });
  }

  if (courts.length === 0) {
    alert('Could not form any courts. Check players present.');
    return;
  }

  // 4) UPDATE STATS FOR THIS ROUND
  const playingIds = new Set(playersToPlay.map(p => p.id));

  state.players.forEach(p => {
    if (!p.isPresent) return; // not here this round at all

    if (playingIds.has(p.id)) {
      p.gamesPlayed = (p.gamesPlayed || 0) + 1;
    } else if (sitOutIds.has(p.id)) {
      p.sits = (p.sits || 0) + 1;
    }
  });

  const newRound = {
    roundNumber: state.nextRoundNumber++,
    courts,
    sitOut: sitOutPlayers.map(p => p.id)
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
    p.isPresent = false; // optional reset; change if you want to keep "present"
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
