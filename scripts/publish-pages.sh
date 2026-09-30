#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

readonly EXPECTED_REMOTE_HTTPS='https://github.com/OfferPk/arrowpath.git'
readonly EXPECTED_REMOTE_HTTPS_NO_SUFFIX='https://github.com/OfferPk/arrowpath'
readonly EXPECTED_REMOTE_SSH='git@github.com:OfferPk/arrowpath.git'
readonly EXPECTED_REMOTE_SSH_URL='ssh://git@github.com/OfferPk/arrowpath.git'
readonly PAGES_API_URL='https://api.github.com/repos/OfferPk/arrowpath/pages'
readonly SITE_URL='https://offerpk.github.io/arrowpath/'

mode='publish'
case "${1:-}" in
  '') ;;
  --dry-run)
    mode='dry-run'
    shift
    [[ $# -eq 0 ]] || { printf 'publish:pages: ERROR: unexpected extra arguments\n' >&2; exit 2; }
    ;;
  --help|-h)
    cat <<'HELP'
Usage: npm run publish:pages [-- --dry-run]

Build and validate the current clean, up-to-date main branch; verify that
GitHub Pages is configured for legacy publishing from gh-pages /; then prepare
and (unless --dry-run is supplied) push a Pages-root commit based on the latest
origin/gh-pages. The push is fast-forward-only; this script never force-pushes.

Requires an authenticated GitHub CLI session or GH_TOKEN/GITHUB_TOKEN that can
read this repository's Pages settings. Publishing also requires permission to
push to gh-pages. No GitHub Actions/workflow files are used or changed.
HELP
    exit 0
    ;;
  *)
    printf 'Usage: npm run publish:pages [-- --dry-run]\n' >&2
    exit 2
    ;;
esac

fail() {
  printf 'publish:pages: ERROR: %s\n' "$*" >&2
  exit 1
}

for command_name in git npm curl python3; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

[[ "$(git rev-parse --show-toplevel)" == "$repo_root" ]] || fail 'could not resolve repository root'
[[ "$(git branch --show-current)" == 'main' ]] || fail 'run this command from the main branch; no files were published'

remote_url="$(git remote get-url origin 2>/dev/null)" || fail 'origin remote is missing'
case "$remote_url" in
  "$EXPECTED_REMOTE_HTTPS"|"$EXPECTED_REMOTE_HTTPS_NO_SUFFIX"|"$EXPECTED_REMOTE_SSH"|"$EXPECTED_REMOTE_SSH_URL") ;;
  *) fail "origin is not the expected OfferPk/arrowpath repository: $remote_url" ;;
esac

[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || fail 'working tree is not clean; commit or remove local changes before publishing'

api_token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [[ -z "$api_token" ]] && command -v gh >/dev/null 2>&1; then
  api_token="$(gh auth token 2>/dev/null || true)"
fi
[[ -n "$api_token" ]] || fail 'GitHub Pages settings cannot be checked: authenticate gh or set GH_TOKEN/GITHUB_TOKEN'

scratch="$(mktemp -d "${TMPDIR:-/tmp}/arrowpath-pages.XXXXXX")"
stage=''
cleanup() {
  if [[ -n "$stage" && -d "$stage" ]]; then
    git -C "$repo_root" worktree remove --force "$stage" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT

# Keep the temporary credential file private and out of process arguments/logs.
auth_config="$scratch/github-auth.curl"
printf 'header = "Authorization: Bearer %s"\n' "$api_token" > "$auth_config"
chmod 600 "$auth_config"
git_token_file="$scratch/github-token"
printf '%s' "$api_token" > "$git_token_file"
chmod 600 "$git_token_file"
git_askpass="$scratch/git-askpass"
cat > "$git_askpass" <<'ASKPASS'
#!/usr/bin/env bash
case "${1:-}" in
  *Username*) printf 'x-access-token\n' ;;
  *Password*) cat -- "$ARROWPATH_GH_TOKEN_FILE" ;;
  *) exit 1 ;;
esac
ASKPASS
chmod 700 "$git_askpass"
unset api_token GH_TOKEN GITHUB_TOKEN

