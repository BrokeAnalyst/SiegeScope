// session storage
/**
 * SiegeScope — store.js
 * localStorage session manager for caching player data and search history.
 */

const KEYS = {
  PLAYER_CACHE:  'ss_player_',     // prefix + identifier
  RP_CACHE:      'ss_rp_',         // prefix + identifier
  RECENT:        'ss_recent',      // JSON array of recent identifiers
  RIVALS:        'ss_rivals',      // JSON array of rival identifiers
  REFRESH_TS:    'ss_refresh_',    // prefix + identifier → ISO timestamp
};

const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes
const MAX_RECENT   = 10;

// ─── Player Cache ─────────────────────────────────────────────────────────────

export function cachePlayer(identifier, playerData) {
  const key = KEYS.PLAYER_CACHE + _normalize(identifier);
  localStorage.setItem(key, JSON.stringify({
    data:      playerData,
    cachedAt:  Date.now(),
  }));
  _addToRecent(identifier);
}

export function getCachedPlayer(identifier) {
  const key  = KEYS.PLAYER_CACHE + _normalize(identifier);
  const raw  = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (Date.now() - obj.cachedAt > CACHE_TTL_MS) return null;
    return obj.data;
  } catch { return null; }
}

// ─── RP History Cache ─────────────────────────────────────────────────────────

export function cacheRPHistory(identifier, historyData) {
  const key = KEYS.RP_CACHE + _normalize(identifier);
  localStorage.setItem(key, JSON.stringify({
    data:     historyData,
    cachedAt: Date.now(),
  }));
}

export function getCachedRPHistory(identifier) {
  const key = KEYS.RP_CACHE + _normalize(identifier);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (Date.now() - obj.cachedAt > CACHE_TTL_MS) return null;
    // Rehydrate Date objects
    const data = obj.data.map(entry => ({
      ...entry,
      timestamp: new Date(entry.timestamp),
    }));
    return data;
  } catch { return null; }
}

// ─── Recent Searches ──────────────────────────────────────────────────────────

export function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.RECENT) || '[]');
  } catch { return []; }
}

function _addToRecent(identifier) {
  const norm    = _normalize(identifier);
  let   recent  = getRecent().filter(r => _normalize(r) !== norm);
  recent.unshift(identifier);
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
  localStorage.setItem(KEYS.RECENT, JSON.stringify(recent));
}

export function clearRecent() {
  localStorage.removeItem(KEYS.RECENT);
}

// ─── Rivals ───────────────────────────────────────────────────────────────────

export function getRivals() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.RIVALS) || '[]');
  } catch { return []; }
}

export function addRival(identifier) {
  const norm   = _normalize(identifier);
  let   rivals = getRivals().filter(r => _normalize(r) !== norm);
  rivals.unshift(identifier);
  localStorage.setItem(KEYS.RIVALS, JSON.stringify(rivals));
}

export function removeRival(identifier) {
  const norm   = _normalize(identifier);
  const rivals = getRivals().filter(r => _normalize(r) !== norm);
  localStorage.setItem(KEYS.RIVALS, JSON.stringify(rivals));
}

// ─── Last Refresh Timestamps ──────────────────────────────────────────────────

export function getLastRefresh(identifier) {
  const ts = localStorage.getItem(KEYS.REFRESH_TS + _normalize(identifier));
  return ts ? new Date(ts) : null;
}

export function setLastRefresh(identifier) {
  localStorage.setItem(KEYS.REFRESH_TS + _normalize(identifier), new Date().toISOString());
}

export function timeSinceRefresh(identifier) {
  const last = getLastRefresh(identifier);
  if (!last) return null;
  const ms = Date.now() - last.getTime();
  if (ms < 60_000)   return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3600_000)}h ago`;
}

// ─── Full Clear ───────────────────────────────────────────────────────────────

export function clearAllCache() {
  Object.keys(localStorage)
    .filter(k => k.startsWith('ss_'))
    .forEach(k => localStorage.removeItem(k));
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function _normalize(identifier) {
  return (identifier || '').trim().toLowerCase().replace(/\s+/g, '_');
}
