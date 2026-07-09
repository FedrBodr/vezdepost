<h1 align="center">Vezdepost</h1>

<p align="center">
  <strong>An AI-developed fork of <a href="https://github.com/gitroomhq/postiz-app">Postiz</a></strong> — the open-source social media & messaging scheduling tool.
</p>

<p align="center">
<a href="https://opensource.org/license/agpl-v3">
  <img src="https://img.shields.io/badge/License-AGPL%203.0-blue.svg" alt="License">
</a>
</p>

---

## What is Vezdepost?

Vezdepost is a fork of [Postiz](https://github.com/gitroomhq/postiz-app) (by [Gitroom](https://gitroom.com)) that adds providers and fixes the upstream project doesn't (yet) carry — most notably support for messengers popular in regions Postiz doesn't focus on.

It is otherwise the same product: schedule and publish posts across 30+ social networks and messaging platforms, with a calendar, analytics, team management and a media library.

### Why a separate fork?

This project is **developed with the help of AI tools** (primarily [Claude Code](https://claude.com/claude-code)). Postiz's upstream project does not accept AI-generated pull requests, so instead of upstreaming these changes we maintain them here as a transparent, openly-licensed fork.

We keep the fork honest and low-friction:

- **Synced with upstream weekly** — an automated GitHub Actions workflow merges the latest `gitroomhq/postiz-app` every Monday. Clean merges open an automatic PR; conflicts open a labelled PR for manual resolution.
- **Minimal diff** — we do not rename packages, paths, internal identifiers, Docker images or env variables. Our changes are additive and isolated so upstream merges stay easy.
- **Attribution preserved** — the original Postiz copyright and AGPL-3.0 license are kept intact (see [LICENSE](LICENSE)).

## What's different from upstream

| Feature | Status |
|---------|--------|
| **MAX messenger provider** — connect a MAX channel (bot-admin model, like Telegram) and publish text & images | ✅ Available |
| _More providers_ | 🔜 Planned |

> **Note on MAX + Russian hosting:** the MAX Bot API serves TLS certificates from both the new Let's Encrypt hierarchy and the Russian Trusted CA (Минцифры) depending on host/SNI. When self-hosting, Node may need those roots via `NODE_EXTRA_CA_CERTS`. Video posting to MAX is intentionally disabled until async-upload readiness handling is implemented.

## Getting started

Vezdepost is a drop-in replacement for Postiz — the setup, environment variables and Docker images are unchanged. Follow the upstream documentation:

- **Docs:** https://docs.postiz.com
- **Self-hosting:** https://docs.postiz.com/installation/docker-compose

## Credits & upstream

Vezdepost is built on top of **[Postiz](https://github.com/gitroomhq/postiz-app)** by **[Gitroom](https://gitroom.com)**. All credit for the underlying product goes to the Postiz team and its contributors. If you want the canonical, non-forked project, use Postiz directly.

- Upstream repository: https://github.com/gitroomhq/postiz-app
- Upstream website: https://postiz.com

## License

This repository's source code is available under the [AGPL-3.0 license](LICENSE), the same license as upstream Postiz. The original Gitroom copyright is retained.
