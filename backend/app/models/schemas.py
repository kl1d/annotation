from typing import Any

from pydantic import BaseModel, Field


class ProjectSummary(BaseModel):
    project_name: str
    participant_id_regex: str
    paths: dict[str, str]


class ProjectTarget(BaseModel):
    project_id: str
    label: str
    path: str
    active: bool = False


class ProjectSelection(BaseModel):
    active_project: str
    available_projects: list[ProjectTarget]


class ProjectSelectionUpdate(BaseModel):
    project_id: str


class NotebookConfig(BaseModel):
    enabled: bool = True
    available: bool = False
    url: str
    launch_url: str
    token_required: bool = True
    active_project: str
    workspace_path: str
    status_message: str = "Notebook service is not running."
    start_command: str = "docker compose --profile notebooks up -d notebooks"
    theme: str = "JupyterLab Dark"
    available_themes: list[str] = Field(
        default_factory=lambda: ["JupyterLab Dark", "JupyterLab Light"]
    )


class NotebookThemeUpdate(BaseModel):
    theme: str


class ConfigFile(BaseModel):
    name: str
    path: str
    content: str


class ConfigFileUpdate(BaseModel):
    content: str


class AnnotationSchemaField(BaseModel):
    key: str
    label: str
    required: bool = False
    input: str = "text"
    options: list[str] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)


class AnnotationSchema(BaseModel):
    event_types: list[str] = Field(default_factory=list)
    required_event_fields: list[str] = Field(default_factory=list)
    optional_event_fields: list[str] = Field(default_factory=list)
    fields: list[AnnotationSchemaField] = Field(default_factory=list)


class SessionSummary(BaseModel):
    session_id: str
    participant_id: str
    status: str = "needs_review"
    video_path: str = ""
    video_url: str | None = None
    log_path: str = ""
    pre_survey_path: str = ""
    progression_survey_path: str = ""
    post_survey_path: str = ""
    annotation_count: int = 0
    starred_count: int = 0
    last_updated: str | None = None


class SessionUpdate(BaseModel):
    status: str | None = None


class EventBase(BaseModel):
    source_type: str = "video"
    task_path: str = ""
    event_type: str = "other"
    title: str = ""
    observation: str = ""
    interpretation: str = ""
    evidence_note: str = ""
    confidence: str = "medium"
    follow_up: str = ""
    starred: bool = False


class EventCreate(EventBase):
    start_time_sec: float = 0
    end_time_sec: float | None = None
    tag_ids: list[str] = Field(default_factory=list)


class EventUpdate(BaseModel):
    start_time_sec: float | None = None
    end_time_sec: float | None = None
    source_type: str | None = None
    task_path: str | None = None
    event_type: str | None = None
    title: str | None = None
    observation: str | None = None
    interpretation: str | None = None
    evidence_note: str | None = None
    confidence: str | None = None
    follow_up: str | None = None
    starred: bool | None = None
    tag_ids: list[str] | None = None


class TagCreate(BaseModel):
    name: str
    category: str
    color: str = ""
    description: str = ""


class TagUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    color: str | None = None
    description: str | None = None
    archived: bool | None = None


class MemoUpdate(BaseModel):
    title: str = "Session memo"
    body: str = ""


class IngestResult(BaseModel):
    participants: int
    sessions: int
    surveys: int
    logs: int
    tags_seeded: int


class SessionDetail(BaseModel):
    session: SessionSummary
    events: list[dict[str, Any]]
    memo: dict[str, Any]
    logs: list[dict[str, Any]]
    surveys: list[dict[str, Any]]


class SessionCsvFile(BaseModel):
    file_id: str
    label: str
    path: str
    description: str = ""
    row_count: int = 0


class SessionCsvPreview(BaseModel):
    file_id: str
    label: str
    path: str
    description: str = ""
    columns: list[str]
    rows: list[dict[str, str]]
    row_count: int = 0
