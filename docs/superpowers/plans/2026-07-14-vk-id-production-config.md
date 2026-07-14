# VK ID Production Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pass VK ID application ID `54677685` to the production Postiz container so the deployed `vk` and `vk-group` providers can complete OAuth.

**Architecture:** The tracked Compose override declares `VK_ID` as a required environment variable. An idempotent server script stores the numeric public application ID in the untracked production `.env`, then Compose recreates only the Postiz service. Deployment and verification never print the complete `.env` or any access token.

**Tech Stack:** Docker Compose, Bash, Postiz production runbooks

## Global Constraints

- Preserve all unrelated work in the primary checkout.
- Do not store or use the VK community access token.
- Store the application ID in `/root/postiz-app/.env` as `VK_ID=54677685`.
- Fail explicitly if `VK_ID` is absent or non-numeric.
- Do not rebuild the image for this environment-only restart.

---

### Task 1: Declare and install the VK ID setting

**Files:**
- Modify: `docker-compose.override.yaml`
- Create: `docs/server-scripts/12-configure-vk-id.sh`

**Interfaces:**
- Consumes: a numeric VK application ID as the script's first argument.
- Produces: `VK_ID` in `/root/postiz-app/.env` and the same key in the running `postiz` container after the tracked Compose change is deployed.

- [ ] **Step 1: Add the required Compose environment mapping**

Add this entry to the `postiz.environment` mapping beside the other social provider settings:

```yaml
      VK_ID: '${VK_ID:?set in .env}'
```

- [ ] **Step 2: Create the idempotent server script**

Create `docs/server-scripts/12-configure-vk-id.sh` with strict Bash mode. It must validate `^[0-9]+$`, update a single `VK_ID=` line through a temporary file, preserve every other `.env` line, set mode `0600`, validate Compose configuration, and run `docker compose up -d --no-build postiz`. It must print only presence/status messages, never the `.env` contents.

- [ ] **Step 3: Run static verification**

Run:

```bash
bash -n docs/server-scripts/12-configure-vk-id.sh
VK_ID=54677685 JWT_SECRET=x TELEGRAM_TOKEN=x MAX_TOKEN=x docker compose config --quiet
git diff --check
```

Expected: all commands exit `0` with no error output.

- [ ] **Step 4: Commit the implementation**

```bash
git add docker-compose.override.yaml docs/server-scripts/12-configure-vk-id.sh
git commit -m "ops: configure VK ID for production"
```

### Task 2: Apply and verify production configuration

**Files:**
- Read: `docs/server-scripts/12-configure-vk-id.sh`

**Interfaces:**
- Consumes: committed Task 1 files and SSH alias `vezdepost`.
- Produces: a healthy production container with `VK_ID` present.

- [ ] **Step 1: Install the server-side value before tracked deployment**

Run the script over SSH with the public application ID argument:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 vezdepost \
  'bash -s -- 54677685' < docs/server-scripts/12-configure-vk-id.sh
```

Expected: numeric validation passes and `/root/postiz-app/.env` gains the key. The first Compose invocation may leave the old container without `VK_ID` until the tracked override is deployed.

- [ ] **Step 2: Fast-forward production**

Push the isolated branch commit to `origin/prod` only if `git merge-base --is-ancestor origin/prod HEAD` succeeds and the outgoing commits contain only the VK design, plan, and implementation.

- [ ] **Step 3: Wait for autodeploy and verify without exposing values**

Over SSH, wait for the deployed revision, then check:

```bash
grep -q '^VK_ID=' /root/postiz-app/.env
docker inspect postiz --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -q '^VK_ID='
docker compose ps
```

Expected: both key-presence checks exit `0`; `postiz` and dependencies are running.

- [ ] **Step 4: Verify the OAuth configuration manually**

In Postiz, choose `Add Channel -> VK Group`. The VK authorization request must use client ID `54677685`, redirect URI `https://app.vezdepost.ru/integrations/social/vk-group`, and include the `groups` scope. Complete authorization, select the new group, and publish a text test post as the community.
