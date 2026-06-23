# Security Policy

## Supported versions

Plume is pre-1.0. Security fixes are applied to the `main` branch and the latest
tagged release. Self-hosters should track `main` or the most recent release.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use one of the following private channels:

- Open a [GitHub security advisory](https://github.com/plume-docs/plume/security/advisories/new)
  (preferred), or
- Email **security@plume.dev** _(replace with your project's real security contact
  before publishing the repository)_.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (a proof-of-concept if possible).
- The affected version / commit.

We will acknowledge your report within **72 hours**, keep you informed of
progress, and credit you in the release notes unless you prefer to remain
anonymous. Please give us a reasonable window to ship a fix before any public
disclosure.

## Hardening your deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the production security checklist —
generating a strong `BETTER_AUTH_SECRET`, keeping datastore ports private, and
serving behind a TLS-terminating reverse proxy.
