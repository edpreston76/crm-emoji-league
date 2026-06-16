const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Data ────────────────────────────────────────────────────────────────────

const DATA_FILE = path.join(__dirname, 'data.json');
const TEAM = ['Ed', 'Maria', 'Alex', 'Millie', 'Juan'];

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { console.error('Load error:', e.message); }
  return { moments: {}, hof: [] };
}

function save(db) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
  catch (e) { console.error('Save error:', e.message); }
}

let db = load();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function monthKey(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date) {
  return (date || new Date()).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function currentMoments() {
  const key = monthKey();
  if (!db.moments[key]) db.moments[key] = [];
  return db.moments[key];
}

function computeLeaderboard(moments) {
  return TEAM.map(name => {
    const mine = moments.filter(m => m.nominee === name);
    const pts = mine.reduce((a, m) => a + 2 + (m.fires || []).length, 0);
    const sorted = [...mine].sort((a, b) => (b.fires || []).length - (a.fires || []).length);
    return {
      name,
      pts,
      noms: mine.length,
      fires: mine.reduce((a, m) => a + (m.fires || []).length, 0),
      topMoment: sorted[0] || null
    };
  }).sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
}

// ─── API ─────────────────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => {
  const moments = currentMoments();
  res.json({ moments, leaderboard: computeLeaderboard(moments), hof: db.hof });
});

app.post('/api/moments', (req, res) => {
  const { nominee, emoji, context, channel, submittedBy } = req.body;
  if (!nominee || !emoji || !submittedBy) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  if (!TEAM.includes(nominee) || !TEAM.includes(submittedBy)) {
    return res.status(400).json({ error: 'Invalid team member' });
  }
  if (nominee === submittedBy) {
    return res.status(400).json({ error: "Can't nominate yourself" });
  }

  const moment = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    nominee,
    emoji,
    context: (context || '').trim().slice(0, 200),
    channel: channel || '#crm-team',
    submittedBy,
    ts: new Date().toISOString(),
    fires: []
  };

  currentMoments().unshift(moment);
  save(db);

  const moments = currentMoments();
  res.json({ moment, leaderboard: computeLeaderboard(moments) });
});

app.post('/api/moments/:id/fire', (req, res) => {
  const { user } = req.body;
  if (!user || !TEAM.includes(user)) {
    return res.status(400).json({ error: 'Invalid user' });
  }
  const moments = currentMoments();
  const m = moments.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.nominee === user) {
    return res.status(400).json({ error: "Can't fire your own moment" });
  }
  if (!m.fires) m.fires = [];
  if (m.fires.includes(user)) {
    m.fires = m.fires.filter(u => u !== user);
  } else {
    m.fires.push(user);
  }
  save(db);
  res.json({ moment: m, leaderboard: computeLeaderboard(moments) });
});

// ─── Monthly reset ────────────────────────────────────────────────────────────

async function doReset(targetDate) {
  const date = targetDate || new Date();
  const key = monthKey(date);
  const label = monthLabel(date);
  const moments = db.moments[key] || [];

  if (!moments.length) {
    console.log(`[reset] No moments for ${key}, skipping`);
    return null;
  }

  const lb = computeLeaderboard(moments);
  if (lb[0].pts === 0) {
    console.log(`[reset] All scores are 0 for ${key}, skipping`);
    return null;
  }

  // Check if already reset this month
  if (db.hof.some(h => h.monthKey === key)) {
    console.log(`[reset] Already reset for ${key}`);
    return null;
  }

  const winner = lb[0];
  const entry = {
    winner: winner.name,
    month: label,
    monthKey: key,
    pts: winner.pts,
    emoji: winner.topMoment?.emoji || '🏆',
    topMomentContext: winner.topMoment?.context || '',
    noms: winner.noms,
    leaderboard: lb.map(p => ({ name: p.name, pts: p.pts }))
  };

  db.hof.push(entry);
  save(db);

  await postToSlack(entry, lb);
  console.log(`[reset] ${label} complete - winner: ${winner.name} (${winner.pts} pts)`);
  return entry;
}

async function postToSlack(entry, lb) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('[slack] SLACK_WEBHOOK_URL not set, skipping announcement');
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const standings = lb
    .map((p, i) => `${medals[i] || `${i + 1}.`} ${p.name} - ${p.pts}pts`)
    .join('\n');
  const appUrl = process.env.APP_URL || '';
  const topMomentLine = entry.topMomentContext
    ? `\n\n:fire: *Top moment:* _${entry.topMomentContext}_ ${entry.emoji}`
    : '';

  const body = {
    text: `CRM Emoji League - ${entry.month} winner: ${entry.winner}!`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🏆 CRM Emoji League - ${entry.month} wrapped!`, emoji: true }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:medal_first: *${entry.winner}* wins ${entry.month} with *${entry.pts} points*!${topMomentLine}`
        }
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Final standings*\n${standings}`
        }
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `New round starts now. Who's got the best emoji game in ${new Date().toLocaleDateString('en-GB', { month: 'long' })}? :eyes:${appUrl ? `  <${appUrl}|Open the league>` : ''}`
        }
      }
    ]
  };

  try {
    await axios.post(webhookUrl, body);
    console.log('[slack] Announcement posted for', entry.month);
  } catch (e) {
    console.error('[slack] Post failed:', e.message);
  }
}

// ─── Cron: 23:55 on days 28-31, fires only on the actual last day ────────────

cron.schedule('55 23 28-31 * *', async () => {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getDate() === 1) {
    console.log('[cron] Last day of month - running reset');
    await doReset();
  }
}, { timezone: 'Europe/London' });

// ─── Startup: catch missed resets ────────────────────────────────────────────
// On Render's free tier the service may be asleep at 23:55.
// If we start up on the 1st of a month, backfill the previous month.

function checkMissedReset() {
  const now = new Date();
  if (now.getDate() !== 1) return;
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const key = monthKey(lastMonth);
  if (db.hof.some(h => h.monthKey === key)) return;
  if (!db.moments[key] || !db.moments[key].length) return;
  console.log('[startup] Missed reset for', key, '- running now');
  doReset(lastMonth);
}

// ─── Manual trigger (for testing) ────────────────────────────────────────────

app.post('/api/trigger-reset', async (req, res) => {
  const secret = process.env.RESET_SECRET;
  if (!secret || req.body.secret !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const result = await doReset();
  res.json({ success: true, result });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CRM Emoji League live on port ${PORT}`);
  checkMissedReset();
});
