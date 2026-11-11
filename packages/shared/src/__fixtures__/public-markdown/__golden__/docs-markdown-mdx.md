Every Nibleaf page is stored as Markdown, a plain-text format where symbols add
formatting, such as `**bold**`. MDX adds components, written like HTML tags, for
richer layouts such as tabs and cards. The visual editor writes this for you. Use
this reference when you choose **Edit as Markdown (advanced)** in the editor.

Always check your changes in **Preview**. Text that is valid Markdown can still
look different from what you expected.

## Basic formatting

Nibleaf supports standard Markdown and the GitHub extensions: headings, bold,
italics, links, images, quotes, lists, task lists, tables, strikethrough, inline
code, and code blocks.

- Set the page title in the editor's title field, not with a `#` heading. Start
  sections at `##` and don't skip levels.
- Add a language to each code block so it is highlighted correctly. You can also
  add a title:

````md
```bash title="Start Nibleaf"
docker compose -f docker-compose.prod.yml up -d
```
````

## Callouts

Callouts highlight a note, tip, or warning. The GitHub style works in both the
visual editor and Markdown:

```md
> [!WARNING]
> Back up Postgres and object storage before an upgrade.
```

The supported types are `NOTE`, `TIP`, `CHECK`, `WARNING`, `CAUTION` (shown as
danger), and `IMPORTANT` (shown as info). You can also write `<Note>`, `<Tip>`,
`<Check>`, `<Warning>`, `<Danger>`, or `<Callout type="warning">`.

## Block components

| Component | Use it for | Attributes |
| --- | --- | --- |
| `Card`, `CardGroup` | Links to related pages, shown as cards | card `title`, `href`, `icon`; group `cols` |
| `Steps`, `Step` | Numbered procedures | step `title` |
| `Tabs`, `Tab` | Alternatives, such as one tab per operating system | tab `title` |
| `Accordion`, `AccordionGroup` | Optional detail that readers can expand | `title`, `defaultOpen` |
| `Expandable` | Nested detail, often inside API fields | `title`, `defaultOpen` |
| `Columns`, `Column` | Side-by-side content | none |
| `Frame` | An image or video with a caption | `caption` |
| `Banner` | A highlighted message | `type` |
| `Update` | A changelog entry | `label`, `description` |
| `CodeGroup` | Several code blocks shown as tabs | each code block's language becomes its tab label |
| `ParamField`, `ResponseField` | API parameters and response fields | `name`, `type`, `required`, `default`, `deprecated`; `ParamField` also accepts `path`, `query`, `header`, `body` |
| `ApiExample`, `RequestExample`, `ResponseExample` | A request and its response | `title`; response `status` |
| `FileTree`, `Folder`, `File` | A drawing of a folder structure | `name`; folder `defaultOpen`; file `icon` |
| `RelatedContent`, `RelatedCard` | "Read next" links at the end of a page | `title`; card `description`, `href`, `icon` |

Put each component tag on its own line, and leave a blank line around Markdown
inside it:

```mdx
<Steps>
  <Step title="Create a backup">

  Run the backup script and record the output files.

  </Step>
</Steps>
```

A file tree only shows the names you type. It doesn't read real files. API
examples and related cards also show only what you write.

Tabs, code groups, accordions, and file trees work with a keyboard. In tabs, the
arrow keys move between labels, and they follow the reading direction in Arabic.

## Inline components

| Component | Use it for | Attributes |
| --- | --- | --- |
| `Tooltip` | A short definition shown on hover or focus | `tip` |
| `Icon` | A small icon from the built-in set | `icon` or `name`, `color`, `size` |
| `Badge` | A small label, such as "Beta" | `color` |
| `Button` | A link styled as a button | `href`, `variant` (`outline` for an outlined button) |

Example: `<Tooltip tip="A plain-language definition">term</Tooltip>`.

Don't put required instructions in a tooltip, and don't rely on an icon alone to
carry meaning.

## Math and diagrams

- **Math:** write inline math between single dollar signs and block math between
  double dollar signs.
- **Diagrams:** write a Mermaid diagram in a code block marked `mermaid`.

Always explain a diagram's main point in the text too. Some readers can't see
diagrams, and search can't read them.

## Unsupported or custom code

Nibleaf removes scripts, event handlers, and unknown attributes when it shows a
page. If a page uses a component that isn't in this reference, the visual editor
keeps it exactly as written and lets you edit the content around it. Nibleaf
can't promise to display custom components, so check the published page and
prefer the components listed here.
