const util = require('util');

// The ops log channel: every job summary (the daily pipeline, circle rankings)
// is posted here as an embed, and every console.warn / console.error from the
// bot process is mirrored here as text, so a failure is visible in Discord the
// night it happens rather than only in `docker compose logs`.
//
// console.log is deliberately not mirrored: the scrapers log every page step,
// which would bury the warnings this channel exists for.

const FLUSH_MS = 5000;
const MAX_MESSAGE = 1900; // under Discord's 2000, leaving room for the code fence
const MAX_QUEUED_CHARS = 20000; // a runaway loop drops lines instead of flooding

let channel = null;
let queue = [];
let queuedChars = 0;
let dropped = 0;
let timer = null;
let sending = false;

function enqueue(level, args) {
    if (!channel) return;
    const line = `[${level}] ${util.format(...args)}`;
    if (queuedChars + line.length > MAX_QUEUED_CHARS) {
        dropped++;
        return;
    }
    queue.push(line);
    queuedChars += line.length;
    if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

/** Packs queued lines into as few code-block messages as fit. */
function takeMessages() {
    const lines = queue;
    queue = [];
    queuedChars = 0;
    if (dropped) {
        lines.push(`[log] ${dropped} more line(s) dropped — see docker compose logs bot`);
        dropped = 0;
    }

    const messages = [];
    let current = '';
    for (let line of lines) {
        if (line.length > MAX_MESSAGE) line = `${line.slice(0, MAX_MESSAGE - 1)}…`;
        if (current && current.length + line.length + 1 > MAX_MESSAGE) {
            messages.push(current);
            current = '';
        }
        current += (current ? '\n' : '') + line;
    }
    if (current) messages.push(current);
    return messages;
}

async function flush() {
    timer = null;
    if (sending || !channel || queue.length === 0) return;
    sending = true;
    try {
        for (const text of takeMessages()) {
            // ``` inside a log line would close the fence early.
            await channel.send('```\n' + text.replace(/```/g, "'''") + '\n```');
        }
    } catch (err) {
        // Through the original stream: going through the patched console here
        // would queue the failure to send and retry it forever.
        originalError('[log] could not post to the log channel:', err.message);
    } finally {
        sending = false;
        if (queue.length && !timer) timer = setTimeout(flush, FLUSH_MS);
    }
}

const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);

/** Starts mirroring console.warn/error to `logChannel`. Safe to call once the client is ready. */
function startMirroring(logChannel) {
    channel = logChannel;
    console.warn = (...args) => {
        originalWarn(...args);
        enqueue('warn', args);
    };
    console.error = (...args) => {
        originalError(...args);
        enqueue('error', args);
    };
}

/** Posts an embed to the log channel; never throws. Returns false when it couldn't. */
async function postEmbed(embed) {
    if (!channel) return false;
    try {
        await channel.send({ embeds: [embed] });
        return true;
    } catch (err) {
        originalError('[log] could not post embed to the log channel:', err.message);
        return false;
    }
}

module.exports = { startMirroring, postEmbed, flush };
