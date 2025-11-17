// ---- State & persistence ----

const STORAGE_KEY = 'tennis-fixtures-state';

let state = loadState();

function defaultState() {
  return {
    players: [],
    rounds: [],
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

    // Backwards-compat: ensure new fields exist
    parsed.players.forEach(p => {
      if (typeof p.gamesPlayed !== 'number') p.gamesPlayed = 0;
      if (typeof p.sits !== 'number') p.sits = 0;
      if (typeof p.happyToSit !== 'boolean') p.happyToSit = false;
      if (typeof p.isPresent !== 'boolean') p.isPresent = false;
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

// ---- Utility helpers ----

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

// Build a map of how many times each pair has been partners
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

// ---- DOM elements ----

const addPlayerForm = document.getElementById('add-player-form');
const playerNameInput = document.getElementById('player-name');
const playerGenderSelect = document.getElementById('player-gender');
const playerSkillInput = document.getElementById('player-skill');
const playersTableBody = document.getElementById('players-table-body');

const clearDayBtn = document.getElementById('clear-day-btn');
const generateRoundBtn = document.getElementById('generate-round-btn');
const roundsContainer = document.getElementById('rounds-container');

const mixedSlider = document.getElementById('mixed-slider');
const mixedSliderValue = document.getElementById('mixed-slider-value');
const skillModeSelect = document.getElementById('skill-mode');

// ---- Helpers ----

function getPlayerById(id) {
  return state.players.find(p => p.id === id) || null;
}

// ---- Rendering ----

function renderPlayers() {
  playersTableBody.innerHTML = '';
  const players = state.players.slice().sort((a, b) => a.name.localeCompare(b.name));

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

    tr.appendChild(nameTd);
    tr.appendChild(genderTd);
    tr.appendChild(skillTd);
    tr.appendChild(presentTd);
    tr.appendChild(happyTd);
    tr.appendChild(playedTd);
    tr.appendChild(sitsTd);

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

  for (const round of state.rounds) {
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

// ---- Sitting-out & round generation ----

function pickSitOutPlayers(activePlayers, numSit) {
  if (numSit <= 0) return [];

  // Sort by:
  // 1) sits ASC  (fewest times sat out)
  // 2) happyToSit DESC (true first)
  // 3) gamesPlayed DESC (most games -> more likely to sit)
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

function generateNextRound() {
  const activePlayers = state.players.filter(p => p.isPresent);
  if (activePlayers.length < 4) {
    alert('Need at least 4 players marked as present to create a round.');
    return;
  }

  const maxPlayersInRound = Math.floor(activePlayers.length / 4) * 4;
  if (maxPlayersInRound < 4) {
    alert('Not enough players for a full court.');
    return;
  }

  const numSit = activePlayers.length - maxPlayersInRound;

  // Decide who sits out (if anyone)
  const sitOutPlayers = pickSitOutPlayers(activePlayers, numSit);
  const sitOutIds = new Set(sitOutPlayers.map(p => p.id));

  let playersToPlay = activePlayers.filter(p => !sitOutIds.has(p.id));

  if (playersToPlay.length !== maxPlayersInRound) {
    console.warn('Mismatch in playersToPlay vs expected; adjusting.');
    playersToPlay = playersToPlay.slice(0, maxPlayersInRound);
  }

  // Now generate courts from playersToPlay
  const shuffled = shuffle(playersToPlay);
  const partnerCounts = buildPartnerCounts();

  const courts = [];
  let courtNumber = 1;

  for (let i = 0; i < shuffled.length; i += 4) {
    const group = shuffled.slice(i, i + 4);
    if (group.length < 4) break;

    const [a, b, c, d] = group;

    const options = [
      [[a.id, b.id], [c.id, d.id]],
      [[a.id, c.id], [b.id, d.id]],
      [[a.id, d.id], [b.id, c.id]]
    ];

    let bestOption = options[0];
    let bestScore = Infinity;

    for (const opt of options) {
      const [p1, p2] = opt;
      const key1 = pairKey(p1[0], p1[1]);
      const key2 = pairKey(p2[0], p2[1]);
      const score = (partnerCounts[key1] || 0) + (partnerCounts[key2] || 0);
      if (score < bestScore) {
        bestScore = score;
        bestOption = opt;
      }
    }

    // Update partner counts for chosen pairs
    for (const pair of bestOption) {
      const key = pairKey(pair[0], pair[1]);
      partnerCounts[key] = (partnerCounts[key] || 0) + 1;
    }

    courts.push({
      courtNumber: courtNumber++,
      players: group.map(p => p.id),
      pairs: bestOption
    });
  }

  if (courts.length === 0) {
    alert('Could not form any courts. Check players present.');
    return;
  }

  // Update stats: gamesPlayed & sits
  const playingIds = new Set(playersToPlay.map(p => p.id));

  state.players.forEach(p => {
    if (!p.isPresent) return; // not here this round

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

// ---- Event wiring ----

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
    sits: 0
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
    p.isPresent = false; // optionally clear presence
  });
  saveState();
  renderPlayers();
  renderRounds();
});

generateRoundBtn.addEventListener('click', () => {
  generateNextRound();
});

mixedSlider.addEventListener('input', () => {
  mixedSliderValue.textContent = mixedSlider.value + '%';
});

// ---- Initial render ----

renderPlayers();
renderRounds();
mixedSliderValue.textContent = mixedSlider.value + '%';
