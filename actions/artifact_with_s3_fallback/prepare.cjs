// @actions/glob is supplied by github-script; no npm installation on the runner.
module.exports = async ({glob, core}) => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const env = process.env;
  const matcher = await glob.create(env.ARTIFACT_PATH, {
    followSymbolicLinks: true,
    implicitDescendants: true,
    omitBrokenSymbolicLinks: true,
  });
  const files = [];
  for (const file of await matcher.glob()) {
    // github-script@v8 supplies glob 0.4.0, which ignores excludeHiddenFiles.
    // Check every segment, including parents of explicitly matched files.
    const segments = path.relative(process.cwd(), file).split(path.sep);
    if (env.ARTIFACT_HIDDEN !== 'true' && segments.some(segment =>
      segment.startsWith('.') && segment !== '..' && segment !== '.')) continue;
    if ((await fs.stat(file)).isFile()) files.push(file);
  }
  if (files.length === 0) {
    core.setOutput('empty', 'true');
    if (env.ARTIFACT_NO_FILES === 'error') {
      throw new Error('No files matched the artifact upload paths');
    }
    if (env.ARTIFACT_NO_FILES === 'warn') core.warning('No files matched the artifact upload paths');
    return;
  }
  const archive = env.ARTIFACT_ARCHIVE !== 'false';
  if (!archive && files.length !== 1) {
    throw new Error('archive=false requires exactly one matching file');
  }
  const name = archive ? env.ARTIFACT_NAME : path.basename(files[0]);
  // Match the artifact service's forbidden characters and keep S3 segments safe.
  if (!name || /[\\/":<>|*?\x00-\x1f]/.test(name) || name === '.' || name === '..') {
    throw new Error('Invalid artifact name');
  }
  const roots = matcher.getSearchPaths();
  let root = roots[0];
  if (roots.length === 1 && files.length === 1 && root === files[0]) {
    root = path.dirname(root);
  } else {
    for (const candidate of roots.slice(1)) {
      while (true) {
        const relative = path.relative(root, candidate);
        if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) break;
        const parent = path.dirname(root);
        if (parent === root) throw new Error('Upload paths must share a filesystem root');
        root = parent;
      }
    }
  }
  const relativeFiles = files.map(file => {
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Matched file is outside the artifact root');
    }
    return relative;
  });
  const directory = await fs.mkdtemp(path.join(env.RUNNER_TEMP || os.tmpdir(), 'artifact-files-'));
  try {
    await fs.writeFile(path.join(directory, 'files'), relativeFiles.join('\0') + '\0');
    await fs.writeFile(path.join(directory, 'root'), root);
    await fs.writeFile(path.join(directory, 'name'), name);
    await fs.writeFile(path.join(directory, 'format'), archive ? 'archive' : 'raw');
    await fs.writeFile(path.join(directory, 'source'), files[0]);
    core.setOutput('directory', directory);
    core.setOutput('empty', 'false');
  } catch (error) {
    await fs.rm(directory, {recursive: true, force: true});
    throw error;
  }
};
