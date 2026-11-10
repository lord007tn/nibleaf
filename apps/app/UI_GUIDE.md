# Building a settings screen

How to build or rebuild a dashboard settings section. `operations/ui-overhaul.md` is the full contract;
`DATA_LOADING.md` covers queries, loaders and skeletons. The worked example is
`src/features/site-general/`.

## Where code goes

```
src/features/<feature>/
  api/hooks.ts         queries and mutations for this screen (wraps src/hooks/api until the feature owns them)
  model/*.ts           pure logic: values, validation, which requests a save sends, access decisions
  model/*.test.ts      unit tests for all of it
  components/*.tsx     rendering only
```

- **Components never decide policy.** Role checks, "why is this disabled", validation rules and save diffs live in
  `model/` and are unit-tested. A component calls them and renders the result.
- **Import from explicit paths.** No barrel `index.ts`.
- **Route files stay thin:** search validation, loader prefetch, and one feature component.
- **`features-boundaries.test.ts` enforces the layers:**
  - `model/` imports no React, design-system, TanStack or services code;
  - `api/` imports no components;
  - features import each other only through public entrypoints.

## Layout

Use the design-system primitives. Never hand-write a card.

```tsx
<PageHeader title={t('…title')} description={t('…summary')} />
<SettingsSection title={t('…')} description={t('…')}>
  <SettingsRow label={t('…')} description={t('…')} control="switch">
    {(ids) => <Switch {...ids.controlProps} checked={on} onCheckedChange={set} />}
  </SettingsRow>
</SettingsSection>
```

- **One bordered panel per section.** Inside it, use rows and dividers, never another card.
- **Row layout:**
  - `layout="inline"` puts the label at the start and the control at the end;
  - `layout="stacked"` is for textareas and lists;
  - `control` sets the control's width: `switch`, `compact`, `field` or `auto`.
- **Font sizes:** only `text-xl` (page title), `text-base` (section title), `text-sm` and `text-xs`. No `text-[13px]`;
  `scripts/check-type-scale.mjs` counts them, and the count only goes down.
- **Text direction:** logical properties only (`ms-`, `pe-`, `start`, `end`). Give user content `dir="auto"`, or the
  content language's `dir`.

## Forms that save with a button

```tsx
const { form, ...draft } = useServerDraftForm({ identity: [projectId, 'general'], source, onSubmit });
useSaveRegionForm('site-general', { isDirty: draft.isDirty, isSubmitting, submit, discard: draft.discard });
```

- **`source`** is the normalized editable values from the query (`toValues(query.data)`). The hook keeps the form in
  step with the server and never drops an edit. Fields the person hasn't touched take server changes. Edits made
  during a save survive it. Fields both sides changed show a "Use theirs / Keep mine" callout.
- **Every editable value is in the form**, including icons, toggles and per-language drafts. No `useState` beside it,
  and no `useEffect` copying server data.
- **Wrap the screen in `SaveRegionProvider`.** The bar appears only while something is dirty. It saves with Save,
  Enter or Cmd/Ctrl+S, and an invalid save focuses the first highlighted field. It also reports to the route's
  unsaved-changes guard.
- **Fields:** wrap them in `FormField` with `validators={validateOnBlurThenChange(check)}`. Errors show after the
  field is left or the form is submitted, never while typing in a fresh field, and they clear as the value is fixed.
- **Server refusals that belong to a field** (an address already taken) go on that field through `withServerError`.
  Everything else gets one `friendlyErrorMessage` toast, and the form stays dirty.

## Controls that apply on change

A toggle or select that saves on its own needs no save bar. Its mutation:

- is optimistic only when the outcome is predictable and touches nothing else (`operations/ui-overhaul.md` §8.2);
- rolls back on failure and toasts a plain-language message.

## Permissions

Read `useSiteAccess(projectId)` from `features/site-access/api/use-site-access` and use the pure model's
`decide(access, action)` in feature models:

```ts
const edit = decide(access, { type: 'site.content.edit' });
const remove = decide(access, { type: 'site.member.remove', member });
```

`allowed` enables the control; `locked` disables it without permission copy while access is unknown.
`denied` carries a `MessageKey` to translate into a visible reason. Show one retry at the section top for
`unavailable`. Cached `ready` access remains usable when `stale`. Keep role checks out of components;
the server still authorizes every write.

## Disabled, unavailable, empty

- **Disabled controls say why.** Use `disabledReason` on `SettingsRow`, `Button`, `TooltipButton` and
  `RowActionsItem`. The reason comes from the model.
- **A feature that can't be used here** (not configured, not on the plan) renders one `FeatureUnavailable` instead of
  its body. Never a dead form under a notice, and no operator wording on Cloud.
- **Lists:** `DataList` with `RowActions`, whose trigger is named after the row. `EmptyState` when there's nothing to
  show.

## Done means

Before/after screenshots at 1440 and 390 px, light and dark, English and Arabic. Loading, empty, error, read-only and
saving states. Keyboard only. Model unit tests. Filtered typecheck, lint and tests.
