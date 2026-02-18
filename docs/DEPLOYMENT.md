# Adventist Community Services Deployment

This backend is deployed via GitHub Actions:

1. Commit to `main` triggers the Docker build workflow.
2. The workflow pushes `ghcr.io/south-nsw-conference-office/acs-backend:latest`.
3. CI SSHs into Genesis (`/opt/adventist-community-services`) and runs `docker compose pull && up -d`.

If deploys fail, verify the `VPS_HOST`, `VPS_USERNAME`, and `VPS_SSH_KEY` secrets.
