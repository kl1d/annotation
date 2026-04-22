from typing import Any

from pydantic import BaseModel, Field


class ProjectSummary(BaseModel):
    project_name: str
    participant_id_regex: str
    paths: dict[str, str]


class SessionSummary(BaseModel):
    session_id: str
    participant_id: str
    status: str = "active"
    video_path: str = ""
    video_url: str | None = None
    log_path: str = ""
    pre_survey_path: str = ""
    progression_survey_path: str = ""
    post_survey_path: str = ""
    annotation_count: int = 0
    starred_count: int = 0
    last_updated: str | None = None


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

