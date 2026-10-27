const SENDER = 'info@tockicanai.hr';

// Stub mail: stores the message in the in-memory outbox instead of sending it.
export function send(store, { to, subject, body }, now) {
  const mail = { to, from: SENDER, subject, body, sentAt: now.toISOString() };
  store.outbox.push(mail);
  return mail;
}
