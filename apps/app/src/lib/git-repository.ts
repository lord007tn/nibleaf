/**
 * The `owner/repo` path of a GitHub repository written as `owner/repo`, a
 * github.com URL, or a clone URL; null for anything else. Used to carry legacy
 * import settings over to the per-site Git connection.
 */
export function githubRepositoryPath(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const match = /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(text);
  return match ? `${match[1]}/${match[2]}` : null;
}
