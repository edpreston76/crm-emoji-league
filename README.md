# CRM Emoji League

Monthly emoji reaction leaderboard for the CRM team.
Log great emoji moments, fire the ones that deserve it, and crown a monthly champion.

---

## Deploy

### 1. GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/meetcleo/crm-emoji-league.git
git push -u origin main
```

### 2. Render

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect the `meetcleo/crm-emoji-league` repo
3. Settings:
   - **Name**: crm-emoji-league
   - **Build command**: `npm install`
   - **Start command**: `node server.js`
   - **Instance type**: Free
4. Add environment variables (see below)
5. **Deploy**

---

## Environment variables (add in Render dashboard)

| Variable | Required | Description |
|---|---|---|
| `SLACK_WEBHOOK_URL` | Yes | Webhook URL for #team-crm announcements |
| `APP_URL` | Recommended | Your Render URL, e.g. `https://crm-emoji-league.onrender.com` |
| `RESET_SECRET` | Optional | A secret string to manually trigger resets for testing |

---

## Setting up the Slack webhook

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. **Create New App** → From scratch → name it "CRM Emoji League", pick the Cleo workspace
3. Under **Features**, click **Incoming Webhooks** → toggle on
4. Click **Add New Webhook to Workspace**
5. Select **#team-crm** from the channel list → **Allow**
6. Copy the webhook URL (starts with `https://hooks.slack.com/services/...`)
7. Paste it into Render as `SLACK_WEBHOOK_URL`

---

## How the monthly reset works

- A cron job runs at **23:55 on the last day of each month** (Europe/London timezone)
- It declares the winner (highest points), saves them to the Hall of Fame, and posts to #team-crm
- The new month starts fresh automatically
- If the Render service is asleep at 23:55 (free tier limitation), a startup check will catch the missed reset the next time the service wakes up

**To test the reset manually:**

```bash
curl -X POST https://your-app.onrender.com/api/trigger-reset \
  -H "Content-Type: application/json" \
  -d '{"secret":"your-RESET_SECRET-value"}'
```

---

## Scoring

- Someone logs your emoji moment → **+2 pts** for you
- A teammate fires your moment → **+1 pt each** for you
- Highest score at month end wins and goes into the Hall of Fame

## Team

Ed, Maria, Alex, Millie, Juan
