import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SECRET_SIGNATURES = [
  /\bvk1\.[A-Za-z0-9._-]{40,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:VK_GROUP_CAPABILITY_TOKEN|access[_-]?token|api[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{32,}/i,
];

function git(cwd, args, encoding = 'utf8') {
  return spawnSync('git', args, {
    cwd,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function headBlob(cwd, path) {
  const exists = git(cwd, ['cat-file', '-e', `HEAD:${path}`]);
  if (exists.status !== 0) {
    return { missing: true };
  }
  const result = git(cwd, ['show', `HEAD:${path}`], null);
  return result.status === 0 && !result.error
    ? { buffer: result.stdout }
    : { error: true };
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

function binaryNumstatFiles(cwd, range) {
  const result = git(cwd, ['diff', '--numstat', '--no-renames', '-z', range]);
  if (result.status !== 0) {
    return undefined;
  }
  const files = [];
  for (const entry of result.stdout.split('\0').filter(Boolean)) {
    const [added, deleted, ...pathParts] = entry.split('\t');
    if (added === '-' || deleted === '-') {
      files.push(pathParts.join('\t'));
    }
  }
  return files;
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
  const headBlobs = new Map(
    changedFiles.map((path) => [path, headBlob(cwd, path)])
  );
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

  const trackedTmpResult = git(cwd, ['ls-files', '-z', '--', ':(glob).tmp/**']);
  const trackedTmp =
    trackedTmpResult.status === 0 ? nulList(trackedTmpResult.stdout) : [];
  const trackedTmpStatus =
    trackedTmpResult.status === 0 && trackedTmp.length === 0 ? 'PASS' : 'STOP';
  failed ||= trackedTmpStatus === 'STOP';
  writeRecord(stdout, {
    check: 'tracked-tmp',
    status: trackedTmpStatus,
    files: trackedTmp,
  });

  const numstatBinary = binaryNumstatFiles(cwd, range);
  const contentBinary = changedFiles.filter((path) => {
    const blob = headBlobs.get(path);
    if (blob.error) {
      return true;
    }
    if (!blob.buffer) {
      return false;
    }
    const buffer = blob.buffer;
    return buffer.subarray(0, 8192).includes(0) || isKnownImage(buffer);
  });
  const binaryFiles = uniqueSorted([
    ...(numstatBinary || []),
    ...contentBinary,
  ]);
  const binaryStatus =
    numstatBinary !== undefined && binaryFiles.length === 0 ? 'PASS' : 'STOP';
  failed ||= binaryStatus === 'STOP';
  writeRecord(stdout, {
    check: 'binary-or-image-files',
    status: binaryStatus,
    files: binaryFiles,
  });

  const secretFiles = changedFiles.filter((path) => {
    const blob = headBlobs.get(path);
    if (blob.error) {
      return true;
    }
    if (!blob.buffer) {
      return false;
    }
    const content = blob.buffer.toString('utf8');
    return SECRET_SIGNATURES.some((pattern) => pattern.test(content));
  });
  const secretStatus = secretFiles.length === 0 ? 'PASS' : 'STOP';
  failed ||= secretStatus === 'STOP';
  writeRecord(stdout, {
    check: 'secret-signatures',
    status: secretStatus,
    files: uniqueSorted(secretFiles),
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
