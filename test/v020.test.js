import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createContactForm, normalizeQuestions } from '../index.js';
import { ContactForm } from '../react.js';

// Gaps found rolling the module out to the fleet (2026-10-29): starting
// values, select defaults and placeholders, section headings, success view.

const mails = [];
const make = (questions) =>
  createContactForm({
    site: 'example',
    to: 'hello@example.com',
    questions,
    send: async (m) => {
      mails.push(m);
      return { sent: true, id: 'm' };
    },
    guard: { secret: 'test-secret-that-is-long-enough', minAgeMs: 0, rateLimit: false },
  });
const jsonReq = (body) =>
  new Request('https://example.com/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const qs = [
  { name: 'section1', type: 'section', label: 'Personal Details', help: 'Who you are' },
  { name: 'email', type: 'email', required: true },
  { name: 'topic', type: 'select', options: ['investor', 'press', 'other'], default: 'other' },
  {
    name: 'service',
    type: 'select',
    required: true,
    placeholder: 'Select a service...',
    options: ['tattoo', 'piercing'],
  },
  { name: 'wantsMock', type: 'checkbox' },
  { name: 'ref', type: 'hidden' },
  { name: 'message', type: 'textarea' },
];

describe('starting values, select placeholders, sections, success view', () => {
  test('a select default must be one of its options', () => {
    expect(() =>
      normalizeQuestions([{ name: 't', type: 'select', options: ['a'], default: 'b' }]),
    ).toThrow();
  });

  test('render(): default selected, placeholder first and selected, section, per-render values', async () => {
    const html = await make(qs).render({ values: { wantsMock: 'yes', ref: 'partner-7' } });
    expect(html).toContain('<option value="other" selected>other</option>');
    expect(html).not.toContain('<option value="investor" selected>');
    expect(html).toContain(
      '<option value="" selected>Select a service...</option><option value="tattoo">',
    );
    expect(html).toContain(
      '<h3 class="cf-section" id="cf-section1">Personal Details</h3><p class="cf-help">Who you are</p>',
    );
    expect(html).toMatch(/<input type="checkbox" id="cf-wantsMock" name="wantsMock" checked>/);
    expect(html).toContain('<input type="hidden" name="ref" value="partner-7">');
  });

  test('a section is not a field: never validated, never in the email', async () => {
    const form = make(qs);
    mails.length = 0;
    const token = (await form.props()).token;
    const res = await form.POST(
      jsonReq({ email: 'a@b.co', service: 'tattoo', section1: 'x', fg_token: token }),
    );
    expect(res.status).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0].text).not.toContain('Personal Details');
    expect(mails[0].text).not.toContain('section1');
  });

  test('a required select with a placeholder refuses the empty choice', async () => {
    const form = make(qs);
    const token = (await form.props()).token;
    const res = await form.POST(jsonReq({ email: 'a@b.co', service: '', fg_token: token }));
    expect(await res.json()).toEqual({ error: 'Service is required' });
  });

  test('props({ values }) keeps only question names; checkboxes become yes or ""', async () => {
    const p = await make(qs).props({ values: { wantsMock: true, ref: 'r1', evil: 'x' } });
    expect(p.values).toEqual({ wantsMock: 'yes', ref: 'r1' });
  });

  test('<ContactForm>: default, placeholder, pre-ticked box, hidden value, section', async () => {
    const props = await make(qs).props({ values: { wantsMock: '1', ref: 'partner-7' } });
    const html = renderToStaticMarkup(createElement(ContactForm, props));
    expect(html).toContain('<option value="other" selected="">other</option>');
    expect(html).toContain('<option value="" selected="">Select a service...</option>');
    expect(html).toContain('checked=""');
    expect(html).toContain('<input type="hidden" name="ref" value="partner-7"/>');
    expect(html).toContain('<h3 class="cf-section" id="cf-section1">Personal Details</h3>');
  });

  test('<ContactForm defaultValues> wins over props values', async () => {
    const props = await make(qs).props({ values: { ref: 'a' } });
    const html = renderToStaticMarkup(
      createElement(ContactForm, { ...props, defaultValues: { ref: 'b' } }),
    );
    expect(html).toContain('<input type="hidden" name="ref" value="b"/>');
  });
});
