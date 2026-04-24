# Annotation Workbench

Dockerized, local-first session review and annotation app for screen recordings, logs, and surveys.

## Requirements

- Docker
- Docker Compose

## Run The Public Sample

```bash
docker compose up --build
```

This starts the app against the tracked sample project in `project/`.

## Run Your Private Local Study

To run the app against your real local study data instead of the sample project:

```bash
PROJECT_DIR=project.local docker compose up --build
```

Frontend: `http://localhost:5173`  
Backend API: `http://localhost:8000/api`

## Project layout

- `frontend/`: React + Vite UI
- `backend/`: FastAPI API and CSV-backed services
- `project/`: tracked sample project for the public repo
- `project.local/`: your real local study project data and config
- `docs/`: static GitHub Pages landing site for public documentation and project overview

## Study-specific files

The real files in `project.local/` are intended to stay local for each study.

- tracked in Git: the sample `project/` plus reusable config templates
- ignored locally: `project.local/`

The public repo includes a generic sample `project/` that is safe to publish. Your real study data
can stay in `project.local/`, and Docker can target it with `PROJECT_DIR=project.local`.

## Public Docs

- landing/docs site source: `docs/`
- GitHub Pages URL: `https://kl1d.github.io/annotation/`

## Current status

This is the first scaffold:
- Dockerized frontend/backend
- Config-driven project loading
- Folder-based ingest for videos, survey CSVs, and participant log folders
- Session dashboard and review workspace
- Timeline event CRUD
- Tags, memo, logs, surveys, and CSV export routes

## Notes For Open-source Use

- the repo ships with a safe sample project in `project/`
- your real study files should stay in `project.local/`
- the sample project can be replaced with your own config and assets without changing app code
