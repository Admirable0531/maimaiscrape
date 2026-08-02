const https = require('https');
const http = require('http');

/**
 * SEGA's image hosts serve art on a non-standard TLS chain — relaxing
 * verification for those hosts only (not globally, unlike a prior version
 * of this code that set NODE_TLS_REJECT_UNAUTHORIZED=0 for the whole
 * process). Mirrors express_server.js's own fetchBinary/relaxedAgent; kept
 * as a separate shared copy rather than refactoring that already-working
 * endpoint to import this.
 */
const relaxedAgent = new https.Agent({ rejectUnauthorized: false });
const RELAXED_TLS_HOSTS = /(^|\.)(maimaidx(-eng)?\.(jp|com)|maimai\.sega\.jp)$/;

/** Downloads a binary body, relaxing TLS verification for SEGA hosts only. */
function fetchBinary(url, redirectsLeft = 3) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(url);
        } catch (err) {
            reject(new Error(`invalid url: ${err.message}`));
            return;
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            reject(new Error('only http(s) urls are supported'));
            return;
        }

        const transport = parsed.protocol === 'https:' ? https : http;
        const options = RELAXED_TLS_HOSTS.test(parsed.hostname) ? { agent: relaxedAgent } : {};

        transport
            .get(parsed, options, (res) => {
                const { statusCode = 0, headers } = res;
                if (statusCode >= 300 && statusCode < 400 && headers.location && redirectsLeft > 0) {
                    res.resume();
                    resolve(fetchBinary(new URL(headers.location, parsed).toString(), redirectsLeft - 1));
                    return;
                }
                if (statusCode < 200 || statusCode >= 300) {
                    res.resume();
                    reject(Object.assign(new Error(`upstream returned ${statusCode}`), { statusCode }));
                    return;
                }
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({
                        buffer: Buffer.concat(chunks),
                        mime: headers['content-type'] || 'image/jpeg',
                    })
                );
            })
            .on('error', reject);
    });
}

module.exports = { fetchBinary };
