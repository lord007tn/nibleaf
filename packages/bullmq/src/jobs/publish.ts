export type PublishJobName = 'publish-deployment';

export interface PublishDeploymentJobData {
  deploymentId: string;
  projectId: string;
  /** Skip the (non-structural) grammar lint at build time — broken-link checks
   *  still block. Set by the dashboard's "Publish anyway" action. */
  skipGrammarChecks?: boolean;
  /** True for system-triggered publishes (e.g. the starter site published at
   *  sign-up) so activation metrics can exclude them. */
  auto?: boolean;
}
