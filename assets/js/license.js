(function () {
  "use strict";

  const CONFIG_URL = "./config.json";
  const STORAGE_KEY = "siegescope_license";

  let _config = null;

  async function loadConfig() {
    if (_config) return _config;
    const res = await fetch(CONFIG_URL);
    _config = await res.json();
    return _config;
  }

  function parseKey(key) {
    if (!key || typeof key !== "string") return null;
    const clean = key.trim().toUpperCase();
    const parts = clean.split("-");
    if (parts.length !== 4) return null;
    const [seasonPrefix, tierCode, block1, block2] = parts;
    if (!/^SS\d{2}$/.test(seasonPrefix)) return null;
    if (!/^[A-Z0-9]{4}$/.test(block1)) return null;
    if (!/^[A-Z0-9]{4}$/.test(block2)) return null;
    return { raw: clean, seasonPrefix, tierCode, block1, block2 };
  }

  function decodeTier(tierCode) {
    const map = {
      INDV: "individual",
      TEAM: "team",
      ORGX: "org",
      FREE: "freelancer",
      TRAL: "trial",
    };
    return map[tierCode] || null;
  }

  function decodeTrialExpiry(block1, block2) {
    try {
      const raw = block1 + block2;
      const daysSinceEpoch = parseInt(raw.slice(0, 5), 36);
      const trialDays = parseInt(raw.slice(5), 36);
      const activatedDate = new Date(daysSinceEpoch * 86400000);
      const expiryDate = new Date(activatedDate.getTime() + trialDays * 86400000);
      return expiryDate;
    } catch (_) {
      return null;
    }
  }

  async function validateKey(key) {
    const config = await loadConfig();
    const parsed = parseKey(key);

    if (!parsed) {
      return { valid: false, reason: "Invalid key format. Expected: SS41-XXXX-XXXX-XXXX" };
    }

    const expectedPrefix = config.activeSeason;
    if (parsed.seasonPrefix !== expectedPrefix) {
      const isOldSeason = parsed.seasonPrefix < expectedPrefix;
      return {
        valid: false,
        reason: isOldSeason
          ? `This key is for a previous season. Purchase a ${config.seasonLabel} key to continue.`
          : `This key is for a future season and cannot be activated yet.`,
        expired: isOldSeason,
      };
    }

    const tier = decodeTier(parsed.tierCode);
    if (!tier) {
      return { valid: false, reason: "Unrecognized tier code. Check your key and try again." };
    }

    if (tier === "trial") {
      const expiry = decodeTrialExpiry(parsed.block1, parsed.block2);
      const now = new Date();
      if (!expiry || now > expiry) {
        return {
          valid: false,
          reason: "This trial key has expired. Choose a plan to continue.",
          expired: true,
          tier: "trial",
        };
      }
      return {
        valid: true,
        tier: "trial",
        label: "Trial",
        expiresAt: expiry.toISOString(),
        expiresLabel: expiry.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        features: config.tiers.trial.features,
        daysLeft: Math.ceil((expiry - now) / 86400000),
      };
    }

    const seasonEnd = new Date(config.seasonEnd);
    const now = new Date();
    if (now > seasonEnd) {
      return {
        valid: false,
        reason: `Season 41 has ended. Purchase a ${config.nextSeasonLabel} key to continue.`,
        expired: true,
        tier,
      };
    }

    const tierConfig = config.tiers[tier];
    const daysLeft = Math.ceil((seasonEnd - now) / 86400000);

    return {
      valid: true,
      tier,
      label: tierConfig.label,
      expiresAt: seasonEnd.toISOString(),
      expiresLabel: seasonEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      features: tierConfig.features,
      maxPlayers: tierConfig.maxPlayers,
      daysLeft,
    };
  }

  function saveLicense(key, result) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ key, result, savedAt: new Date().toISOString() })
    );
  }

  function loadSavedLicense() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function clearLicense() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function hasFeature(feature) {
    const saved = loadSavedLicense();
    if (!saved || !saved.result || !saved.result.valid) return false;
    return saved.result.features.includes(feature);
  }

  function currentTier() {
    const saved = loadSavedLicense();
    if (!saved || !saved.result || !saved.result.valid) return null;
    return saved.result.tier;
  }

  function daysRemaining() {
    const saved = loadSavedLicense();
    if (!saved || !saved.result || !saved.result.valid) return 0;
    return saved.result.daysLeft || 0;
  }

  async function activate(key) {
    const result = await validateKey(key);
    if (result.valid) {
      saveLicense(key, result);
    }
    return result;
  }

  async function checkOnLoad() {
    const saved = loadSavedLicense();
    if (!saved) return { status: "none" };
    const result = await validateKey(saved.key);
    if (!result.valid) {
      return { status: "expired", tier: saved.result?.tier || null, reason: result.reason };
    }
    saveLicense(saved.key, result);
    return { status: "active", ...result };
  }

  window.SiegeLicense = {
    activate,
    checkOnLoad,
    hasFeature,
    currentTier,
    daysRemaining,
    clearLicense,
    loadSavedLicense,
  };
})();
