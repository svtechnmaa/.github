"""Exercise the real Bash/curl upload against a local HTTPS S3 stand-in."""
import hashlib
import http.server
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest


ACTION = Path(__file__).resolve().parents[1]
BASH = os.environ.get('TEST_BASH') or (
    r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else shutil.which('bash'))
OPENSSL = shutil.which('openssl') or r'C:\Program Files\Git\usr\bin\openssl.exe'


def shell_path(value):
    value = str(value).replace('\\', '/')
    return '/' + value[0].lower() + value[2:] if os.name == 'nt' else value


class UploadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cert_dir = tempfile.TemporaryDirectory(prefix='artifact-tls-')
        cls.cert = Path(cls.cert_dir.name) / 'cert.pem'
        key = Path(cls.cert_dir.name) / 'key.pem'
        subprocess.run([
            OPENSSL, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
            '-keyout', str(key), '-out', str(cls.cert), '-days', '1',
            '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
        ], check=True, capture_output=True)
        cls.tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        cls.tls.load_cert_chain(cls.cert, key)

    @classmethod
    def tearDownClass(cls):
        cls.cert_dir.cleanup()

    def run_upload(self, scenario, retries=1, overwrite=False):
        state = {'puts': 0, 'heads': 0, 'object': None, 'errors': []}
        if scenario.startswith('old-'):
            # An artifact from a previous invocation exists before any PUT.
            state['object'] = {'x-amz-meta-artifact-upload-id': 'previous-upload',
                               'x-amz-meta-artifact-sha256': '0' * 64,
                               'content-length': '3'}

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def reply(self, status, headers=None):
                self.send_response(status)
                if 'content-length' not in (headers or {}):
                    self.send_header('Content-Length', '0')
                for key, value in (headers or {}).items():
                    self.send_header(key, value)
                self.end_headers()

            def do_PUT(self):
                state['puts'] += 1
                payload = self.rfile.read(int(self.headers['Content-Length']))
                metadata = {key.lower(): value for key, value in self.headers.items()
                            if key.lower().startswith('x-amz-meta-')}
                metadata['content-length'] = str(len(payload))
                if metadata['x-amz-meta-artifact-sha256'] != hashlib.sha256(payload).hexdigest():
                    state['errors'].append('Incorrect payload checksum')
                if bool(self.headers.get('If-None-Match')) == overwrite:
                    state['errors'].append('Incorrect overwrite condition')
                if not self.headers.get('Authorization', '').startswith('AWS4-HMAC-SHA256 '):
                    state['errors'].append('Missing SigV4 authorization')
                if scenario == 'forbidden':
                    self.reply(403)
                    return
                if scenario.startswith('old-') and (state['puts'] == 1 or scenario == 'old-exhausted'):
                    if scenario == 'old-lost-response':
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                    else:
                        self.reply(503)
                    return
                if scenario in ('existing-different', 'existing-identical'):
                    metadata['x-amz-meta-artifact-upload-id'] = 'previous-upload'
                    if scenario == 'existing-different':
                        metadata['x-amz-meta-artifact-sha256'] = '0' * 64
                    state['object'] = metadata
                    self.reply(412)
                    return
                if (state['puts'] == 1 and scenario != 'success') or scenario == 'exhausted':
                    if scenario not in ('lost-before-store', 'transient', 'exhausted'):
                        state['object'] = metadata
                    if scenario == 'wrong-checksum':
                        state['object']['x-amz-meta-artifact-sha256'] = '0' * 64
                    if scenario == 'wrong-size':
                        state['object']['content-length'] = '999'
                    if scenario == 'missing-token':
                        del state['object']['x-amz-meta-artifact-upload-id']
                    if scenario == 'transient':
                        self.reply(503)
                    else:
                        # Consume the entire payload, then drop the response.
                        self.connection.shutdown(socket.SHUT_RDWR)
                        self.connection.close()
                    return
                if state['object'] is not None and not overwrite:
                    self.reply(412)
                    return
                state['object'] = metadata
                self.reply(200)

            def do_HEAD(self):
                state['heads'] += 1
                if scenario == 'head-forbidden':
                    self.reply(403)
                elif state['object'] is None or (scenario == 'late-visible' and state['heads'] == 1):
                    self.reply(404)
                else:
                    self.reply(200, state['object'])

        with tempfile.TemporaryDirectory(prefix='artifact-transfer-') as directory:
            root = Path(directory)
            # Schannel ignores CURL_CA_BUNDLE. An explicit curl config trusts
            # only this test server's certificate without changing OS trust.
            (root / '.curlrc').write_text(
                'cacert = "' + self.cert.as_posix() + '"\n', encoding='utf-8')
            prepared = root / 'prepared'
            prepared.mkdir()
            source = root / 'report.xml'
            source.write_bytes(b'<report>fixture</report>\n')
            for name, value in {'name': 'report.xml', 'format': 'raw', 'source': shell_path(source)}.items():
                (prepared / name).write_text(value, encoding='utf-8')
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            server.socket = self.tls.wrap_socket(server.socket, server_side=True)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            env = dict(os.environ, **{
                'RUNNER_TEMP': shell_path(root), 'ARTIFACT_PREPARED': shell_path(prepared),
                'ARTIFACT_OPERATION': 'upload', 'ARTIFACT_NAME': 'report.xml',
                'ARTIFACT_COMPRESSION': '6', 'ARTIFACT_RETENTION': '0',
                'ARTIFACT_OVERWRITE': str(overwrite).lower(),
                'ARTIFACT_S3_ENDPOINT': f'https://localhost:{server.server_port}',
                'ARTIFACT_S3_BUCKET': 'test', 'ARTIFACT_S3_RETRY_COUNT': str(retries),
                'AWS_ACCESS_KEY_ID': 'test', 'AWS_SECRET_ACCESS_KEY': 'test',
                'AWS_DEFAULT_REGION': 'us-east-1',
                'GITHUB_WORKFLOW_REF': 'owner/repo/.github/workflows/test.yml@refs/heads/main',
                'GITHUB_REPOSITORY': 'owner/repo', 'GITHUB_RUN_NUMBER': '1',
                'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
                'CURL_CA_BUNDLE': shell_path(self.cert), 'NO_PROXY': 'localhost,127.0.0.1',
                'CURL_HOME': shell_path(root),
            })
            try:
                result = subprocess.run([BASH, shell_path(ACTION / 'transfer.sh')],
                                        env=env, capture_output=True, text=True, timeout=30)
            finally:
                server.shutdown()
                server.server_close()
                worker.join()
        self.assertEqual(state['errors'], [])
        return result, state

    def check(self, scenario, success, puts, heads, **kwargs):
        result, state = self.run_upload(scenario, **kwargs)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        self.assertEqual((state['puts'], state['heads']), (puts, heads), result.stdout + result.stderr)

    def test_success(self):
        self.check('success', True, 1, 0)

    def test_lost_response_after_store(self):
        self.check('lost-after-store', True, 1, 1)

    def test_lost_response_with_overwrite(self):
        self.check('lost-after-store', True, 1, 1, overwrite=True)

    def test_retry_after_missing_object(self):
        self.check('lost-before-store', True, 2, 1)

    def test_retry_receives_412_after_delayed_visibility(self):
        self.check('late-visible', True, 2, 2)

    def test_transient_http_retry(self):
        self.check('transient', True, 2, 1)

    def test_overwrite_retries_with_old_object(self):
        for scenario in ('old-transient', 'old-lost-response'):
            with self.subTest(scenario=scenario):
                self.check(scenario, True, 2, 1, overwrite=True, retries=3)

    def test_overwrite_old_object_retry_limit(self):
        self.check('old-exhausted', False, 4, 4, overwrite=True, retries=3)
        self.check('old-transient', False, 1, 1, overwrite=True, retries=0)

    def test_old_object_without_overwrite_fails(self):
        self.check('old-transient', False, 1, 1, retries=3)

    def test_overwrite_current_upload_corruption_fails(self):
        for scenario in ('wrong-checksum', 'wrong-size'):
            with self.subTest(scenario=scenario):
                self.check(scenario, False, 1, 1, overwrite=True, retries=3)

    def test_no_retry_still_verifies_committed_write(self):
        self.check('lost-after-store', True, 1, 1, retries=0)

    def test_no_retry_missing_write_fails(self):
        self.check('exhausted', False, 1, 1, retries=0)

    def test_retry_limit(self):
        self.check('exhausted', False, 2, 2)

    def test_existing_different_object_fails(self):
        self.check('existing-different', False, 1, 1)

    def test_existing_identical_object_still_fails(self):
        self.check('existing-identical', False, 1, 1)

    def test_mismatched_metadata_fails(self):
        for scenario in ('wrong-checksum', 'wrong-size', 'missing-token'):
            with self.subTest(scenario=scenario):
                self.check(scenario, False, 1, 1)

    def test_permission_errors_fail_without_more_puts(self):
        self.check('forbidden', False, 1, 0)
        self.check('head-forbidden', False, 1, 1)


if __name__ == '__main__':
    unittest.main()
