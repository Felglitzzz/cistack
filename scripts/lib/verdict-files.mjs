// The reviewer's verdict files, in the system temp folder.
//
// Claude Code's auto mode gives no verdict on a Write inside the reviewer's isolated
// worktree, and refuses a heredoc from it, so the file goes in the temp folder, which
// auto mode allows (docs/limitations.md). The name carries the pull request and the round:
// <temp>/cistack-review/<owner>-<repo>-pr<n>-r<round>.json

import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const folder = () => join(tmpdir(), "cistack-review");
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `<owner>-<repo>` for a pull request's URL (https://github.com/<owner>/<repo>/pull/<n>).
export const repoSlug = (url) => {
  const [, owner, repo] = new URL(url).pathname.split("/");
  return `${owner}-${repo}`;
};

// Where the reviewer writes its verdict for this pull request and round. Makes the folder.
export function verdictPath(pr, round) {
  mkdirSync(folder(), { recursive: true });
  return join(folder(), `${repoSlug(pr.url)}-pr${pr.number}-r${round}.json`);
}

// The verdict files in the folder for one repo, with the pull request each belongs to.
function filesOf(slug) {
  const pattern = new RegExp(`^${escape(slug)}-pr(\\d+)-r\\d+\\.json$`);
  let names = [];
  try {
    names = readdirSync(folder()).sort();
  } catch {
    // No folder yet, so no files.
  }
  return names.flatMap((name) => {
    const match = name.match(pattern);
    return match ? [{ path: join(folder(), name), pr: Number(match[1]) }] : [];
  });
}

function remove(files) {
  for (const { path } of files) unlinkSync(path);
  return files.map(({ path }) => path);
}

// Deletes every verdict file left for this pull request, from any round.
export const removeVerdictFiles = (pr) => remove(filesOf(repoSlug(pr.url)).filter((f) => f.pr === pr.number));

// Deletes the verdict files of this repo's pull requests that aren't in `open`.
export const removeVerdictFilesExcept = (slug, open) => remove(filesOf(slug).filter((f) => !open.includes(f.pr)));
