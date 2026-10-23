const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const prepare = require('../prepare.cjs');

for (const hidden of ['false', 'true']) {
  for (const explicit of [false, true]) {
    test(`hidden=${hidden}, explicit files=${explicit}`, async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-test-'));
      const saved = {...process.env};
      try {
        const names = ['report.xml', '.env', '.credentials/config', 'visible/.nested/config', 'visible/result.xml'];
        for (const name of names) {
          const target = path.join(root, name);
          await fs.mkdir(path.dirname(target), {recursive: true});
          await fs.writeFile(target, 'fixture');
        }
        const matches = names.map(name => path.join(root, name));
        Object.assign(process.env, {
          ARTIFACT_PATH: explicit ? matches.join('\n') : root,
          ARTIFACT_HIDDEN: hidden, ARTIFACT_ARCHIVE: 'true',
          ARTIFACT_NAME: 'report', ARTIFACT_NO_FILES: 'error', RUNNER_TEMP: root,
        });
        const outputs = {};
        // Model glob 0.4.0: return hidden files regardless of the options.
        await prepare({
          glob: {create: async () => ({
            glob: async () => matches,
            getSearchPaths: () => explicit ? matches : [root],
          })},
          core: {setOutput: (key, value) => { outputs[key] = value; }},
        });
        const files = (await fs.readFile(path.join(outputs.directory, 'files'), 'utf8'))
          .split('\0').filter(Boolean).map(name => name.split(path.sep).join('/'));
        assert.deepEqual(files, hidden === 'true' ? names : ['report.xml', 'visible/result.xml']);
      } finally {
        process.env = saved;
        await fs.rm(root, {recursive: true, force: true});
      }
    });
  }
}

test('hidden-only input follows if-no-files-found=error', async () => {
  const saved = {...process.env};
  Object.assign(process.env, {ARTIFACT_PATH: '.env', ARTIFACT_HIDDEN: 'false', ARTIFACT_NO_FILES: 'error'});
  try {
    await assert.rejects(prepare({
      glob: {create: async () => ({glob: async () => [path.resolve('.env')]})},
      core: {setOutput: () => {}},
    }), /No files matched/);
  } finally {
    process.env = saved;
  }
});
