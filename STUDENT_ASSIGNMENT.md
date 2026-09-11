# Student Assignment: Containerize the Incident Management System

You are given a working React frontend, Express backend, and PostgreSQL requirement. Your task is to create the Docker configuration.

## Required deliverables

1. `backend/Dockerfile`
2. `backend/.dockerignore`
3. `frontend/Dockerfile`
4. `frontend/.dockerignore`
5. Nginx configuration for the frontend
6. `compose.yaml`
7. Updated run instructions

## Acceptance criteria

- `docker compose up --build` starts the complete system.
- The UI is available from the host machine.
- The frontend can call the backend through the internal Compose network.
- The backend can connect to PostgreSQL without using `localhost`.
- PostgreSQL data survives `docker compose down` and a later restart.
- The frontend uses a multi-stage build.
- The backend does not run as root.
- Health checks exist for all services.
- Secrets are not embedded in either Dockerfile.
- A new developer can run the project by following the README.

## Bonus challenges

- Add separate development and production Compose files.
- Add resource limits.
- Add a database administration service under a Compose profile.
- Scan the images with Trivy.
- Push versioned images to Docker Hub.
