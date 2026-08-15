import { execFileSync } from 'node:child_process';
import {
  copyFile,
  mkdtemp,
  mkdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseRawDiff,
  runHygieneChecks,
} from './vk-group-photo-release-hygiene.mjs';

const roots = [];

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function makeRepository() {
  const root = await mkdtemp(join(tmpdir(), 'vk-hygiene-test-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Capability Test');
  git(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(root, 'base.txt'), 'base\n');
  git(root, 'add', 'base.txt');
  git(root, 'commit', '-qm', 'base');
  git(root, 'branch', 'prod');
  git(root, 'checkout', '-qb', 'feature');
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('VK Group photo release hygiene', () => {
  it('fails closed on raw diff output after the terminal NUL', () => {
    expect(
      parseRawDiff(':100644 100644 aaaaaaa bbbbbbb M\0safe.txt\0\0trailing')
    ).toEqual({ error: true, entries: [] });
  });

  it('passes a text-only branch diff and reports its exact changed-file set', async () => {
    const root = await makeRepository();
    await writeFile(join(root, 'safe.txt'), 'safe release content\n');
    await unlink(join(root, 'base.txt'));
    git(root, 'add', '--all');
    git(root, 'commit', '-qm', 'safe change');
    let output = '';

    const exitCode = runHygieneChecks({
      cwd: root,
      base: 'prod',
      stdout: { write: (chunk) => (output += String(chunk)) },
    });

    expect(exitCode).toBe(0);
    const records = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records).toContainEqual({
      check: 'changed-files',
      status: 'PASS',
      files: ['base.txt', 'safe.txt'],
    });
    expect(records).toContainEqual({
      check: 'binary-or-image-files',
      status: 'PASS',
      files: [],
    });
    expect(records).toContainEqual({
      check: 'secret-signatures',
      status: 'PASS',
      files: [],
    });
  });

  it('fails safely with filenames only for tracked tmp, binary, and secrets', async () => {
    const root = await makeRepository();
    await mkdir(join(root, '.tmp'));
    await writeFile(join(root, '.tmp', 'tracked.txt'), 'tracked temp\n');
    await writeFile(
      join(root, 'binary-without-image-extension'),
      Buffer.from('GIF89asynthetic-image-without-nul', 'ascii')
    );
    const secret = `vk1.${'a'.repeat(64)}`;
    await writeFile(
      join(root, 'credentials.txt'),
      `VK_GROUP_CAPABILITY_TOKEN=${secret}\n`
    );
    git(
      root,
      'add',
      '.tmp',
      'binary-without-image-extension',
      'credentials.txt'
    );
    git(root, 'commit', '-qm', 'unsafe change');
    await writeFile(
      join(root, 'binary-without-image-extension'),
      'safe text\n'
    );
    await writeFile(join(root, 'credentials.txt'), 'safe replacement\n');
    let output = '';

    const exitCode = runHygieneChecks({
      cwd: root,
      base: 'prod',
      stdout: { write: (chunk) => (output += String(chunk)) },
    });

    expect(exitCode).toBe(2);
    const records = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records).toContainEqual({
      check: 'tracked-tmp',
      status: 'STOP',
      files: ['.tmp/tracked.txt'],
    });
    expect(records).toContainEqual({
      check: 'binary-or-image-files',
      status: 'STOP',
      files: ['binary-without-image-extension'],
    });
    expect(records).toContainEqual({
      check: 'secret-signatures',
      status: 'STOP',
      files: ['credentials.txt'],
    });
    expect(output).not.toContain(secret);
    expect(output).not.toContain('VK_GROUP_CAPABILITY_TOKEN=');
  });

  it.each([
    ['legacy plain', 'VK_GROUP_CAPABILITY_TOKEN', false],
    ['user OAuth plain', 'VK_GROUP_CAPABILITY_USER_TOKEN', false],
    ['legacy quoted', 'VK_GROUP_CAPABILITY_TOKEN', true],
    ['user OAuth quoted', 'VK_GROUP_CAPABILITY_USER_TOKEN', true],
  ])(
    'detects and redacts the %s environment assignment in history',
    async (label, environmentName, quoted) => {
      const root = await makeRepository();
      const secret = `${label.replaceAll(' ', '-')}-token-${'a'.repeat(40)}`;
      const assignedValue = quoted ? `'${secret}'` : secret;
      await writeFile(
        join(root, 'capability-token.env'),
        `${environmentName}=${assignedValue}\n`
      );
      git(root, 'add', 'capability-token.env');
      git(root, 'commit', '-qm', `introduce ${label} token assignment`);
      await writeFile(join(root, 'capability-token.env'), 'safe replacement\n');
      let output = '';

      const exitCode = runHygieneChecks({
        cwd: root,
        base: 'prod',
        stdout: { write: (chunk) => (output += String(chunk)) },
      });

      expect(exitCode).toBe(2);
      expect(
        output
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      ).toContainEqual({
        check: 'secret-signatures',
        status: 'STOP',
        files: ['capability-token.env'],
      });
      expect(output).not.toContain(secret);
      expect(output).not.toContain(`${environmentName}=`);
    }
  );

  it('does not treat a source object mapping as a literal token assignment', async () => {
    const root = await makeRepository();
    await writeFile(
      join(root, 'config.mjs'),
      [
        'export function capabilityConfig(env) {',
        '  return {',
        '    accessToken: env.VK_GROUP_CAPABILITY_USER_TOKEN,',
        '  };',
        '}',
        '',
      ].join('\n')
    );
    git(root, 'add', 'config.mjs');
    git(root, 'commit', '-qm', 'add safe environment reference');
    let output = '';

    const exitCode = runHygieneChecks({
      cwd: root,
      base: 'prod',
      stdout: { write: (chunk) => (output += String(chunk)) },
    });

    expect(exitCode).toBe(0);
    expect(
      output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toContainEqual({
      check: 'secret-signatures',
      status: 'PASS',
      files: [],
    });
  });

  it('emits exactly one terminal GO after all safe checks pass', async () => {
    const root = await makeRepository();
    await writeFile(join(root, 'safe.txt'), 'safe release content\n');
    git(root, 'add', 'safe.txt');
    git(root, 'commit', '-qm', 'safe change');
    let output = '';

    expect(
      runHygieneChecks({
        cwd: root,
        base: 'prod',
        stdout: { write: (chunk) => (output += String(chunk)) },
      })
    ).toBe(0);
    const records = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const terminalRecords = records.filter(
      (record) => record.check === 'terminal'
    );

    expect(terminalRecords).toEqual([{ check: 'terminal', status: 'GO' }]);
    expect(records.at(-1)).toEqual({ check: 'terminal', status: 'GO' });
  });

  it('emits exactly one terminal STOP after a check stops', async () => {
    const root = await makeRepository();
    await writeFile(join(root, 'unsafe.txt'), 'trailing whitespace  \n');
    git(root, 'add', 'unsafe.txt');
    git(root, 'commit', '-qm', 'unsafe change');
    let output = '';

    expect(
      runHygieneChecks({
        cwd: root,
        base: 'prod',
        stdout: { write: (chunk) => (output += String(chunk)) },
      })
    ).toBe(2);
    const records = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const terminalRecords = records.filter(
      (record) => record.check === 'terminal'
    );

    expect(terminalRecords).toEqual([{ check: 'terminal', status: 'STOP' }]);
    expect(records.at(-1)).toEqual({ check: 'terminal', status: 'STOP' });
  });

  it('scans secret and image blobs that branch history later deletes', async () => {
    const root = await makeRepository();
    const secret = `vk1.${'a'.repeat(64)}`;
    await writeFile(join(root, 'deleted-secret.txt'), secret);
    await writeFile(
      join(root, 'deleted-image.data'),
      Buffer.from('GIF89asynthetic-image-without-nul', 'ascii')
    );
    git(root, 'add', 'deleted-secret.txt', 'deleted-image.data');
    git(root, 'commit', '-qm', 'introduce unsafe history');
    await unlink(join(root, 'deleted-secret.txt'));
    await unlink(join(root, 'deleted-image.data'));
    git(root, 'add', '--all');
    git(root, 'commit', '-qm', 'delete unsafe history');
    let output = '';

    const exitCode = runHygieneChecks({
      cwd: root,
      stdout: { write: (chunk) => (output += String(chunk)) },
    });

    expect(exitCode).toBe(2);
    const records = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records).toContainEqual({
      check: 'binary-or-image-files',
      status: 'STOP',
      files: ['deleted-image.data'],
    });
    expect(records).toContainEqual({
      check: 'secret-signatures',
      status: 'STOP',
      files: ['deleted-secret.txt'],
    });
    expect(output).not.toContain(secret);
  });

  it('rejects historical tracked tmp and a binary with a late NUL', async () => {
    const root = await makeRepository();
    await mkdir(join(root, '.tmp'));
    await writeFile(join(root, '.tmp', 'deleted.txt'), 'temporary data\n');
    await writeFile(
      join(root, 'late-nul.data'),
      Buffer.concat([
        Buffer.alloc(9000, 0x61),
        Buffer.from([0]),
        Buffer.from('z'),
      ])
    );
    git(root, 'add', '.tmp/deleted.txt', 'late-nul.data');
    git(root, 'commit', '-qm', 'introduce temp and late binary');
    await unlink(join(root, '.tmp', 'deleted.txt'));
    git(root, 'add', '--all');
    git(root, 'commit', '-qm', 'delete historical temp');
    let output = '';

    const exitCode = runHygieneChecks({
      cwd: root,
      stdout: { write: (chunk) => (output += String(chunk)) },
    });

    expect(exitCode).toBe(2);
    const records = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records).toContainEqual({
      check: 'tracked-tmp',
      status: 'STOP',
      files: ['.tmp/deleted.txt'],
    });
    expect(records).toContainEqual({
      check: 'binary-or-image-files',
      status: 'STOP',
      files: ['late-nul.data'],
    });
  });

  it('handles rename, copy, and legitimate deletion semantics', async () => {
    const root = await makeRepository();
    await writeFile(join(root, 'rename-source.txt'), 'safe rename\n');
    git(root, 'add', 'rename-source.txt');
    git(root, 'commit', '-qm', 'add rename source');
    await rename(
      join(root, 'rename-source.txt'),
      join(root, 'renamed-safe.txt')
    );
    await copyFile(
      join(root, 'renamed-safe.txt'),
      join(root, 'copied-safe.txt')
    );
    git(root, 'add', '--all');
    git(root, 'commit', '-qm', 'rename and copy safe content');
    await unlink(join(root, 'base.txt'));
    git(root, 'add', '--all');
    git(root, 'commit', '-qm', 'legitimate deletion');
    let output = '';

    const exitCode = runHygieneChecks({
      cwd: root,
      stdout: { write: (chunk) => (output += String(chunk)) },
    });

    expect(exitCode).toBe(0);
    const records = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records).toContainEqual({
      check: 'binary-or-image-files',
      status: 'PASS',
      files: [],
    });
    expect(records).toContainEqual({
      check: 'secret-signatures',
      status: 'PASS',
      files: [],
    });
  });

  it('refuses to scan a range other than prod...HEAD', async () => {
    const root = await makeRepository();
    let output = '';

    const exitCode = runHygieneChecks({
      cwd: root,
      base: 'feature',
      stdout: { write: (chunk) => (output += String(chunk)) },
    });

    expect(exitCode).toBe(2);
    expect(
      output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toEqual([
      { check: 'input', status: 'STOP', files: [] },
      { check: 'terminal', status: 'STOP' },
    ]);
  });

  it('fails closed when a changed HEAD blob cannot be read safely', async () => {
    const root = await makeRepository();
    await writeFile(join(root, 'oversized.txt'), 'x'.repeat(17 * 1024 * 1024));
    git(root, 'add', 'oversized.txt');
    git(root, 'commit', '-qm', 'oversized change');
    await unlink(join(root, 'oversized.txt'));
    git(root, 'add', '--all');
    git(root, 'commit', '-qm', 'delete unreadable historical blob');
    let output = '';

    const exitCode = runHygieneChecks({
      cwd: root,
      stdout: { write: (chunk) => (output += String(chunk)) },
    });

    expect(exitCode).toBe(2);
    const records = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records).toContainEqual({
      check: 'binary-or-image-files',
      status: 'STOP',
      files: ['oversized.txt'],
    });
    expect(records).toContainEqual({
      check: 'secret-signatures',
      status: 'STOP',
      files: ['oversized.txt'],
    });
    expect(output).not.toContain('xxxxxxxxxxxxxxxx');
  });
});
