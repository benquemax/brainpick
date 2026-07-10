/** Per-forge deep links for pasting a deploy key (Chunk E MVP scope) —
 * presentation convenience only; unresolved hosts just show the raw key. */
export interface ParsedRepo {
  host: string;
  owner: string;
  name: string;
}

export function parseGitRepo(repo: string): ParsedRepo | null {
  // scp-like: git@host:owner/repo.git
  const scpMatch = /^[^@\s]+@([^:\s]+):([^/\s]+)\/(.+?)(\.git)?$/.exec(repo);
  if (scpMatch) return { host: scpMatch[1]!, owner: scpMatch[2]!, name: scpMatch[3]! };

  try {
    const url = new URL(repo);
    const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { host: url.hostname, owner: parts[0], name: parts[1] };
    }
  } catch {
    /* not a URL — scp-like above already had its shot */
  }
  return null;
}

export interface ForgeLink {
  label: string;
  url: string;
}

export function forgeDeepLink(repo: string): ForgeLink | null {
  const parsed = parseGitRepo(repo);
  if (parsed === null) return null;
  const { host, owner, name } = parsed;
  if (host === "github.com") {
    return { label: "GitHub", url: `https://github.com/${owner}/${name}/settings/keys/new` };
  }
  if (host === "gitlab.com" || host.startsWith("gitlab.")) {
    return { label: "GitLab", url: `https://${host}/${owner}/${name}/-/settings/repository` };
  }
  // Gitea/self-hosted instances vary too much in URL shape to guess reliably.
  return null;
}
