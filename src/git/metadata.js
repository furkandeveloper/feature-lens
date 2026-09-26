// Collects repository and attribution metadata from git. Every value records
// where it came from; nothing is guessed. In particular, git's user.name is a
// free-form display name and is never reported as a GitHub login.

import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Run a git command in `cwd`. Returns trimmed stdout, or null on any failure
 * (git missing, not a repository, no commits yet, unset config key, ...).
 * Uses execFile (no shell) so arguments are never interpreted by a shell.
 */
export function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * @param {string} cwd any directory inside the repository
 * @returns {{ isGitRepo: boolean, root: string, name: string, remoteUrl?: string, branch?: string, commit?: string, dirty?: boolean }}
 */
export function getRepositoryInfo(cwd) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  if (root === null) return { isGitRepo: false, root: path.resolve(cwd), name: path.basename(path.resolve(cwd)) };

  const info = { isGitRepo: true, root, name: path.basename(root) };

  const remote = git(root, ['remote', 'get-url', 'origin']);
  if (remote) info.remoteUrl = redactCredentials(remote);

  const branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (branch) info.branch = branch;

  const commit = git(root, ['rev-parse', 'HEAD']);
  if (commit) info.commit = commit;

  // Untracked files count: an analysis may cite a file that is not in `commit`.
  const status = git(root, ['status', '--porcelain', '--untracked-files=normal']);
  if (status !== null) info.dirty = status.length > 0;

  return info;
}

/**
 * The person running FeatureLens, from local git config.
 * @param {string} cwd
 * @param {{ includeEmail?: boolean }} [options]
 */
export function getCurrentUser(cwd, { includeEmail = false } = {}) {
  const name = git(cwd, ['config', 'user.name']);
  if (!name) return { source: 'unknown' };
  const person = { name, source: 'git-config' };
  if (includeEmail) {
    const email = git(cwd, ['config', 'user.email']);
    if (email) person.email = email;
  }
  return person;
}

/**
 * Authors of commits touching `files`, most commits first.
 * @param {string} cwd
 * @param {string[]} files repository-relative paths
 * @param {{ includeEmail?: boolean, limit?: number }} [options]
 */
export function getContributors(cwd, files, { includeEmail = false, limit = 20 } = {}) {
  if (files.length === 0) return [];
  // %x1f (unit separator) cannot appear in names or emails, unlike "|" or ",".
  const out = git(cwd, ['log', '--no-merges', '--format=%aN%x1f%aE', '--', ...files]);
  if (!out) return [];

  // Group by email (mailmap-aware via %aN/%aE) so one person with a changed display name counts once.
  const byEmail = new Map();
  for (const line of out.split('\n')) {
    const [name, email] = line.split('\x1f');
    const key = email.toLowerCase();
    const entry = byEmail.get(key) ?? { name, email, commits: 0 };
    entry.commits += 1;
    byEmail.set(key, entry);
  }

  return [...byEmail.values()]
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ name, email, commits }) => ({
      name,
      ...(includeEmail ? { email } : {}),
      commits,
      source: 'git-log',
    }));
}

/** Strip `user:token@` from https remotes so secrets never land in generated docs. */
export function redactCredentials(url) {
  return url.replace(/^(https?:\/\/)[^/@]+@/i, '$1');
}
