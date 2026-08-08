/**
 * Discord webhook sender, shared by every report script.
 *
 * Replaces four near-identical copies of a raw https.request helper. Adds the
 * batching that those copies lacked: Discord rejects a message with more than
 * 10 embeds *or* more than 6000 characters of embed content in total, and the
 * old code only guarded the embed count.
 */

const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_CHARS_PER_MESSAGE = 6000;

/** Accepts EmbedBuilder instances or plain embed objects. */
function toPlainEmbed(embed) {
    return embed && typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
}

/** Rough character count Discord charges an embed against the 6000 limit. */
function embedLength(embed) {
    let len = 0;
    len += (embed.title || '').length;
    len += (embed.description || '').length;
    len += (embed.footer?.text || '').length;
    len += (embed.author?.name || '').length;
    for (const field of embed.fields || []) {
        len += (field.name || '').length + (field.value || '').length;
    }
    return len;
}

/** Splits embeds into messages that respect both Discord limits. */
function batchEmbeds(embeds) {
    const batches = [];
    let current = [];
    let currentLen = 0;

    for (const embed of embeds) {
        const len = embedLength(embed);
        const tooMany = current.length >= MAX_EMBEDS_PER_MESSAGE;
        const tooLong = currentLen + len > MAX_CHARS_PER_MESSAGE;
        if ((tooMany || tooLong) && current.length > 0) {
            batches.push(current);
            current = [];
            currentLen = 0;
        }
        current.push(embed);
        currentLen += len;
    }
    if (current.length > 0) batches.push(current);
    return batches;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postOnce(webhookUrl, embeds, label) {
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds }),
    });

    if (response.status === 429) {
        const body = await response.json().catch(() => ({}));
        const waitMs = Math.ceil((body.retry_after ?? 1) * 1000);
        console.warn(`[${label}][webhook] rate limited, retrying in ${waitMs}ms`);
        await delay(waitMs);
        return postOnce(webhookUrl, embeds, label);
    }

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error(`[${label}][webhook] status ${response.status}: ${text}`);
        return false;
    }
    return true;
}

/**
 * Sends embeds to a Discord webhook, batched as needed.
 * Resolves true only when every batch was accepted.
 */
async function sendToWebhook(webhookUrl, embeds, label = 'webhook') {
    if (!webhookUrl) {
        console.error(`[${label}][webhook] no webhook URL configured; nothing sent.`);
        return false;
    }
    const plain = (Array.isArray(embeds) ? embeds : [embeds]).map(toPlainEmbed).filter(Boolean);
    if (plain.length === 0) return false;

    const batches = batchEmbeds(plain);
    let allSent = true;

    for (let i = 0; i < batches.length; i++) {
        if (i > 0) await delay(1000);
        try {
            const ok = await postOnce(webhookUrl, batches[i], label);
            if (!ok) allSent = false;
        } catch (err) {
            console.error(`[${label}][webhook] request failed:`, err.message);
            allSent = false;
        }
    }
    return allSent;
}

module.exports = { sendToWebhook, batchEmbeds };
