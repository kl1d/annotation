import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import build_router
from app.services.project_manager import ProjectManager

workspace_root = Path(os.environ.get("WORKSPACE_ROOT", "/workspace")).resolve()
default_project_id = os.environ.get("PROJECT_DIR", "project")
fallback_project_root = Path(os.environ.get("PROJECT_ROOT", "/project")).resolve()
project_manager = ProjectManager(
    workspace_root=workspace_root,
    default_project_id=default_project_id,
    fallback_root=fallback_project_root,
)

app = FastAPI(title="Annotation Workbench API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(build_router(project_manager))
