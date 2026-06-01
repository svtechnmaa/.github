#!/usr/bin/env bash
set -euo pipefail

TEMPLATE_REPO="${TEMPLATE_REPO:-svtechnmaa/template-repository}"
BRANCH="${BRANCH:-main}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
HOOKS_PATH="hooks"
WORKFLOW_PATH=".github/workflows"
WORKFLOW_FILE="scan-secret.yaml"

AUTO_YES=0
MODE=""

usage() {
  cat <<EOF
Usage:
  ./setup_security_scan.bash
  ./setup_security_scan.bash -y
  ./setup_security_scan.bash --auto
  ./setup_security_scan.bash --template
  ./setup_security_scan.bash --install
  ./setup_security_scan.bash --check

Modes:
  --auto       Detect current repo state. Install missing files if needed, then activate hooks.
  --template   Use when this repo was created from the template. Only activate hooks.
  --install    Use for an existing repo. Install hooks/workflow, then activate hooks.
  --check      Print current setup status only.

Options:
  -y, --yes    Run without confirmation prompts.
  -h, --help   Show this help.

Environment:
  TEMPLATE_REPO=owner/repo   Source template repo for downloads.
  BRANCH=main                Source branch for downloads.
  BASE_URL=https://...       Override raw file base URL.
  GITHUB_TOKEN=ghp_xxx       GitHub PAT required for private template repos.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --auto) MODE="auto" ;;
    --template) MODE="template" ;;
    --install) MODE="install" ;;
    --check) MODE="check" ;;
    -y|--yes) AUTO_YES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown option: $1"; usage; exit 1 ;;
  esac
  shift
done

has_required_files() {
  [ -f "${HOOKS_PATH}/pre-commit" ] &&
    [ -f "${HOOKS_PATH}/prepare-commit-msg" ] &&
    [ -f "${HOOKS_PATH}/install-betterleaks.sh" ] &&
    [ -f "${WORKFLOW_PATH}/${WORKFLOW_FILE}" ]
}

require_git_repo() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "ERROR: run this inside a git repository."
    exit 1
  fi
}

print_header() {
  echo ""
  echo "========================================"
  echo " SVTECH Security Scan Setup"
  echo "========================================"
  echo ""
}

file_status() {
  if [ -f "$1" ]; then
    echo "[OK]      $1"
  else
    echo "[MISSING] $1"
  fi
}

show_status() {
  echo "Current repository:"
  echo "  $(git rev-parse --show-toplevel)"
  echo ""
  echo "Required files:"
  file_status "${HOOKS_PATH}/pre-commit"
  file_status "${HOOKS_PATH}/prepare-commit-msg"
  file_status "${HOOKS_PATH}/install-betterleaks.sh"
  file_status "${WORKFLOW_PATH}/${WORKFLOW_FILE}"
  echo ""
  echo "Git hook config:"
  current_hooks_path="$(git config --get core.hooksPath || true)"
  if [ "$current_hooks_path" = "$HOOKS_PATH" ]; then
    echo "[OK]      core.hooksPath=${HOOKS_PATH}"
  elif [ -n "$current_hooks_path" ]; then
    echo "[WARNING] core.hooksPath=${current_hooks_path}"
  else
    echo "[MISSING] core.hooksPath is not configured"
  fi
  echo ""
}