http_status="$(curl --silent --show-error --config "$auth_config" \
  --header 'Accept: application/vnd.github+json' \
  --header 'X-GitHub-Api-Version: 2022-11-28' \
  --output "$scratch/pages.json" --write-out '%{http_code}' "$PAGES_API_URL")" || \
  fail 'could not contact the GitHub Pages settings API; no Pages files were written'
[[ "$http_status" == '200' ]] || fail "could not read GitHub Pages settings (HTTP $http_status); no Pages files were written"

python3 - "$scratch/pages.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as f:
    settings = json.load(f)
source = settings.get("source") or {}
actual = (settings.get("build_type"), source.get("branch"), source.get("path"))
expected = ("legacy", "gh-pages", "/")
if actual != expected:
    raise SystemExit(
        "publish:pages: ERROR: Pages source is not legacy gh-pages root "
        f"(found build_type={actual[0]!r}, branch={actual[1]!r}, path={actual[2]!r}); "
        "nothing was published"
    )
print("[publish:pages] Verified Pages source: legacy gh-pages root.")
PY

printf '[publish:pages] Fetching main and gh-pages refs...\n'
git fetch --no-tags origin || fail 'could not fetch origin; no Pages files were written'
main_sha="$(git rev-parse HEAD)"
remote_main_sha="$(git rev-parse refs/remotes/origin/main 2>/dev/null)" || fail 'origin/main is unavailable after fetch'
[[ "$main_sha" == "$remote_main_sha" ]] || fail "local main ($main_sha) is not exactly origin/main ($remote_main_sha); update/review main first"
pages_base="$(git rev-parse refs/remotes/origin/gh-pages 2>/dev/null)" || fail 'origin/gh-pages is unavailable after fetch'
printf '[publish:pages] Validating main %s...\n' "${main_sha:0:7}"

npm ci --no-audit --no-fund
npm test
npm run build

git diff --check HEAD -- || fail 'main contains whitespace errors'
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || fail 'build or tests changed tracked/unignored files; refusing to publish'

python3 - "$repo_root/dist" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
# Prompt-mode virtual:pwa-register is bundled in the hashed app JavaScript; it
# no longer emits a standalone registerSW.js file.
required = ("index.html", "levels.json", "manifest.webmanifest", "sw.js")
missing = [name for name in required if not (root / name).is_file()]
if missing:
    raise SystemExit("publish:pages: ERROR: build output is missing: " + ", ".join(missing))
if not (root / "assets").is_dir():
    raise SystemExit("publish:pages: ERROR: build output has no assets directory")
if not any((root / "assets").glob("index-*.js")):
    raise SystemExit("publish:pages: ERROR: build output has no compiled app/update registration bundle")
if (root / ".nojekyll").exists() or (root / "CNAME").exists():
    raise SystemExit("publish:pages: ERROR: dist must not replace Pages-owned .nojekyll or CNAME")
for entry in root.rglob("*"):
    if entry.is_symlink():
        raise SystemExit(f"publish:pages: ERROR: build output contains a symlink: {entry.relative_to(root)}")
html = (root / "index.html").read_text(encoding="utf-8")
if "/arrowpath/" not in html:
    raise SystemExit("publish:pages: ERROR: built index does not contain the /arrowpath/ base path")
for value in re.findall(r'''(?:src|href)=[\"']([^\"']+)[\"']''', html):
    if value.startswith("/"):
        if not value.startswith("/arrowpath/"):
            raise SystemExit(f"publish:pages: ERROR: unexpected root-absolute asset URL: {value}")
        relative = value.removeprefix("/arrowpath/").split("?", 1)[0].split("#", 1)[0]
        if relative and not (root / relative).is_file():
            raise SystemExit(f"publish:pages: ERROR: built index points to missing asset: {value}")
print("[publish:pages] Build output validated for /arrowpath/ and required PWA assets.")
PY

stage="$scratch/gh-pages"
git worktree add --detach "$stage" "$pages_base" >/dev/null || fail 'could not create an isolated gh-pages staging worktree'
[[ -f "$stage/.nojekyll" && ! -L "$stage/.nojekyll" ]] || fail 'origin/gh-pages is missing its required regular .nojekyll file'

python3 - "$repo_root/dist" "$stage" <<'PY'
import shutil
import sys
from pathlib import Path

