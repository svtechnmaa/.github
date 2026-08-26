#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

errors=()
skill_count=0

# --- portable stat helper ---
file_size() {
  local f="$1"
  if stat -f%z "$f" >/dev/null 2>&1; then
    stat -f%z "$f"
  elif stat -c%s "$f" >/dev/null 2>&1; then
    stat -c%s "$f"
  else
    # Git Bash / Windows fallback
    wc -c < "$f" | tr -d ' '
  fi
}

# --- Check 1: Stubs symmetric ---
for stub in CLAUDE.md AGENTS.md; do
  if [[ ! -f "$stub" ]]; then
    errors+=("MISSING: $stub does not exist")
  elif ! grep -q '\.agentic/INSTRUCTIONS\.md' "$stub"; then
    errors+=("DRIFT: $stub does not mention .agentic/INSTRUCTIONS.md")
  fi
done

# --- Check 5: Stub size limit (5120 bytes) ---
for stub in CLAUDE.md AGENTS.md; do
  if [[ -f "$stub" ]]; then
    sz=$(file_size "$stub")
    if [[ "$sz" -gt 5120 ]]; then
      errors+=("SIZE: $stub is ${sz}B (max 5120B). Move content into .agentic/INSTRUCTIONS.md.")
    fi
  fi
done

# --- Check 2: Skill folder parity ---
claude_skills_dir=".claude/skills"
codex_skills_dir=".codex/skills"

if [[ -d "$claude_skills_dir" ]]; then
  while IFS= read -r -d '' skill_dir; do
    skill_name="$(basename "$skill_dir")"
    skill_count=$((skill_count + 1))
    codex_counterpart="$codex_skills_dir/$skill_name"
    if [[ ! -d "$codex_counterpart" ]]; then
      errors+=("MISSING: $codex_counterpart/ — you added the Claude side (.claude/skills/$skill_name) without the Codex side")
    elif [[ ! -f "$codex_counterpart/SKILL.md" ]]; then
      errors+=("MISSING: $codex_counterpart/SKILL.md")
    fi
    if [[ ! -f "$skill_dir/SKILL.md" ]]; then
      errors+=("MISSING: $skill_dir/SKILL.md")
    fi
  done < <(find "$claude_skills_dir" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)
fi

if [[ -d "$codex_skills_dir" ]]; then
  while IFS= read -r -d '' skill_dir; do
    skill_name="$(basename "$skill_dir")"
    claude_counterpart="$claude_skills_dir/$skill_name"
    if [[ ! -d "$claude_counterpart" ]]; then
      errors+=("MISSING: $claude_counterpart/ — you added the Codex side (.codex/skills/$skill_name) without the Claude side")
    fi
  done < <(find "$codex_skills_dir" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)
fi

# --- Checks 3 & 4: Phase-doc back-reference and frontmatter ---
while IFS= read -r -d '' skill_md; do
  # Check 4: frontmatter
  first_line="$(head -1 "$skill_md")"
  if [[ "$first_line" != "---" ]]; then
    errors+=("DRIFT: $skill_md does not start with '---' (missing YAML frontmatter)")
  else
    frontmatter="$(sed -n '/^---$/,/^---$/p' "$skill_md" | sed '1d;$d')"
    if ! printf '%s\n' "$frontmatter" | grep -q '^name:'; then
      errors+=("DRIFT: $skill_md frontmatter is missing 'name:' field")
    fi
  fi

  # Check 3: phase-doc back-reference
  phase_ref="$(grep -oE '\.agentic/phases/[a-zA-Z0-9_-]+\.md' "$skill_md" | head -1 || true)"
  if [[ -z "$phase_ref" ]]; then
    errors+=("DRIFT: $skill_md does not reference any .agentic/phases/ path")
  else
    # Strip any trailing punctuation/quotes
    phase_ref="${phase_ref%%[)\"\']*}"
    if [[ ! -f "$phase_ref" ]]; then
      errors+=("MISSING: $skill_md references $phase_ref but that file does not exist")
    fi
  fi
done < <(find ".claude/skills" ".codex/skills" -name "SKILL.md" -print0 2>/dev/null)

# --- Check 6: name: field parity between .claude and .codex skill sides ---
while IFS= read -r -d '' claude_skill_md; do
  skill_dir_name="$(basename "$(dirname "$claude_skill_md")")"
  codex_skill_md=".codex/skills/$skill_dir_name/SKILL.md"
  if [[ ! -f "$codex_skill_md" ]]; then
    continue  # already caught by Check 2
  fi
  claude_fm="$(sed -n '/^---$/,/^---$/p' "$claude_skill_md" | sed '1d;$d')"
  codex_fm="$(sed -n '/^---$/,/^---$/p' "$codex_skill_md" | sed '1d;$d')"
  claude_name="$(printf '%s\n' "$claude_fm" | grep '^name:' | head -1 | sed 's/^name:[[:space:]]*//')"
  codex_name="$(printf '%s\n' "$codex_fm" | grep '^name:' | head -1 | sed 's/^name:[[:space:]]*//')"
  if [[ "$claude_name" != "$codex_name" ]]; then
    errors+=("MISMATCH: .claude/skills/$skill_dir_name/SKILL.md name='$claude_name' vs .codex/skills/$skill_dir_name/SKILL.md name='$codex_name'")
  fi
done < <(find ".claude/skills" -name "SKILL.md" -print0 2>/dev/null)

# --- Report ---
if [[ "${#errors[@]}" -gt 0 ]]; then
  for err in "${errors[@]}"; do
    echo "$err"
  done
  exit 1
fi

echo "parity: OK ($skill_count skills, checks: stubs, folders, refs, frontmatter, size, name-parity)"
exit 0
