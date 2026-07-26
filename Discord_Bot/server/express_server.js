const express = require('express');
const dotenv = require('dotenv');
dotenv.config({ path: require('path').resolve(__dirname, '../../.env') });

const { updateUserData } = require('../scripts/update_user_data');
const updateScore = require('../scripts/update_score');

const app = express();
app.use(express.json());

app.post('/run-update-user-data', async (req, res) => {
    try {
        console.log('[server] /run-update-user-data triggered');
        const ok = await updateUserData();
        res.json({ success: !!ok });
    } catch (err) {
        console.error('[server] update-user-data error', err);
        res.status(500).json({ success: false, error: String(err) });
    }
});

app.post('/run-update-score', async (req, res) => {
    try {
        console.log('[server] /run-update-score triggered');
        if (typeof updateScore.runStandalone === 'function') {
            await updateScore.runStandalone();
            res.json({ success: true });
        } else if (typeof updateScore.execute === 'function') {
            const fakeChannel = { send: (p) => console.log('[fakeChannel] send', p) };
            await updateScore.execute(fakeChannel);
            res.json({ success: true });
        } else {
            res.status(500).json({ success: false, error: 'update_score has no runnable export' });
        }
    } catch (err) {
        console.error('[server] update-score error', err);
        res.status(500).json({ success: false, error: String(err) });
    }
});

const port = process.env.EXPRESS_PORT || 3000;
app.listen(port, () => {
    console.log(`[server] Express server listening on port ${port}`);
});

module.exports = app;
