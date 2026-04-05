// r6 tracker fetcher
/**
 * SiegeScope — r6fetch.js
 * Fetches and parses R6 Tracker data via the Cloudflare Worker proxy.
 * No direct api.tracker.gg calls. All requests go through the Worker.
 */

const WORKER_BASE = 'https://siegescope-proxy.millezbiz.workers.dev';
const TRN_BASE = 'https://api.tracker.gg';

// ─── Internal fetch helper ───────────────────────────────────────────────────

async function workerFetch(path) {
  const url = `${WORKER_BASE}/?url=${encodeURIComponent(TRN_BASE + path)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Worker fetch failed: ${res.status} for ${path}`);
  return res.json();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch full player profile + season history.
 * Returns a normalized player object with rpHistory + prediction.
 */
export async function fetchProfile(identifier) {
  const encoded = encodeURIComponent(identifier);

  const [profileResult, historyResult] = await Promise.allSettled([
    workerFetch(`/api/v2/r6siege/standard/profile/ubi/${encoded}`),
    workerFetch(`/api/v2/r6siege/standard/profile/ubi/${encoded}/stats/overview/rankPoints?localOffset=300`)
  ]);

  if (profileResult.status !== 'fulfilled') {
    throw profileResult.reason;
  }

  const player = parseProfile(profileResult.value);

  const rpHistory =
    historyResult.status === 'fulfilled'
      ? parseRPHistory(historyResult.value)
      : [];

  console.log('profileResult:', profileResult);
  console.log('historyResult:', historyResult);

  player.rpHistory = rpHistory;
  player.prediction = computePrediction(player, rpHistory);

  return player;
}

/**
 * Fetch RP history for the projection chart.
 * Returns array of { timestamp, rp, rank, color } sorted oldest→newest.
 */
