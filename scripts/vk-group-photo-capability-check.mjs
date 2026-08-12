import { rmSync } from 'node:fs';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const API_ROOT = 'https://api.vk.com/method/';
const API_VERSION = '5.251';
const REQUEST_TIMEOUT_MS = 30_000;
const activeWorkspaces = new Set();

class SafeFailure extends Error {
  constructor(phase, method, errorCode, creationUncertain = false) {
    super('Capability phase failed');
    this.phase = phase;
    this.method = method;
    this.errorCode = errorCode;
    this.creationUncertain = creationUncertain;
  }
}

function stopRecord(failure) {
  return {
    phase: failure.phase,
    method: failure.method,
    ...(Number.isInteger(failure.errorCode)
      ? { error_code: failure.errorCode }
      : {}),
    status: 'STOP',
  };
}

function pendingCleanupRecord(failure, postId) {
  return {
    phase: failure.phase,
    method: failure.method,
    ...(Number.isInteger(failure.errorCode)
      ? { error_code: failure.errorCode }
      : {}),
    status: 'PENDING_CLEANUP',
    ...(postId ? { post_id: Number(postId) } : {}),
  };
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !['--group-id', '--media-file'].includes(key) ||
      typeof value !== 'string'
    ) {
      throw new SafeFailure('preflight');
    }
    values[key] = value;
  }
  if (Object.keys(values).length !== 2) {
    throw new SafeFailure('preflight');
  }
  return values;
}

async function validateInputs(args, env) {
  if (
    env.VK_GROUP_CAPABILITY_AUTHORIZED !== '1' ||
    typeof env.VK_GROUP_CAPABILITY_TOKEN !== 'string' ||
    env.VK_GROUP_CAPABILITY_TOKEN.length < 10
  ) {
    throw new SafeFailure('preflight');
  }

  const values = parseArgs(args);
  if (!/^[1-9]\d*$/.test(values['--group-id'])) {
    throw new SafeFailure('preflight');
  }

  const mediaFile = resolve(values['--media-file']);
  if (
    !['.jpg', '.jpeg', '.png', '.webp'].includes(
      extname(mediaFile).toLowerCase()
    )
  ) {
    throw new SafeFailure('preflight');
  }
  const mediaStat = await stat(mediaFile).catch(() => undefined);
  if (!mediaStat?.isFile() || mediaStat.size === 0) {
    throw new SafeFailure('preflight');
  }

  return {
    accessToken: env.VK_GROUP_CAPABILITY_TOKEN,
    groupId: values['--group-id'],
    mediaFile,
  };
}

async function createPrivateWorkspace(tempRoot) {
  const directory = await mkdtemp(
    join(tempRoot || tmpdir(), 'vk-group-photo-capability-')
  );
  await chmod(directory, 0o700);
  activeWorkspaces.add(directory);
  let sequence = 0;

  return {
    directory,
    async retainRaw(method, raw) {
      sequence += 1;
      const safeMethod = method.replace(/[^a-zA-Z0-9.-]/g, '-');
      const path = join(
        directory,
        `${String(sequence).padStart(2, '0')}-${safeMethod}.json`
      );
      await writeFile(path, raw, { encoding: 'utf8', mode: 0o600 });
      await chmod(path, 0o600);
    },
  };
}

async function removeWorkspace(workspace) {
  if (!workspace) {
    return;
  }
  await rm(workspace.directory, { recursive: true, force: true });
  activeWorkspaces.delete(workspace.directory);
}

function removeActiveWorkspacesSync() {
  for (const directory of activeWorkspaces) {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // The process is exiting; the private workspace remains mode 0700.
    }
    activeWorkspaces.delete(directory);
  }
}

async function readJsonResponse(
  response,
  workspace,
  phase,
  method,
  creationUncertain = false
) {
  let raw;
  try {
    raw = await response.text();
    await workspace.retainRaw(method, raw);
  } catch {
    throw new SafeFailure(phase, method, undefined, creationUncertain);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new SafeFailure(phase, method, undefined, creationUncertain);
  }
}

function unwrapVk(payload, phase, method, creationUncertain = false) {
  if (payload?.error !== undefined && payload?.error !== null) {
    const rawCode = payload?.error?.error_code;
    throw new SafeFailure(
      phase,
      method,
      typeof rawCode === 'number' && Number.isInteger(rawCode)
        ? rawCode
        : undefined
    );
  }
  if (payload?.response === undefined || payload?.response === null) {
    throw new SafeFailure(phase, method, undefined, creationUncertain);
  }
  return payload.response;
}

