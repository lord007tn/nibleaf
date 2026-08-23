import type { ReactElement } from 'react';
import { render } from 'react-email';

export async function renderEmail(node: ReactElement) {
  const [html, text] = await Promise.all([render(node, { pretty: false }), render(node, { plainText: true })]);
  return { html, text };
}
