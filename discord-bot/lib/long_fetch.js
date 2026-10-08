const { Agent, fetch } = require('undici');

// fetch() for requests that legitimately take longer than 5 minutes to answer,
// like /run-update-user-data, which only replies once every friend's page has
// been scraped.
//
// Node's built-in fetch gives up on any response whose headers take more than
// 300s (undici's default headersTimeout), and an AbortSignal.timeout() passed
// by the caller does not lift that limit. So a 45-minute budget was really a
// 5-minute one: the daily pipeline logged "scrape-top-scores — fetch failed
// (301s)" while the scrape carried on in the api and finished fine, and the
// pipeline moved straight on to post-score-update against a half-written
// scrape. This agent turns undici's own timeouts off, leaving the caller's
// signal as the only limit, so every caller must pass one.
const noTimeoutAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

function longFetch(url, options) {
    if (!options?.signal) {
        throw new Error('longFetch needs a signal: it has no timeout of its own');
    }
    return fetch(url, { ...options, dispatcher: noTimeoutAgent });
}

module.exports = { longFetch };
