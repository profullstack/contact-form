import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createContactForm,
  DEFAULT_QUESTIONS,
  normalizeQuestions,
  validate,
  withQuestions,
} from '../index.js';
import { ContactForm } from '../react.js';

const SECRET = 'test-secret-that-is-long-enough';
const sentMail = () => {
  const mails = [];
  const send = async (m) => {
    mails.push(m);
    return { sent: true, id: `m${mails.length}` };
  };
  return { mails, send };
};

const jsonReq = (body, headers = {}) =>
  new Request('https://example.com/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7', ...headers },
    body: JSON.stringify(body),
  });
const formReq = (body, headers = {}) =>
  new Request('https://example.com/api/contact', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      referer: 'https://example.com/contact',
      'x-forwarded-for': '198.51.100.8',
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  });

const make = (extra = {}) => {
  const { mails, send } = sentMail();
  const form = createContactForm({
    site: 'example',
    to: 'hello@example.com',
    from: 'Example <hello@example.com>',
    send,
    guard: { secret: SECRET, minAgeMs: 0 },
    ...extra,
  });
  return { form, mails };
};
const tokenOf = async (form) => (await form.props()).token;
const VALID = {
  name: 'Dana Okafor',
  email: 'dana@okafor.dev',
  message: 'We run four nodes and want to understand settlement timing.',
};

describe('questions', () => {
  test('defaults are name, email, message, all required', () => {
    expect(DEFAULT_QUESTIONS.map((q) => [q.name, q.required])).toEqual([
      ['name', true],
      ['email', true],
      ['message', true],
    ]);
  });

  test('withQuestions adds before message, omits and overrides', () => {
    const qs = withQuestions({
      add: [{ name: 'company' }],
      omit: ['name'],
      override: { message: { label: 'Tell us more' } },
    });
    expect(qs.map((q) => q.name)).toEqual(['email', 'company', 'message']);
    expect(qs[2].label).toBe('Tell us more');
  });

  test('normalizeQuestions refuses unsafe names, duplicates, unknown types, empty selects', () => {
    expect(() => normalizeQuestions([{ name: 'a b' }])).toThrow();
    expect(() => normalizeQuestions([{ name: 'a' }, { name: 'a' }])).toThrow();
    expect(() => normalizeQuestions([{ name: 'a', type: 'color' }])).toThrow();
    expect(() => normalizeQuestions([{ name: 'a', type: 'select' }])).toThrow();
    expect(() => normalizeQuestions([])).toThrow();
  });

  test('validate: required, email, url, select, maxLength, and drops unknown keys', () => {
    const qs = normalizeQuestions([
      ...DEFAULT_QUESTIONS,
      { name: 'budget', type: 'select', options: ['<5k', '5k+'] },
      { name: 'site', type: 'url' },
      { name: 'short', maxLength: 3 },
    ]);
    expect(validate(qs, { ...VALID, budget: 'lots' })).toMatchObject({
      ok: false,
      field: 'budget',
    });
    expect(validate(qs, { ...VALID, email: 'nope' })).toMatchObject({ ok: false, field: 'email' });
    expect(validate(qs, { ...VALID, site: 'ftp://x' })).toMatchObject({ ok: false, field: 'site' });
    expect(validate(qs, { ...VALID, short: 'toolong' })).toMatchObject({
      ok: false,
      field: 'short',
    });
    expect(validate(qs, { ...VALID, name: '  ' })).toMatchObject({
      ok: false,
      field: 'name',
      error: 'Your name is required',
    });
    const ok = validate(qs, { ...VALID, budget: '5k+', injected: 'x' });
    expect(ok.ok).toBe(true);
    expect(ok.values.injected).toBeUndefined();
  });
});