confirm() {
  if [ "$AUTO_YES" -eq 1 ]; then
    return 0
  fi

  printf "%s [y/N] " "$1"
  if ! read -r answer; then
    answer=""
  fi
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

download_file() {
  src="$1"
  dest="$2"
  mkdir -p "$(dirname "$dest")"
  echo "[INFO] Downloading ${dest}"

  if [ -n "$GITHUB_TOKEN" ]; then
    curl -fsSL \
      -H "Authorization: token ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github.v3.raw" \
      "https://api.github.com/repos/${TEMPLATE_REPO}/contents/${src}?ref=${BRANCH}" \
      -o "$dest"
  else
    curl -fsSL \
      "https://raw.githubusercontent.com/${TEMPLATE_REPO}/${BRANCH}/${src}" \
      -o "$dest"
  fi
}

install_files() {
  echo "[STEP] Installing security scan files"

  if [ -z "$GITHUB_TOKEN" ]; then
    echo "[WARNING] GITHUB_TOKEN is not set. Downloads may fail if the template repo is private."
    echo ""
  fi

  mkdir -p "$HOOKS_PATH" "$WORKFLOW_PATH"

  download_file "hooks/pre-commit" "${HOOKS_PATH}/pre-commit"
  download_file "hooks/prepare-commit-msg" "${HOOKS_PATH}/prepare-commit-msg"
  download_file "hooks/install-betterleaks.sh" "${HOOKS_PATH}/install-betterleaks.sh"
  download_file ".github/workflows/${WORKFLOW_FILE}" "${WORKFLOW_PATH}/${WORKFLOW_FILE}"

  chmod +x "${HOOKS_PATH}/pre-commit" "${HOOKS_PATH}/prepare-commit-msg" "${HOOKS_PATH}/install-betterleaks.sh"
  echo "[OK] Security scan files are installed"
  echo ""
}

activate_hooks() {
  echo "[STEP] Activating git hooks"
  git config core.hooksPath "$HOOKS_PATH"

  active_hooks_path="$(git config --get core.hooksPath || true)"
  if [ "$active_hooks_path" != "$HOOKS_PATH" ]; then
    echo "ERROR: failed to set core.hooksPath=${HOOKS_PATH}"
    exit 1
  fi

  echo "[OK] Git hooks activated: ${HOOKS_PATH}"
  echo ""
}

print_next_steps() {
  echo "Next steps for developers:"
  echo "  1. Review installed files:"
  echo "     git status --short"
  echo "  2. Commit the template files if this is an existing repo:"
  echo "     git add hooks .github/workflows/${WORKFLOW_FILE}"
  echo "     git commit -m \"chore: install security scan hooks\""
  echo "  3. Make a test commit normally. The pre-commit hook will run betterleaks."
  echo ""
  echo "If BetterLeaks cannot be downloaded automatically, download it manually from:"
  echo "  https://github.com/betterleaks/betterleaks/releases"
  echo ""
}

choose_mode() {
  if [ -n "$MODE" ]; then
    return
  fi

  if [ "$AUTO_YES" -eq 1 ]; then
    MODE="auto"
    return
  fi

  echo "Choose setup mode:"
  echo "  0) Auto setup"
  echo "     - Install missing files if needed"
  echo "     - Then runs: git config core.hooksPath hooks"
  echo ""
  echo "  1) New repo created from this template"
  echo "     - Required files already exist"
  echo "     - Script only runs: git config core.hooksPath hooks"
  echo ""
  echo "  2) Existing repo"
  echo "     - Script installs hooks and GitHub workflow"
  echo "     - Then activates hooks"
  echo ""
  echo "  3) Check current setup only"
  echo ""
  printf "Select [0/1/2/3]: "
  if ! read -r choice; then
    choice=""
  fi

  case "$choice" in
    0) MODE="auto" ;;
    1) MODE="template" ;;
    2) MODE="install" ;;
    3) MODE="check" ;;
    *) echo "ERROR: invalid selection"; exit 1 ;;
  esac
}

require_git_repo
print_header
show_status
choose_mode

case "$MODE" in
  auto)
    if has_required_files; then
      echo "[INFO] Required files already exist. Activating hooks only."
      echo ""
      activate_hooks
    else
      echo "[INFO] Some security scan files are missing. Installing them first."
      echo ""
      install_files
      activate_hooks
    fi
    show_status
    print_next_steps
    ;;
  template)
    if confirm "Activate hooks for this template-based repo?"; then
      activate_hooks
      show_status
      print_next_steps
    else
      echo "Cancelled."
    fi
    ;;
  install)
    echo "This will add or overwrite these files:"
    echo "  ${HOOKS_PATH}/pre-commit"
    echo "  ${HOOKS_PATH}/prepare-commit-msg"
    echo "  ${HOOKS_PATH}/install-betterleaks.sh"
    echo "  ${WORKFLOW_PATH}/${WORKFLOW_FILE}"
    echo ""
    if confirm "Install security scan files and activate hooks?"; then
      install_files
      activate_hooks
      show_status
      print_next_steps
    else
      echo "Cancelled."
    fi
    ;;
  check)
    echo "No changes made."
    ;;
  *)
    echo "ERROR: unsupported mode: ${MODE}"
    exit 1
    ;;
esac