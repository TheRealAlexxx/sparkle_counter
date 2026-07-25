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
  // If true, a reaction_removed event will decrement the count, so the
  // number reflects the *current* live count of sparkling_heart reactions
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

function counterText(count) {
  return `:sparkling_heart: <@${TARGET_USER_ID}> has reacted with :${TARGET_EMOJI}: *${count}* time${count === 1 ? '' : 's'}.`;
}

// Post the counter message the first time, or update it in place afterward,
// so the channel doesn't get spammed with a new message per reaction.
async function syncCounterMessage(client) {
  const text = counterText(state.count);

  if (state.messageTs) {
    try {
      await client.chat.update({
        channel: COUNTER_CHANNEL_ID,
        ts: state.messageTs,
        text,
      });
      return;
    } catch (err) {
      // Message may have been deleted, or the ts is stale — fall through
      // and post a fresh one.
      console.warn('Could not update existing counter message, posting a new one:', err.data?.error || err.message);
    }
  }

  const result = await client.chat.postMessage({
    channel: COUNTER_CHANNEL_ID,
    text,
  });
  state.messageTs = result.ts;
  saveState(state);
}

app.event('reaction_added', async ({ event, client }) => {
  try {
    if (event.user !== TARGET_USER_ID) return;
    if (event.reaction !== TARGET_EMOJI) return;

    state.count += 1;
    saveState(state);
    await syncCounterMessage(client);

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
      await syncCounterMessage(client);

      console.log(`-1 (${state.count} total) — reaction_removed by ${event.user}`);
    } catch (err) {
      console.error('Error handling reaction_removed:', err);
    }
  });
}

(async () => {
  await app.start();
  console.log('ur stupid bot is running');
  console.log(`tracking user ${TARGET_USER_ID} reacting with :${TARGET_EMOJI}:`);
  console.log(`current count: ${state.count}`);
})();
