import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createContactForm, ERROR_CODES } from '../index.js';
import { ContactForm } from '../react.js';

// Gaps from the second rollout batch (2026-10-29): stable ?error= codes,
// responses overrides in plain-form mode, minLength, select labels in the
// email, labels with "*", onSubmit/onError.

const mails = [];
const make = (extra = {}) =>
  createContactForm({
    site: 'example',
    to: 'hello@example.com',
    send: async (m) => {
      mails.push(m);
      return { sent: true, id: 'm' };
    },
    guard: { secret: 'test-secret-that-is-long-enough', minAgeMs: 0, rateLimit: false },
    ...extra,
  });
const qs = [
  { name: 'name', label: 'Name *', required: true, minLength: 2 },
  { name: 'email', label: 'Email *', type: 'email', required: true },
  {
    name: 'subject',
    type: 'select',
    required: true,
    placeholder: 'Pick one',
    options: [
      { value: 'bug', label: 'Bug Report' },
      { value: 'other', label: 'Something else' },
    ],
  },
  { name: 'code', pattern: '[A-Z]{3}', patternMessage: 'Use three capital letters' },
  { name: 'message', type: 'textarea', required: true, minLength: 10 },
];
const formPost = (body) =>
  new Request('https://example.com/api/contact', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      referer: 'https://example.com/contact?sent=1#form',
    },
    body: new URLSearchParams(body).toString(),
  });
const jsonPost = (body) =>
  new Request('https://example.com/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const good = {
  name: 'Dana',
  email: 'dana@okafor.dev',
  subject: 'bug',
  message: 'It crashes on save.',
};

describe('0.3.0', () => {
  test('a plain form post is redirected with a stable code, never free text', async () => {
    const form = make({ questions: qs });
    const token = (await form.props()).token;
    const res = await form.POST(formPost({ ...good, message: 'short', fg_token: token }));
    expect(res.headers.get('location')).toBe(
      'https://example.com/contact?error=invalid&field=message&reason=tooShort#form',
    );
    const verify = make({ questions: qs, verify: () => 'free text <script>' });
    const res2 = await verify.POST(formPost({ ...good, fg_token: (await verify.props()).token }));
    expect(res2.headers.get('location')).toBe('https://example.com/contact?error=invalid#form');
  });

  test('errorMessage() rebuilds the message from the form, and ignores forged codes', () => {
    const form = make({ questions: qs });
    expect(form.errorMessage('?error=invalid&field=message&reason=tooShort')).toBe(
      'Message is too short (10 characters at least)',
    );
    expect(form.errorMessage({ error: 'invalid', field: 'name', reason: 'required' })).toBe(
      'Name is required',
    );
    expect(form.errorMessage('error=<b>hi</b>')).toBe('An unexpected error occurred');
    expect(form.errorMessage('error=invalid&field=nope&reason=required')).toBe(
      'Invalid submission.',
    );
    expect(form.errorMessage('?x=1')).toBeNull();
    expect(form.sentMessage('?sent=1')).toContain('Thanks');
    expect(ERROR_CODES).toContain('limited');
  });

  test('responses overrides are used for plain-form error messages', () => {
    const form = make({
      responses: { limited: { body: { error: 'Slow down, friend.' }, status: 429 } },
    });
    expect(form.errorMessage('?error=limited')).toBe('Slow down, friend.');
  });

  test('render({ query }) shows the rebuilt error or the thanks', async () => {
    const form = make({ questions: qs });
    expect(await form.render({ query: '?error=invalid&field=email&reason=email' })).toContain(
      '<p class="cf-error" role="alert">Email must be a valid email address</p>',
    );
    expect(await form.render({ query: new URLSearchParams('sent=1') })).toContain('cf-notice');
  });

  test('minLength and pattern are checked on the server and sent to the inputs', async () => {
    const form = make({ questions: qs });
    const token = (await form.props()).token;
    const short = await form.POST(jsonPost({ ...good, name: 'D', fg_token: token }));
    expect(await short.json()).toEqual({ error: 'Name is too short (2 characters at least)' });
    const pat = await form.POST(jsonPost({ ...good, code: 'abcd', fg_token: token }));
    expect(await pat.json()).toEqual({ error: 'Use three capital letters' });
    const html = await form.render();
    expect(html).toContain('minlength="2"');
    expect(html).toContain('pattern="[A-Z]{3}" title="Use three capital letters"');
    expect(html).toMatch(/<textarea[^>]*minlength="10"/);
    const react = renderToStaticMarkup(createElement(ContactForm, await form.props()));
    expect(react).toContain('minLength="2"');
    expect(react).toContain('pattern="[A-Z]{3}"');
  });

  test('the email shows a select label and a label without its "*"', async () => {
    mails.length = 0;
    const form = make({ questions: qs });
    const res = await form.POST(jsonPost({ ...good, fg_token: (await form.props()).token }));
    expect(res.status).toBe(200);
    expect(mails[0].text).toContain('Subject: Bug Report');
    expect(mails[0].text).toContain('Name: Dana');
    expect(mails[0].text).not.toContain('Name *');
  });
});
