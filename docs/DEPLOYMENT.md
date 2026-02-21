# Deployment Pipeline

Reusable deployment pipeline: GitHub Actions → DockerHub → Watchtower → Server.

## Overview

```
Push to repo
    ↓
GitHub Actions (CI/CD)
    ↓
Build Docker image → Push to DockerHub
    ↓
Watchtower on server detects new image → pulls & restarts container
```

## 1. Project Setup

### Dockerfile

In the project root, create a `Dockerfile` for building the production image.

### GitHub Actions Workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Build & Push Docker Image

on:
  push:
    branches: [main]

jobs:
  build-and-push:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Log in to DockerHub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ secrets.DOCKERHUB_USERNAME }}/<image-name>:latest
            ${{ secrets.DOCKERHUB_USERNAME }}/<image-name>:${{ github.sha }}
```

### GitHub Secrets

Add these secrets to the repo (`Settings → Secrets and variables → Actions`):

| Secret               | Value                        |
| -------------------- | ---------------------------- |
| `DOCKERHUB_USERNAME` | Your DockerHub username      |
| `DOCKERHUB_TOKEN`    | DockerHub access token (not password) |

---

## 2. Server Init (One-Time Setup)

### 2.1. Create project directory

```bash
mkdir -p /opt/<project-name>
cd /opt/<project-name>
```

### 2.2. Create `.env` file

```bash
nano .env
```

Add all required environment variables for the project. This file is **not** in the repo — it lives only on the server.

### 2.3. Create `docker-compose.yml`

```yaml
services:
  app:
    image: <dockerhub-username>/<image-name>:latest
    container_name: <project-name>
    restart: unless-stopped
    ports:
      - "<LOCAL_PORT>:3000"   # Use a unique port to avoid conflicts
    env_file:
      - .env
    labels:
      - "com.centurylinklabs.watchtower.enable=true"

  watchtower:
    image: containrrr/watchtower
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_POLL_INTERVAL=60        # Check every 60 seconds
      - WATCHTOWER_LABEL_ENABLE=true       # Only watch labeled containers
    # If DockerHub requires auth:
    #   - REPO_USER=<dockerhub-username>
    #   - REPO_PASS=<dockerhub-token>
```

> **Port convention**: pick a unique `<LOCAL_PORT>` per project (e.g. 3001, 3002, ...) to avoid conflicts with other services on the same server.

> **Watchtower**: if you already have a shared Watchtower instance on the server, remove the `watchtower` service from this file and just keep the label on the `app` service.

### 2.4. Start

```bash
docker compose up -d
```

---

## 3. Routine Deploy

After init, every deploy is automatic:

1. Push to `main`
2. GitHub Actions builds the image and pushes to DockerHub
3. Watchtower detects the new image, pulls it, and restarts the container

No manual steps required.

---

## 4. Checklist for New Projects

- [ ] `Dockerfile` in project root
- [ ] `.github/workflows/deploy.yml` configured
- [ ] `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` added to GitHub secrets
- [ ] On server: project directory created (`/opt/<project-name>`)
- [ ] On server: `.env` file with all required variables
- [ ] On server: `docker-compose.yml` with unique local port
- [ ] On server: `docker compose up -d`
- [ ] Watchtower running (shared or per-project)
