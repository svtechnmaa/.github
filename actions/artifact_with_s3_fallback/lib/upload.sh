#!/usr/bin/env bash
set -euo pipefail

source "${BASH_SOURCE[0]%/*}/s3.sh"
source "${BASH_SOURCE[0]%/*}/validate.sh"

readonly RETRY_UPLOAD=4

# Retry if the object is missing or an overwrite is still pending.
verify_upload() {
  local status stored_upload_id
  if ! status=$(curl "${curl_options[@]}" --head --output /dev/null \
    --dump-header "$headers" --write-out '%{http_code}' "$url"); then
    echo '::error::Unable to verify S3 upload after an uncertain PUT result.'
    return 1
  fi
  case "$status" in
    404) return "$RETRY_UPLOAD" ;;
    200) ;;
    *) echo "::error::S3 upload verification failed (HTTP $status)."; return 1 ;;
  esac
  stored_upload_id=$(response_header x-amz-meta-artifact-upload-id)
  if [[ "$ARTIFACT_OVERWRITE" == true && "$stored_upload_id" != "$upload_id" ]]; then
    echo 'S3 still contains another upload; retrying overwrite within the retry limit.'
    return "$RETRY_UPLOAD"
  fi
  if [[ "$stored_upload_id" == "$upload_id" &&
        $(response_header x-amz-meta-artifact-sha256) == "$payload_hash" &&
        $(response_header content-length) == "$payload_size" ]]; then
    echo 'S3 confirms this upload was stored successfully.'
    return 0
  fi
  echo '::error::Existing S3 object does not match this upload ID, checksum and size.'
  return 1
}

put_once() {
  curl "${curl_options[@]}" --retry 0 "${conditional_headers[@]}" \
    --header "x-amz-content-sha256: $payload_hash" \
    --header 'Content-Type: application/octet-stream' \
    --header "x-amz-meta-artifact-format: $format" \
    --header "x-amz-meta-artifact-sha256: $payload_hash" \
    --header "x-amz-meta-artifact-upload-id: $upload_id" \
    --header "x-amz-meta-artifact-retention-days-requested: $ARTIFACT_RETENTION" \
    --header "x-amz-meta-github-run-url: ${GITHUB_SERVER_URL:-https://github.com}/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/attempts/$attempt" \
    --header "x-amz-meta-github-workflow: $(urlencode "${GITHUB_WORKFLOW:-$workflow_file}")" \
    --header "x-amz-meta-github-job: $(urlencode "${GITHUB_JOB:-unknown}")" \
    --header "x-amz-meta-github-sha: ${GITHUB_SHA:-unknown}" \
    --upload-file "$archive" --output /dev/null --write-out '%{http_code}' "$url"
}

temp_dir=
trap 'cleanup_s3; rm -f -- "$ARTIFACT_FILE_LIST"' EXIT
init_s3
validate_artifact_name "$ARTIFACT_NAME"
key="$run_key/attempts/$attempt/artifacts/$ARTIFACT_NAME/content"
url=$(s3_url "$key")

if [[ "$ARTIFACT_ARCHIVE" == false ]]; then
  format=raw
  IFS= read -r -d '' source_file < "$ARTIFACT_FILE_LIST"
  # Keep the hashed payload stable across PUT retries.
  cp -- "$ARTIFACT_ROOT/$source_file" "$archive"
else
  format=tar
  tar_options=(--dereference --hard-dereference --no-recursion -cf -
    -C "$ARTIFACT_ROOT" --null --verbatim-files-from -T "$ARTIFACT_FILE_LIST")
  if [[ "$ARTIFACT_COMPRESSION" == 0 ]]; then
    tar "${tar_options[@]}" > "$archive"
  else
    tar "${tar_options[@]}" | gzip -n -"$ARTIFACT_COMPRESSION" > "$archive"
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
payload_hash=$(sha256sum -- "$archive")
payload_hash=${payload_hash%% *}
payload_size=$(stat -c %s -- "$archive")
upload_id=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
retries=${ARTIFACT_S3_RETRY_COUNT:-3}
for ((try = 0; try <= retries; try++)); do
  transport_failed=false
  if status=$(put_once); then
    case "$status" in
      200|201) break ;;
      408|429|500|502|503|504|522|524|412) ;;
      *) echo "::error::S3 upload failed (HTTP $status)."; exit 1 ;;
    esac
  else
    transport_failed=true
  fi
  # A lost PUT response can mean S3 stored the payload. Verify before retrying.
  if verify_upload; then
    break
  elif [[ $? != "$RETRY_UPLOAD" ]]; then
    exit 1
  fi
  if [[ "$status" == 412 ]]; then
    echo '::error::S3 artifact already exists in this attempt; use overwrite=true to replace it.'
    exit 1
  fi
  if ((try == retries)); then
    echo "::error::S3 upload failed after $((try + 1)) attempt(s) (HTTP $status; transport failure: $transport_failed)."
    exit 1
  fi
  sleep 2
done

echo "upload succeeded: s3://$ARTIFACT_S3_BUCKET/$key"
