# CTF-P Annotation App

Dockerized, local-first session review and annotation app for screen recordings, logs, and surveys.

## Run

```bash
docker compose up --build
```

Frontend: `http://localhost:5173`  
Backend API: `http://localhost:8000/api`

## Project layout

- `frontend/`: React + Vite UI
- `backend/`: FastAPI API and CSV-backed services
- `project/`: mounted study project with config, raw assets, and canonical CSV data

## Current status

This is the first scaffold:
- Dockerized frontend/backend
- Config-driven project loading
- Folder-based ingest for videos, survey CSVs, and participant log folders
- Session dashboard and review workspace
- Timeline event CRUD
- Tags, memo, logs, surveys, and CSV export routes