source, destination = map(Path, sys.argv[1:])
source_names = {entry.name for entry in source.iterdir()}
if ".nojekyll" in source_names or "CNAME" in source_names:
    raise SystemExit("publish:pages: ERROR: dist cannot overwrite .nojekyll or CNAME")
for entry in source.iterdir():
    if entry.name.startswith("."):
        raise SystemExit(f"publish:pages: ERROR: unexpected hidden build entry: {entry.name}")
    if entry.is_symlink():
        raise SystemExit(f"publish:pages: ERROR: build output contains a symlink: {entry.name}")

# Unknown root-level files are preserved by refusing to delete them. Known
# generated root entries are replaced from dist; .nojekyll, CNAME, .git, and
# other hidden Pages-owned files are left untouched.
for entry in destination.iterdir():
    if entry.name in {".git", ".nojekyll", "CNAME"} or entry.name.startswith("."):
        continue
    if entry.name not in source_names:
        raise SystemExit(
            "publish:pages: ERROR: refusing to delete unexpected gh-pages root entry "
            f"{entry.name!r}; preserve or review it before publishing"
        )
    if entry.is_symlink():
        raise SystemExit(f"publish:pages: ERROR: refusing to replace symlink in gh-pages: {entry.name}")
    if entry.is_dir():
        shutil.rmtree(entry)
    else:
        entry.unlink()

for entry in source.iterdir():
    target = destination / entry.name
    if entry.is_dir():
        shutil.copytree(entry, target)
    else:
        shutil.copy2(entry, target)

if not (destination / ".nojekyll").is_file():
    raise SystemExit("publish:pages: ERROR: .nojekyll was not preserved")
PY

git -C "$stage" add --all
git -C "$stage" diff --cached --check || fail 'staged Pages output has whitespace errors'
git -C "$stage" diff --cached --quiet -- .nojekyll || fail 'staging changed the required .nojekyll file'
if git -C "$stage" cat-file -e HEAD:CNAME 2>/dev/null; then
  git -C "$stage" diff --cached --quiet -- CNAME || fail 'staging changed the existing CNAME file'
fi

if git -C "$stage" diff --cached --quiet; then
  printf '[publish:pages] No Pages output changes; %s already matches this main build.\n' "$SITE_URL"
  exit 0
fi

printf '[publish:pages] Proposed Pages-root update from main %s:\n' "${main_sha:0:7}"
git -C "$stage" diff --cached --stat
if [[ "$mode" == 'dry-run' ]]; then
  printf '[publish:pages] Dry run complete; nothing was committed or pushed.\n'
  exit 0
fi

# The new deployment commit must be directly based on the fetched Pages tip.
[[ "$(git -C "$stage" rev-parse HEAD)" == "$pages_base" ]] || fail 'staging worktree moved from fetched gh-pages tip'
git -C "$stage" commit -m "deploy: ArrowPath from main ${main_sha:0:7}"
new_pages_sha="$(git -C "$stage" rev-parse HEAD)"
[[ "$(git -C "$stage" rev-parse HEAD^)" == "$pages_base" ]] || fail 'deployment commit is not based on the fetched gh-pages tip'
git -C "$stage" merge-base --is-ancestor "$pages_base" "$new_pages_sha" || fail 'deployment is not a fast-forward from gh-pages'

latest_pages_sha="$(git ls-remote origin refs/heads/gh-pages | awk 'NR == 1 { print $1 }')"
[[ "$latest_pages_sha" == "$pages_base" ]] || fail 'origin/gh-pages changed during staging; refusing to push a stale deployment'

printf '[publish:pages] Pushing %s with a normal fast-forward-only push...\n' "$new_pages_sha"
if [[ "$remote_url" == https://* ]]; then
  env -u GH_TOKEN -u GITHUB_TOKEN \
    ARROWPATH_GH_TOKEN_FILE="$git_token_file" GIT_ASKPASS="$git_askpass" GIT_TERMINAL_PROMPT=0 \
    git -c credential.helper= -C "$stage" push origin HEAD:refs/heads/gh-pages
else
  git -C "$stage" push origin HEAD:refs/heads/gh-pages
fi
printf '[publish:pages] Published main %s to %s.\n' "${main_sha:0:7}" "$SITE_URL"
