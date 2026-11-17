/** The starter site's Getting started page title and icon, as sign-up creates it. */
export const STARTER_GETTING_STARTED_TITLE = 'Getting started';
export const STARTER_GETTING_STARTED_ICON = 'rocket';

/** The starter site's Getting started page, exactly as sign-up creates it.
 * Importers compare against it to recognise an untouched starter page: any
 * edit, even whitespace-insensitive additions, makes the page the writer's. */
export const STARTER_GETTING_STARTED_CONTENT = `Welcome to your new documentation site. Everything you read here is a regular
page — edit it, replace it, or delete it. This starter shows what your docs can
do, so your first edits feel natural.

## Edit this page

1. Click anywhere in the text and start typing — the editor is a Notion-style
   editor over plain Markdown.
2. Type \`/\` on an empty line to insert callouts, code blocks, tabs, and more.
3. Changes save automatically as drafts. Nothing goes live until you publish.

## Publish your site

Hit **Publish** in the top bar to ship a snapshot of your docs as a live,
searchable site. This starter was published for you at sign-up, so your site is
already live — each publish after this replaces it, and you can roll back to
any earlier version.

<Note>

Write about **your** product here. A good first edit: rename this page, then
describe what your product does in one paragraph.

</Note>

## Explore the starter

<CardGroup cols="2">

<Card title="Installation" href="/installation" icon="download">

Show users how to install your product with tabs and step-by-step guides.

</Card>

<Card title="Components tour" href="/components-tour" icon="puzzle">

Steps, tabs, callouts, cards, and accordions — everything in your toolkit.

</Card>

<Card title="API reference" href="/api-reference/create-a-widget" icon="code">

Document endpoints with parameter and response fields.

</Card>

<Card title="FAQ" href="/faq" icon="help-circle">

Answer common questions with accordions.

</Card>

</CardGroup>
`;

// The rest of the starter site's pages, exactly as sign-up creates them.

export const STARTER_INSTALLATION_CONTENT = `Replace this page with real installation instructions for your product. It
demonstrates the two building blocks most install guides need: tabs for
package managers and steps for a walkthrough.

## Install the package

<Tabs>

<Tab title="npm">

\`\`\`bash
npm install @acme/sdk
\`\`\`

</Tab>

<Tab title="pnpm">

\`\`\`bash
pnpm add @acme/sdk
\`\`\`

</Tab>

<Tab title="yarn">

\`\`\`bash
yarn add @acme/sdk
\`\`\`

</Tab>

</Tabs>

## Set up your project

<Steps>

<Step title="Grab an API key">

Create a key in your product's dashboard and keep it secret — treat it like a
password.

</Step>

<Step title="Configure the client">

\`\`\`ts title="acme.ts"
import { Acme } from '@acme/sdk';

export const acme = new Acme({ apiKey: process.env.ACME_API_KEY });
\`\`\`

</Step>

<Step title="Make your first call">

\`\`\`ts
const widget = await acme.widgets.create({ name: 'My first widget' });
console.log(widget.id);
\`\`\`

</Step>

</Steps>

<Tip>

Swap \`@acme/sdk\` for your real package name. Code blocks support syntax
highlighting for dozens of languages, plus a \`title="file.ts"\` header.

</Tip>

Next: document your API in the [API reference](/api-reference/create-a-widget).
`;

export const STARTER_COMPONENTS_TOUR_CONTENT = `Every component on this page works in the editor today — copy the patterns you
like into your own pages, then delete this tour.

## Callouts

<Note>

A **Note** for neutral asides. There are also \`<Info>\`, \`<Tip>\`, \`<Check>\`,
\`<Warning>\`, and \`<Danger>\` variants.

</Note>

<Warning>

A **Warning** for things that break when readers skip them.

</Warning>

## Steps

<Steps>

<Step title="Write">

Draft pages in the editor — plain Markdown underneath, so nothing locks you in.

</Step>

<Step title="Organize">

Drag pages in the sidebar to reorder them, or nest them into groups.

</Step>

<Step title="Publish">

Ship a new version of the live site whenever you are ready.

</Step>

</Steps>

## Tabs

<Tabs>

<Tab title="macOS">

Content per platform, per language, per anything.

</Tab>

<Tab title="Windows">

Each tab holds full Markdown — lists, code blocks, images.

</Tab>

</Tabs>

## Cards

<CardGroup cols="2">

<Card title="Link card" href="/faq" icon="help-circle">

Cards can link to other pages or external URLs.

</Card>

<Card title="Plain card" icon="box">

Or just hold content in a tidy grid.

</Card>

</CardGroup>

## Accordions

<AccordionGroup>

<Accordion title="When should I use an accordion?">

For optional detail readers should not have to scroll past — edge cases,
advanced configuration, long FAQ answers.

</Accordion>

<Accordion title="Can accordions hold other components?">

Yes — accordions hold full Markdown, including code blocks and callouts.

</Accordion>

</AccordionGroup>
`;

