/**
 * The Visibility & access screen's queries and mutations, wrapping
 * `hooks/api/reader-access.ts` (frozen until this feature owns it).
 *
 * Every write below is server-confirmed (operations/ui-overhaul.md §8.2), as
 * before; none is optimistic. Each invalidates the reader-access detail on
 * success, so the screen redraws from the server. None sets
 * `meta.errorMessage`, so the global cache stays quiet and the caller owns the
 * error: a toast, a field error, or the `ActionDialog` that ran it.
 */
import {
  useApproveAccessRequest,
  useCreateReaderAudience,
  useDeclineAccessRequest,
  useDeleteReaderAudience,
  useEmergencyRevokeReaderAccess,
  useInviteReader,
  useInviteReaders,
  usePages,
  useReaderAccess,
  useResendReaderInvitation,
  useRevokeReader,
  useTestReaderJwt,
  useUpdateReaderAccessMode,
  useUpdateReaderAccessRequests,
  useUpdateReaderEmailDomains,
  useUpdateReaderJwt,
} from '@/hooks/api';

/** Who can read the site, its readers, audiences, JWT handoff and access log (Admins only, reads included). */
export const useReaderAccessSettings = (projectId: string) => useReaderAccess(projectId);

/** The site's pages, to pick which ones an audience can read. */
export const useAudiencePages = (projectId: string) => usePages(projectId);

/** Changes who can read the site. Server-confirmed: run from an `ActionDialog` after the person confirms. */
export const useSetAccessMode = (projectId: string) => useUpdateReaderAccessMode(projectId);

/** Invites one reader; the response carries the activation link to share. Server-confirmed. */
export const useInviteOneReader = (projectId: string) => useInviteReader(projectId);

/** Invites several readers in one request. Server-confirmed. */
export const useInviteManyReaders = (projectId: string) => useInviteReaders(projectId);

/** Sends a reader's invitation again. Server-confirmed. */
export const useResendInvitation = (projectId: string) => useResendReaderInvitation(projectId);

/** Removes a reader's access and ends their sessions. Server-confirmed, from an `ActionDialog`. */
export const useRevokeReaderAccess = (projectId: string) => useRevokeReader(projectId);

/** Saves the allowed email domains (a form save). The response is the stored, normalized list. */
export const useSaveEmailDomains = (projectId: string) => useUpdateReaderEmailDomains(projectId);

/** Turns access requests on or off. Server-confirmed: the switch waits for the answer. */
export const useSetAccessRequests = (projectId: string) => useUpdateReaderAccessRequests(projectId);

/** Approves an access request, which sends an invitation. Server-confirmed. */
export const useApproveRequest = (projectId: string) => useApproveAccessRequest(projectId);

/** Declines an access request quietly. Server-confirmed. */
export const useDeclineRequest = (projectId: string) => useDeclineAccessRequest(projectId);

/** Creates an audience (the server creates its id). Server-confirmed. */
export const useCreateAudience = (projectId: string) => useCreateReaderAudience(projectId);

/** Deletes an audience and its reader assignments. Server-confirmed, from an `ActionDialog`. */
export const useDeleteAudience = (projectId: string) => useDeleteReaderAudience(projectId);

/** Saves the JWT handoff configuration (a form save). */
export const useSaveJwtConfig = (projectId: string) => useUpdateReaderJwt(projectId);

/** Checks a test JWT against the saved configuration; nothing is stored. */
export const useTestJwt = (projectId: string) => useTestReaderJwt(projectId);

/** Ends every reader session and turns JWT handoff off. Server-confirmed, from an `ActionDialog`. */
export const useEmergencyRevoke = (projectId: string) => useEmergencyRevokeReaderAccess(projectId);
