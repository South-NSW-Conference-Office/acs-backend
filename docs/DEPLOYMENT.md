# Adventist Community Services Deployment

**Migrated 2026-08-17** from Genesis (kylevps, amd64) to morpheus (NVIDIA
GB10, arm64) + a public API proxy stub on snswserver. See
[`deploy/README.md`](../deploy/README.md) for the full runbook.

This backend is deployed via GitHub Actions:

1. Commit to `main` (prod) or `staging` triggers the matching Docker build
   workflow — native `linux/arm64` build on an `ubuntu-24.04-arm` runner.
2. The workflow pushes `ghcr.io/south-nsw-conference-office/acs-backend:latest`
   (or `:staging`).
3. `deploy-backend` runs directly ON morpheus via its self-hosted Actions
   runner (label `morpheus`) — pull-only, no SSH involved.
4. (Prod workflow only) `deploy-api-proxy` syncs the reverse-proxy stub on
   snswserver that exposes `api.communityservices.org.au` /
   `staging-api.communityservices.org.au` publicly, forwarding to morpheus
   over Tailscale.

If deploys fail, check that morpheus's self-hosted runner is online (repo →
Settings → Actions → Runners) and that repo secret `SNSW_SSH_KEY` is valid for
the `deploy-api-proxy` job.
