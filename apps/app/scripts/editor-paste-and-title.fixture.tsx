// Isolated component journey: actual editor/title, fictional clipboard content.
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { useT } from '@nibleaf/i18n/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { focusBodyStart, PageTitleField } from '../src/components/editor/page-title-field';
import { TiptapEditor } from '../src/components/editor/tiptap-editor';

const locale = new URLSearchParams(location.search).get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
function Journey() {
  const t = useT();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  return (
    <main className="h-dvh bg-background text-foreground">
      <header className="border-border border-b px-5 py-3 font-semibold">Nibleaf · AUTH-36</header>
      <div ref={canvasRef} className="mx-auto h-[calc(100dvh-49px)] max-w-5xl">
        <TiptapEditor
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          lang={locale}
          variant="wysiwyg"
          value={content}
          onChange={setContent}
          titleSlot={
            <PageTitleField
              value={title}
              onChange={setTitle}
              onEnter={() => focusBodyStart(canvasRef.current)}
              textareaRef={titleRef}
              label={t('editor.pageTitlePlaceholder')}
              placeholder={t('editor.untitled')}
              lang={locale}
            />
          }
        />
      </div>
    </main>
  );
}
const element = document.getElementById('root');
if (!element) throw new Error('Missing fixture root');
createRoot(element).render(
  <QueryClientProvider client={new QueryClient()}>
    <Journey />
  </QueryClientProvider>,
);
