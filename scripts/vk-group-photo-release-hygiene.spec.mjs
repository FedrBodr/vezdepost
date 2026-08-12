import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runHygieneChecks } from './vk-group-photo-release-hygiene.mjs';

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

  it('refuses to scan a range other than prod...HEAD', async () => {
    const root = await makeRepository();
    let output = '';

    const exitCode = runHygieneChecks({
      cwd: root,
      base: 'feature',
      stdout: { write: (chunk) => (output += String(chunk)) },
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(output)).toEqual({
      check: 'input',
      status: 'STOP',
      files: [],
    });
  });

  it('fails closed when a changed HEAD blob cannot be read safely', async () => {
    const root = await makeRepository();
    await writeFile(join(root, 'oversized.txt'), 'x'.repeat(17 * 1024 * 1024));
    git(root, 'add', 'oversized.txt');
    git(root, 'commit', '-qm', 'oversized change');
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
