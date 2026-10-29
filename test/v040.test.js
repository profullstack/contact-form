import { expect, test } from 'bun:test';
import { mountGuard } from '../browser.js';
import { createContactForm } from '../index.js';

const mails = [];
const make = () =>
  createContactForm({
    to: 'a@b.co',
    send: async (m) => {
      mails.push(m);
      return { sent: true, id: 'm' };
    },
    guard: { secret: 'test-secret-that-is-long-enough', minAgeMs: 0, rateLimit: false },
  });
const good = { name: 'Dana', email: 'dana@okafor.dev', message: 'Hello there, a real question.' };

// Primate puts the parsed body in request.body; Express has body-parser.
test('handleFields: JSON answers, plain-form answers, token still required', async () => {
  const c = make();
  mails.length = 0;
  const token = (await c.props()).token;
  const ok = await c.handleFields({ ...good, fg_token: token }, { ip: '198.51.100.9' });
  expect(await ok.json()).toEqual({ success: true, messageId: 'm' });
  expect(mails[0].text).toContain('198.51.100.9');
  const dropped = await c.handleFields(good);
  expect(await dropped.json()).toEqual({ success: true });
  expect(mails).toHaveLength(1);
  const html = await c.handleFields(
    { ...good, email: 'x', fg_token: token },
    { html: true, referer: 'https://x.example/contact' },
  );
  expect(html.status).toBe(303);
  expect(html.headers.get('location')).toBe(
    'https://x.example/contact?error=invalid&field=email&reason=email',
  );
});

// A tiny DOM: enough of document/form for mountGuard.
function fakeForm() {
  const children = [];
  const el = (tag) => {
    const node = {
      tag,
      attrs: {},
      children: [],
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      appendChild(c) {
        this.children.push(c);
        return c;
      },
      remove() {
        children.splice(children.indexOf(node), 1);
      },
    };
    return node;
  };
  const doc = { createElement: el };
  return {
    ownerDocument: doc,
    children,
    appendChild(c) {
      children.push(c);
      return c;
    },
    querySelectorAll: () => children.filter((c) => 'data-cf-guard' in c.attrs),
  };
}

test('mountGuard adds the token and honeypot from contact.GET, and replaces them on a remount', async () => {
  const c = make();
  const fetchStub = async () => c.GET();
  const form = fakeForm();
  const props = await mountGuard(form, '/api/contact', { fetch: fetchStub });
  expect(props.tokenField).toBe('fg_token');
  expect(form.children).toHaveLength(2);
  expect(form.children[0]).toMatchObject({ tag: 'input', type: 'hidden', name: 'fg_token' });
  expect(form.children[0].value).toBe(props.token);
  expect(form.children[1].className).toBe('cf-hp');
  expect(form.children[1].children[0].children[0]).toMatchObject({ name: 'website', tabIndex: -1 });
  await mountGuard(form, '/api/contact', { fetch: fetchStub });
  expect(form.children).toHaveLength(2);
});

test('mountGuard refuses a missing form and a failing route', async () => {
  await expect(mountGuard(null, '/x')).rejects.toThrow();
  const failing = async () => new Response('no', { status: 500 });
  await expect(mountGuard(fakeForm(), '/x', { fetch: failing })).rejects.toThrow('answered 500');
});
