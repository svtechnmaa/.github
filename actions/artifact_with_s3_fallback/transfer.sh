#!/usr/bin/env bash
set -euo pipefail

echo "::warning::GitHub artifact failed; trying SeaweedFS S3."
temp_dir=$(mktemp -d "$RUNNER_TEMP/artifact.XXXXXX")
cleanup() {
  rm -rf -- "$temp_dir"
  if [[ -n ${ARTIFACT_PREPARED:-} && "$ARTIFACT_PREPARED" == "$RUNNER_TEMP"/artifact-files-* ]]; then
    rm -rf -- "$ARTIFACT_PREPARED"
  fi
}
trap cleanup EXIT
archive="$temp_dir/content"
headers="$temp_dir/headers"

if [[ -z "$AWS_ACCESS_KEY_ID" || -z "$AWS_SECRET_ACCESS_KEY" ]]; then
  echo "::error::GitHub artifact failed and S3_ARTIFACT_ACCESS_KEY / S3_ARTIFACT_SECRET_KEY are unavailable."
  exit 1
fi
if [[ "$ARTIFACT_OPERATION" == upload ]]; then
  ARTIFACT_NAME=$(cat "$ARTIFACT_PREPARED/name")
fi
case "$ARTIFACT_NAME" in
  ''|.|..|*/*|*\\*) echo '::error::Invalid artifact name'; exit 1 ;;
esac

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

# Use the caller workflow's filename, not its potentially duplicated display name.
workflow_path=${GITHUB_WORKFLOW_REF%%@refs/*}
workflow_file=${workflow_path##*/}
owner=${GITHUB_REPOSITORY%%/*}
repository=${GITHUB_REPOSITORY#*/}
attempt=${GITHUB_RUN_ATTEMPT:-1}
if [[ ! "$attempt" =~ ^[1-9][0-9]*$ ]]; then
  echo '::error::Invalid GITHUB_RUN_ATTEMPT'
  exit 1
fi
run_prefix="$owner/$repository/workflows/$workflow_file/runs/$GITHUB_RUN_NUMBER-$GITHUB_RUN_ID"
url_prefix="$(urlencode "$owner")/$(urlencode "$repository")/workflows/$(urlencode "$workflow_file")/runs/$GITHUB_RUN_NUMBER-$GITHUB_RUN_ID"
key="$run_prefix/attempts/$attempt/artifacts/$ARTIFACT_NAME/content"
url_key="$url_prefix/attempts/$attempt/artifacts/$(urlencode "$ARTIFACT_NAME")/content"
url="${ARTIFACT_S3_ENDPOINT%/}/$ARTIFACT_S3_BUCKET/$url_key"
curl_options=(
  --silent --show-error --fail
  --aws-sigv4 "aws:amz:$AWS_DEFAULT_REGION:s3"
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
  --connect-timeout 10 --max-time 600
  --retry "${ARTIFACT_S3_RETRY_COUNT:-3}" --retry-delay 2 --retry-connrefused
  --globoff --proto '=https'
)

# Return 4 only for a missing object; never hide authentication or network errors.
download_archive() {
  local candidate_key="$1" candidate_url_key="$2" legacy_format="${3:-}" status
  echo "Trying s3://$ARTIFACT_S3_BUCKET/$candidate_key"
  if status=$(curl "${curl_options[@]}" --output "$archive" --dump-header "$headers" --write-out '%{http_code}' \
    "${ARTIFACT_S3_ENDPOINT%/}/$ARTIFACT_S3_BUCKET/$candidate_url_key"); then
    if [[ "$status" == 200 ]]; then
      key=$candidate_key
      format=$(awk 'tolower($1) == "x-amz-meta-artifact-format:" {value=$2; sub(/\r$/, "", value)} END {print value}' "$headers")
      format=${format:-$legacy_format}
      case "$format" in
        tar|tar+gzip|raw) return 0 ;;
        *) echo '::error::Missing or unsupported S3 artifact format metadata'; return 1 ;;
      esac
    fi
  elif [[ "$status" == 404 ]]; then
    return 4
  fi
  echo "::error::S3 download failed (HTTP $status): $candidate_key"
  return 1
}

