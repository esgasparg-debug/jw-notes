const test = require('node:test');
const assert = require('node:assert/strict');
const { handleNotify } = require('../notify');

const CLIENT = 'web-client.apps.googleusercontent.com';
const DEVICES = {
  f1: { id: 'samsung', name: 'Samsung_SM-X216B', platform: 'android', pushToken: 'tok-samsung' },
  f2: { id: 'xiaomi', name: 'Xiaomi_2412DPC0AG', platform: 'android', pushToken: 'tok-xiaomi' },
  f3: { id: 'pc', name: 'PC-SALA', platform: 'electron' },
};

/** Google's tokeninfo and the user's Drive, answering only to the right token. */
function fakeGoogle({ azp = CLIENT } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push(url);
    const json = (body, ok = true) => ({ ok, json: async () => body });
    if (url.startsWith('https://oauth2.googleapis.com/tokeninfo'))
      return url.includes('access_token=good') ? json({ azp }) : json({}, false);
    if (init.headers?.Authorization !== 'Bearer good') return json({}, false);
    if (url.includes('?q=')) {
      assert.match(decodeURIComponent(url), /'devs' in parents/);
      return json({ files: [...Object.keys(DEVICES).map((id) => ({ id, name: `${id}.json` })), { id: 'x', name: 'leia-me.txt' }] });
    }
    const id = /files\/(\w+)\?alt=media/.exec(url)?.[1];
    return DEVICES[id] ? json(DEVICES[id]) : json({}, false);
  };
  const sent = [];
  const send = async (messages) => {
    sent.push(...messages);
    return { successCount: messages.length, responses: messages.map(() => ({ success: true })) };
  };
  return { deps: { fetch, send, allowedClientIds: [CLIENT] }, sent, calls };
}

const request = (body, token = 'good') => ({ authorization: `Bearer ${token}`, body });

test('sends the request to the waiting devices, named after the sender', async () => {
  const g = fakeGoogle();
  const result = await handleNotify(
    request({ event: 'backup-requested', from: 'samsung', targets: ['xiaomi', 'pc'], devicesFolderId: 'devs' }),
    g.deps,
  );

  // The computer has no push token (it checks the Drive while open); the sender is never notified.
  assert.deepEqual(result, { sent: 1, failed: [], errors: {} });
  assert.equal(g.sent[0].token, 'tok-xiaomi');
  assert.equal(g.sent[0].notification.body, 'Samsung_SM-X216B enviou um backup. Toque para enviar o deste aparelho.');
  assert.deepEqual(g.sent[0].data, { event: 'backup-requested', sender: 'samsung' });
});

test('never notifies the sender, even if listed', async () => {
  const g = fakeGoogle();
  await handleNotify(request({ event: 'sync-ready', from: 'samsung', targets: ['samsung', 'xiaomi'], devicesFolderId: 'devs' }), g.deps);

  assert.deepEqual(
    g.sent.map((m) => m.token),
    ['tok-xiaomi'],
  );
  assert.equal(g.sent[0].notification.title, 'Atualização pronta');
});

test('rejects tokens issued to another app', async () => {
  const g = fakeGoogle({ azp: 'other-app' });
  await assert.rejects(
    handleNotify(request({ event: 'sync-ready', from: 'samsung', targets: ['xiaomi'], devicesFolderId: 'devs' }), g.deps),
    { status: 403 },
  );
  assert.equal(g.sent.length, 0);
});

test('rejects missing or invalid tokens and malformed requests', async () => {
  const g = fakeGoogle();
  const body = { event: 'sync-ready', from: 'samsung', targets: ['xiaomi'], devicesFolderId: 'devs' };
  await assert.rejects(handleNotify({ body }, g.deps), { status: 401 });
  await assert.rejects(handleNotify(request(body, 'bad'), g.deps), { status: 403 });
  await assert.rejects(handleNotify(request({ ...body, event: 'spam' }), g.deps), { status: 400 });
  await assert.rejects(handleNotify(request({ ...body, devicesFolderId: "x' or '1'='1" }), g.deps), { status: 400 });
  assert.equal(g.sent.length, 0);
});

test('reports why FCM refused a device', async () => {
  const g = fakeGoogle();
  g.deps.send = async (messages) => ({
    successCount: 0,
    responses: messages.map(() => ({ success: false, error: { code: 'messaging/registration-token-not-registered' } })),
  });
  const result = await handleNotify(
    request({ event: 'backup-requested', from: 'samsung', targets: ['xiaomi'], devicesFolderId: 'devs' }),
    g.deps,
  );

  assert.deepEqual(result, { sent: 0, failed: ['xiaomi'], errors: { xiaomi: 'messaging/registration-token-not-registered' } });
});