export const STARTER_API_AUTHENTICATION_CONTENT = `Show readers how to authenticate against your API. This example uses a bearer
token; adapt it to your scheme.

All requests must include your API key in the \`Authorization\` header:

<CodeGroup>

\`\`\`bash title="cURL"
curl https://api.example.com/v1/widgets \\
  -H "Authorization: Bearer $ACME_API_KEY"
\`\`\`

\`\`\`ts title="TypeScript"
const res = await fetch('https://api.example.com/v1/widgets', {
  headers: { Authorization: \`Bearer \${process.env.ACME_API_KEY}\` },
});
\`\`\`

\`\`\`python title="Python"
import requests

res = requests.get(
    "https://api.example.com/v1/widgets",
    headers={"Authorization": f"Bearer {API_KEY}"},
)
\`\`\`

</CodeGroup>

<Warning>

Never ship API keys in client-side code. Call your API from a server and keep
keys in environment variables.

</Warning>
`;

export const STARTER_API_CREATE_WIDGET_CONTENT = `A worked example of an endpoint page. Duplicate it for each endpoint in your
API, or delete the group if you do not document an API.

## POST /v1/widgets

Creates a widget and returns it.

### Body parameters

<ParamField body="name" type="string" required="true">

A human-readable name, 1-80 characters.

</ParamField>

<ParamField body="color" type="string" default="terracotta">

Any CSS color keyword or hex value.

</ParamField>

<ParamField body="tags" type="string[]">

Up to 10 tags used for filtering in list endpoints.

</ParamField>

### Response

<ResponseField name="id" type="string" required="true">

Unique identifier, prefixed with \`wid_\`.

</ResponseField>

<ResponseField name="name" type="string" required="true">

The name you supplied.

</ResponseField>

<ResponseField name="createdAt" type="string">

ISO 8601 creation timestamp.

</ResponseField>

### Example

<CodeGroup>

\`\`\`bash title="Request"
curl -X POST https://api.example.com/v1/widgets \\
  -H "Authorization: Bearer $ACME_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "My first widget" }'
\`\`\`

\`\`\`json title="Response"
{
  "id": "wid_1a2b3c",
  "name": "My first widget",
  "createdAt": "2026-07-10T12:00:00Z"
}
\`\`\`

</CodeGroup>

See [Authentication](/api-reference/authentication) for how to get a key.
`;

export const STARTER_FAQ_CONTENT = `A pattern for frequently asked questions — accordions keep long answer lists
scannable. Replace these with questions about your product.

<AccordionGroup>

<Accordion title="How do I change what visitors see?">

Edit any page, then hit **Publish**. The live site only updates when you
publish, so drafts stay private.

</Accordion>

<Accordion title="How do I add a page?">

Use the add button in the sidebar. Drag pages to reorder them, or drop one
onto another to nest it inside a group.

</Accordion>

<Accordion title="Can I write in more than one language?">

Yes — add languages in project settings. Each language keeps its own page
tree, and right-to-left languages such as Arabic are fully supported.

</Accordion>

<Accordion title="Can I use my own domain?">

Yes — add a custom domain in project settings and follow the DNS
instructions.

</Accordion>

<Accordion title="Where does this starter content come from?">

Your docs run on Nibleaf, an open-source, self-hostable documentation
platform — an alternative to Mintlify and GitBook. Source at
[github.com/lord007tn/nibleaf](https://github.com/lord007tn/nibleaf), hosted
cloud at [nibleaf.com](https://nibleaf.com).

</Accordion>

</AccordionGroup>
`;

/** Every page the starter site is created with, by title, for tests that open them. */
export const STARTER_PAGE_CONTENTS: ReadonlyArray<{ title: string; content: string }> = [
  { title: STARTER_GETTING_STARTED_TITLE, content: STARTER_GETTING_STARTED_CONTENT },
  { title: 'Installation', content: STARTER_INSTALLATION_CONTENT },
  { title: 'Components tour', content: STARTER_COMPONENTS_TOUR_CONTENT },
  { title: 'Authentication', content: STARTER_API_AUTHENTICATION_CONTENT },
  { title: 'Create a widget', content: STARTER_API_CREATE_WIDGET_CONTENT },
  { title: 'FAQ', content: STARTER_FAQ_CONTENT },
];
