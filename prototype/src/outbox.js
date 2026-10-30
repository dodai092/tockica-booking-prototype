const SENDER = 'info@tockicanai.hr';

// Stub mail: stores the message in the in-memory outbox instead of sending it.
// `action` is an optional button: { label, url }. The URL stays out of the body.
export function send(store, { to, subject, body, action }, now) {
  const mail = { to, from: SENDER, subject, body, sentAt: now.toISOString() };
  if (action) mail.action = action;
  store.outbox.push(mail);
  return mail;
}
