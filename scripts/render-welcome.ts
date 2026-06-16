import * as React from 'react';
import { render } from '@react-email/components';
import { template } from '../src/lib/email-templates/circle-welcome';

const props = {
  firstName: 'Justin',
  siteName: 'Contractor Circle',
  siteUrl: 'https://app.alpcontractorcircle.com',
};
const el = React.createElement(template.component, props);
const html = await render(el);
const text = await render(el, { plainText: true });
const subject = typeof template.subject === 'function' ? template.subject(props) : template.subject;

const out = { html, text, subject };
await Bun.write('/tmp/justin-welcome.json', JSON.stringify(out));
console.log('rendered', { subject, htmlLen: html.length, textLen: text.length });
