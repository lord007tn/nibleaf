import { Input } from '@midad/design-system/components/ui/input';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { FIELD_MONO, Field, SaveBar, SectionHeader, saveConfigSection, ToggleRow } from './shared';

export function AddonsSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const addons = project.config?.addons ?? {};
  const [feedback, setFeedback] = useState<boolean>(addons.feedback ?? true);
  const [editSuggestions, setEditSuggestions] = useState<boolean>(addons.editSuggestions ?? true);
  const [issueLinks, setIssueLinks] = useState<boolean>(addons.issueLinks ?? true);
  const [ciChecks, setCiChecks] = useState<boolean>(addons.ciChecks ?? true);
  const [brokenLinks, setBrokenLinks] = useState<boolean>(addons.brokenLinks ?? true);
  const [grammarLinter, setGrammarLinter] = useState<boolean>(addons.grammarLinter ?? false);
  const [previewDeployments, setPreviewDeployments] = useState<boolean>(addons.previewDeployments ?? true);

  const form = useForm({
    defaultValues: {
      editUrl: addons.editUrl ?? '',
      issueUrl: addons.issueUrl ?? '',
    },
    onSubmit: async ({ value }) => {
      await saveConfigSection(update, {
        addons: {
          feedback,
          editSuggestions,
          issueLinks,
          ciChecks,
          brokenLinks,
          grammarLinter,
          previewDeployments,
          editUrl: value.editUrl.trim() || undefined,
          issueUrl: value.issueUrl.trim() || undefined,
        },
      });
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <SectionHeader description={t('settings.addons.description')} icon="◩" title={t('settings.addons.title')} />

      <ToggleRow
        checked={feedback}
        hint={t('settings.addons.feedback.hint')}
        onCheckedChange={setFeedback}
        title={t('settings.addons.feedback.title')}
      />
      <ToggleRow
        checked={editSuggestions}
        hint={t('settings.addons.editSuggestions.hint')}
        onCheckedChange={setEditSuggestions}
        title={t('settings.addons.editSuggestions.title')}
      />
      {editSuggestions ? (
        <form.Field name="editUrl">
          {(field) => (
            <Field className="mt-4" hint={t('settings.addons.editUrl.hint')} label={t('settings.addons.editUrl.label')}>
              <Input
                className={FIELD_MONO}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="https://github.com/acme/docs/edit/main/{path}.mdx"
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
      ) : null}
      <ToggleRow
        checked={issueLinks}
        hint={t('settings.addons.issueLinks.hint')}
        onCheckedChange={setIssueLinks}
        title={t('settings.addons.issueLinks.title')}
      />
      {issueLinks ? (
        <form.Field name="issueUrl">
          {(field) => (
            <Field className="mt-4" hint={t('settings.addons.issueUrl.hint')} label={t('settings.addons.issueUrl.label')}>
              <Input
                className={FIELD_MONO}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="https://github.com/acme/docs/issues/new?title=Docs%20feedback&body={url}"
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
      ) : null}
      <ToggleRow
        checked={ciChecks}
        hint={t('settings.addons.ciChecks.hint')}
        onCheckedChange={setCiChecks}
        title={t('settings.addons.ciChecks.title')}
      />
      <ToggleRow
        checked={brokenLinks}
        hint={t('settings.addons.brokenLinks.hint')}
        onCheckedChange={setBrokenLinks}
        title={t('settings.addons.brokenLinks.title')}
      />
      <ToggleRow
        checked={grammarLinter}
        hint={t('settings.addons.grammarLinter.hint')}
        onCheckedChange={setGrammarLinter}
        title={t('settings.addons.grammarLinter.title')}
      />
      <ToggleRow
        checked={previewDeployments}
        hint={t('settings.addons.previewDeployments.hint')}
        onCheckedChange={setPreviewDeployments}
        title={t('settings.addons.previewDeployments.title')}
      />

      <div className="mt-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
      </div>
    </form>
  );
}
