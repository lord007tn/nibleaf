import { useT } from '@nibleaf/i18n/react';
import { CALLOUT_TYPES } from '@nibleaf/shared/callouts';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { ChevronUp } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { calloutVariantAttributes } from '../extensions/callout';
import { ColorField, ExpressionField, IconField, ListField, NumberField, SelectField, SwitchField, TextField, UrlField } from './fields';
import { componentNameKey, componentTargetsAt, optionLabel, type SettingsField, type SettingsTarget, settingsSchemaFor, targetNode } from './schema';
import { finishPreview, writeComponentAttributes } from './write';

const isExpression = (value: unknown): value is string => typeof value === 'string' && /^\{[\s\S]*\}$/.test(value.trim());
const textOf = (value: unknown): string => (typeof value === 'string' ? value : value == null || value === false ? '' : String(value));

/** One attribute's live value and its writers (see FieldProps). */
function useAttribute(editor: Editor, target: SettingsTarget, name: string) {
  const value = useEditorState({ editor, selector: ({ editor: current }) => targetNode(current.state, target)?.attrs[name] as unknown });
  // The value before the current run of previews; undefined when no run is open.
  const runStart = useRef<{ value: unknown } | undefined>(undefined);
  const targetRef = useRef(target);
  targetRef.current = target;
  const finish = () => {
    const start = runStart.current;
    runStart.current = undefined;
    if (start) finishPreview(editor, targetRef.current, name, start.value);
  };
  // A field removed mid-edit (the panel closed with Escape) still folds its run into one step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on unmount.
  useEffect(() => () => finish(), []);
  return {
    value,
    onChange: (next: unknown) => {
      finish();
      writeComponentAttributes(editor, targetRef.current, { [name]: next });
    },
    onPreview: (next: unknown) => {
      if (!runStart.current) runStart.current = { value: targetNode(editor.state, targetRef.current)?.attrs[name] };
      writeComponentAttributes(editor, targetRef.current, { [name]: next }, 'preview');
    },
    onFinish: finish,
  };
}

function AttributeField({ editor, target, field }: { editor: Editor; target: SettingsTarget; field: Extract<SettingsField, { kind: 'attribute' }> }) {
  const t = useT();
  const id = useId();
  const { attribute } = field;
  const state = useAttribute(editor, target, attribute.name);
  const label = t(field.copy.label);
  const hint = field.copy.hint ? t(field.copy.hint) : undefined;
  const common = { id, label, hint, onFinish: state.onFinish };
  if (isExpression(state.value)) return <ExpressionField id={id} label={label} value={state.value} onChange={state.onChange} />;
  switch (attribute.type) {
    case 'boolean': {
      const fallback = attribute.default === true;
      const checked = state.value === true || state.value === 'true' || (state.value === '' && fallback);
      return <SwitchField {...common} value={checked} onChange={state.onChange} onPreview={state.onChange} />;
    }
    case 'number':
      return (
        <NumberField
          {...common}
          value={textOf(state.value)}
          onChange={state.onChange}
          onPreview={state.onPreview}
          min={attribute.min}
          max={attribute.max}
          offset={field.oneBased ? 1 : 0}
          placeholder={attribute.default === undefined ? undefined : String(Number(attribute.default) + (field.oneBased ? 1 : 0))}
        />
      );
    case 'enum': {
      const options = (attribute.values ?? []).map((value) => {
        const key = optionLabel(target.tag, attribute.name, value);
        return { value, label: key ? t(key) : value };
      });
      return (
        <SelectField
          {...common}
          value={textOf(state.value)}
          onChange={state.onChange}
          onPreview={state.onChange}
          options={options}
          defaultValue={attribute.default === undefined ? undefined : String(attribute.default)}
        />
      );
    }
    case 'url':
      return (
        <UrlField
          {...common}
          editor={editor}
          pagePicker={attribute.name === 'href'}
          value={textOf(state.value)}
          onChange={state.onChange}
          onPreview={state.onPreview}
        />
      );
    case 'icon':
      return <IconField {...common} value={textOf(state.value)} onChange={state.onChange} onPreview={state.onPreview} />;
    case 'color':
      return <ColorField {...common} named={attribute.values} value={textOf(state.value)} onChange={state.onChange} onPreview={state.onPreview} />;
    case 'list':
      return (
        <ListField
          {...common}
          value={Array.isArray(state.value) ? (state.value as string[]) : []}
          onChange={state.onChange}
          onPreview={state.onChange}
        />
      );
    default:
      return (
        <TextField
          {...common}
          dir={attribute.name === 'id' || attribute.name === 'type' || attribute.name === 'status' ? 'ltr' : 'auto'}
          value={textOf(state.value)}
          onChange={state.onChange}
          onPreview={state.onPreview}
        />
      );
  }
}