async function callVk({
  fetchImpl,
  workspace,
  accessToken,
  phase,
  method,
  params = {},
  creationUncertain = false,
}) {
  const body = new FormData();
  body.append('access_token', accessToken);
  body.append('v', API_VERSION);
  Object.entries(params).forEach(([key, value]) => body.append(key, value));

  let response;
  try {
    response = await fetchImpl(`${API_ROOT}${method}`, {
      method: 'POST',
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SafeFailure(phase, method, undefined, creationUncertain);
  }

  const payload = await readJsonResponse(
    response,
    workspace,
    phase,
    method,
    creationUncertain
  );
  if (payload?.error !== undefined && payload?.error !== null) {
    return unwrapVk(payload, phase, method, creationUncertain);
  }
  if (!response.ok) {
    throw new SafeFailure(phase, method, undefined, creationUncertain);
  }
  return unwrapVk(payload, phase, method, creationUncertain);
}

function integerString(value, { signed = false } = {}) {
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    (signed ? value !== 0 : value > 0)
  ) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const pattern = signed ? /^-?[1-9]\d*$/ : /^[1-9]\d*$/;
  return pattern.test(value) ? value : undefined;
}

function responseItems(response) {
  if (Array.isArray(response)) {
    return response;
  }
  return Array.isArray(response?.items) ? response.items : undefined;
}

function uploadUrlFrom(response) {
  if (typeof response?.upload_url !== 'string') {
    return undefined;
  }
  try {
    const url = new URL(response.upload_url);
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

async function uploadPhoto({ fetchImpl, workspace, uploadUrl, mediaFile }) {
  let body;
  try {
    body = new FormData();
    body.append(
      'photo',
      new Blob([await readFile(mediaFile)]),
      `capability-check${extname(mediaFile).toLowerCase()}`
    );
  } catch {
    throw new SafeFailure('upload', 'upload');
  }

  let response;
  try {
    response = await fetchImpl(uploadUrl, {
      method: 'POST',
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SafeFailure('upload', 'upload');
  }
  const payload = await readJsonResponse(
    response,
    workspace,
    'upload',
    'upload'
  );
  if (payload?.error !== undefined && payload?.error !== null) {
    const rawCode = payload?.error?.error_code;
    throw new SafeFailure(
      'upload',
      'upload',
      typeof rawCode === 'number' && Number.isInteger(rawCode)
        ? rawCode
        : undefined
    );
  }
  if (!response.ok) {
    throw new SafeFailure('upload', 'upload');
  }
  if (
    typeof payload?.photo !== 'string' ||
    !payload.photo ||
    !integerString(payload?.server) ||
    typeof payload?.hash !== 'string' ||
    !payload.hash
  ) {
    throw new SafeFailure('upload', 'upload');
  }
  return {
    photo: payload.photo,
    server: String(payload.server),
    hash: payload.hash,
  };
}

async function cleanupArtifacts({
  fetchImpl,
  workspace,
  accessToken,
  groupId,
  postId,
  photo,
  events,
}) {
  let firstFailure;
  const attempt = async (phase, method, params, validate, eventPostId) => {
    try {
      const response = await callVk({
        fetchImpl,
        workspace,
        accessToken,
        phase,
        method,
        params,
      });
      if (!validate(response)) {
        throw new SafeFailure(phase, method);
      }
      events.push({
        phase,
        method,
        status: 'PASS',
        ...(eventPostId ? { post_id: Number(eventPostId) } : {}),
      });
    } catch (error) {
      firstFailure ||=
        error instanceof SafeFailure ? error : new SafeFailure(phase, method);
    }
  };

  if (postId) {
    await attempt(
      'cleanup-post',
      'wall.delete',
      { owner_id: `-${groupId}`, post_id: postId },
      (response) => response === 1,
      postId
    );
  }
  if (photo) {
    await attempt(
      'cleanup-photo',
      'photos.delete',
      { owner_id: photo.ownerId, photo_id: photo.id },
      (response) => response === 1
    );
  }
  if (postId) {
    await attempt(
      'verify-post-cleanup',
      'wall.getById',
      { posts: `-${groupId}_${postId}` },
      (response) => responseItems(response)?.length === 0,
      postId
    );
  }
  if (photo) {
    await attempt(
      'verify-photo-cleanup',
      'photos.getById',
      { photos: `${photo.ownerId}_${photo.id}` },
      (response) => responseItems(response)?.length === 0
    );
  }

  return firstFailure;
}

export async function runCapabilityCheck({
  args = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdout = process.stdout,
  tempRoot,
} = {}) {
  let inputs;
  try {
    inputs = await validateInputs(args, env);
  } catch {
    stdout.write(`${JSON.stringify({ phase: 'preflight', status: 'STOP' })}\n`);
    return 2;
  }

  let workspace;
  let outputRecords;
  let exitCode = 2;
  let photo;
  let postId;
  const events = [];
  try {
    workspace = await createPrivateWorkspace(tempRoot);
    const uploadServer = await callVk({
      fetchImpl,
      workspace,
      accessToken: inputs.accessToken,
      phase: 'upload-server',
      method: 'photos.getWallUploadServer',
      params: { group_id: inputs.groupId },
    });
    const uploadUrl = uploadUrlFrom(uploadServer);
    if (!uploadUrl) {
      throw new SafeFailure('upload-server', 'photos.getWallUploadServer');
    }
    events.push({
      phase: 'upload-server',
      method: 'photos.getWallUploadServer',
      status: 'PASS',
    });

    const upload = await uploadPhoto({
      fetchImpl,
      workspace,
      uploadUrl,
      mediaFile: inputs.mediaFile,
    });
    events.push({ phase: 'upload', method: 'upload', status: 'PASS' });

    const saved = await callVk({
      fetchImpl,
      workspace,
      accessToken: inputs.accessToken,
      phase: 'save-photo',
      method: 'photos.saveWallPhoto',
      params: {
        group_id: inputs.groupId,
        photo: upload.photo,
        server: upload.server,
        hash: upload.hash,
      },
      creationUncertain: true,
    });
    const savedPhoto = responseItems(saved)?.[0];
    const ownerId = integerString(savedPhoto?.owner_id, { signed: true });
    const photoId = integerString(savedPhoto?.id);
    if (!ownerId || !photoId) {
      throw new SafeFailure(
        'save-photo',
        'photos.saveWallPhoto',
        undefined,
        true
      );
    }
    photo = { ownerId, id: photoId };
    events.push({
      phase: 'save-photo',
      method: 'photos.saveWallPhoto',
      status: 'PASS',
    });

    const published = await callVk({
      fetchImpl,
      workspace,
      accessToken: inputs.accessToken,
      phase: 'publish',
      method: 'wall.post',
      params: {
        owner_id: `-${inputs.groupId}`,
        from_group: '1',
        attachments: `photo${photo.ownerId}_${photo.id}`,
        message: 'Vezdepost VK Group photo capability check',
      },
      creationUncertain: true,
    });
    postId = integerString(published?.post_id);
    if (!postId || !Number.isSafeInteger(Number(postId))) {
      throw new SafeFailure('publish', 'wall.post', undefined, true);
    }
    events.push({
      phase: 'publish',
      method: 'wall.post',
      status: 'PASS',
      post_id: Number(postId),
    });

    const wallPost = await callVk({
      fetchImpl,
      workspace,
      accessToken: inputs.accessToken,
      phase: 'verify-authorship',
      method: 'wall.getById',
      params: { posts: `-${inputs.groupId}_${postId}` },
    });
    const item = responseItems(wallPost)?.[0];
    if (
      integerString(item?.id) !== postId ||
      integerString(item?.owner_id, { signed: true }) !==
        `-${inputs.groupId}` ||
      integerString(item?.from_id, { signed: true }) !== `-${inputs.groupId}`
    ) {
      throw new SafeFailure('verify-authorship', 'wall.getById');
    }
    events.push({
      phase: 'verify-authorship',
      method: 'wall.getById',
      status: 'PASS',
      post_id: Number(postId),
    });

    const cleanupFailure = await cleanupArtifacts({
      fetchImpl,
      workspace,
      accessToken: inputs.accessToken,
      groupId: inputs.groupId,
      postId,
      photo,
      events,
    });
    if (cleanupFailure) {
      outputRecords = [pendingCleanupRecord(cleanupFailure, postId)];
      exitCode = 3;
    } else {
      events.push({
        phase: 'complete',
        status: 'GO',
        post_id: Number(postId),
      });
      outputRecords = events;
      exitCode = 0;
    }
  } catch (error) {
    const failure =
      error instanceof SafeFailure ? error : new SafeFailure('preflight');
    let pendingFailure = failure.creationUncertain ? failure : undefined;
    if (workspace && (postId || photo)) {
      const cleanupFailure = await cleanupArtifacts({
        fetchImpl,
        workspace,
        accessToken: inputs.accessToken,
        groupId: inputs.groupId,
        postId,
        photo,
        events: [],
      });
      if (cleanupFailure) {
        pendingFailure ||= cleanupFailure;
      }
    }
    if (pendingFailure) {
      outputRecords = [pendingCleanupRecord(pendingFailure, postId)];
      exitCode = 3;
    } else {
      outputRecords = [stopRecord(failure)];
    }
  } finally {
    await removeWorkspace(workspace);
  }

  for (const record of outputRecords) {
    stdout.write(`${JSON.stringify(record)}\n`);
  }
  return exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const terminate = (signal) => {
    removeActiveWorkspacesSync();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', () => terminate('SIGINT'));
  process.once('SIGTERM', () => terminate('SIGTERM'));
  process.exitCode = await runCapabilityCheck();
}
