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
const { form, ...draft } = useServerDraftForm({ identity: [projectId, 'general'], source, onSubmit: saveValues });
// saveValues returns 'saved' | 'invalid' | 'failed' and calls save.succeeded(confirmed) on success.
const formProps = useSaveRegionForm('site-general', {
  isDirty: draft.isDirty,
  isSubmitting: draft.isSaving,
  submit, // draft.submit with 'busy' mapped to 'failed'
  discard: draft.discard,
  settlement: draft.settlement,
});

return (
  <form noValidate {...formProps}>
    <SaveRegionSubmit />
    {/* fields */}
  </form>
);
```

- **`source`** is the normalized editable values from the query (`toValues(query.data)`). The hook keeps the form in
  step with the server and never drops an edit. Fields the person hasn't touched take server changes. Edits made
  during a save survive it. Fields both sides changed show a "Use theirs / Keep mine" callout.
- **`save.succeeded(confirmed)` takes this request's own response** (or nothing), never a snapshot read from the
  query cache. Let the mutation await its query's refetch: the refetched value reaches the form through `source`,
  before or after the response, and is reconciled there for edits and conflicts. A refetched value that is neither
  what the save started from, nor what it sent, nor what the response confirms can't be ordered against the response
  (another writer, before or after the save, or different server normalization). The response never overrides it
  silently: the person's value stays, dirty, against it, with the conflict. `succeeded` returns whether the draft
  settled clean: close a dialog, collapse an editor or move on only when it did.
- **Always submit through `draft.submit()`**, never `form.handleSubmit()`. Only one save runs at a time, and a second
  Save, Enter or Cmd+S during a save is refused. Map a server field error only if the field still holds the value that
  was sent, and only while `save.isCurrent()`.
- **A save belongs to the form that started it.** Once the form unmounts (or moves to another identity),
  `save.isCurrent()` stays false, even after the same form mounts again. `succeeded` and `failed` then do nothing, and
  `submit()` resolves `'failed'`. In your submit handler, check `save.isCurrent()` after every `await` and before any
  effect on the form or the screen: a toast, a field error, focus, closing, collapsing or navigating. The request
  itself still runs to its end: what it wrote stays written, and its query invalidation still happens. Release a
  lock or flag owned outside the form (a write in flight for the page) in `finally`, whether or not the save is
  current. A one-off action whose form is gone may still report its own outcome (an address added, invitations sent).
- **Every editable value is in the form**, including icons, toggles and per-language drafts. No `useState` beside it,
  and no `useEffect` copying server data.
- **Wrap the screen in `SaveRegionProvider`.** The bar appears only while something is dirty. It saves with Save,
  Enter or Cmd/Ctrl+S, and an invalid save focuses the first highlighted field. It also reports to the route's
  unsaved-changes guard.
- **"Saved" means nothing is left to save or resolve, not just that the request went through.** The submit you pass
  resolves `'saved'` when the server accepted the request, even if `succeeded` returned false. Pass
  `settlement: draft.settlement` too. When the saves end, the bar reads every registered form's live settlement:
  - it announces `common.saved` only when all of them are settled;
  - after an edit made during the save, a kept conflict, "Keep mine", or another form still dirty, it announces
    `forms.unsavedChanges`, keeps the bar and keeps the draft.

  Failed, invalid, deferred (a confirmation that saves later) or stale saves never say "Saved". A stale save is one for
  a form that was replaced, or moved to another identity since. A new edit silently takes back an earlier "Saved".
  Settling forms without a save (Discard, "Use theirs") silently clears "Unsaved changes" and never says "Saved". The
  bar's status is the page's one save announcement: don't add another.

  If you write your own `settlement` instead of passing `draft.settlement` (a form with authored state outside the
  draft, like Theme):
  - **Keep it stable** (`useCallback`). A new function each render re-registers the form with the bar every render.
  - **Read live state** (refs, the form store), not render state, and cover everything that counts as unsaved:
    `settled` is true only with no save in flight and nothing left to save or resolve anywhere in the form.
  - **Return a real `generation`**: the draft's, or one that changes whenever the form starts over for another site,
    language or other identity. Never a constant. The bar uses it to drop results for an identity the form has left.
  - **Keep `isDirty` and `isSubmitting` in step with it.** The bar re-checks its status against every form's
    settlement when a registration changes, so a settlement that changes without either flag changing is not seen.
- **Enter saves the form it was pressed in.** Spread the props `useSaveRegionForm` returns on the `<form>` and render
  `<SaveRegionSubmit />` inside it. HTML submits a form on Enter only if it has a submit button or a single text field;
  this hidden one is never a Tab stop or announced. Plain Enter in an editable single-line field then saves that form
  only, if it is dirty, with the bar's status and focus handling. Enter during IME composition, with a modifier, or on a
  radio or checkbox does not save. Textareas keep their newline. Save and Cmd/Ctrl+S still save every dirty form.
- **Fields:** wrap them in `FormField` with `validators={validateOnBlurThenChange(check)}`. Errors show after the
  field is left or the form is submitted, never while typing in a fresh field, and they clear as the value is fixed.
- **Server refusals that belong to a field** (an address already taken) go on that field through `withServerError`.
  Everything else gets one `friendlyErrorMessage` toast, and the form stays dirty.

## Controls that apply on change

A toggle or select that saves on its own needs no save bar. Its mutation:

- is optimistic only when the outcome is predictable and touches nothing else (`operations/ui-overhaul.md` §8.2);
- rolls back on failure and toasts a plain-language message.

## Choices

Use the design system's `Checkbox` / `CheckboxField` and `RadioGroup` / `RadioField`, never a native
`<input type="checkbox|radio">`:

- `CheckboxField` and `RadioField` render the label and an optional description and wire them up; the whole row is
  the click target. A bare `Checkbox` needs a wrapping `<label>`, `aria-label`, or `id` with `<label htmlFor>`.
- `RadioGroup` takes `label` and `description` for the group (or `aria-labelledby`). It is one tab stop, and arrow
  keys move and choose, following the reading direction in RTL.
- A parent of some ticked items is `indeterminate` (read as "mixed").
- `disabledReason` announces the control as unavailable and reads the reason as its description; the field
  components also show it under the label. A checkbox stays focusable. Arrow keys pass over an unavailable radio, so its
  reason is also part of the group's description.
- The name of a field is its label alone; the description and the reason are read as its description.

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

- **Disabled controls say why.** Use `disabledReason` on `SettingsRow`, `Button`, `TooltipButton`,
  `RowActionsItem`, `Checkbox` and `RadioGroupItem`. The reason comes from the model.
- **A feature that can't be used here** (not configured, not on the plan) renders one `FeatureUnavailable` instead of
  its body. Never a dead form under a notice, and no operator wording on Cloud.
- **Lists:** `DataList` with `RowActions`, whose trigger is named after the row. `EmptyState` when there's nothing to
  show.

## Done means

Before/after screenshots at 1440 and 390 px, light and dark, English and Arabic. Loading, empty, error, read-only and
saving states. Keyboard only. Model unit tests. Filtered typecheck, lint and tests.
