import {
  mkdtemp,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runCapabilityCheck,
  terminateForSignal,
} from './vk-group-photo-capability-check.mjs';

const roots = [];

async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'vk-capability-test-'));
  roots.push(root);
  const mediaFile = join(root, 'synthetic.png');
  await writeFile(mediaFile, Buffer.from('synthetic-image'));
  let output = '';

  return {
    root,
    mediaFile,
    stdout: {
      write(chunk) {
        output += String(chunk);
        return true;
      },
    },
    output: () => output,
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function parseRecords(output) {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function successfulFetch(
  fixture,
  {
    wallDeleteErrorCode,
    wallDeleteHttpStatus = 200,
    wallDeleteMalformed,
    wallPostTransport = false,
    saveMalformed = false,
    uploadErrorCode,
    removeMediaAfterUploadServer = false,
    photoRemains = false,
    savedOwnerId = -123,
    saveExtraPhoto = false,
    verifyErrorCode,
    verifiedPostId = 789,
    verifiedMessage,
    verifiedAttachments,
  } = {}
) {
  let wallGetCount = 0;
  let publishedMessage;
  const methods = [];
  const fetchImpl = vi.fn(async (url, options) => {
    expect(url).not.toContain('private-community-token');
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const method = url.startsWith('https://api.vk.com/method/')
      ? url.slice('https://api.vk.com/method/'.length)
      : 'upload';
    methods.push(method);

    if (method !== 'upload') {
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get('access_token')).toBe('private-community-token');
      expect(options.body.get('v')).toBe('5.251');
    }

    switch (method) {
      case 'photos.getWallUploadServer':
        expect(options.body.get('group_id')).toBe('123');
        if (removeMediaAfterUploadServer) {
          await unlink(fixture.mediaFile);
        }
        return jsonResponse({
          response: { upload_url: 'https://upload.invalid/private-session' },
        });
      case 'upload': {
        expect(url).toBe('https://upload.invalid/private-session');
        expect(options.body).toBeInstanceOf(FormData);
        expect(options.body.get('photo')).toBeInstanceOf(Blob);
        const entries = await readdir(fixture.root);
        const workspaceName = entries.find((entry) =>
          entry.startsWith('vk-group-photo-capability-')
        );
        expect(workspaceName).toBeTruthy();
        const workspace = join(fixture.root, workspaceName);
        expect((await stat(workspace)).mode & 0o777).toBe(0o700);
        const rawFiles = await readdir(workspace);
        expect(rawFiles).toHaveLength(1);
        expect((await stat(join(workspace, rawFiles[0]))).mode & 0o777).toBe(
          0o600
        );
        return uploadErrorCode
          ? jsonResponse({
              error: {
                error_code: uploadErrorCode,
                error_msg: 'private upload rejection',
              },
            })
          : jsonResponse({
              photo: 'private-upload-photo',
              server: 321,
              hash: 'private-upload-hash',
            });
      }
      case 'photos.saveWallPhoto':
        expect(options.body.get('group_id')).toBe('123');
        expect(options.body.get('photo')).toBe('private-upload-photo');
        expect(options.body.get('server')).toBe('321');
        expect(options.body.get('hash')).toBe('private-upload-hash');
        return jsonResponse({
          response: saveMalformed
            ? []
            : [
                { owner_id: savedOwnerId, id: 456 },
                ...(saveExtraPhoto ? [{ owner_id: -123, id: 457 }] : []),
              ],
        });
      case 'wall.post':
        expect(options.body.get('owner_id')).toBe('-123');
        expect(options.body.get('from_group')).toBe('1');
        expect(options.body.get('attachments')).toBe('photo-123_456');
        publishedMessage = options.body.get('message');
        expect(publishedMessage).toMatch(
          /^Vezdepost VK Group photo capability check [0-9a-f-]{36}$/
        );
        if (wallPostTransport) {
          throw new Error('lost wall.post response with private details');
        }
        return jsonResponse({ response: { post_id: 789 } });
      case 'wall.getById':
        wallGetCount += 1;
        expect(options.body.get('posts')).toBe('-123_789');
        if (wallGetCount === 1 && verifyErrorCode) {
          return jsonResponse({
            error: {
              error_code: verifyErrorCode,
              error_msg: 'private verification response',
            },
          });
        }
        return wallGetCount === 1
          ? jsonResponse({
              response: {
                items: [
                  {
                    id: verifiedPostId,
                    owner_id: -123,
                    from_id: -123,
                    text: verifiedMessage ?? publishedMessage,
                    attachments: verifiedAttachments ?? [
                      {
                        type: 'photo',
                        photo: { owner_id: -123, id: 456 },
                      },
                    ],
                  },
                ],
              },
            })
          : jsonResponse({ response: { items: [] } });
      case 'wall.delete':
        expect(options.body.get('owner_id')).toBe('-123');
        expect(options.body.get('post_id')).toBe('789');
        return wallDeleteMalformed
          ? jsonResponse(
              { response: wallDeleteMalformed },
              wallDeleteHttpStatus
            )
          : wallDeleteErrorCode
          ? jsonResponse({
              error: {
                error_code: wallDeleteErrorCode,
                error_msg: 'private cleanup message',
              },
            })
          : jsonResponse({ response: 1 }, wallDeleteHttpStatus);
      case 'photos.delete':
        expect(options.body.get('owner_id')).toBe('-123');
        expect(options.body.get('photo_id')).toBe('456');
        return jsonResponse({ response: 1 });
      case 'photos.getById':
        expect(options.body.get('photos')).toBe('-123_456');
        return jsonResponse({
          response: photoRemains ? [{ owner_id: -123, id: 456 }] : [],
        });
      default:
        throw new Error(`Unexpected method ${method}`);
    }
  });

  return { fetchImpl, methods };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('VK Group photo capability check', () => {
  it('stops before network access without explicit authorization', async () => {
    const fixture = await makeFixture();
    const fetchImpl = vi.fn();

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: { VK_GROUP_CAPABILITY_TOKEN: 'private-community-token' },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fixture.output()).toBe(
      `${JSON.stringify({ phase: 'preflight', status: 'STOP' })}\n`
    );
    expect(await readdir(fixture.root)).toEqual(['synthetic.png']);
    expect(fixture.output()).not.toContain('private-community-token');
  });

  it('rejects a token argument before network access without echoing it', async () => {
    const fixture = await makeFixture();
    const fetchImpl = vi.fn();

    const exitCode = await runCapabilityCheck({
      args: [
        '--group-id',
        '123',
        '--media-file',
        fixture.mediaFile,
        '--token',
        'private-community-token',
      ],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fixture.output()).toBe(
      `${JSON.stringify({ phase: 'preflight', status: 'STOP' })}\n`
    );
    expect(fixture.output()).not.toContain('private-community-token');
  });

  it('records only method and numeric code for a VK pre-publication failure', async () => {
    const fixture = await makeFixture();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            error_code: 15,
            error_msg: 'upstream-private-message',
            request_params: [{ value: 'private-community-token' }],
          },
        })
      )
    );

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fixture.output()).toBe(
      `${JSON.stringify({
        phase: 'upload-server',
        method: 'photos.getWallUploadServer',
        error_code: 15,
        status: 'STOP',
      })}\n`
    );
    expect(fixture.output()).not.toContain('upstream-private-message');
    expect(fixture.output()).not.toContain('private-community-token');
    expect(await readdir(fixture.root)).toEqual(['synthetic.png']);
  });

  it('omits an error code and caught details for a transport failure', async () => {
    const fixture = await makeFixture();
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(
        new Error('transport private-community-token https://private.invalid')
      );

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const record = JSON.parse(fixture.output());
    expect(record).toEqual({
      phase: 'upload-server',
      method: 'photos.getWallUploadServer',
      status: 'STOP',
    });
    expect(record).not.toHaveProperty('error_code');
    expect(fixture.output()).not.toContain('private-community-token');
    expect(fixture.output()).not.toContain('private.invalid');
    expect(await readdir(fixture.root)).toEqual(['synthetic.png']);
  });

  it('does not coerce a nonnumeric VK error code into durable evidence', async () => {
    const fixture = await makeFixture();
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        error: {
          error_code: null,
          error_msg: 'private upstream message',
        },
      })
    );

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(fixture.output())).toEqual({
      phase: 'upload-server',
      method: 'photos.getWallUploadServer',
      status: 'STOP',
    });
    expect(fixture.output()).not.toContain('private upstream message');
  });

  it('retains a numeric upload error code without upstream details', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      uploadErrorCode: 15,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(methods).toEqual(['photos.getWallUploadServer', 'upload']);
    expect(JSON.parse(fixture.output())).toEqual({
      phase: 'upload',
      method: 'upload',
      error_code: 15,
      status: 'STOP',
    });
    expect(fixture.output()).not.toContain('private upload rejection');
  });

  it('emits GO only after authorship and cleanup absence are verified', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture);

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(0);
    expect(methods).toEqual([
      'photos.getWallUploadServer',
      'upload',
      'photos.saveWallPhoto',
      'wall.post',
      'wall.getById',
      'wall.delete',
      'photos.delete',
      'wall.getById',
      'photos.getById',
    ]);
    const records = parseRecords(fixture.output());
    expect(records.at(-1)).toEqual({
      phase: 'complete',
      status: 'GO',
      post_id: 789,
    });
    expect(typeof records.at(-1).post_id).toBe('number');
    expect(records.map(({ method }) => method).filter(Boolean)).toEqual(
      methods
    );
    expect(fixture.output()).not.toContain('private-community-token');
    expect(fixture.output()).not.toContain('private-session');
    expect(fixture.output()).not.toContain('private-upload');
    expect(await readdir(fixture.root)).toEqual(['synthetic.png']);
  });

  it.each([
    ['a stale post id', { verifiedPostId: 788 }],
    ['a wrong marker message', { verifiedMessage: 'unrelated post' }],
    [
      'a wrong photo attachment',
      {
        verifiedAttachments: [
          { type: 'photo', photo: { owner_id: -123, id: 999 } },
        ],
      },
    ],
    [
      'an extra attachment',
      {
        verifiedAttachments: [
          { type: 'photo', photo: { owner_id: -123, id: 456 } },
          { type: 'photo', photo: { owner_id: -123, id: 999 } },
        ],
      },
    ],
  ])(
    'never deletes an ambiguous post with %s',
    async (_description, verificationOverride) => {
      const fixture = await makeFixture();
      const { fetchImpl, methods } = successfulFetch(
        fixture,
        verificationOverride
      );

      const exitCode = await runCapabilityCheck({
        args: ['--group-id', '123', '--media-file', fixture.mediaFile],
        env: {
          VK_GROUP_CAPABILITY_AUTHORIZED: '1',
          VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
        },
        fetchImpl,
        stdout: fixture.stdout,
        tempRoot: fixture.root,
      });

      expect(exitCode).toBe(3);
      expect(methods).not.toContain('wall.delete');
      expect(methods).toContain('photos.delete');
      expect(parseRecords(fixture.output()).at(-1)).toMatchObject({
        phase: 'verify-authorship',
        method: 'wall.getById',
        status: 'PENDING_CLEANUP',
      });
      expect(parseRecords(fixture.output())).not.toContainEqual(
        expect.objectContaining({ status: 'GO' })
      );
    }
  );

  it('treats failed setup-directory removal as pending local cleanup', async () => {
    const fixture = await makeFixture();
    const fetchImpl = vi.fn();
    const removeWorkspaceImpl = vi
      .fn()
      .mockRejectedValue(new Error('private setup directory'));

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
      chmodWorkspaceImpl: vi.fn().mockRejectedValue(new Error('private mode')),
      removeWorkspaceImpl,
    });

    expect(exitCode).toBe(4);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(removeWorkspaceImpl).toHaveBeenCalledOnce();
    expect(parseRecords(fixture.output())).toEqual([
      { phase: 'local-cleanup', status: 'PENDING_LOCAL_CLEANUP' },
    ]);
    expect(fixture.output()).not.toContain(fixture.root);
    expect(fixture.output()).not.toContain('private setup');
  });

  it('reports signal cleanup failure safely without a path or raw exception', async () => {
    const fixture = await makeFixture();
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        error: { error_code: 15, error_msg: 'private upstream response' },
      })
    );
    await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
      removeWorkspaceImpl: vi.fn().mockRejectedValue(new Error('private path')),
    });
    let signalOutput = '';
    const exitImpl = vi.fn();

    terminateForSignal({
      signal: 'SIGTERM',
      exitImpl,
      writeSyncImpl: vi.fn((_fd, chunk) => {
        signalOutput += String(chunk);
      }),
      removeWorkspaceSyncImpl: vi.fn(() => {
        throw new Error('private signal cleanup path');
      }),
    });

    expect(exitImpl).toHaveBeenCalledWith(4);
    expect(parseRecords(signalOutput)).toEqual([
      { phase: 'local-cleanup', status: 'PENDING_LOCAL_CLEANUP' },
    ]);
    expect(signalOutput).not.toContain(fixture.root);
    expect(signalOutput).not.toContain('private signal');
  });

  it('uses the conventional signal exit after all private workspaces are removed', () => {
    let signalOutput = '';
    const exitImpl = vi.fn();
    const writeSyncImpl = vi.fn((_fd, chunk) => {
      signalOutput += String(chunk);
    });

    terminateForSignal({
      signal: 'SIGINT',
      exitImpl,
      writeSyncImpl,
      removeWorkspaceSyncImpl: vi.fn(),
    });

    expect(exitImpl).toHaveBeenCalledWith(130);
    expect(writeSyncImpl).not.toHaveBeenCalled();
    expect(signalOutput).toBe('');
  });

  it('exits safely when signal cleanup and the fixed stdout write both fail', async () => {
    const fixture = await makeFixture();
    await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl: vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: { error_code: 15 } })),
      stdout: fixture.stdout,
      tempRoot: fixture.root,
      removeWorkspaceImpl: vi.fn().mockRejectedValue(new Error('private path')),
    });
    const exitImpl = vi.fn();

    expect(() =>
      terminateForSignal({
        signal: 'SIGTERM',
        exitImpl,
        removeWorkspaceSyncImpl: vi.fn(() => {
          throw new Error('private cleanup path');
        }),
        writeSyncImpl: vi.fn(() => {
          throw new Error('private broken stdout');
        }),
      })
    ).not.toThrow();

    expect(exitImpl).toHaveBeenCalledWith(4);
  });

  it('never stores or deletes a saved photo owned by another target', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      savedOwnerId: -999,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).toEqual([
      'photos.getWallUploadServer',
      'upload',
      'photos.saveWallPhoto',
    ]);
    expect(parseRecords(fixture.output())).toEqual([
      {
        phase: 'save-photo',
        method: 'photos.saveWallPhoto',
        status: 'PENDING_CLEANUP',
      },
    ]);
  });

  it('never selects a cleanup target from an ambiguous multi-photo save', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      saveExtraPhoto: true,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).toEqual([
      'photos.getWallUploadServer',
      'upload',
      'photos.saveWallPhoto',
    ]);
    expect(parseRecords(fixture.output())).toEqual([
      {
        phase: 'save-photo',
        method: 'photos.saveWallPhoto',
        status: 'PENDING_CLEANUP',
      },
    ]);
  });

  it('keeps a verified wall candidate pending when authorship lookup is rejected', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      verifyErrorCode: 7,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).not.toContain('wall.delete');
    expect(methods).toContain('photos.delete');
    expect(parseRecords(fixture.output())).toEqual([
      {
        phase: 'verify-authorship',
        method: 'wall.getById',
        error_code: 7,
        status: 'PENDING_CLEANUP',
        post_id: 789,
      },
    ]);
    expect(fixture.output()).not.toContain('private verification');
  });

  it.each([
    ['a successful remote run', {}],
    ['a failed remote run', { uploadErrorCode: 15 }],
  ])(
    'forces safe local-cleanup pending output when removal fails after %s',
    async (_description, fetchOptions) => {
      const fixture = await makeFixture();
      const { fetchImpl } = successfulFetch(fixture, fetchOptions);
      const removeWorkspaceImpl = vi
        .fn()
        .mockRejectedValue(new Error('private workspace path and response'));

      const exitCode = await runCapabilityCheck({
        args: ['--group-id', '123', '--media-file', fixture.mediaFile],
        env: {
          VK_GROUP_CAPABILITY_AUTHORIZED: '1',
          VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
        },
        fetchImpl,
        stdout: fixture.stdout,
        tempRoot: fixture.root,
        removeWorkspaceImpl,
      });

      expect(exitCode).toBe(4);
      expect(removeWorkspaceImpl).toHaveBeenCalledOnce();
      expect(parseRecords(fixture.output())).toEqual([
        { phase: 'local-cleanup', status: 'PENDING_LOCAL_CLEANUP' },
      ]);
      expect(fixture.output()).not.toContain(fixture.root);
      expect(fixture.output()).not.toContain('private workspace');
      expect(parseRecords(fixture.output())).not.toContainEqual(
        expect.objectContaining({ status: 'GO' })
      );
    }
  );

  it('keeps status pending and attempts remaining cleanup when cleanup fails', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      wallDeleteErrorCode: 7,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).toContain('photos.delete');
    expect(parseRecords(fixture.output()).at(-1)).toEqual({
      phase: 'cleanup-post',
      method: 'wall.delete',
      error_code: 7,
      status: 'PENDING_CLEANUP',
      post_id: 789,
    });
    expect(fixture.output()).not.toContain('private cleanup message');
    expect(fixture.output()).not.toContain('private-community-token');
    expect(parseRecords(fixture.output())).not.toContainEqual(
      expect.objectContaining({ status: 'GO' })
    );
    expect(await readdir(fixture.root)).toEqual(['synthetic.png']);
  });

  it('never emits GO when cleanup absence cannot be verified', async () => {
    const fixture = await makeFixture();
    const { fetchImpl } = successfulFetch(fixture, { photoRemains: true });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(parseRecords(fixture.output()).at(-1)).toEqual({
      phase: 'verify-photo-cleanup',
      method: 'photos.getById',
      status: 'PENDING_CLEANUP',
      post_id: 789,
    });
    expect(parseRecords(fixture.output())).not.toContainEqual(
      expect.objectContaining({ status: 'GO' })
    );
    expect(await readdir(fixture.root)).toEqual(['synthetic.png']);
  });

  it('does not accept a string delete response as successful cleanup', async () => {
    const fixture = await makeFixture();
    const { fetchImpl } = successfulFetch(fixture, {
      wallDeleteMalformed: '1',
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(parseRecords(fixture.output())).toEqual([
      {
        phase: 'cleanup-post',
        method: 'wall.delete',
        status: 'PENDING_CLEANUP',
        post_id: 789,
      },
    ]);
  });

  it('does not accept a non-2xx delete response as successful cleanup', async () => {
    const fixture = await makeFixture();
    const { fetchImpl } = successfulFetch(fixture, {
      wallDeleteHttpStatus: 500,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(parseRecords(fixture.output())).toEqual([
      {
        phase: 'cleanup-post',
        method: 'wall.delete',
        status: 'PENDING_CLEANUP',
        post_id: 789,
      },
    ]);
  });

  it('classifies a media read race as upload STOP with no raw details', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      removeMediaAfterUploadServer: true,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(methods).toEqual(['photos.getWallUploadServer']);
    expect(JSON.parse(fixture.output())).toEqual({
      phase: 'upload',
      method: 'upload',
      status: 'STOP',
    });
  });

  it('marks a lost wall.post response pending even after known photo cleanup', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      wallPostTransport: true,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).toEqual([
      'photos.getWallUploadServer',
      'upload',
      'photos.saveWallPhoto',
      'wall.post',
      'photos.delete',
      'photos.getById',
    ]);
    expect(parseRecords(fixture.output())).toEqual([
      {
        phase: 'publish',
        method: 'wall.post',
        status: 'PENDING_CLEANUP',
      },
    ]);
    expect(fixture.output()).not.toContain('private details');
    expect(await readdir(fixture.root)).toEqual(['synthetic.png']);
  });

  it('marks a malformed save response pending because photo creation is uncertain', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      saveMalformed: true,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).toEqual([
      'photos.getWallUploadServer',
      'upload',
      'photos.saveWallPhoto',
    ]);
    expect(parseRecords(fixture.output())).toEqual([
      {
        phase: 'save-photo',
        method: 'photos.saveWallPhoto',
        status: 'PENDING_CLEANUP',
      },
    ]);
    expect(await readdir(fixture.root)).toEqual(['synthetic.png']);
  });
});
