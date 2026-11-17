/*
 * Pages written the way Git-authored and imported Markdown usually is: paragraphs
 * hard-wrapped at about 80 columns, at the top level and inside lists, quotes and
 * components. The editor must open them without changing them (P1-ED-001) and save
 * an edit without re-wrapping the paragraphs the writer didn't touch.
 *
 * The two imported pages follow the pages the UX audit imported from the public
 * `mintlify/starter` repository (Introduction and Quickstart; both were rewritten
 * on open, data/phase-4/journey-2.json → import.openWithoutEdit), as the Mintlify
 * importer stores them. Each page ends with a component, like the starter's FAQ
 * and Getting started pages.
 */

export const HARD_WRAPPED_EN = `Every paragraph on this page is wrapped by hand, the way most Markdown in a Git
repository is. Opening it must not change a byte.

## Lists and quotes

- A tight list item that is long enough to wrap onto a second line, with the
  continuation indented under the marker.
- A short item.

1. An ordered item that also wraps, so the continuation sits three columns in,
   under its text.
2. Another short item.

> A quoted paragraph that wraps across two lines, each with its own quote
> marker in front.

Hit **Publish** when you are ready. A line can end with **bold**
and the next word must stay a separate word, as it does after \`code\`
or after a [link](/installation).

<Note>

A note whose body is a wrapped paragraph, kept inside the component when the
page is saved.

</Note>

<Steps>

<Step title="Install">

Install the package with your package manager of choice. The command below uses
npm.

</Step>

<Step title="Configure">

Add your API key to the environment, then restart the development server so it
picks the key up.

</Step>

</Steps>

<AccordionGroup>

<Accordion title="Does wrapping change how the page reads?">

No. A single line break inside a paragraph reads as a space, so readers see one
paragraph either way.

</Accordion>

</AccordionGroup>
`;

export const HARD_WRAPPED_AR = `كل فقرة في هذه الصفحة ملفوفة يدويًا، كما هو حال معظم ملفات ماركداون في
المستودعات. يجب ألا يغيّر فتحها أي بايت.

## القوائم والاقتباسات

- عنصر قائمة طويل بما يكفي ليلتف إلى سطر ثانٍ، مع إزاحة السطر التالي تحت
  العلامة.
- عنصر قصير.

> فقرة مقتبسة تلتف على سطرين، ولكل سطر علامة اقتباس خاصة به في
> بدايته.

اضغط **نشر** عندما تكون جاهزًا. الموقع المباشر لا يتغير إلا عند النشر، لذلك
تبقى المسودات خاصة.

<Note>

ملاحظة نصها فقرة ملفوفة، تبقى داخل المكوّن عند حفظ الصفحة دون أن تتغير
أسطرها.

</Note>

<AccordionGroup>

<Accordion title="هل يغيّر اللف طريقة قراءة الصفحة؟">

لا. فاصل السطر الواحد داخل الفقرة يُقرأ كمسافة، فيرى القارئ فقرة واحدة في
الحالتين.

</Accordion>

</AccordionGroup>
`;

export const IMPORTED_INTRODUCTION = `Welcome to the home of your new documentation. This page is the first thing
your readers see, so tell them what your product does and where to start.

## Setting up

The first step to world-class documentation is setting up your editing
environments.

<CardGroup cols="2">

<Card title="Edit your docs" icon="pen-to-square" href="/quickstart">

Get your docs set up locally for easy development, with a preview of every
change before it goes live.

</Card>

<Card title="Preview changes" icon="image" href="/quickstart">

Preview your changes before you push to make sure they're perfect.

</Card>

</CardGroup>

## Make it yours

Update your docs to your brand and add valuable content for the best user
conversion.

<CardGroup cols="2">

<Card title="Customize style" icon="palette" href="/quickstart">

Customize your docs to your company's colors and brands, so they feel like the
rest of your product.

</Card>

<Card title="Reference APIs" icon="code" href="/quickstart">

Auto-generate API documentation from OpenAPI specifications.

</Card>

</CardGroup>
`;

export const IMPORTED_QUICKSTART = `Start building awesome documentation in under 5 minutes. Follow the steps
below, then come back here whenever you need a refresher.

## Setup your development

Learn how to update your docs locally and deploy them to the public.

### Edit and preview

<AccordionGroup>

<Accordion title="1. Clone your docs locally">

During the onboarding process, we created a repository on your GitHub with your
docs content. You can find this repository on our dashboard.

To clone the repository locally, follow these
[instructions](https://docs.github.com/en/repositories/creating-and-managing-repositories/cloning-a-repository)
in your terminal.

</Accordion>

<Accordion title="2. Preview changes">

Previewing helps you make sure your changes look as intended. We built a command
line tool to render these changes locally.

1. Install the command line tool, which needs a recent version of Node.js on
   your machine.
2. Run the preview command in the root of your documentation.

</Accordion>

</AccordionGroup>

### Deploy your changes

<Tip>

Changes are deployed to production automatically after you push to the default
branch.

</Tip>

<Steps>

<Step title="Push your changes">

Commit your changes and push them to the default branch of the repository that
holds your docs.

</Step>

</Steps>
`;
