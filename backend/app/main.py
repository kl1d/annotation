import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import build_router
from app.services.project_service import ProjectService

project_root = Path(os.environ.get("PROJECT_ROOT", "/project")).resolve()
project_service = ProjectService(project_root)

app = FastAPI(title="CTF-P Annotation App")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(build_router(project_service))

assets_dir = project_root / "assets"
assets_dir.mkdir(parents=True, exist_ok=True)
app.mount("/project-assets", StaticFiles(directory=assets_dir), name="project-assets")
