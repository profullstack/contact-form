import { expect, test } from 'bun:test';
import { createContactForm } from '../index.js';

const make = (extra) =>
  createContactForm({ to: 'a@b.co', guard: false, send: async () => ({ sent: true }), ...extra });
const json = (body) =>
  new Request('https://x.example/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const form = (body) =>
  new Request('https://x.example/api/contact', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      referer: 'https://x.example/sales',
    },
    body: new URLSearchParams(body).toString(),
  });
const good = { name: 'Dana', email: 'dana@okafor.dev', message: 'Hello there, a real question.' };

// rssamplifier's DB-backed 3-per-hour check runs in verify(); it must answer as `limited`.
test('verify() can refuse as limited: 429 for JSON, ?error=limited for a plain post', async () => {
  const c = make({ verify: () => ({ kind: 'limited' }) });
  const res = await c.POST(json(good));
  expect(res.status).toBe(429);
  expect((await c.POST(form(good))).headers.get('location')).toBe(
    'https://x.example/sales?error=limited',
  );
  expect(c.errorMessage('?error=limited')).toBe('Too many messages. Please try again later.');
});

test('verify() still accepts true, refuses false and strings as invalid', async () => {
  expect((await make({ verify: () => true }).POST(json(good))).status).toBe(200);
  expect(await (await make({ verify: () => 'nope' }).POST(json(good))).json()).toEqual({
    error: 'nope',
  });
  expect((await make({ verify: () => false }).POST(json(good))).status).toBe(400);
});

test('errorLabel names the field in messages', async () => {
  const c = make({
    questions: [
      { name: 'email', type: 'email', required: true },
      {
        name: 'use_case',
        label: 'What do you want the corpus for?',
        errorLabel: 'Your use case',
        minLength: 10,
      },
    ],
  });
  const res = await c.POST(json({ email: 'a@b.co', use_case: 'short' }));
  expect(await res.json()).toEqual({
    error: 'Your use case is too short (10 characters at least)',
  });
  expect(c.errorMessage('?error=invalid&field=use_case&reason=tooShort')).toBe(
    'Your use case is too short (10 characters at least)',
  );
  expect(await c.render()).toContain('What do you want the corpus for?');
});
