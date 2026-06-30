import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { SaveBar, SectionHeader, saveConfigSection, ToggleRow } from './shared';

export function AddonsSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const addons = project.config?.addons ?? {};
  const seo = project.config?.seo ?? {};
  const [feedback, setFeedback] = useState<boolean>(addons.feedback ?? true);
  const [editSuggestions, setEditSuggestions] = useState<boolean>(addons.editSuggestions ?? true);
  const [issueLinks, setIssueLinks] = useState<boolean>(addons.issueLinks ?? true);
  const [ciChecks, setCiChecks] = useState<boolean>(addons.ciChecks ?? true);
  const [brokenLinks, setBrokenLinks] = useState<boolean>(addons.brokenLinks ?? true);
  const [grammarLinter, setGrammarLinter] = useState<boolean>(addons.grammarLinter ?? false);
  const [previewDeployments, setPreviewDeployments] = useState<boolean>(addons.previewDeployments ?? true);
  const [allowIndex, setAllowIndex] = useState<boolean>(seo.allowIndex ?? true);

  const form = useForm({
    defaultValues: {},
    onSubmit: async () => {
      await saveConfigSection(update, {
        addons: {
          feedback,
          editSuggestions,
          issueLinks,
          ciChecks,
          brokenLinks,
          grammarLinter,
          previewDeployments,
        },
        seo: { ...seo, allowIndex },
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
      <ToggleRow
        checked={issueLinks}
        hint={t('settings.addons.issueLinks.hint')}
        onCheckedChange={setIssueLinks}
        title={t('settings.addons.issueLinks.title')}
      />
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
      <ToggleRow
        checked={allowIndex}
        hint={t('settings.addons.allowIndex.hint')}
        onCheckedChange={setAllowIndex}
        title={t('settings.addons.allowIndex.title')}
      />

      <div className="mt-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
      </div>
    </form>
  );
}
