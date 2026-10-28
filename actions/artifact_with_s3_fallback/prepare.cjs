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
  const roots = matcher.getSearchPaths();
  // glob starts walking at each search root. Hidden ancestors above that root
  // are not visited, but a hidden root itself prevents traversal.
  const visibleFromSearchRoot = file => roots.some(root => {
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
    return [path.basename(root), ...relative.split(path.sep)]
      .every(segment => !segment.startsWith('.'));
  });
  const files = [];
  for (const file of await matcher.glob()) {
    // github-script@v8 supplies glob 0.4.0, which ignores excludeHiddenFiles.
    if (env.ARTIFACT_HIDDEN !== 'true' && !visibleFromSearchRoot(file)) continue;
    if ((await fs.stat(file)).isFile()) files.push(file);
  }
  if (files.length === 0) {
    // This resolver runs only after GitHub upload failed. Do not turn that
    // failure into success without storing an artifact in either backend.
    throw new Error('No files matched the artifact upload paths after GitHub upload failed; S3 fallback cannot recover the artifact');
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
