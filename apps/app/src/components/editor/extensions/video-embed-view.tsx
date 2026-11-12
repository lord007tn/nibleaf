import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { readerEmbedSource } from '@nibleaf/shared/reader-embeds';
import { videoEmbedSrc, videoPageUrl } from '@nibleaf/shared/video-embeds';
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { ExternalLink, Settings2, Trash2 } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { EmbedLink, ReaderVideo, VideoEmbed, VideoPosterPreview } from '@/components/site/mdx/video-embed';
import { slashPageLocale } from './slash-command';
import type { VideoEmbedAttributes } from './video-embed';
import { type EmbedIntent, embedTargetFor, formatStartTime, parseStartTime, providerVideoOf, takesStartTime } from './video-embed-url';

/**
 * The Video and Embed block in the editor: the reader's own preview (the
 * click-to-load poster, the link card or the video element; nothing is loaded
 * from the provider here either), and its settings: the address, a title (the
 * player's accessible name, required), a start time for YouTube and Vimeo, and a
 * caption, which writes `<Frame caption>`.
 */
export function VideoEmbedView({ node, updateAttributes, editor, getPos, deleteNode, selected }: NodeViewProps) {
  const t = useT();
  const attributes = node.attrs as VideoEmbedAttributes;
  const { kind, src, title, caption } = attributes;
  const video = kind === 'iframe' ? providerVideoOf(src) : null;
  const intent: EmbedIntent = attributes.intent || (kind === 'video' || video || !src ? 'video' : 'embed');
  const editable = editor.isEditable;
  const [open, setOpen] = useState(() => editable && !src);
  const panelId = useId();
  const urlRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);

  // A block just inserted from the slash menu, a paste or a link asks for one of its fields.
  useEffect(() => {
    const field = attributes.focus;
    if (!field || !editable) return;
    setOpen(true);
    // The insert's own `focus()` returns focus to the page in the next frame; take it after that.
    // Clearing the request below re-runs this effect, so the frame isn't cancelled; unmounted, the refs are empty.
    requestAnimationFrame(() => requestAnimationFrame(() => (field === 'title' && titleRef.current ? titleRef : urlRef).current?.focus()));
    const position = getPos();
    if (typeof position === 'number') editor.view.dispatch(editor.state.tr.setNodeAttribute(position, 'focus', '').setMeta('addToHistory', false));
  }, [attributes.focus, editable, editor, getPos]);

  const position = getPos();
  const framedByParent = typeof position === 'number' && editor.state.doc.resolve(position).parent.type.name === 'mdxFrame';
  const source = video ? null : readerEmbedSource(src);
  const name = title.trim() || (source?.kind === 'link' ? source.url.host : '') || t('editor.video.untitled');
  const label = t(intent === 'video' ? 'editor.video.blockLabel' : 'editor.video.embedBlockLabel', { name });
  const previewHref = previewAddress(kind, src);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => settingsRef.current?.focus());
  };

  return (
    <NodeViewWrapper
      className={cn('pl-video-embed my-4 flex flex-col gap-2 rounded-xl', selected && 'outline-2 outline-ring outline-offset-4')}
      data-video-embed=""
      role="group"
      aria-label={label}
    >
      <Preview kind={kind} src={src} title={title} intent={intent} language={slashPageLocale(editor)} />
      {caption ? (
        <p className="text-center text-muted-foreground text-sm" dir="auto">
          {caption}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        {editable ? (
          <Button
            ref={settingsRef}
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={() => setOpen((value) => !value)}
          >
            <Settings2 aria-hidden className="size-4" />
            {t(intent === 'video' ? 'editor.video.settings' : 'editor.video.embedSettings')}
          </Button>
        ) : null}
        {previewHref ? (
          <Button variant="ghost" size="sm" render={<a href={previewHref} target="_blank" rel="noopener noreferrer" />} nativeButton={false}>
            <ExternalLink aria-hidden className="size-4" />
            {t('editor.video.preview')}
            <span className="sr-only"> {t('editor.video.opensInNewTab')}</span>
          </Button>
        ) : null}
        {editable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ms-auto text-destructive"
            onClick={() => {
              deleteNode();
              editor.commands.focus();
            }}
          >
            <Trash2 aria-hidden className="size-4" />
            {t('editor.video.remove')}
          </Button>
        ) : null}
      </div>
      {open && editable ? (
        <Settings
          id={panelId}
          attributes={attributes}
          intent={intent}
          showCaption={!framedByParent}
          urlRef={urlRef}
          titleRef={titleRef}
          update={updateAttributes}
          onDone={close}
        />
      ) : null}
    </NodeViewWrapper>
  );
}

/** Where Preview opens the video or page: the provider's own page, the file, or the embedded page. https only. */
const previewAddress = (kind: string, src: string): string | null => {
  if (kind === 'video') return embedTargetFor(src, 'video')?.kind === 'video' ? src : null;
  const source = readerEmbedSource(src);
  if (source?.kind === 'video') return videoPageUrl(source.video);
  return source?.kind === 'link' ? source.url.href : null;
};

function Preview({ kind, src, title, intent, language }: { kind: string; src: string; title: string; intent: EmbedIntent; language: string }) {
  const t = useT();
  if (!src.trim())
    return (
      <div className="grid aspect-video w-full place-items-center rounded-xl border border-border border-dashed bg-muted/40 p-4 text-center text-muted-foreground text-sm">
        {t(intent === 'video' ? 'editor.video.empty' : 'editor.video.emptyEmbed')}
      </div>
    );
  if (kind === 'video') return <ReaderVideo src={src} />;
  const source = readerEmbedSource(src);
  if (source?.kind === 'video') return <VideoPosterPreview embed={source.video} title={title.trim() || undefined} language={language} />;
  return (
    <div className="flex flex-col gap-1.5">
      {source?.kind === 'link' ? (
        <EmbedLink url={source.url} title={title.trim() || undefined} newTab />
      ) : (
        <VideoEmbed text={src} title={title.trim() || undefined} language={language} />
      )}
      <p className="text-muted-foreground text-xs">{t(source?.kind === 'link' ? 'editor.video.shownAsLink' : 'editor.video.shownAsText')}</p>
    </div>
  );
}

