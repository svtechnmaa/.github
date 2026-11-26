#!/usr/bin/env bash
set -euo pipefail

source "${BASH_SOURCE[0]%/*}/s3.sh"

readonly OBJECT_NOT_FOUND=4

download_archive() {
  local candidate_key="$1" status expected_digest actual_digest
  echo "Trying s3://$ARTIFACT_S3_BUCKET/$candidate_key"
  if ! status=$(curl "${curl_options[@]}" --output "$archive" --dump-header "$headers" --write-out '%{http_code}' \
    "$(s3_url "$candidate_key")"); then
    echo "::error::S3 download transport failed (HTTP $status): $candidate_key"
    return 1
  fi
  case "$status" in
    200) ;;
    404) return "$OBJECT_NOT_FOUND" ;;
    *) echo "::error::S3 download failed (HTTP $status): $candidate_key"; return 1 ;;
  esac
  format=$(response_header x-amz-meta-artifact-format)
  if [[ -z "$format" && "$candidate_key" == *.tar.gz ]]; then
    format=tar+gzip
  fi
  case "$format" in
    tar|tar+gzip|raw) ;;
    *) echo '::error::Missing or unsupported S3 artifact format metadata'; return 1 ;;
  esac
  expected_digest=$(response_header x-amz-meta-artifact-sha256)
  # Existing objects predate checksum metadata and remain readable.
  if [[ -n "$expected_digest" ]]; then
    if [[ ! "$expected_digest" =~ ^[[:xdigit:]]{64}$ ]]; then
      echo '::error::Invalid artifact SHA-256 metadata'
      return 1
    fi
    actual_digest=$(sha256sum -- "$archive") || return 1
    if [[ "${actual_digest%% *}" != "${expected_digest,,}" ]]; then
      echo '::error::S3 artifact SHA-256 mismatch; refusing to restore corrupted data'
      return 1
    fi
  fi
  return 0
}

temp_dir=
trap cleanup_s3 EXIT
init_s3

candidates=()
for ((candidate_attempt = attempt; candidate_attempt >= 1; candidate_attempt--)); do
  prefix="$run_key/attempts/$candidate_attempt/artifacts/$ARTIFACT_NAME"
  candidates+=("$prefix/content" "$prefix.tar.gz")
done
candidates+=("$GITHUB_REPOSITORY/$GITHUB_RUN_ID/$ARTIFACT_NAME.tar.gz")

found=false
for key in "${candidates[@]}"; do
  if download_archive "$key"; then
    found=true
    break
  elif [[ $? != "$OBJECT_NOT_FOUND" ]]; then
    exit 1
  fi
done
if [[ "$found" == false ]]; then
  echo "::error::Artifact '$ARTIFACT_NAME' not found in S3 for run $GITHUB_RUN_ID (attempts $attempt through 1)."
  exit 1
fi

# Match the native action's input trimming, workspace default and path resolution.
ARTIFACT_PATH=${ARTIFACT_PATH#"${ARTIFACT_PATH%%[![:space:]]*}"}
ARTIFACT_PATH=${ARTIFACT_PATH%"${ARTIFACT_PATH##*[![:space:]]}"}
ARTIFACT_PATH=${ARTIFACT_PATH:-${GITHUB_WORKSPACE:-$PWD}}
IFS= read -r -d '' ARTIFACT_PATH < <(realpath -msz -- "${ARTIFACT_PATH/#\~/$HOME}")
if [[ "$format" == raw ]]; then
  mkdir -p -- "$ARTIFACT_PATH"
  cp -- "$archive" "$ARTIFACT_PATH/$ARTIFACT_NAME"
else
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
fi

delimiter=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
printf 'download-path<<%s\n%s\n%s\n' "$delimiter" "$ARTIFACT_PATH" "$delimiter" >> "$GITHUB_OUTPUT"
echo "download succeeded: s3://$ARTIFACT_S3_BUCKET/$key"