function CalloutTypeField({ editor, target }: { editor: Editor; target: SettingsTarget }) {
  const t = useT();
  const id = useId();
  const variant = useEditorState({ editor, selector: ({ editor: current }) => String(targetNode(current.state, target)?.attrs.variant ?? 'note') });
  const options = CALLOUT_TYPES.map((value) => {
    const key = optionLabel('Callout', 'type', value);
    return { value, label: key ? t(key) : value };
  });
  const change = (next: string) => {
    const node = targetNode(editor.state, target);
    if (!node || !next) return;
    writeComponentAttributes(editor, target, calloutVariantAttributes(node.attrs, next as Parameters<typeof calloutVariantAttributes>[1]));
  };
  return (
    <SelectField
      id={id}
      label={t('editor.componentSettings.attr.type.label')}
      hint={t('editor.componentSettings.attr.type.hint')}
      value={variant}
      defaultValue="note"
      options={options}
      onChange={change}
      onPreview={change}
      onFinish={() => undefined}
    />
  );
}

const PARAM_LOCATIONS = ['query', 'path', 'body', 'header', 'name'] as const;
type ParamLocation = (typeof PARAM_LOCATIONS)[number];

/** ParamField authors one of five location props (`query="limit"`); this edits it as "Sent in" + a name. */
function ParamLocationField({ editor, target }: { editor: Editor; target: SettingsTarget }) {
  const t = useT();
  const locationId = useId();
  const location = useEditorState({
    editor,
    selector: ({ editor: current }): ParamLocation => {
      const attrs = targetNode(current.state, target)?.attrs ?? {};
      return PARAM_LOCATIONS.find((name) => textOf(attrs[name]) !== '') ?? 'query';
    },
  });
  const name = useAttribute(editor, target, location);
  const nameId = useId();
  const options = PARAM_LOCATIONS.map((value) => ({ value, label: t(`editor.componentSettings.param.location.${value}`) }));
  return (
    <>
      <SelectField
        id={locationId}
        label={t('editor.componentSettings.param.location.label')}
        hint={t('editor.componentSettings.param.location.hint')}
        value={location}
        defaultValue="query"
        options={options}
        onFinish={() => undefined}
        onPreview={() => undefined}
        onChange={(next) => {
          if (!next || next === location) return;
          const value = textOf(targetNode(editor.state, target)?.attrs[location]);
          writeComponentAttributes(editor, target, { ...Object.fromEntries(PARAM_LOCATIONS.map((key) => [key, ''])), [next]: value });
        }}
      />
      {isExpression(name.value) ? (
        <ExpressionField id={nameId} label={t('editor.componentSettings.param.name.label')} value={name.value} onChange={name.onChange} />
      ) : (
        <TextField
          id={nameId}
          dir="ltr"
          label={t('editor.componentSettings.param.name.label')}
          hint={t('editor.componentSettings.param.name.hint')}
          value={textOf(name.value)}
          onChange={name.onChange}
          onPreview={name.onPreview}
          onFinish={name.onFinish}
        />
      )}
    </>
  );
}

/**
 * The settings form of one component: every registry attribute as a labelled
 * field. Changes apply to the document immediately (and undo field by field).
 */
export default function ComponentSettingsPanel({
  editor,
  target,
  titleId,
  onNavigate,
}: {
  editor: Editor;
  target: SettingsTarget;
  titleId: string;
  /** Switch the panel to another component (the parent of this one). */
  onNavigate: (target: SettingsTarget) => void;
}) {
  const t = useT();
  const descriptionId = useId();
  const schema = settingsSchemaFor(target.nodeName);
  const nameKey = componentNameKey(target.tag);
  const component = nameKey ? t(nameKey) : target.tag;
  const parent = componentTargetsAt(editor.state, target.pos).find((candidate) => candidate.pos !== target.pos);
  const parentNameKey = parent ? componentNameKey(parent.tag) : undefined;
  return (
    <form
      className="grid gap-4"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onSubmit={(event) => event.preventDefault()}
      data-component-settings={target.tag}
    >
      <div className="grid gap-1 pe-8">
        <h2 id={titleId} className="m-0 font-semibold text-base leading-tight">
          {t('editor.componentSettings.buttonLabel', { component })}
        </h2>
        <p id={descriptionId} className="m-0 text-muted-foreground text-xs">
          {t('editor.componentSettings.description')}
        </p>
        {parent ? (
          <button
            type="button"
            className="mt-1 inline-flex w-fit items-center gap-1 rounded text-primary text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => onNavigate(parent)}
          >
            <ChevronUp className="size-3.5" aria-hidden />
            {t('editor.componentSettings.parent', { component: parentNameKey ? t(parentNameKey) : parent.tag })}
          </button>
        ) : null}
      </div>
      {schema && schema.fields.length > 0 ? (
        schema.fields.map((field) => {
          if (field.kind === 'calloutType') return <CalloutTypeField key="callout-type" editor={editor} target={target} />;
          if (field.kind === 'paramLocation') return <ParamLocationField key="param-location" editor={editor} target={target} />;
          return <AttributeField key={field.attribute.name} editor={editor} target={target} field={field} />;
        })
      ) : (
        <p className="m-0 text-muted-foreground text-sm">{t('editor.componentSettings.empty')}</p>
      )}
    </form>
  );
}
