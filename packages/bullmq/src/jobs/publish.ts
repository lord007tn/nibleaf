export type PublishJobName = 'publish-deployment';

export interface FirstPublishAttribution {
  entry_point: 'organic_content' | 'free_tool';
  intent: 'first_publish';
  source: 'docker_compose_guide' | 'mintlify_introduction' | 'rtl_readiness_grader';
}

export interface PublishDeploymentJobData {
  deploymentId: string;
  projectId: string;
  /** Skip the (non-structural) grammar lint at build time — broken-link checks
   *  still block. Set by the dashboard's "Publish anyway" action. */
  skipGrammarChecks?: boolean;
  /** True for system-triggered publishes (e.g. the starter site published at
   *  sign-up) so activation metrics can exclude them. */
  auto?: boolean;
  /** Consent-gated, identifier-free article attribution. The worker may write
   *  its aggregate READY receipt only after this exact job succeeds. */
  firstPublishAttribution?: FirstPublishAttribution;
  /** Paraglide interface locale resolved when the publish was requested. */
  locale?: string;
}