case "$ARTIFACT_OPERATION" in
  upload)
    if [[ $(cat "$ARTIFACT_PREPARED/format") == raw ]]; then
      format=raw
      cp -- "$(cat "$ARTIFACT_PREPARED/source")" "$archive"
    else
      format=tar
      tar --dereference --hard-dereference -cf "$archive" -C "$(cat "$ARTIFACT_PREPARED/root")" \
        --null --verbatim-files-from -T "$ARTIFACT_PREPARED/files"
      if [[ "$ARTIFACT_COMPRESSION" != 0 ]]; then
        gzip -n -"$ARTIFACT_COMPRESSION" -c "$archive" > "$temp_dir/compressed"
        mv -- "$temp_dir/compressed" "$archive"
        format=tar+gzip
      fi
    fi
    if [[ "$ARTIFACT_RETENTION" != 0 && "$ARTIFACT_RETENTION" != 60 ]]; then
      echo '::warning::retention-days applies to GitHub. SeaweedFS expiration still uses the configured bucket TTL (60 days).'
    fi
    conditional_headers=()
    if [[ "$ARTIFACT_OVERWRITE" == false ]]; then
      conditional_headers=(--header 'If-None-Match: *')
    fi
    # curl signs this explicit payload hash along with the PUT request.
    payload_hash=$(sha256sum "$archive")
    if ! status=$(curl "${curl_options[@]}" "${conditional_headers[@]}" \
      --header "x-amz-content-sha256: ${payload_hash%% *}" \
      --header 'Content-Type: application/octet-stream' \
      --header "x-amz-meta-artifact-format: $format" \
      --header "x-amz-meta-artifact-retention-days-requested: $ARTIFACT_RETENTION" \
      --header "x-amz-meta-github-run-url: ${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/attempts/$attempt" \
      --header "x-amz-meta-github-workflow: $(urlencode "${GITHUB_WORKFLOW:-$workflow_file}")" \
      --header "x-amz-meta-github-job: $(urlencode "${GITHUB_JOB:-unknown}")" \
      --header "x-amz-meta-github-sha: ${GITHUB_SHA:-unknown}" \
      --upload-file "$archive" --output /dev/null --write-out '%{http_code}' "$url"); then
      if [[ "$status" == 412 ]]; then
        echo '::error::S3 artifact already exists in this attempt; use overwrite=true to replace it.'
      else
        echo "::error::S3 upload failed (HTTP $status)."
      fi
      exit 1
    fi
    [[ "$status" == 200 || "$status" == 201 ]] || { echo "::error::Unexpected S3 upload status: $status"; exit 1; }
    ;;
  download)
    found=false
    # Successful producer jobs may belong to an earlier attempt of this same run.
    for ((candidate_attempt = attempt; candidate_attempt >= 1; candidate_attempt--)); do
      if download_archive \
        "$run_prefix/attempts/$candidate_attempt/artifacts/$ARTIFACT_NAME/content" \
        "$url_prefix/attempts/$candidate_attempt/artifacts/$(urlencode "$ARTIFACT_NAME")/content"; then
        found=true
        break
      else
        result=$?
        [[ "$result" == 4 ]] || exit "$result"
      fi
      # Read the previous per-attempt layout before looking at an older attempt.
      if download_archive \
        "$run_prefix/attempts/$candidate_attempt/artifacts/$ARTIFACT_NAME.tar.gz" \
        "$url_prefix/attempts/$candidate_attempt/artifacts/$(urlencode "$ARTIFACT_NAME").tar.gz" tar+gzip; then
        found=true
        break
      else
        result=$?
        [[ "$result" == 4 ]] || exit "$result"
      fi
    done
    # Read objects written by the action's original layout during migration.
    if [[ "$found" == false ]]; then
      if download_archive "$GITHUB_REPOSITORY/$GITHUB_RUN_ID/$ARTIFACT_NAME.tar.gz" \
        "$(urlencode "$owner")/$(urlencode "$repository")/$GITHUB_RUN_ID/$(urlencode "$ARTIFACT_NAME").tar.gz" tar+gzip; then
        found=true
      else
        result=$?
        [[ "$result" == 4 ]] || exit "$result"
      fi
    fi
    if [[ "$found" == false ]]; then
      echo "::error::Artifact '$ARTIFACT_NAME' not found in S3 for run $GITHUB_RUN_ID (attempts $attempt through 1)."
      exit 1
    fi
    # Match download-artifact's basic tilde expansion.
    if [[ "$ARTIFACT_PATH" == '~' || "$ARTIFACT_PATH" == '~/'* ]]; then
      ARTIFACT_PATH="$HOME${ARTIFACT_PATH:1}"
    fi
    if [[ "$format" == raw ]]; then
      mkdir -p -- "$ARTIFACT_PATH"
      cp -- "$archive" "$ARTIFACT_PATH/$ARTIFACT_NAME"
      echo "$ARTIFACT_OPERATION succeeded: s3://$ARTIFACT_S3_BUCKET/$key"
      exit 0
    fi
    # Reject traversal paths and links before extraction into a staging directory.
    tar -tf "$archive" > "$temp_dir/members"
    if ! awk '/^\// || /(^|\/)\.\.(\/|$)/ {exit 1}' "$temp_dir/members"; then
      echo '::error::Unsafe artifact archive path'
      exit 1
    fi
    tar -tvf "$archive" > "$temp_dir/details"
    if ! awk 'substr($0, 1, 1) != "-" && substr($0, 1, 1) != "d" {exit 1}' "$temp_dir/details"; then
      echo '::error::Artifact archive contains unsupported links or special files'
      exit 1
    fi
    mkdir -p "$temp_dir/extracted" "$ARTIFACT_PATH"
    tar -xf "$archive" --no-same-owner --no-same-permissions -C "$temp_dir/extracted"
    cp -a "$temp_dir/extracted/." "$ARTIFACT_PATH/"
    ;;
  *) echo '::error::operation must be upload or download'; exit 1 ;;
esac

echo "$ARTIFACT_OPERATION succeeded: s3://$ARTIFACT_S3_BUCKET/$key"
