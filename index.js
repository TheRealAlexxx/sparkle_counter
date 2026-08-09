require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { App } = require('@slack/bolt');

const {
  SLACK_BOT_TOKEN,
  SLACK_APP_TOKEN,
  SLACK_SIGNING_SECRET,
  TARGET_USER_ID,
  TARGET_EMOJI,
  COUNTER_CHANNEL_ID,
  // If true,a reaction_removed event will decrement the count, so the
  // number reflects, the *current* live count of sparkling_heart reactions
  // from this user, rather than a cumulative "all-time" total.
  DECREMENT_ON_REMOVE,
} = process.env;

for (const [name, val] of Object.entries({
  SLACK_BOT_TOKEN,
  SLACK_APP_TOKEN,
  TARGET_USER_ID,
  TARGET_EMOJI,
  COUNTER_CHANNEL_ID,
})) {
  if (!val) {
    console.error(`Missing required env var: ${name}. Check your .env file (see .env.example).`);
    process.exit(1);
  }
}

const STATE_FILE = path.join(__dirname, 'state.json');

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    return { count: 0, messageTs: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let state = loadState();

const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  socketMode: true,
});

// Best-effort: get a link to the message that was reacted to, so the
// announcement can point back to it. Falls back gracefully if it fails
// (e.g. message in a channel the bot can't read a permalink for).
async function getPermalink(client, channel, ts) {
  try {
    const result = await client.chat.getPermalink({ channel, message_ts: ts });
    return result.permalink;
  } catch (err) {
    console.warn('Could not fetch permalink:', err.data?.error || err.message);
    return null;
  }
}

async function announceReaction(client, event) {
  const permalink = await getPermalink(client, event.item.channel, event.item.ts);
  const linkPart = permalink ? ` — <${permalink}|jump to message>` : '';
  const text = `:sparkling_heart: <@${TARGET_USER_ID}> reacted with :${TARGET_EMOJI}:${linkPart}\nTotal so far: *${state.count}*`;

  await client.chat.postMessage({
    channel: COUNTER_CHANNEL_ID,
    text,
  });
}

app.event('reaction_added', async ({ event, client }) => {
  try {
    if (event.user !== TARGET_USER_ID) return;
    if (event.reaction !== TARGET_EMOJI) return;

    state.count += 1;
    saveState(state);
    await announceReaction(client, event);

    console.log(`+1 (${state.count} total) — reaction_added by ${event.user}`);
  } catch (err) {
    console.error('Error handling reaction_added:', err);
  }
});

if (DECREMENT_ON_REMOVE === 'true') {
  app.event('reaction_removed', async ({ event, client }) => {
    try {
      if (event.user !== TARGET_USER_ID) return;
      if (event.reaction !== TARGET_EMOJI) return;

      state.count = Math.max(0, state.count - 1);
      saveState(state);
      await client.chat.postMessage({
        channel: COUNTER_CHANNEL_ID,
        text: `:heavy_minus_sign: <@${TARGET_USER_ID}> removed a :${TARGET_EMOJI}: reaction.\nTotal so far: *${state.count}*`,
      });

      console.log(`-1 (${state.count} total) — reaction_removed by ${event.user}`);
    } catch (err) {
      console.error('Error handling reaction_removed:', err);
    }
  });
}

(async () => {
  await app.start();
  console.log('⚡️ Sparkle counter bot is running (Socket Mode).');
  console.log(`Tracking user ${TARGET_USER_ID} reacting with :${TARGET_EMOJI}:`);
  console.log(`Current count: ${state.count}`);
})();
