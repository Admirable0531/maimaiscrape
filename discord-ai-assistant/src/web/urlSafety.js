const dns = require('node:dns').promises;
const net = require('node:net');

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** IPv4 ranges considered private, reserved, loopback, or link-local. */
function isPrivateIPv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true; // malformed -> unsafe
    const [a, b] = parts;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
    if (a >= 224) return true; // multicast + reserved
    return false;
}

/** IPv6 ranges considered private/reserved/loopback/link-local, including IPv4-mapped addresses. */
function isPrivateIPv6(ip) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true; // loopback / unspecified
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 unique local
    if (/^fe[89ab]/.test(normalized)) return true; // fe80::/10 link-local

    // IPv4-mapped (::ffff:a.b.c.d) — check the embedded IPv4 too, a known SSRF bypass.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    if (mapped) return isPrivateIPv4(mapped[1]);
    return false;
}

function isPrivateOrReservedIp(ip) {
    const version = net.isIP(ip);
    if (version === 4) return isPrivateIPv4(ip);
    if (version === 6) return isPrivateIPv6(ip);
    return true; // not a recognizable IP -> treat as unsafe
}

/**
 * Validates a URL's scheme and hostname, then resolves DNS and checks the
 * *resolved* IP too — a hostname can look public but resolve to a private
 * address (DNS rebinding). Throws a short, user-safe message on any
 * violation. Callers must re-run this on every redirect hop, not just the
 * original URL.
 */
async function assertSafeUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('Not a valid URL.');
    }

    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
        throw new Error('Only http:// and https:// URLs are allowed.');
    }

    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw new Error('Requests to localhost are not allowed.');
    }

    if (net.isIP(hostname) && isPrivateOrReservedIp(hostname)) {
        throw new Error('Requests to private or reserved IP addresses are not allowed.');
    }

    let addresses;
    try {
        addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
        throw new Error(`Could not resolve host "${hostname}".`);
    }

    if (addresses.length === 0 || addresses.some((a) => isPrivateOrReservedIp(a.address))) {
        throw new Error('This URL resolves to a private or reserved address and cannot be fetched.');
    }

    return parsed;
}

module.exports = { assertSafeUrl, isPrivateOrReservedIp };
