// Firebase entry point. Deploy with `npm run deploy` from this folder (see README).
const { onRequest } = require('firebase-functions/v2/https');
const { defineString } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const { HttpError, handleNotify } = require('./notify');

initializeApp();

/** Comma-separated OAuth client ids (web + Android) whose tokens may call the relay. */
const allowedClientIds = defineString('ALLOWED_CLIENT_IDS');

// The function itself authenticates every caller by its Google token, so Cloud Run lets anyone
// in (invoker 'public') and any origin (web, desktop, Android) may call.
exports.notify = onRequest({ cors: true, invoker: 'public', region: 'southamerica-east1', maxInstances: 2 }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }
  try {
    const result = await handleNotify(
      { authorization: req.get('Authorization'), body: req.body },
      {
        fetch,
        send: (messages) => getMessaging().sendEach(messages),
        allowedClientIds: allowedClientIds
          .value()
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      },
    );
    if (result.failed.length) console.warn('FCM recusou', JSON.stringify(result.errors));
    res.json(result);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: e.message });
  }
});
