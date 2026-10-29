import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createContactForm } from '../index.js';
import { ContactForm } from '../react.js';

// A checkbox is optional by nature; "(optional)" after "Send me a free mock" reads oddly.
test('no "(optional)" marker on a checkbox, still on an optional text field', async () => {
  const form = createContactForm({
    to: 'a@b.co',
    guard: false,
    questions: [
      { name: 'email', type: 'email', required: true },
      { name: 'wantsMock', type: 'checkbox', label: 'Send me a free mock' },
      { name: 'company' },
    ],
  });
  const html = await form.render();
  expect(html).toContain('<label for="cf-wantsMock">Send me a free mock</label>');
  expect(html).toContain('Company <span class="cf-optional">(optional)</span>');
  const react = renderToStaticMarkup(createElement(ContactForm, await form.props()));
  expect(react).toContain('<label for="cf-wantsMock">Send me a free mock</label>');
  expect(react).toContain('cf-optional');
});
