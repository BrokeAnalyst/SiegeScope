/**
 * SiegeScope — r6fetch.js
 * Stable + production-ready version with prediction layer
 */

const WORKER_BASE = 'https://siegescope-proxy.millezbiz.workers.dev';
const TRN_BASE = 'https://api.tracker.gg';

// ─── Internal fetch helper ───────────────────────────────────────────────────

async function workerFetch(path) {
  const url = `${WORKER_BASE}/?url=${encodeURIComponent(TRN_BASE + path)}`;

  const res = await fetch(url);

  if (!res.ok) {
    console.error("Worker error:", res.status, path);
    throw new Error(`Worker fetch failed: ${res.status}`);
  }

  const json = await res.json();

  if (!json || json.errors) {
    throw new Error("Tracker API returned invalid data");
  }

  return json;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function fetchProfile(identifier) {
  if (!identifier) throw new Error("Invalid identifier");

  const encoded = encodeURIComponent(identifier);

  // Fetch BOTH in parallel (faster)
  const [profileRaw, historyRaw] = await Promise.all([
    workerFetch(`/api/v2/r6siege/standard/profile/ubi/${encoded}`),
    workerFetch(`/api/v2/r6siege/standard/profile/ubi/${encoded}/stats/overview/rankPoints?localOffset=300`)
  ]);

  const player = parseProfile(profileRaw);
  const history = parseRPHistory(historyRaw);

  // Attach prediction directly
  player.prediction = computePrediction(player, history);

  return player;
}

export async function fetchRPHistory(identifier) {
  if (!identifier) return [];

  try {
    const raw = await workerFetch(
      `/api/v2/r6siege/standard/profile/ubi/${encodeURIComponent(identifier)}/stats/overview/rankPoints?localOffset=300`
    );

    return parseRPHistory(raw);
  } catch (err) {
    console.warn("RP history failed:", err);
    return [];
  }
}

// ─── Prediction Engine ───────────────────────────────────────────────────────

function computePrediction(player, history, targetRP = 5000) {
  const currentRP = player?.ranked?.rp || 0;
  const winRate = (player?.ranked?.winPct || 0) / 100;

  if (!currentRP || history.length < 5) {
    return { status: "insufficient_data" };
  }

  let gains = [];
  let losses = [];

  for (let i = 1; i < history.length; i++) {
    const delta = history[i].rp - history[i - 1].rp;

    if (delta > 0) gains.push(delta);
    if (delta < 0) losses.push(Math.abs(delta));
  }

  const avgGain = gains.length
    ? gains.reduce((a, b) => a + b, 0) / gains.length
    : 0;

  const avgLoss = losses.length
    ? losses.reduce((a, b) => a + b, 0) / losses.length
    : 0;

  const expectedRP =
    (winRate * avgGain) - ((1 - winRate) * avgLoss);

  if (expectedRP <= 0) {
    return {
      status: "stuck",
      currentRP,
      targetRP,
      expectedRP
    };
  }

  const rpRemaining = Math.max(0, targetRP - currentRP);
  const matchesNeeded = rpRemaining / expectedRP;

  const matchesPerDay = 5;

  return {
    status: "climbing",
    currentRP,
    targetRP,
    rpRemaining,
    expectedRP,
    matchesNeeded,
    matchesPerDay,
    daysNeeded: matchesNeeded / matchesPerDay,
    avgGain,
    avgLoss,
    confidence: history.length > 30 ? "high" : "low"
  };
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseProfile(raw) {
  const d = raw?.data || {};
  const segments = Array.isArray(d.segments) ? d.segments : [];

  const platform = d.platformInfo || {};
  const meta = d.metadata || {};

  const player = {
    username:
      platform.platformUserHandle ||
      platform.platformUserIdentifier ||
      'Unknown',

    uuid: platform.platformUserId || '',
    avatarUrl: platform.avatarUrl || '',
    clearanceLevel: meta.clearanceLevel ?? 0,
    battlepass: meta.battlepassLevel ?? 0,
    currentSeason: meta.currentSeason ?? 0,
    nameHistory: (meta.nameChanges || []).map(n => n.name),
  };

  // ─── Career ─────────────────────────────────

  const overview = segments.find(s => s.type === 'overview');

  if (overview?.stats) {
    const st = overview.stats;

    player.career = {
      matchesPlayed: val(st.matchesPlayed),
      wins: val(st.matchesWon),
      losses: val(st.matchesLost),
      winPct: val(st.winPercentage),
      kills: val(st.kills),
      deaths: val(st.deaths),
      kd: val(st.kdRatio),
      killsPerMatch: val(st.killsPerMatch),
      headshotPct: val(st.headshotPercentage),
      timePlayed: val(st.timePlayed),
      assists: val(st.assists),
    };
  }

  // ─── Ranked ─────────────────────────────────

  const ranked = segments.find(
    s =>
      s.type === 'season' &&
      s.attributes?.season === player.currentSeason &&
      s.attributes?.gamemode === 'pvp_ranked'
  );

  if (ranked?.stats) {
    const st = ranked.stats;
    const rp = st.rankPoints || {};
    const mrp = st.maxRankPoints || {};

    player.ranked = {
      season: player.currentSeason,
      seasonName: ranked.metadata?.seasonName || '',
      seasonShort: ranked.metadata?.shortName || '',
      seasonColor: ranked.metadata?.color || '#a0daae',

      rp: rp.value ?? 0,
      rpDisplay: rp.displayValue || '0',
      maxRp: mrp.value ?? 0,

      rankName: rp.metadata?.name || 'Unranked',
      rankImage: rp.metadata?.imageUrl || '',

      leaderboard: rp.rank ?? null,
      topPosition: val(st.topRankPosition),

      matchesPlayed: val(st.matchesPlayed),
      wins: val(st.matchesWon),
      losses: val(st.matchesLost),
      winPct: val(st.winPercentage),

      kills: val(st.kills),
      deaths: val(st.deaths),
      kd: val(st.kdRatio),
      killsPerGame: val(st.killsPerGame),

      headshotPct:
        val(st.headshotPct) ?? val(st.headshotPercentage),

      firstBloods: val(st.firstBloods),
      clutches: val(st.clutches),

      elo: st.elo?.value ?? null,

      multikills: {
        k1: val(st.kills1K),
        k2: val(st.kills2K),
        k3: val(st.kills3K),
        k4: val(st.kills4K),
        k5: val(st.kills5K),
      },
    };
  } else {
    player.ranked = {
      rp: 0,
      winPct: 0,
      rankName: 'Unranked',
    };
  }

  // ─── Season History ─────────────────────────

  player.seasonHistory = segments
    .filter(s => s.type === 'season' && s.attributes?.gamemode === 'pvp_ranked')
    .sort((a, b) => (b.attributes?.season || 0) - (a.attributes?.season || 0))
    .map(s => {
      const st = s.stats || {};
      const rp = st.rankPoints || {};
      const mrp = st.maxRankPoints || {};

      return {
        season: s.attributes?.season ?? 0,
        seasonName: s.metadata?.seasonName || '',
        shortName: s.metadata?.shortName || '',
        color: s.metadata?.color || '#888',

        rp: rp.value ?? 0,
        maxRp: mrp.value ?? 0,

        rankName: rp.metadata?.name || 'Unranked',
        rankImage: rp.metadata?.imageUrl || '',

        wins: val(st.matchesWon),
        losses: val(st.matchesLost),
        kd: val(st.kdRatio),
        winPct: val(st.winPercentage),
        kills: val(st.kills),
      };
    });

  return player;
}

// ─── RP History ─────────────────────────────────

function parseRPHistory(raw) {
  const history = raw?.data?.history?.data;

  if (!Array.isArray(history)) return [];

  return history
    .map(entry => {
      if (!Array.isArray(entry) || entry.length < 2) return null;

      const [ts, data] = entry;

      return {
        timestamp: new Date(ts),
        rp: data?.value ?? 0,
        rank: data?.metadata?.rank || '',
        color: data?.metadata?.color || '#a0daae',
        image: data?.metadata?.imageUrl || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

// ─── Utility ─────────────────────────────────

function val(stat) {
  return stat?.value ?? null;
}

// ─── Identifier Parser ─────────────────────────

export function parseIdentifier(input) {
  if (!input) return null;

  input = input.trim();

  const urlMatch = input.match(/\/profile\/ubi\/([^/]+)/);

  if (urlMatch) {
    return decodeURIComponent(urlMatch[1]);
  }

  return input;
}
