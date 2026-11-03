// The relay's logic, free of Firebase imports so it can be tested with plain `node --test`.
//
// A device that sent its backup (or merged everything) asks the relay to notify the others. The
// relay keeps no data: it checks that the caller's Google token was issued to this app, reads
// the push tokens from the device list in the caller's own Drive, with that same token, and
// forwards a fixed message through Firebase Cloud Messaging. Backups never pass through here.

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const TOKEN_INFO = 'https://oauth2.googleapis.com/tokeninfo';
const MAX_DEVICES = 50;

const MESSAGES = {
  'backup-requested': (from) => ({
    title: 'Sincronizar JW Library',
    body: `${from} enviou um backup. Toque para enviar o deste aparelho.`,
  }),
  'sync-ready': () => ({
    title: 'Atualização pronta',
    body: 'Os backups foram mesclados. Toque para atualizar o JW Library deste aparelho.',
  }),
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {{ authorization?: string, body: any }} request
 * @param {{ fetch: typeof fetch, send: (messages: object[]) => Promise<{ successCount: number, responses: { success: boolean }[] }>, allowedClientIds: string[] }} deps
 */
async function handleNotify(request, deps) {
  const token = /^Bearer (\S+)$/.exec(request.authorization ?? '')?.[1];
  if (!token) throw new HttpError(401, 'Token ausente.');
  const { event, from, targets, devicesFolderId } = request.body ?? {};
  if (!MESSAGES[event] || typeof from !== 'string' || !Array.isArray(targets) || !/^[\w-]+$/.test(String(devicesFolderId))) {
    throw new HttpError(400, 'Pedido inválido.');
  }

  // Any Google token would read a Drive; only tokens issued to this app may use the relay.
  const info = await getJson(deps.fetch, `${TOKEN_INFO}?access_token=${encodeURIComponent(token)}`);
  const clientId = info?.azp ?? info?.aud;
  // Naming the client id helps filling ALLOWED_CLIENT_IDS (the Android one is easy to get wrong).
  if (!clientId || !deps.allowedClientIds.includes(clientId)) throw new HttpError(403, `Token não emitido para este app (cliente: ${clientId ?? '?'}).`);

  const auth = { Authorization: `Bearer ${token}` };
  const q = `'${devicesFolderId}' in parents and trashed = false`;
  const list = await getJson(deps.fetch, `${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=${MAX_DEVICES}`, auth);
  if (!list?.files) throw new HttpError(403, 'Lista de aparelhos inacessível.');
  const devices = (
    await Promise.all(
      list.files.filter((f) => f.name.endsWith('.json')).map((f) => getJson(deps.fetch, `${DRIVE}/${f.id}?alt=media`, auth)),
    )
  ).filter((d) => d && typeof d.id === 'string');

  const wanted = new Set(targets);
  const recipients = devices.filter((d) => d.id !== from && wanted.has(d.id) && typeof d.pushToken === 'string' && d.pushToken);
  if (!recipients.length) return { sent: 0, failed: [], errors: {} };

  const senderName = String(devices.find((d) => d.id === from)?.name ?? 'Outro aparelho').slice(0, 60);
  const notification = MESSAGES[event](senderName);
  const messages = recipients.map((d) => ({
    token: d.pushToken,
    notification,
    // "from" is reserved by FCM (the message is refused with invalid-argument).
    data: { event, sender: from },
    // Same tag: a newer notice replaces the previous one instead of piling up.
    android: { priority: 'high', notification: { tag: 'jw-notes-sync' } },
  }));
  const result = await deps.send(messages);
  // FCM's reason per device (e.g. messaging/registration-token-not-registered), to tell a stale
  // token from a project setup problem.
  const errors = {};
  result.responses.forEach((r, i) => {
    if (!r.success) errors[recipients[i].id] = [r.error?.code, r.error?.message].filter(Boolean).join(': ') || 'desconhecido';
  });
  return { sent: result.successCount, failed: Object.keys(errors), errors };
}

async function getJson(fetchFn, url, headers) {
  const res = await fetchFn(url, { headers });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

module.exports = { handleNotify, HttpError };
