/** Never transfer an organization implicitly during personal account deletion.
 * Validate ALL ownerships before removing even an empty organization. */
export declare const reassignOrDeleteOrgs: (userId: string) => Promise<void>;
//# sourceMappingURL=account-deletion.d.ts.map