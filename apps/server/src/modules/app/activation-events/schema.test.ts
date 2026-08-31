import { describe, expect, it } from 'vitest';
import { firstPublishActivationBody } from './schema';

describe('authenticated activation-event privacy boundary', () => {
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
    ).toBe(true);
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
