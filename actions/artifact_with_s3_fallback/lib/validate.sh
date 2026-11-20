#!/usr/bin/env bash

validate_retry_count() {
  if [[ ! "$1" =~ ^(0|[1-9][0-9]*)$ ]]; then
    echo '::error::s3-retry-count must be a nonnegative integer'
    return 1
  fi
}

validate_artifact_name() {
  local LC_ALL=C name="$1" forbidden='[\\/":<>|*?[:cntrl:]]'
  if [[ "$name" != *[![:space:]]* || "$name" == . || "$name" == .. || "$name" =~ $forbidden ]]; then
    echo '::error::Invalid artifact name'
    return 1
  fi
}

export_artifact_name() {
  local name="$1"
  validate_artifact_name "$name" || return 1
  # Use the same name for the GitHub action and the S3 fallback.
  name=${name#"${name%%[![:space:]]*}"}
  name=${name%"${name##*[![:space:]]}"}
  validate_artifact_name "$name" || return 1
  printf 'name=%s\n' "$name" >> "$GITHUB_OUTPUT"
}
