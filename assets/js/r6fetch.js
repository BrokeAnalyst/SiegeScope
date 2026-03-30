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
 * Returns a normalized player object.
 */
export async function fetchProfile(identifier) {
  const raw = await workerFetch(`/api/v2/r6siege/standard/profile/ubi/${encodeURIComponent(identifier)}`);
  return parseProfile(raw);
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
  const d = raw.data;
  const segments = d.segments || [];

  // Platform / identity
  const platform = d.platformInfo || {};
  const meta     = d.metadata    || {};

  const player = {
    username:       platform.platformUserHandle || platform.platformUserIdentifier || 'Unknown',
    uuid:           platform.platformUserId || '',
    avatarUrl:      platform.avatarUrl || '',
    clearanceLevel: meta.clearanceLevel || 0,
    battlepass:     meta.battlepassLevel || 0,
    currentSeason:  meta.currentSeason   || 41,
    nameHistory:    (meta.nameChanges || []).map(n => n.name),
  };

  // Career overview segment
  const overview = segments.find(s => s.type === 'overview');
  if (overview) {
    const st = overview.stats;
    player.career = {
      matchesPlayed: val(st.matchesPlayed),
      wins:          val(st.matchesWon),
      losses:        val(st.matchesLost),
      winPct:        val(st.winPercentage),
      kills:         val(st.kills),
      deaths:        val(st.deaths),
      kd:            val(st.kdRatio),
      killsPerMatch: val(st.killsPerMatch),
      headshotPct:   val(st.headshotPercentage),
      timePlayed:    val(st.timePlayed),     // seconds
      assists:       val(st.assists),
    };
  }

  // Current season ranked segment
  const currentSeason = player.currentSeason;
  const ranked = segments.find(
    s => s.type === 'season' &&
         s.attributes.season === currentSeason &&
         s.attributes.gamemode === 'pvp_ranked'
  );

  if (ranked) {
    const st  = ranked.stats;
    const rp  = st.rankPoints  || {};
    const mrp = st.maxRankPoints || {};
    player.ranked = {
      season:        currentSeason,
      seasonName:    ranked.metadata.seasonName || 'Silent Hunt',
      seasonShort:   ranked.metadata.shortName  || 'Y11S1',
      seasonColor:   ranked.metadata.color      || '#a0daae',
      rp:            rp.value     ?? null,
      rpDisplay:     rp.displayValue || '—',
      maxRp:         mrp.value    ?? null,
      rankName:      rp.metadata?.name || '—',
      rankImage:     rp.metadata?.imageUrl || '',
      leaderboard:   rp.rank      ?? null,
      topPosition:   val(st.topRankPosition),
      matchesPlayed: val(st.matchesPlayed),
      wins:          val(st.matchesWon),
      losses:        val(st.matchesLost),
      winPct:        val(st.winPercentage),
      kills:         val(st.kills),
      deaths:        val(st.deaths),
      kd:            val(st.kdRatio),
      killsPerGame:  val(st.killsPerGame),
      headshotPct:   val(st.headshotPct),
      firstBloods:   val(st.firstBloods),
      clutches:      val(st.clutches),
      elo:           st.elo?.value ?? null,
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
    .filter(s => s.type === 'season' && s.attributes.gamemode === 'pvp_ranked')
    .sort((a, b) => b.attributes.season - a.attributes.season)
    .map(s => {
      const st  = s.stats;
      const rp  = st.rankPoints    || {};
      const mrp = st.maxRankPoints || {};
      return {
        season:      s.attributes.season,
        seasonName:  s.metadata.seasonName  || '',
        shortName:   s.metadata.shortName   || '',
        color:       s.metadata.color       || '#888',
        rp:          rp.value    ?? null,
        maxRp:       mrp.value   ?? null,
        rankName:    rp.metadata?.name || '—',
        rankImage:   rp.metadata?.imageUrl || '',
        wins:        val(st.matchesWon),
        losses:      val(st.matchesLost),
        kd:          val(st.kdRatio),
        winPct:      val(st.winPercentage),
        kills:       val(st.kills),
      };
    });

  return player;
}

function parseRPHistory(raw) {
  const history = raw?.data?.history?.data || [];
  // Each entry: [isoTimestamp, {value, metadata:{rank, color, imageUrl}}]
  return history
    .map(([ts, entry]) => ({
      timestamp: new Date(ts),
      rp:        entry.value,
      rank:      entry.metadata?.rank  || '',
      color:     entry.metadata?.color || '#a0daae',
      image:     entry.metadata?.imageUrl || '',
    }))
    .sort((a, b) => a.timestamp - b.timestamp); // oldest first for chart
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

  // Full tracker URL
  const urlMatch = input.match(/\/profile\/ubi\/([^/]+)/);
  if (urlMatch) return decodeURIComponent(urlMatch[1]);

  // Already a clean identifier
  return input;
}
