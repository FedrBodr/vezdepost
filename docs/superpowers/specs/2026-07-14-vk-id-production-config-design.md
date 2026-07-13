Project: postiz-app
Document: design-spec

# VK ID Production Configuration Design

**Goal:** Enable the already-deployed `vk` and `vk-group` providers by passing
the VK ID application ID to the Postiz production container.

**Date:** 2026-07-14
**Status:** approved by user

## Configuration

Add `VK_ID: '${VK_ID:?set in .env}'` to the `postiz` service environment in
`docker-compose.override.yaml`. Store the public numeric application ID only in
the server-side, untracked `/root/postiz-app/.env` file as `VK_ID=54677685`.

This keeps the deployment reproducible: tracked Compose configuration declares
the required variable, while the environment-specific value remains outside
the image and git history. The VK community access token is not used or stored.

## Deployment

Create an idempotent numbered script under `docs/server-scripts/`. The script
accepts the application ID as an argument, validates that it is numeric, updates
or appends `VK_ID` in `/root/postiz-app/.env` without printing the file, sets
mode `0600`, and runs `docker compose up -d postiz` from the repository root.

The tracked Compose change is committed and pushed to `prod` without including
unrelated working-tree changes. Autodeploy applies the tracked configuration;
the server script supplies the host-specific value and may be safely rerun.

## Verification

After deployment:

1. Confirm `.env` contains a `VK_ID` key without printing its value.
2. Confirm the running `postiz` container contains a `VK_ID` key.
3. Confirm all relevant Compose services remain running.
4. Open the generated VK Group OAuth URL and verify it contains client ID
   `54677685`, the `vk-group` redirect URI, and the `groups` scope.
5. Complete a manual `Add Channel -> VK Group` connection and publish a text
   test post as the community.

## Failure Handling

The Compose declaration uses the required-variable form, so a missing server
value fails deployment explicitly instead of starting a broken integration.
The script aborts on invalid IDs or failed Compose operations. Existing `.env`
entries and unrelated local changes are preserved.
