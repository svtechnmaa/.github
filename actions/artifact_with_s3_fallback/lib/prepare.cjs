// @actions/glob is supplied by github-script; no npm installation on the runner.
module.exports = async ({glob, core}) => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const {randomUUID} = require('node:crypto');
  const env = process.env;
  const matcher = await glob.create(env.ARTIFACT_PATH, {
    followSymbolicLinks: true,
    implicitDescendants: true,
    omitBrokenSymbolicLinks: true,
  });
  const roots = matcher.getSearchPaths();
  const relativeInside = (root, file) => {
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return null;
    }
    return relative;
  };
  // glob starts walking at each search root. Hidden ancestors above that root
  // are not visited, but a hidden root itself prevents traversal.
  const visibleFromSearchRoot = file => roots.some(root => {
    const relative = relativeInside(root, file);
    return relative !== null && [path.basename(root), ...relative.split(path.sep)]
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
  let root = roots[0];
  if (roots.length === 1 && files.length === 1 && root === files[0]) {
    root = path.dirname(root);
  } else {
    for (const candidate of roots.slice(1)) {
      while (relativeInside(root, candidate) === null) {
        const parent = path.dirname(root);
        if (parent === root) throw new Error('Upload paths must share a filesystem root');
        root = parent;
      }
    }
  }
  const relativeFiles = files.map(file => {
    const relative = relativeInside(root, file);
    if (!relative) {
      throw new Error('Matched file is outside the artifact root');
    }
    return relative;
  });
  const list = path.join(env.RUNNER_TEMP || os.tmpdir(), 'artifact-files-' + randomUUID());
  const file = await fs.open(list, 'wx', 0o600);
  try {
    try {
      await file.writeFile(relativeFiles.join('\0') + '\0');
    } finally {
      await file.close();
    }
    core.setOutput('file-list', list);
    core.setOutput('root', root);
    core.setOutput('name', name);
  } catch (error) {
    await fs.rm(list, {force: true});
    throw error;
  }
};