/** Keys typed in a field are the field's; ProseMirror never sees them. Enter commits, Escape closes. */
const fieldKeys = (commit: () => boolean, onDone: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
  event.stopPropagation();
  if (event.nativeEvent.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    commit();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    if (commit()) onDone();
  }
};

function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium text-sm">
        {label}
        {required ? <span className="ms-1 font-normal text-muted-foreground text-xs">({required})</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-message`} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-message`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Settings({
  id,
  attributes,
  intent,
  showCaption,
  urlRef,
  titleRef,
  update,
  onDone,
}: {
  id: string;
  attributes: VideoEmbedAttributes;
  intent: EmbedIntent;
  showCaption: boolean;
  urlRef: React.RefObject<HTMLInputElement | null>;
  titleRef: React.RefObject<HTMLInputElement | null>;
  update: (attributes: Partial<VideoEmbedAttributes>) => void;
  onDone: () => void;
}) {
  const t = useT();
  const fieldId = useId();
  const { kind, src, title, caption } = attributes;
  const video = kind === 'iframe' ? providerVideoOf(src) : null;
  const [url, setUrl] = useState(src);
  const [urlError, setUrlError] = useState(false);
  const [start, setStart] = useState(() => formatStartTime(video?.start));
  const [startError, setStartError] = useState(false);
  // The block changed from elsewhere (undo, another field): show what it holds now.
  useEffect(() => {
    setUrl(src);
    setUrlError(false);
  }, [src]);
  useEffect(() => {
    setStart(formatStartTime(video?.start));
    setStartError(false);
  }, [video?.start]);

  const commitUrl = (): boolean => {
    const value = url.trim();
    if (value === src) {
      setUrlError(false);
      return true;
    }
    const target = embedTargetFor(value, intent);
    if (!target) {
      setUrlError(true);
      return false;
    }
    setUrlError(false);
    update({ kind: target.kind, src: target.src, title: target.kind === 'iframe' ? title : '' });
    return true;
  };
  const commitStart = (): boolean => {
    if (!takesStartTime(video)) return true;
    const seconds = parseStartTime(start);
    if (seconds === null) {
      setStartError(true);
      return false;
    }
    setStartError(false);
    if (seconds !== video.start) update({ src: videoEmbedSrc({ provider: video.provider, id: video.id, start: seconds }) });
    return true;
  };
  const stop = { onKeyDown: (event: KeyboardEvent) => event.stopPropagation() };
  const titleMissing = kind === 'iframe' && !title.trim();

  return (
    <section
      id={id}
      aria-label={t(intent === 'video' ? 'editor.video.settings' : 'editor.video.embedSettings')}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
    >
      <Field
        id={`${fieldId}-url`}
        label={t(intent === 'video' ? 'editor.video.url' : 'editor.video.embedUrl')}
        error={urlError ? t(intent === 'video' ? 'editor.video.invalidUrl' : 'editor.video.invalidEmbedUrl') : null}
      >
        <Input
          ref={urlRef}
          id={`${fieldId}-url`}
          type="url"
          inputMode="url"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://"
          value={url}
          aria-invalid={urlError || undefined}
          aria-describedby={urlError ? `${fieldId}-url-message` : undefined}
          onChange={(event) => {
            setUrl(event.target.value);
            setUrlError(false);
          }}
          onBlur={commitUrl}
          onKeyDown={fieldKeys(commitUrl, onDone)}
        />
      </Field>
      {kind === 'iframe' ? (
        <Field
          id={`${fieldId}-title`}
          label={t('editor.video.title')}
          required={t('editor.video.required')}
          hint={
            <span className={titleMissing ? 'text-warning' : undefined}>
              {t(titleMissing ? 'editor.video.titleMissing' : 'editor.video.titleHint')}
            </span>
          }
        >
          <Input
            ref={titleRef}
            id={`${fieldId}-title`}
            aria-required="true"
            aria-describedby={`${fieldId}-title-message`}
            value={title}
            onChange={(event) => update({ title: event.target.value })}
            onKeyDown={fieldKeys(() => true, onDone)}
          />
        </Field>
      ) : null}
      {takesStartTime(video) ? (
        <Field
          id={`${fieldId}-start`}
          label={t('editor.video.start')}
          error={startError ? t('editor.video.invalidStart') : null}
          hint={t('editor.video.startHint')}
        >
          <Input
            id={`${fieldId}-start`}
            dir="ltr"
            inputMode="numeric"
            autoComplete="off"
            placeholder="0:00"
            className="w-32"
            value={start}
            aria-invalid={startError || undefined}
            aria-describedby={`${fieldId}-start-message`}
            onChange={(event) => {
              setStart(event.target.value);
              setStartError(false);
            }}
            onBlur={commitStart}
            onKeyDown={fieldKeys(commitStart, onDone)}
          />
        </Field>
      ) : null}
      {showCaption ? (
        <Field id={`${fieldId}-caption`} label={t('editor.video.caption')}>
          <Input
            id={`${fieldId}-caption`}
            value={caption}
            onChange={(event) => update({ caption: event.target.value })}
            onKeyDown={fieldKeys(() => true, onDone)}
          />
        </Field>
      ) : null}
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => commitUrl() && commitStart() && onDone()} {...stop}>
          {t('editor.video.done')}
        </Button>
      </div>
    </section>
  );
}
