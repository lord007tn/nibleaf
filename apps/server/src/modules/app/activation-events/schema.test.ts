import { describe, expect, it } from 'vitest';
import { firstPublishActivationBody } from './schema';

describe('authenticated activation-event privacy boundary', () => {
  it('accepts the finite grader source only as a free tool and rejects mislabeled or identifying fields', () => {
    const properties = { entry_point: 'free_tool', intent: 'first_publish', source: 'rtl_readiness_grader' };
    expect(firstPublishActivationBody.safeParse({ stage: 'project_entered', properties }).success).toBe(true);
    expect(
      firstPublishActivationBody.safeParse({ stage: 'editor_entered', properties: { ...properties, entry_point: 'organic_content' } }).success,
    ).toBe(false);
    expect(firstPublishActivationBody.safeParse({ stage: 'editor_entered', properties: { ...properties, submitted_html: 'private' } }).success).toBe(
      false,
    );
  });
  it('accepts an allowlisted stage without a client-supplied identity or tenant', () => {
    expect(
      firstPublishActivationBody.safeParse({
        stage: 'editor_entered',
        properties: { entry_point: 'organic_content', intent: 'first_publish', source: 'mintlify_introduction' },
      }).success,
    ).toBe(true);
    expect(
      firstPublishActivationBody.safeParse({
        stage: 'publish_ready',
        properties: { entry_point: 'organic_content', intent: 'first_publish', source: 'docker_compose_guide' },
      }).success,
    ).toBe(false);
  });

  it.each(['userId', 'projectId', 'email', 'content'])('rejects the extra %s field', (field) => {
    expect(
      firstPublishActivationBody.safeParse({
        stage: 'project_entered',
        properties: { entry_point: 'organic_content', intent: 'first_publish', source: 'docker_compose_guide' },
        [field]: 'private',
      }).success,
    ).toBe(false);
  });
});
