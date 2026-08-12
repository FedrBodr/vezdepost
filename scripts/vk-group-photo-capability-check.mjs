import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';
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
const MESSAGE_PREFIX = 'Vezdepost VK Group photo capability check';
const activeSignalStates = new Set();

class SafeFailure extends Error {
  constructor(phase, method, errorCode, creationUncertain = false) {
    super('Capability phase failed');
    this.phase = phase;
    this.method = method;
    this.errorCode = errorCode;
    this.creationUncertain = creationUncertain;
  }
}

class LocalCleanupFailure extends Error {
  constructor() {
    super('Local workspace cleanup failed');
  }
}

function noGoRecord(failure) {
  return {
    phase: failure.phase,
    method: failure.method,
    ...(Number.isInteger(failure.errorCode)
      ? { error_code: failure.errorCode }
      : {}),
    status: 'NO_GO',
  };
}

function pendingCleanupRecord(failure) {
  return {
    phase: failure.phase,
    method: failure.method,
    ...(Number.isInteger(failure.errorCode)
      ? { error_code: failure.errorCode }
      : {}),
    status: 'PENDING_CLEANUP',
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
    'VK_GROUP_CAPABILITY_TOKEN' in env ||
    typeof env.VK_GROUP_CAPABILITY_USER_TOKEN !== 'string' ||
    env.VK_GROUP_CAPABILITY_USER_TOKEN.length < 10
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
    accessToken: env.VK_GROUP_CAPABILITY_USER_TOKEN,
    groupId: values['--group-id'],
    mediaFile,
  };
}

