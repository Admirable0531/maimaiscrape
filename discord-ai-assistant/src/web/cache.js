/** Minimal in-memory TTL cache — one instance per resource type, each with its own expiry. */
class TtlCache {
    constructor(ttlMs) {
        this.ttlMs = ttlMs;
        this.store = new Map();
    }

    get(key) {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }
        return entry.value;
    }

    set(key, value) {
        this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    }
}

const WEBPAGE_CACHE_TTL_MS = 15 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

module.exports = {
    TtlCache,
    webpageCache: new TtlCache(WEBPAGE_CACHE_TTL_MS),
    searchCache: new TtlCache(SEARCH_CACHE_TTL_MS),
};
