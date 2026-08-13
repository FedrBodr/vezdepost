import { spawn } from 'node:child_process';
import {
  mkdtemp,
  readFile,
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
const authorizationMethods = ['groups.get'];

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

function authorizationFetch({
  groupsPayload = {
    response: {
      count: 2,
      items: [{ id: 123 }, { id: 999 }],
    },
  },
} = {}) {
  const methods = [];
  const fetchImpl = vi.fn(async (url, options) => {
    expect(url).not.toContain('private-user-oauth-token');
    expect(options.redirect).toBe('error');
    const method = url.slice('https://api.vk.com/method/'.length);
    methods.push(method);
    expect(options.body.get('access_token')).toBe('private-user-oauth-token');

    if (method === 'groups.get') {
      expect(options.body.get('filter')).toBe('admin');
      expect(options.body.get('extended')).toBe('1');
      return jsonResponse(groupsPayload);
    }

    return jsonResponse({
      response: {
        upload_url: 'https://upload.invalid/otherwise-capable-private-session',
      },
    });
  });
  return { fetchImpl, methods };
}

function successfulFetch(
  fixture,
  {
    managedGroups = [{ id: 123 }, { id: 999 }],
    uploadUrl = 'https://upload.invalid/private-session',
    wallDeleteErrorCode,
    wallDeleteHttpStatus = 200,
    wallDeleteMalformed,
    wallPostTransport = false,
    wallPostError,
    saveMalformed = false,
    saveError,
    uploadErrorCode,
    removeMediaAfterUploadServer = false,
    photoRemains = false,
    savedOwnerId = -123,
    savedPhotoId = 456,
    saveExtraPhoto = false,
    verifyErrorCode,
    verifiedPostId = 789,
    verifiedOwnerId = -123,
    verifiedFromId = -123,
    verifiedMessage,
    verifiedAttachments,
    verifiedExtraPost = false,
    onSaveResponse,
    onVerifiedPostResponse,
  } = {}
) {
  let wallGetCount = 0;
  let publishedMessage;
  const methods = [];
  const fetchImpl = vi.fn(async (url, options) => {
    expect(url).not.toContain('private-user-oauth-token');
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const method = url.startsWith('https://api.vk.com/method/')
      ? url.slice('https://api.vk.com/method/'.length)
      : 'upload';
    methods.push(method);

    if (method !== 'upload') {
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get('access_token')).toBe('private-user-oauth-token');
      expect(options.body.get('v')).toBe('5.251');
    }

    switch (method) {
      case 'groups.get':
        expect(options.body.get('filter')).toBe('admin');
        expect(options.body.get('extended')).toBe('1');
        return jsonResponse({
          response: { count: managedGroups.length, items: managedGroups },
        });
      case 'photos.getWallUploadServer':
        expect(options.body.get('group_id')).toBe('123');
        if (removeMediaAfterUploadServer) {
          await unlink(fixture.mediaFile);
        }
        return jsonResponse({
          response: { upload_url: uploadUrl },
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
        expect(rawFiles).toHaveLength(2);
        await Promise.all(
          rawFiles.map(async (rawFile) => {
            expect((await stat(join(workspace, rawFile))).mode & 0o777).toBe(
              0o600
            );
          })
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
        onSaveResponse?.();
        return jsonResponse(
          saveError ?? {
            response: saveMalformed
              ? []
              : [
                  { owner_id: savedOwnerId, id: savedPhotoId },
                  ...(saveExtraPhoto ? [{ owner_id: -123, id: 457 }] : []),
                ],
          }
        );
      case 'wall.post':
        expect(options.body.get('owner_id')).toBe('-123');
        expect(options.body.get('from_group')).toBe('1');
        expect(options.body.get('attachments')).toBe(
          `photo${savedOwnerId}_${savedPhotoId}`
        );
        publishedMessage = options.body.get('message');
        expect(publishedMessage).toMatch(
          /^Vezdepost VK Group photo capability check [0-9a-f-]{36}$/
        );
        if (wallPostTransport) {
          throw new Error('lost wall.post response with private details');
        }
        if (wallPostError) {
          return jsonResponse(wallPostError);
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
        if (wallGetCount === 1) {
          const response = jsonResponse({
            response: {
              items: [
                {
                  id: verifiedPostId,
                  owner_id: verifiedOwnerId,
                  from_id: verifiedFromId,
                  text: verifiedMessage ?? publishedMessage,
                  attachments: verifiedAttachments ?? [
                    {
                      type: 'photo',
                      photo: { owner_id: savedOwnerId, id: savedPhotoId },
                    },
                  ],
                },
                ...(verifiedExtraPost
                  ? [
                      {
                        id: 789,
                        owner_id: -123,
                        from_id: -123,
                        text: publishedMessage,
                        attachments: [
                          {
                            type: 'photo',
                            photo: { owner_id: savedOwnerId, id: savedPhotoId },
                          },
                        ],
                      },
                    ]
                  : []),
              ],
            },
          });
          onVerifiedPostResponse?.();
          return response;
        }
        return jsonResponse({ response: { items: [] } });
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
        expect(options.body.get('owner_id')).toBe(String(savedOwnerId));
        expect(options.body.get('photo_id')).toBe(String(savedPhotoId));
        return jsonResponse({ response: 1 });
      case 'photos.getById':
        expect(options.body.get('photos')).toBe(
          `${savedOwnerId}_${savedPhotoId}`
        );
        return jsonResponse({
          response: photoRemains
            ? [{ owner_id: savedOwnerId, id: savedPhotoId }]
            : [],
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
      env: { VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token' },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fixture.output()).toBe(
      `${JSON.stringify({ phase: 'preflight', status: 'NO_GO' })}\n`
    );
    expect(await readdir(fixture.root)).toEqual(['synthetic.png']);
    expect(fixture.output()).not.toContain('private-user-oauth-token');
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
        'private-user-oauth-token',
      ],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fixture.output()).toBe(
      `${JSON.stringify({ phase: 'preflight', status: 'NO_GO' })}\n`
    );
    expect(fixture.output()).not.toContain('private-user-oauth-token');
  });

  it('rejects the legacy community-token environment contract', async () => {
    const fixture = await makeFixture();
    const fetchImpl = vi.fn();

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_TOKEN: 'private-legacy-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(parseRecords(fixture.output())).toEqual([
      { phase: 'preflight', status: 'NO_GO' },
    ]);
    expect(fixture.output()).not.toContain('private-legacy-community-token');
  });

  it('rejects a legacy token present alongside the user OAuth token', async () => {
    const fixture = await makeFixture();
    const fetchImpl = vi.fn();

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
        VK_GROUP_CAPABILITY_TOKEN: 'private-legacy-community-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(parseRecords(fixture.output())).toEqual([
      { phase: 'preflight', status: 'NO_GO' },
    ]);
    expect(fixture.output()).not.toContain('private-user-oauth-token');
    expect(fixture.output()).not.toContain('private-legacy-community-token');
  });

  it.each([
    ['no administered groups', { response: { count: 0, items: [] } }],
    [
      'a different administered group',
      { response: { count: 1, items: [{ id: 456 }] } },
    ],
    [
      'duplicate target entries',
      { response: { count: 2, items: [{ id: 123 }, { id: 123 }] } },
    ],
  ])(
    'stops when groups.get reports %s before every photo or cleanup method',
    async (_description, groupsPayload) => {
      const fixture = await makeFixture();
      const { fetchImpl, methods } = authorizationFetch({ groupsPayload });

      const exitCode = await runCapabilityCheck({
        args: ['--group-id', '123', '--media-file', fixture.mediaFile],
        env: {
          VK_GROUP_CAPABILITY_AUTHORIZED: '1',
          VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
        },
        fetchImpl,
        stdout: fixture.stdout,
        tempRoot: fixture.root,
      });

      expect(exitCode).toBe(2);
      expect(methods).toEqual(['groups.get']);
      expect(methods).not.toContain('photos.getWallUploadServer');
      expect(methods).not.toContain('upload');
      expect(methods).not.toContain('wall.post');
      expect(methods).not.toContain('wall.delete');
      expect(parseRecords(fixture.output())).toEqual([
        {
          phase: 'authorization',
          method: 'groups.get',
          status: 'NO_GO',
        },
      ]);
      expect(fixture.output()).not.toContain('private-user-oauth-token');
      expect(fixture.output()).not.toContain('private-session');
      expect(fixture.output()).not.toContain('123');
      expect(fixture.output()).not.toContain('456');
      expect(parseRecords(fixture.output())).not.toContainEqual(
        expect.objectContaining({ status: 'GO' })
      );
    }
  );

  it.each([
    ['response envelope', { response: { count: 1, items: {} } }],
    ['target group id', { response: { count: 1, items: [{ id: '12.3' }] } }],
    ['count', { response: { count: '1', items: [{ id: 123 }] } }],
  ])(
    'fails closed on a malformed groups.get %s',
    async (_description, groupsPayload) => {
      const fixture = await makeFixture();
      const { fetchImpl, methods } = authorizationFetch({ groupsPayload });

      const exitCode = await runCapabilityCheck({
        args: ['--group-id', '123', '--media-file', fixture.mediaFile],
        env: {
          VK_GROUP_CAPABILITY_AUTHORIZED: '1',
          VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
        },
        fetchImpl,
        stdout: fixture.stdout,
        tempRoot: fixture.root,
      });

      expect(exitCode).toBe(2);
      expect(methods).toEqual(['groups.get']);
      expect(methods.some((method) => method.startsWith('photos.'))).toBe(
        false
      );
      expect(parseRecords(fixture.output())).toEqual([
        {
          phase: 'authorization',
          method: 'groups.get',
          status: 'NO_GO',
        },
      ]);
      expect(fixture.output()).not.toContain('private-user-oauth-token');
    }
  );

  it('records only groups.get and error 27 when user authorization is unavailable', async () => {
    const fixture = await makeFixture();
    const methods = [];
    const fetchImpl = vi.fn(async (url, options) => {
      methods.push(url.slice('https://api.vk.com/method/'.length));
      expect(options.body.get('access_token')).toBe('private-user-oauth-token');
      return jsonResponse({
        error: {
          error_code: 27,
          error_msg: 'private user authorization details',
        },
      });
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(methods).toEqual(authorizationMethods);
    expect(parseRecords(fixture.output())).toEqual([
      {
        phase: 'authorization',
        method: 'groups.get',
        error_code: 27,
        status: 'NO_GO',
      },
    ]);
    expect(fixture.output()).not.toContain('private user authorization');
    expect(fixture.output()).not.toContain('private-user-oauth-token');
  });

  it('accepts the exact target among other administered groups', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      managedGroups: [{ id: 999 }, { id: 123 }],
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(0);
    expect(methods.slice(0, authorizationMethods.length)).toEqual(
      authorizationMethods
    );
    expect(methods).toContain('photos.getWallUploadServer');
    expect(parseRecords(fixture.output()).at(-1)).toEqual({
      phase: 'complete',
      status: 'GO',
      post_id: 789,
    });
  });

  it('records only method and numeric code for a VK pre-publication failure', async () => {
    const fixture = await makeFixture();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            error_code: 15,
            error_msg: 'upstream-private-message',
            request_params: [{ value: 'private-user-oauth-token' }],
          },
        })
      )
    );

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fixture.output()).toBe(
      `${JSON.stringify({
        phase: 'authorization',
        method: 'groups.get',
        error_code: 15,
        status: 'NO_GO',
      })}\n`
    );
    expect(fixture.output()).not.toContain('upstream-private-message');
    expect(fixture.output()).not.toContain('private-user-oauth-token');
    expect(await readdir(fixture.root)).toEqual(['synthetic.png']);
  });

  it('omits an error code and caught details for a transport failure', async () => {
    const fixture = await makeFixture();
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(
        new Error('transport private-user-oauth-token https://private.invalid')
      );

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const record = JSON.parse(fixture.output());
    expect(record).toEqual({
      phase: 'authorization',
      method: 'groups.get',
      status: 'NO_GO',
    });
    expect(record).not.toHaveProperty('error_code');
    expect(fixture.output()).not.toContain('private-user-oauth-token');
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
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(fixture.output())).toEqual({
      phase: 'authorization',
      method: 'groups.get',
      status: 'NO_GO',
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
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(methods).toEqual([
      ...authorizationMethods,
      'photos.getWallUploadServer',
      'upload',
    ]);
    expect(JSON.parse(fixture.output())).toEqual({
      phase: 'upload',
      method: 'upload',
      error_code: 15,
      status: 'NO_GO',
    });
    expect(fixture.output()).not.toContain('private upload rejection');
  });

  it('rejects a non-HTTPS upload URL before sending the image', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      uploadUrl: 'http://upload.invalid/private-session',
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(methods).toEqual(['groups.get', 'photos.getWallUploadServer']);
    expect(parseRecords(fixture.output())).toEqual([
      {
        phase: 'upload-server',
        method: 'photos.getWallUploadServer',
        status: 'NO_GO',
      },
    ]);
    expect(fixture.output()).not.toContain('upload.invalid');
  });

  it('emits GO only after authorship and cleanup absence are verified', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture);

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(
      exitCode,
      JSON.stringify({ methods, records: parseRecords(fixture.output()) })
    ).toBe(0);
    expect(methods).toEqual([
      ...authorizationMethods,
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
    expect(fixture.output()).not.toContain('private-user-oauth-token');
    expect(fixture.output()).not.toContain('private-session');
    expect(fixture.output()).not.toContain('private-upload');
    expect(await readdir(fixture.root)).toEqual(['synthetic.png']);
  });

  it('proves a photo saved for the OAuth user is published and cleaned up by its exact identity', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      savedOwnerId: 456,
      savedPhotoId: 789,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(0);
    expect(methods).toEqual([
      ...authorizationMethods,
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
    expect(parseRecords(fixture.output()).at(-1)).toEqual({
      phase: 'complete',
      status: 'GO',
      post_id: 789,
    });
  });

  it.each([
    ['a stale post id', { verifiedPostId: 788 }],
    ['a wrong post owner', { verifiedOwnerId: -999 }],
    ['a wrong post author', { verifiedFromId: 456 }],
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
    ['multiple post readback results', { verifiedExtraPost: true }],
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
          VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
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
          status: 'PENDING_CLEANUP',
        },
      ]);
      expect(fixture.output()).not.toContain('789');
      expect(fixture.output()).not.toContain('unrelated post');
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
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
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

  it('serializes SIGTERM cleanup after saved-photo ownership proof', async () => {
    const fixture = await makeFixture();
    const signalExit = vi.fn();
    let signalOutput = '';
    const { fetchImpl, methods } = successfulFetch(fixture, {
      onSaveResponse: () =>
        terminateForSignal({
          signal: 'SIGTERM',
          exitImpl: signalExit,
          removeWorkspaceSyncImpl: vi.fn(),
          writeSyncImpl: vi.fn((_fd, chunk) => {
            signalOutput += String(chunk);
          }),
        }),
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(143);
    expect(signalExit).not.toHaveBeenCalled();
    expect(signalOutput).toBe('');
    expect(methods).toEqual([
      ...authorizationMethods,
      'photos.getWallUploadServer',
      'upload',
      'photos.saveWallPhoto',
      'photos.delete',
      'photos.getById',
    ]);
    expect(parseRecords(fixture.output())).toEqual([
      { phase: 'signal', status: 'NO_GO' },
    ]);
    expect(fixture.output()).not.toContain('private-user-oauth-token');
    expect(fixture.output()).not.toContain(fixture.root);
  });

  it('handles the same CLI signal twice without bypassing serialized cleanup', async () => {
    const fixture = await makeFixture();
    const preloader = join(fixture.root, 'signal-fetch-preloader.mjs');
    const callsFile = join(fixture.root, 'calls.txt');
    const listenersFile = join(fixture.root, 'listeners.txt');
    await writeFile(
      preloader,
      `
        import { appendFileSync, writeFileSync } from 'node:fs';

        const jsonResponse = (payload) =>
          new Response(JSON.stringify(payload), { status: 200 });

        process.on('exit', () => {
          writeFileSync(
            process.env.LISTENERS_FILE,
            JSON.stringify({
              sigint: process.listenerCount('SIGINT'),
              sigterm: process.listenerCount('SIGTERM'),
            })
          );
        });

        globalThis.fetch = async (url, options) => {
          const method = url.startsWith('https://api.vk.com/method/')
            ? url.slice('https://api.vk.com/method/'.length)
            : 'upload';
          appendFileSync(process.env.CALLS_FILE, method + '\\n');

          if (method !== 'upload') {
            if (options.body.get('access_token') !== 'private-user-oauth-token') {
              throw new Error('unexpected token contract');
            }
          }

          switch (method) {
            case 'groups.get':
              return jsonResponse({ response: { count: 1, items: [{ id: 123 }] } });
            case 'photos.getWallUploadServer':
              return jsonResponse({ response: { upload_url: 'https://upload.invalid/private-session' } });
            case 'upload':
              return jsonResponse({ photo: 'private-photo', server: 321, hash: 'private-hash' });
            case 'photos.saveWallPhoto':
              process.stderr.write('SAVE_READY\\n');
              await new Promise((resolve) => setTimeout(resolve, 500));
              return jsonResponse({ response: [{ owner_id: -123, id: 456 }] });
            case 'photos.delete':
              return jsonResponse({ response: 1 });
            case 'photos.getById':
              return jsonResponse({ response: [] });
            default:
              throw new Error('unexpected method ' + method);
          }
        };
      `
    );

    const child = spawn(
      process.execPath,
      [
        '--import',
        preloader,
        join(process.cwd(), 'scripts/vk-group-photo-capability-check.mjs'),
        '--group-id',
        '123',
        '--media-file',
        fixture.mediaFile,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          VK_GROUP_CAPABILITY_AUTHORIZED: '1',
          VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
          CALLS_FILE: callsFile,
          LISTENERS_FILE: listenersFile,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let output = '';
    let errors = '';
    let signaled = false;
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      errors += String(chunk);
      if (!signaled && errors.includes('SAVE_READY')) {
        signaled = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGTERM'), 50);
      }
    });

    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });

    expect(signaled).toBe(true);
    expect(result).toEqual({ code: 143, signal: null });
    expect(parseRecords(output)).toEqual([
      { phase: 'signal', status: 'NO_GO' },
    ]);
    expect((await readFile(callsFile, 'utf8')).trim().split('\n')).toEqual([
      ...authorizationMethods,
      'photos.getWallUploadServer',
      'upload',
      'photos.saveWallPhoto',
      'photos.delete',
      'photos.getById',
    ]);
    expect(JSON.parse(await readFile(listenersFile, 'utf8'))).toEqual({
      sigint: 0,
      sigterm: 0,
    });
    expect(output).not.toContain('private-user-oauth-token');
    expect(output).not.toContain(fixture.root);
    expect(errors).not.toContain('private-user-oauth-token');
    expect(errors).not.toContain(fixture.root);
  });

  it('serializes SIGINT cleanup after exact post ownership proof', async () => {
    const fixture = await makeFixture();
    const signalExit = vi.fn();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      onVerifiedPostResponse: () =>
        terminateForSignal({
          signal: 'SIGINT',
          exitImpl: signalExit,
          removeWorkspaceSyncImpl: vi.fn(),
          writeSyncImpl: vi.fn(),
        }),
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(130);
    expect(signalExit).not.toHaveBeenCalled();
    expect(methods).toEqual([
      ...authorizationMethods,
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
    expect(parseRecords(fixture.output())).toEqual([
      { phase: 'signal', status: 'NO_GO' },
    ]);
    expect(fixture.output()).not.toContain('private-user-oauth-token');
    expect(fixture.output()).not.toContain(fixture.root);
  });

  it('keeps a signaled run pending when remote absence cannot be proven', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      photoRemains: true,
      onSaveResponse: () =>
        terminateForSignal({
          signal: 'SIGTERM',
          exitImpl: vi.fn(),
          removeWorkspaceSyncImpl: vi.fn(),
          writeSyncImpl: vi.fn(),
        }),
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).toEqual([
      ...authorizationMethods,
      'photos.getWallUploadServer',
      'upload',
      'photos.saveWallPhoto',
      'photos.delete',
      'photos.getById',
    ]);
    expect(parseRecords(fixture.output())).toEqual([
      {
        phase: 'verify-photo-cleanup',
        method: 'photos.getById',
        status: 'PENDING_CLEANUP',
      },
    ]);
  });

  it('prioritizes pending local cleanup after serialized remote signal cleanup', async () => {
    const fixture = await makeFixture();
    const signalExit = vi.fn();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      onSaveResponse: () =>
        terminateForSignal({
          signal: 'SIGTERM',
          exitImpl: signalExit,
          removeWorkspaceSyncImpl: vi.fn(),
          writeSyncImpl: vi.fn(),
        }),
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
      removeWorkspaceImpl: vi
        .fn()
        .mockRejectedValue(new Error('private local path')),
    });

    expect(exitCode).toBe(4);
    expect(signalExit).not.toHaveBeenCalled();
    expect(methods).toEqual([
      ...authorizationMethods,
      'photos.getWallUploadServer',
      'upload',
      'photos.saveWallPhoto',
      'photos.delete',
      'photos.getById',
    ]);
    expect(parseRecords(fixture.output())).toEqual([
      { phase: 'local-cleanup', status: 'PENDING_LOCAL_CLEANUP' },
    ]);
    expect(fixture.output()).not.toContain(fixture.root);
    expect(fixture.output()).not.toContain('private local');
  });

  it('marks a zero saved photo owner pending before publication', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      savedOwnerId: 0,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).toEqual([
      ...authorizationMethods,
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
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).toEqual([
      ...authorizationMethods,
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

  it('keeps an unverified wall candidate private when authorship lookup is rejected', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      verifyErrorCode: 7,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
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
      },
    ]);
    expect(fixture.output()).not.toContain('789');
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
          VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
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
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
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
    });
    expect(fixture.output()).not.toContain('private cleanup message');
    expect(fixture.output()).not.toContain('private-user-oauth-token');
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
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
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
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
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
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
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
      },
    ]);
  });

  it('classifies a media read race as upload NO_GO with no raw details', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      removeMediaAfterUploadServer: true,
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(2);
    expect(methods).toEqual([
      ...authorizationMethods,
      'photos.getWallUploadServer',
    ]);
    expect(JSON.parse(fixture.output())).toEqual({
      phase: 'upload',
      method: 'upload',
      status: 'NO_GO',
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
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).toEqual([
      ...authorizationMethods,
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
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).toEqual([
      ...authorizationMethods,
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

  it('keeps a nonnumeric save error envelope pending and redacted', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      saveError: {
        error: {
          error_code: '15',
          error_msg: 'private save envelope private-user-oauth-token',
        },
      },
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).toEqual([
      ...authorizationMethods,
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
    expect(fixture.output()).not.toContain('NO_GO');
    expect(fixture.output()).not.toContain('private save');
    expect(fixture.output()).not.toContain('private-user-oauth-token');
  });

  it('keeps a malformed wall.post error envelope pending after photo cleanup', async () => {
    const fixture = await makeFixture();
    const { fetchImpl, methods } = successfulFetch(fixture, {
      wallPostError: { error: 'private malformed wall envelope' },
    });

    const exitCode = await runCapabilityCheck({
      args: ['--group-id', '123', '--media-file', fixture.mediaFile],
      env: {
        VK_GROUP_CAPABILITY_AUTHORIZED: '1',
        VK_GROUP_CAPABILITY_USER_TOKEN: 'private-user-oauth-token',
      },
      fetchImpl,
      stdout: fixture.stdout,
      tempRoot: fixture.root,
    });

    expect(exitCode).toBe(3);
    expect(methods).toEqual([
      ...authorizationMethods,
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
    expect(fixture.output()).not.toContain('NO_GO');
    expect(fixture.output()).not.toContain('private malformed');
    expect(fixture.output()).not.toContain('private-user-oauth-token');
  });
});