async function createPrivateWorkspace(
  tempRoot,
  chmodWorkspaceImpl,
  removeWorkspaceImpl
) {
  const directory = await mkdtemp(
    join(tempRoot || tmpdir(), 'vk-group-photo-capability-')
  );
  try {
    await chmodWorkspaceImpl(directory, 0o700);
  } catch {
    const removed = await removeWorkspace({ directory }, removeWorkspaceImpl);
    if (!removed) {
      throw new LocalCleanupFailure();
    }
    throw new SafeFailure('preflight');
  }
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

async function removeWorkspace(workspace, removeWorkspaceImpl) {
  if (!workspace) {
    return true;
  }
  try {
    await removeWorkspaceImpl(workspace.directory, {
      recursive: true,
      force: true,
    });
    return true;
  } catch {
    return false;
  }
}

function signalExitCode(signal) {
  return signal === 'SIGINT' ? 130 : 143;
}

function throwIfSignalRequested(signalState, creationUncertain = false) {
  if (signalState.signal) {
    throw new SafeFailure('signal', undefined, undefined, creationUncertain);
  }
}

export function terminateForSignal({
  signal,
  exitImpl = process.exit,
  writeSyncImpl = writeSync,
} = {}) {
  if (activeSignalStates.size > 0) {
    for (const signalState of activeSignalStates) {
      signalState.signal ||= signal;
    }
    return;
  }

  try {
    writeSyncImpl(process.stdout.fd, '{"phase":"signal","status":"NO_GO"}\n');
  } catch {
    // A broken stdout cannot carry the safe record; the exit remains non-GO.
  } finally {
    try {
      exitImpl(signalExitCode(signal));
    } catch {
      // There is no safe fallback if the injected exit implementation fails.
    }
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
    const errorCode =
      typeof rawCode === 'number' && Number.isInteger(rawCode)
        ? rawCode
        : undefined;
    throw new SafeFailure(
      phase,
      method,
      errorCode,
      creationUncertain && errorCode === undefined
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

function hasExactManagedTarget(response, groupId) {
  if (
    !response ||
    typeof response !== 'object' ||
    !Number.isSafeInteger(response.count) ||
    response.count < 0 ||
    !Array.isArray(response.items) ||
    response.count < response.items.length
  ) {
    return false;
  }

  const groupIds = response.items.map((group) =>
    group && typeof group === 'object' ? integerString(group.id) : undefined
  );
  return (
    groupIds.every(Boolean) &&
    groupIds.filter((candidate) => candidate === groupId).length === 1
  );
}

async function authorizeUserTarget({
  fetchImpl,
  workspace,
  accessToken,
  groupId,
  events,
}) {
  const managedGroups = await callVk({
    fetchImpl,
    workspace,
    accessToken,
    phase: 'authorization',
    method: 'groups.get',
    params: { filter: 'admin', extended: '1' },
  });
  if (!hasExactManagedTarget(managedGroups, groupId)) {
    throw new SafeFailure('authorization', 'groups.get');
  }
  events.push({
    phase: 'authorization',
    method: 'groups.get',
    status: 'PASS',
  });
}

function isExpectedPhotoAttachment(attachments, photo) {
  if (!Array.isArray(attachments) || attachments.length !== 1) {
    return false;
  }
  const attachment = attachments[0];
  return (
    attachment?.type === 'photo' &&
    integerString(attachment?.photo?.owner_id, { signed: true }) ===
      photo.ownerId &&
    integerString(attachment?.photo?.id) === photo.id
  );
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
  removeWorkspaceImpl = rm,
  chmodWorkspaceImpl = chmod,
  markerFactory = randomUUID,
} = {}) {
  const signalState = { signal: undefined };
  activeSignalStates.add(signalState);
  let inputs;
  try {
    inputs = await validateInputs(args, env);
  } catch {
    activeSignalStates.delete(signalState);
    stdout.write(
      `${JSON.stringify({ phase: 'preflight', status: 'NO_GO' })}\n`
    );
    return 2;
  }

  let workspace;
  let outputRecords;
  let exitCode = 2;
  let photo;
  let postId;
  let candidatePostId;
  const events = [];
  try {
    workspace = await createPrivateWorkspace(
      tempRoot,
      chmodWorkspaceImpl,
      removeWorkspaceImpl
    );
    throwIfSignalRequested(signalState);
    await authorizeUserTarget({
      fetchImpl,
      workspace,
      accessToken: inputs.accessToken,
      groupId: inputs.groupId,
      events,
    });
    throwIfSignalRequested(signalState);
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
    throwIfSignalRequested(signalState);

    const upload = await uploadPhoto({
      fetchImpl,
      workspace,
      uploadUrl,
      mediaFile: inputs.mediaFile,
    });
    events.push({ phase: 'upload', method: 'upload', status: 'PASS' });
    throwIfSignalRequested(signalState);

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
    const savedItems = responseItems(saved);
    const savedPhoto = savedItems?.[0];
    const ownerId = integerString(savedPhoto?.owner_id, { signed: true });
    const photoId = integerString(savedPhoto?.id);
    if (
      savedItems?.length !== 1 ||
      ownerId !== `-${inputs.groupId}` ||
      !photoId
    ) {
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
    throwIfSignalRequested(signalState);

    const markerMessage = `${MESSAGE_PREFIX} ${markerFactory()}`;
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
        message: markerMessage,
      },
      creationUncertain: true,
    });
    const rawCandidatePostId = integerString(published?.post_id);
    if (
      !rawCandidatePostId ||
      !Number.isSafeInteger(Number(rawCandidatePostId))
    ) {
      throw new SafeFailure('publish', 'wall.post', undefined, true);
    }
    candidatePostId = rawCandidatePostId;
    events.push({
      phase: 'publish',
      method: 'wall.post',
      status: 'PASS',
      post_id: Number(candidatePostId),
    });
    throwIfSignalRequested(signalState, true);

    let wallPost;
    try {
      wallPost = await callVk({
        fetchImpl,
        workspace,
        accessToken: inputs.accessToken,
        phase: 'verify-authorship',
        method: 'wall.getById',
        params: { posts: `-${inputs.groupId}_${candidatePostId}` },
      });
    } catch (error) {
      throw new SafeFailure(
        'verify-authorship',
        'wall.getById',
        error instanceof SafeFailure ? error.errorCode : undefined,
        true
      );
    }
    const wallItems = responseItems(wallPost);
    const item = wallItems?.[0];
    if (
      wallItems?.length !== 1 ||
      integerString(item?.id) !== candidatePostId ||
      integerString(item?.owner_id, { signed: true }) !==
        `-${inputs.groupId}` ||
      integerString(item?.from_id, { signed: true }) !== `-${inputs.groupId}` ||
      item?.text !== markerMessage ||
      !isExpectedPhotoAttachment(item?.attachments, photo)
    ) {
      throw new SafeFailure(
        'verify-authorship',
        'wall.getById',
        undefined,
        true
      );
    }
    postId = candidatePostId;
    events.push({
      phase: 'verify-authorship',
      method: 'wall.getById',
      status: 'PASS',
      post_id: Number(postId),
    });
    throwIfSignalRequested(signalState);

    const completedPostId = postId;
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
      outputRecords = [pendingCleanupRecord(cleanupFailure)];
      exitCode = 3;
    } else {
      postId = undefined;
      photo = undefined;
      throwIfSignalRequested(signalState);
      events.push({
        phase: 'complete',
        status: 'GO',
        post_id: Number(completedPostId),
      });
      outputRecords = events;
      exitCode = 0;
    }
  } catch (error) {
    if (error instanceof LocalCleanupFailure) {
      outputRecords = [
        { phase: 'local-cleanup', status: 'PENDING_LOCAL_CLEANUP' },
      ];
      exitCode = 4;
    } else {
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
        } else {
          postId = undefined;
          photo = undefined;
        }
      }
      if (pendingFailure) {
        outputRecords = [pendingCleanupRecord(pendingFailure)];
        exitCode = 3;
      } else {
        const finalFailure = signalState.signal
          ? new SafeFailure('signal')
          : failure;
        outputRecords = [noGoRecord(finalFailure)];
        exitCode = signalState.signal ? signalExitCode(signalState.signal) : 2;
      }
    }
  } finally {
    const removed = await removeWorkspace(workspace, removeWorkspaceImpl);
    activeSignalStates.delete(signalState);
    if (!removed) {
      outputRecords = [
        { phase: 'local-cleanup', status: 'PENDING_LOCAL_CLEANUP' },
      ];
      exitCode = 4;
    } else if (signalState.signal && ![3, 4].includes(exitCode)) {
      outputRecords = [noGoRecord(new SafeFailure('signal'))];
      exitCode = signalExitCode(signalState.signal);
    }
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
  const terminateForSigint = () => terminateForSignal({ signal: 'SIGINT' });
  const terminateForSigterm = () => terminateForSignal({ signal: 'SIGTERM' });
  process.on('SIGINT', terminateForSigint);
  process.on('SIGTERM', terminateForSigterm);
  try {
    process.exitCode = await runCapabilityCheck();
  } finally {
    process.removeListener('SIGINT', terminateForSigint);
    process.removeListener('SIGTERM', terminateForSigterm);
  }
}