describe('createContactForm', () => {
  test('requires `to`', () => {
    expect(() => createContactForm({ guard: false })).toThrow();
  });

  test('a real submission is delivered with labels, reply-to and provenance', async () => {
    const { form, mails } = make({
      questions: withQuestions({ add: [{ name: 'company', label: 'Company / Project' }] }),
    });
    const res = await form.POST(
      jsonReq({ ...VALID, company: 'Okafor Labs', fg_token: await tokenOf(form) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, messageId: 'm1' });
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      to: 'hello@example.com',
      replyTo: 'dana@okafor.dev',
      subject: 'New contact form submission from Dana Okafor',
    });
    expect(mails[0].text).toContain('Company / Project: Okafor Labs');
    expect(mails[0].text).toContain('198.51.100.7');
    expect(mails[0].html).not.toContain('fg_token');
  });

  test('a direct POST with no token is answered like a success and not delivered', async () => {
    const { form, mails } = make();
    const res = await form.POST(jsonReq(VALID));
    expect(await res.json()).toEqual({ success: true });
    expect(mails).toHaveLength(0);
  });

  test('a forged token and a filled honeypot are dropped the same way', async () => {
    const { form, mails } = make();
    await form.POST(jsonReq({ ...VALID, fg_token: '1.abc.def' }));
    await form.POST(
      jsonReq({ ...VALID, fg_token: await tokenOf(form), website: 'https://spam.example' }),
    );
    expect(mails).toHaveLength(0);
  });

  test('guard checks run before validation, so a bot never learns the fields', async () => {
    const { form } = make();
    const res = await form.POST(jsonReq({ junk: 1 }));
    expect(await res.json()).toEqual({ success: true });
  });

  test('a too-fast submit gets a retry, not a drop', async () => {
    const { form, mails } = make({ guard: { secret: SECRET, minAgeMs: 60_000 } });
    const res = await form.POST(jsonReq({ ...VALID, fg_token: await tokenOf(form) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('send it again');
    expect(mails).toHaveLength(0);
  });

  test('rate limit answers 429', async () => {
    const { form } = make({
      guard: { secret: SECRET, minAgeMs: 0, rateLimit: { max: 1, windowMs: 60_000 } },
    });
    expect((await form.POST(jsonReq({ ...VALID, fg_token: await tokenOf(form) }))).status).toBe(
      200,
    );
    expect((await form.POST(jsonReq({ ...VALID, fg_token: await tokenOf(form) }))).status).toBe(
      429,
    );
  });

  test('validation errors come back as 400 with the label', async () => {
    const { form } = make();
    const res = await form.POST(jsonReq({ ...VALID, email: 'bad', fg_token: await tokenOf(form) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Email must be a valid email address' });
  });

  test('response styles', async () => {
    const { form } = make({ style: 'ok' });
    expect(
      await (await form.POST(jsonReq({ ...VALID, fg_token: await tokenOf(form) }))).json(),
    ).toEqual({
      ok: true,
    });
    const m = make({ style: 'message' }).form;
    expect(await (await m.POST(jsonReq({ ...VALID, fg_token: await tokenOf(m) }))).json()).toEqual({
      message: "Message received! We'll be in touch.",
    });
  });

  test('requireSubstance quarantines the stock enquiry but keeps a real one', async () => {
    const quarantined = [];
    const { form, mails } = make({
      questions: withQuestions({ override: { message: { label: 'What should it do?' } } }),
      requireSubstance: ['message'],
      onQuarantine: (s) => {
        quarantined.push(s.email);
      },
    });
    const template =
      'Hello, I have a few questions about pricing, availability, and the general process of working with you. Please let me know what details you need from me to proceed. Thanks!';
    const spam = await form.POST(
      jsonReq({ ...VALID, message: template, fg_token: await tokenOf(form) }),
    );
    expect(await spam.json()).toEqual({ success: true });
    expect(mails).toHaveLength(0);
    expect(quarantined).toEqual(['dana@okafor.dev']);
    await form.POST(
      jsonReq({
        ...VALID,
        message: `${template} I want a booking app for my barbershop.`,
        fg_token: await tokenOf(form),
      }),
    );
    expect(mails).toHaveLength(1);
  });

  test('requireSubstance must name a question', () => {
    expect(() =>
      createContactForm({ to: 'a@b.c', guard: false, requireSubstance: ['idea'] }),
    ).toThrow();
  });

  test('a plain form post is redirected back with ?sent=1 or ?error=', async () => {
    const { form, mails } = make();
    const ok = await form.POST(formReq({ ...VALID, fg_token: await tokenOf(form) }));
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('https://example.com/contact?sent=1');
    expect(mails).toHaveLength(1);
    const bad = await form.POST(formReq({ ...VALID, email: 'x', fg_token: await tokenOf(form) }));
    expect(bad.headers.get('location')).toBe(
      'https://example.com/contact?error=Email+must+be+a+valid+email+address',
    );
    const relative = createContactForm({
      to: 'a@b.c',
      guard: false,
      send: async () => ({ sent: true }),
      redirect: '/thanks',
    });
    expect((await relative.POST(formReq(VALID))).headers.get('location')).toBe('/thanks?sent=1');
  });

  test('persist runs before delivery and its id is returned', async () => {
    const { form } = make({ persist: async (s) => `row-${s.email}` });
    const body = await (
      await form.POST(jsonReq({ ...VALID, fg_token: await tokenOf(form) }))
    ).json();
    expect(body.id).toBe('row-dana@okafor.dev');
  });

  test('send failure: 500 by default, success with onSendError=ignore', async () => {
    const fail = async () => ({ sent: false, error: 'boom' });
    const a = createContactForm({ to: 'a@b.c', guard: false, send: fail });
    expect((await a.POST(jsonReq(VALID))).status).toBe(500);
    const b = createContactForm({ to: 'a@b.c', guard: false, send: fail, onSendError: 'ignore' });
    expect((await b.POST(jsonReq(VALID))).status).toBe(200);
  });

  test('invalid JSON is a 400', async () => {
    const { form } = make();
    const res = await form.POST(
      new Request('https://example.com/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      }),
    );
    expect(res.status).toBe(400);
  });

  test('render(): every question, the token, the honeypot hidden by class, escaped values', async () => {
    const { form } = make({
      questions: withQuestions({
        add: [{ name: 'budget', type: 'select', options: ['<5k', '5k+'] }],
      }),
    });
    const html = await form.render({
      action: '/contact',
      values: { name: '<script>x</script>' },
      error: 'Oops & more',
    });
    expect(html).toContain('action="/contact"');
    expect(html).toContain('name="fg_token" value="');
    expect(html).toContain(
      '<div aria-hidden="true" class="cf-hp"><label>Website<input type="text" name="website"',
    );
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('<p class="cf-error" role="alert">Oops &amp; more</p>');
    expect(html).toContain('<option value="5k+">5k+</option>');
    expect(html).not.toContain('style=');
  });

  test('GET returns fresh props with no-store', async () => {
    const { form } = make();
    const res = await form.GET();
    expect(res.headers.get('cache-control')).toBe('no-store');
    const p = await res.json();
    expect(p.tokenField).toBe('fg_token');
    expect(p.token).toBeTruthy();
    expect(p.questions.map((q) => q.name)).toEqual(['name', 'email', 'message']);
  });

  test('guard: false still honours the honeypot', async () => {
    const { mails, send } = sentMail();
    const form = createContactForm({ to: 'a@b.c', guard: false, send });
    await form.POST(jsonReq({ ...VALID, website: 'x' }));
    expect(mails).toHaveLength(0);
    await form.POST(jsonReq(VALID));
    expect(mails).toHaveLength(1);
  });

  test('no guard secret anywhere falls back to the honeypot, with a warning', async () => {
    const saved = [process.env.FORM_GUARD_SECRET, process.env.RESEND_API_KEY];
    delete process.env.FORM_GUARD_SECRET;
    delete process.env.RESEND_API_KEY;
    try {
      const form = createContactForm({ to: 'a@b.c', send: async () => ({ sent: true }) });
      expect(form.guard).toBeNull();
      expect(await form.render()).toContain('name="website"');
    } finally {
      if (saved[0] !== undefined) process.env.FORM_GUARD_SECRET = saved[0];
      if (saved[1] !== undefined) process.env.RESEND_API_KEY = saved[1];
    }
  });
});

describe('<ContactForm>', () => {
  test('renders the questions, token and honeypot from props()', async () => {
    const { form } = make();
    const html = renderToStaticMarkup(
      createElement(ContactForm, await form.props({ action: '/api/contact' })),
    );
    expect(html).toContain('<form class="cf-form" action="/api/contact" method="post">');
    expect(html).toContain('name="message"');
    expect(html).toMatch(/<input type="hidden" name="fg_token" value="[^"]+"\/>/);
    expect(html).toContain('class="cf-hp"');
    expect(html).toContain('name="website"');
  });
});
