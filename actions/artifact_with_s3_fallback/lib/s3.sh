#!/usr/bin/env bash

# Encode each URL segment; SeaweedFS displays the original names in object keys.
urlencode() {
  local LC_ALL=C value="$1" character index
  for ((index = 0; index < ${#value}; index++)); do
    character=${value:index:1}
    case "$character" in
      [a-zA-Z0-9.~_-]) printf '%s' "$character" ;;
      *) printf '%%%02X' "'$character" ;;
    esac
  done
}

s3_url() {
  local IFS=/ part
  local -a parts encoded=()
  read -r -d '' -a parts < <(printf '%s\0' "$1")
  for part in "${parts[@]}"; do
    encoded+=("$(urlencode "$part")")
  done
  printf '%s/%s/%s\n' "${ARTIFACT_S3_ENDPOINT%/}" "$ARTIFACT_S3_BUCKET" "${encoded[*]}"
}

cleanup_s3() {
  if [[ -n "$temp_dir" ]]; then
    rm -rf -- "$temp_dir"
  fi
}

init_s3() {
  local curl_version curl_major curl_minor workflow_path
  echo "::warning::GitHub artifact failed; trying SeaweedFS S3."
  temp_dir=$(mktemp -d "$RUNNER_TEMP/artifact.XXXXXX")
  archive="$temp_dir/content"
  headers="$temp_dir/headers"

  # Earlier curl versions do not use x-amz-content-sha256 as the payload hash
  # when signing --upload-file, so they cannot authenticate these S3 PUTs.
  if ! curl_version=$(curl --version) || [[ ! "$curl_version" =~ ^curl[[:space:]]+([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
    echo '::error::Unable to determine curl version; S3 fallback requires curl 7.87.0 or newer.'
    exit 1
  fi
  curl_major=${BASH_REMATCH[1]}
  curl_minor=${BASH_REMATCH[2]}
  if ((10#$curl_major < 7 || (10#$curl_major == 7 && 10#$curl_minor < 87))); then
    echo "::error::S3 fallback requires curl 7.87.0 or newer for SigV4 uploads; found $curl_major.$curl_minor.${BASH_REMATCH[3]}."
    exit 1
  fi

  if [[ -z "$AWS_ACCESS_KEY_ID" || -z "$AWS_SECRET_ACCESS_KEY" ]]; then
    echo "::error::GitHub artifact failed and S3_ARTIFACT_ACCESS_KEY / S3_ARTIFACT_SECRET_KEY are unavailable."
    exit 1
  fi
  # Use the caller workflow's filename, not its potentially duplicated display name.
  workflow_path=${GITHUB_WORKFLOW_REF%%@refs/*}
  workflow_file=${workflow_path##*/}
  attempt=${GITHUB_RUN_ATTEMPT:-1}
  if [[ ! "$attempt" =~ ^[1-9][0-9]*$ ]]; then
    echo '::error::Invalid GITHUB_RUN_ATTEMPT'
    exit 1
  fi
  run_key="$GITHUB_REPOSITORY/workflows/$workflow_file/runs/$GITHUB_RUN_NUMBER-$GITHUB_RUN_ID"
  curl_options=(
    # Classify HTTP statuses below instead of --fail, so retry-all-errors does not
    # retry permanent HTTP 4xx responses. Curl still retries transient HTTP statuses.
    --silent --show-error
    --aws-sigv4 "aws:amz:$AWS_DEFAULT_REGION:s3"
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
    --connect-timeout 10 --max-time 600
    --retry "${ARTIFACT_S3_RETRY_COUNT:-3}" --retry-delay 2 --retry-all-errors
    --globoff --proto '=https'
  )
}

# Curl can dump several responses during retries or proxy negotiation. Read only
# the final response, so a prior response cannot supply stale metadata.
response_header() {
  awk -v name="$1:" '
    /^HTTP\// {value=""}
    tolower($1) == name {value=$2; sub(/\r$/, "", value)}
    END {print value}
  ' "$headers"
}
