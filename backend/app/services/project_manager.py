import json
from pathlib import Path
from typing import Any

from app.services.project_service import ProjectService


class ProjectManager:
    def __init__(
        self,
        workspace_root: Path | None,
        default_project_id: str = "project",
        fallback_root: Path | None = None,
    ) -> None:
        self.workspace_root = workspace_root.resolve() if workspace_root else None
        self.default_project_id = default_project_id
        self.fallback_root = fallback_root.resolve() if fallback_root else None
        self.state_path = (
            self.workspace_root / ".annotation-workbench.local.json"
            if self.workspace_root
            else None
        )
        self.active_project_id = self._initial_active_project_id()
        self._service = ProjectService(self._project_root_for_id(self.active_project_id))

    def get_service(self) -> ProjectService:
        return self._service

    def list_projects(self) -> dict[str, Any]:
        available = []
        for project_id in self._discover_project_ids():
            available.append(
                {
                    "project_id": project_id,
                    "label": self._label_for_project(project_id),
                    "path": project_id,
                    "active": project_id == self.active_project_id,
                }
            )
        return {
            "active_project": self.active_project_id,
            "available_projects": available,
        }

    def set_active_project(self, project_id: str) -> dict[str, Any]:
        project_root = self._project_root_for_id(project_id)
        self.active_project_id = project_id
        self._service = ProjectService(project_root)
        self._save_state(project_id)
        return self.list_projects()

    def _discover_project_ids(self) -> list[str]:
        if not self.workspace_root or not self.workspace_root.exists():
            if self.fallback_root:
                return [self.fallback_root.name]
            return [self.default_project_id]

        project_ids: list[str] = []
        for child in sorted(self.workspace_root.iterdir()):
            if child.name.startswith(".") or not child.is_dir():
                continue
            if (child / "config").is_dir() and (child / "assets").is_dir() and (child / "data").is_dir():
                project_ids.append(child.name)

        if self.default_project_id not in project_ids:
            default_root = self.workspace_root / self.default_project_id
            if default_root.exists():
                project_ids.insert(0, self.default_project_id)

        if not project_ids and self.fallback_root:
            project_ids.append(self.fallback_root.name)

        return project_ids

    def _initial_active_project_id(self) -> str:
        candidates = self._discover_project_ids()
        saved = self._load_state()
        if saved in candidates:
            return saved
        if self.default_project_id in candidates:
            return self.default_project_id
        if candidates:
            return candidates[0]
        if self.fallback_root:
            return self.fallback_root.name
        return self.default_project_id

    def _project_root_for_id(self, project_id: str) -> Path:
        if self.workspace_root:
            candidate = (self.workspace_root / project_id).resolve()
            try:
                candidate.relative_to(self.workspace_root)
            except ValueError as exc:
                raise ValueError(f"Invalid project path: {project_id}") from exc
            if candidate.exists() and candidate.is_dir():
                return candidate

        if self.fallback_root and self.fallback_root.exists():
            if project_id == self.fallback_root.name or project_id == self.default_project_id:
                return self.fallback_root

        raise ValueError(f"Unknown project: {project_id}")

    def _load_state(self) -> str | None:
        if not self.state_path or not self.state_path.exists():
            return None
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        project_id = data.get("active_project")
        return project_id if isinstance(project_id, str) else None

    def _save_state(self, project_id: str) -> None:
        if not self.state_path:
            return
        try:
            self.state_path.write_text(
                json.dumps({"active_project": project_id}, indent=2),
                encoding="utf-8",
            )
        except OSError:
            return

    @staticmethod
    def _label_for_project(project_id: str) -> str:
        if project_id == "project":
            return "Sample public project"
        if project_id == "project.local":
            return "Private local project"
        return project_id.replace("-", " ").replace("_", " ").title()
