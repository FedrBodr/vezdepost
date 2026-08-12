import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SECRET_SIGNATURES = [
  /\bvk1\.[A-Za-z0-9._-]{40,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:VK_GROUP_CAPABILITY_(?:USER_)?TOKEN|access[_-]?token|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{32,}/i,
];

function git(cwd, args, encoding = 'utf8') {
  return spawnSync('git', args, {
    cwd,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function nulList(value) {
  return value.split('\0').filter(Boolean).sort();
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function isKnownImage(buffer) {
  return (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
    buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
    buffer.subarray(0, 6).toString('ascii') === 'GIF89a' ||
    (buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP') ||
    buffer.subarray(0, 2).toString('ascii') === 'BM' ||
    ['II*\u0000', 'MM\u0000*'].includes(
      buffer.subarray(0, 4).toString('binary')
    )
  );
}

export function parseRawDiff(raw) {
  const tokens = raw.split('\0');
  const entries = [];
  let index = 0;
  while (index < tokens.length - 1) {
    if (!tokens[index]) {
      return { error: true, entries: [] };
    }
    const header = tokens[index++];
    const match = header.match(
      /^:\d{6} \d{6} [0-9a-f]+ ([0-9a-f]+) ([A-Z])\d*$/
    );
    if (!match) {
      return { error: true, entries: [] };
    }
    const [, blobId, status] = match;
    const firstPath = tokens[index++];
    const destinationPath = ['R', 'C'].includes(status)
      ? tokens[index++]
      : firstPath;
    if (!destinationPath) {
      return { error: true, entries: [] };
    }
    if (status !== 'D') {
      entries.push({ path: destinationPath, blobId });
    }
  }
  if (index !== tokens.length - 1 || tokens[index] !== '') {
    return { error: true, entries: [] };
  }
  return { error: false, entries };
}

function changedBlobEntries(cwd, commit, parent) {
  const result = git(
    cwd,
    [
      'diff-tree',
      '--no-commit-id',
      '--raw',
      '-r',
      '-z',
      '-M',
      '-C',
      parent,
      commit,
    ],
    'utf8'
  );
  if (result.status !== 0 || result.error) {
    return { error: true, entries: [] };
  }
  return parseRawDiff(result.stdout);
}

function branchHistoryBlobs(cwd, base) {
  const commitsResult = git(cwd, ['rev-list', '--reverse', `${base}..HEAD`]);
  if (commitsResult.status !== 0 || commitsResult.error) {
    return { error: true, blobs: [] };
  }

  const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
  const entries = [];
  for (const commit of commitsResult.stdout.split('\n').filter(Boolean)) {
    const parentsResult = git(cwd, [
      'rev-list',
      '--parents',
      '-n',
      '1',
      commit,
    ]);
    if (parentsResult.status !== 0 || parentsResult.error) {
      return { error: true, blobs: [] };
    }
    const [, firstParent] = parentsResult.stdout.trim().split(/\s+/);
    const changed = changedBlobEntries(cwd, commit, firstParent || emptyTree);
    if (changed.error) {
      return { error: true, blobs: [] };
    }
    entries.push(...changed.entries);
  }

  const blobCache = new Map();
  const blobs = entries.map(({ path, blobId }) => {
    if (!blobCache.has(blobId)) {
      const result = git(cwd, ['cat-file', 'blob', blobId], null);
      blobCache.set(
        blobId,
        result.status === 0 && !result.error
          ? { buffer: result.stdout }
          : { error: true }
      );
    }
    return { path, ...blobCache.get(blobId) };
  });
  return { error: false, blobs };
}

function unsafeBlobFiles(history, predicate) {
  if (history.error) {
    return { error: true, files: [] };
  }
  return {
    error: false,
    files: uniqueSorted(
      history.blobs
        .filter(({ buffer, error }) => error || predicate(buffer))
        .map(({ path }) => path)
    ),
  };
}

function writeRecord(stdout, record) {
  stdout.write(`${JSON.stringify(record)}\n`);
}

export function runHygieneChecks({
  cwd = process.cwd(),
  base = 'prod',
  stdout = process.stdout,
} = {}) {
  if (base !== 'prod') {
    writeRecord(stdout, { check: 'input', status: 'STOP', files: [] });
    return 2;
  }

  const range = `${base}...HEAD`;
  const changedResult = git(cwd, ['diff', '--name-only', '-z', range]);
  if (changedResult.status !== 0) {
    writeRecord(stdout, { check: 'changed-files', status: 'STOP', files: [] });
    return 2;
  }
  const changedFiles = nulList(changedResult.stdout);
  const history = branchHistoryBlobs(cwd, base);
  writeRecord(stdout, {
    check: 'changed-files',
    status: 'PASS',
    files: changedFiles,
  });

  let failed = false;
  const whitespace = git(cwd, ['diff', '--check', range]);
  const whitespaceFiles = uniqueSorted(
    whitespace.stdout
      .split('\n')
      .filter((line) => /^[^+\s].*:\d+:/.test(line))
      .map((line) => line.slice(0, line.indexOf(':')))
  );
  const whitespaceStatus = whitespace.status === 0 ? 'PASS' : 'STOP';
  failed ||= whitespaceStatus === 'STOP';
  writeRecord(stdout, {
    check: 'whitespace',
    status: whitespaceStatus,
    files: whitespaceFiles,
  });

  const trackedTmp = uniqueSorted(
    history.blobs
      .map(({ path }) => path)
      .filter((path) => path === '.tmp' || path.startsWith('.tmp/'))
  );
  const trackedTmpStatus =
    !history.error && trackedTmp.length === 0 ? 'PASS' : 'STOP';
  failed ||= trackedTmpStatus === 'STOP';
  writeRecord(stdout, {
    check: 'tracked-tmp',
    status: trackedTmpStatus,
    files: trackedTmp,
  });

  const binary = unsafeBlobFiles(
    history,
    (buffer) => buffer.includes(0) || isKnownImage(buffer)
  );
  const binaryStatus =
    !binary.error && binary.files.length === 0 ? 'PASS' : 'STOP';
  failed ||= binaryStatus === 'STOP';
  writeRecord(stdout, {
    check: 'binary-or-image-files',
    status: binaryStatus,
    files: binary.files,
  });

  const secrets = unsafeBlobFiles(history, (buffer) => {
    const content = buffer.toString('utf8');
    return SECRET_SIGNATURES.some((pattern) => pattern.test(content));
  });
  const secretStatus =
    !secrets.error && secrets.files.length === 0 ? 'PASS' : 'STOP';
  failed ||= secretStatus === 'STOP';
  writeRecord(stdout, {
    check: 'secret-signatures',
    status: secretStatus,
    files: secrets.files,
  });

  return failed ? 2 : 0;
}

function cliBase(args) {
  if (args.length === 0) {
    return 'prod';
  }
  return args.length === 2 && args[0] === '--base' ? args[1] : undefined;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const base = cliBase(process.argv.slice(2));
  process.exitCode = base
    ? runHygieneChecks({ base })
    : (writeRecord(process.stdout, {
        check: 'input',
        status: 'STOP',
        files: [],
      }),
      2);
}