export async function fetchRPHistory(identifier) {
  const raw = await workerFetch(
    `/api/v2/r6siege/standard/profile/ubi/${encodeURIComponent(identifier)}/stats/overview/rankPoints?localOffset=300`
  );
  return parseRPHistory(raw);
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

function parseProfile(raw) {
  const d = raw?.data || {};
  const segments = d.segments || [];

  // Platform / identity
  const platform = d.platformInfo || {};
  const meta = d.metadata || {};

  const player = {
    username: platform.platformUserHandle || platform.platformUserIdentifier || 'Unknown',
    uuid: platform.platformUserId || '',
    avatarUrl: platform.avatarUrl || '',
    clearanceLevel: meta.clearanceLevel || 0,
    battlepass: meta.battlepassLevel || 0,
    currentSeason: meta.currentSeason || 41,
    nameHistory: (meta.nameChanges || []).map(n => n.name),
  };

  // Career overview segment
  const overview = segments.find(s => s.type === 'overview');
  if (overview) {
    const st = overview.stats || {};
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

  // Current season ranked segment
  const currentSeason = player.currentSeason;
  const ranked = segments.find(
    s => s.type === 'season' &&
         s.attributes?.season === currentSeason &&
         s.attributes?.gamemode === 'pvp_ranked'
  );

  if (ranked) {
    const st = ranked.stats || {};
    const rp = st.rankPoints || {};
    const mrp = st.maxRankPoints || {};
    player.ranked = {
      season: currentSeason,
      seasonName: ranked.metadata?.seasonName || 'Silent Hunt',
      seasonShort: ranked.metadata?.shortName || 'Y11S1',
      seasonColor: ranked.metadata?.color || '#a0daae',
      rp: rp.value ?? null,
      rpDisplay: rp.displayValue || '—',
      maxRp: mrp.value ?? null,
      rankName: rp.metadata?.name || '—',
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
      headshotPct: val(st.headshotPct) ?? val(st.headshotPercentage),
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
  }

  // Season history — ranked only, per season, newest first
  player.seasonHistory = segments
    .filter(s => s.type === 'season' && s.attributes?.gamemode === 'pvp_ranked')
    .sort((a, b) => (b.attributes?.season || 0) - (a.attributes?.season || 0))
    .map(s => {
      const st = s.stats || {};
      const rp = st.rankPoints || {};
      const mrp = st.maxRankPoints || {};
      return {
        season: s.attributes?.season ?? null,
        seasonName: s.metadata?.seasonName || '',
        shortName: s.metadata?.shortName || '',
        color: s.metadata?.color || '#888',
        rp: rp.value ?? null,
        maxRp: mrp.value ?? null,
        rankName: rp.metadata?.name || '—',
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

function parseRPHistory(raw) {
  const history = raw?.data?.history?.data || [];
  return history
    .map(item => {
      if (!Array.isArray(item) || item.length < 2) return null;
      const [ts, entry] = item;
      return {
        timestamp: new Date(ts),
        rp: entry?.value ?? null,
        rank: entry?.metadata?.rank || '',
        color: entry?.metadata?.color || '#a0daae',
        image: entry?.metadata?.imageUrl || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

// ─── Prediction ──────────────────────────────────────────────────────────────

function computePrediction(player, history, targetRP = 5000, matchesPerDay = 5) {
  const currentRP = player?.ranked?.rp ?? null;
  const winRate = (player?.ranked?.winPct ?? 0) / 100;

  if (currentRP === null || history.length < 5) {
    return {
      status: 'insufficient_data',
      currentRP,
      targetRP,
      rpRemaining: currentRP === null ? null : Math.max(0, targetRP - currentRP),
      expectedRP: null,
      matchesNeeded: null,
      matchesPerDay,
      daysNeeded: null,
      avgGain: null,
      avgLoss: null,
      confidence: 'low',
    };
  }

  const gains = [];
  const losses = [];

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]?.rp;
    const curr = history[i]?.rp;

    if (prev == null || curr == null) continue;

    const delta = curr - prev;
    if (delta > 0) gains.push(delta);
    if (delta < 0) losses.push(Math.abs(delta));
  }

  const avgGain = gains.length
    ? gains.reduce((sum, value) => sum + value, 0) / gains.length
    : 0;

  const avgLoss = losses.length
    ? losses.reduce((sum, value) => sum + value, 0) / losses.length
    : 0;

  const expectedRP = (winRate * avgGain) - ((1 - winRate) * avgLoss);
  const rpRemaining = Math.max(0, targetRP - currentRP);
  const confidence = history.length > 30 ? 'high' : 'low';

  if (rpRemaining === 0) {
    return {
      status: 'goal_reached',
      currentRP,
      targetRP,
      rpRemaining: 0,
      expectedRP,
      matchesNeeded: 0,
      matchesPerDay,
      daysNeeded: 0,
      avgGain,
      avgLoss,
      confidence,
    };
  }

  if (expectedRP <= 0) {
    return {
      status: 'stuck',
      currentRP,
      targetRP,
      rpRemaining,
      expectedRP,
      matchesNeeded: null,
      matchesPerDay,
      daysNeeded: null,
      avgGain,
      avgLoss,
      confidence,
    };
  }

  const matchesNeeded = rpRemaining / expectedRP;
  const daysNeeded = matchesPerDay > 0 ? matchesNeeded / matchesPerDay : null;

  return {
    status: 'climbing',
    currentRP,
    targetRP,
    rpRemaining,
    expectedRP,
    matchesNeeded,
    matchesPerDay,
    daysNeeded,
    avgGain,
    avgLoss,
    confidence,
  };
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function val(stat) {
  return stat?.value ?? null;
}

/**
 * Parse a player identifier from a URL or raw username/UUID.
 * Accepts:
 *   - https://r6.tracker.network/r6siege/profile/ubi/Beaulo/overview
 *   - Beaulo
 *   - 3cc51897-49c4-45f6-af9d-66507b8ef0e1
 */
export function parseIdentifier(input) {
  if (!input) return null;
  input = input.trim();

  const urlMatch = input.match(/\/profile\/ubi\/([^/]+)/);
  if (urlMatch) return decodeURIComponent(urlMatch[1]);

  return input;
}