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
// Much shorter than the general webpage cache — this is live account data
// (ratings, play records) that can change from actual gameplay during a
// conversation, not a wiki article. Still worth a short cache so a burst of
// tool calls about the same page within one reply doesn't refetch it.
const MAIMAI_ACCOUNT_CACHE_TTL_MS = 2 * 60 * 1000;

module.exports = {
    TtlCache,
    webpageCache: new TtlCache(WEBPAGE_CACHE_TTL_MS),
    searchCache: new TtlCache(SEARCH_CACHE_TTL_MS),
    maimaiAccountCache: new TtlCache(MAIMAI_ACCOUNT_CACHE_TTL_MS),
};
