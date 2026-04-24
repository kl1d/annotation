import csv
import fnmatch
import json
import re
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

import yaml

from app.models.schemas import ProjectSummary, SessionSummary
from app.repositories.csv_repository import CsvRepository

PARTICIPANTS_FIELDS = ["participant_id", "experience_level", "ctf_familiarity", "notes"]
SESSIONS_FIELDS = [
    "session_id",
    "participant_id",
    "video_path",
    "log_path",
    "pre_survey_path",
    "progression_survey_path",
    "post_survey_path",
    "status",
    "created_at",
]
EVENT_FIELDS = [
    "event_id",
    "session_id",
    "participant_id",
    "start_time_sec",
    "end_time_sec",
    "source_type",
    "task_path",
    "event_type",
    "title",
    "observation",
    "interpretation",
    "evidence_note",
    "confidence",
    "follow_up",
    "starred",
    "created_at",
    "updated_at",
]
TAG_FIELDS = ["tag_id", "name", "category", "color", "description", "archived"]
EVENT_TAG_FIELDS = ["event_id", "tag_id"]
MEMO_FIELDS = ["memo_id", "session_id", "participant_id", "title", "body", "last_updated"]
SURVEY_FIELDS = [
    "row_id",
    "session_id",
    "participant_id",
    "survey_name",
    "question_id",
    "question_text",
    "response",
    "source_path",
]
LOG_FIELDS = [
    "log_event_id",
    "session_id",
    "participant_id",
    "source_file",
    "line_number",
    "timestamp_sec",
    "event_class",
    "raw_text",
    "command",
    "path",
    "exit_code",
    "extra_json",
]
EVIDENCE_FIELDS = [
    "evidence_id",
    "event_id",
    "evidence_type",
    "source_ref",
    "start_time_sec",
    "end_time_sec",
    "log_event_id",
    "survey_row_id",
    "note",
]


class ProjectService:
    EDITABLE_CONFIG_FILES = {
        "project": "project.yaml",
        "survey_mappings": "survey_mappings.yaml",
        "log_mappings": "log_mappings.yaml",
        "annotation_schema": "annotation_schema.yaml",
        "codebook": "codebook.yaml",
        "asset_mappings": "asset_mappings.yaml",
    }

    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root
        self.config_dir = project_root / "config"
        self.data_dir = project_root / "data"
        self.assets_dir = project_root / "assets"
        self.repo = CsvRepository(self.data_dir)
        self._lookup_map_cache: dict[tuple[str, str, str, str], dict[str, str]] = {}
        self._ensure_data_files()

    def _ensure_data_files(self) -> None:
        self.repo.ensure_file("participants.csv", PARTICIPANTS_FIELDS)
        self.repo.ensure_file("sessions.csv", SESSIONS_FIELDS)
        self.repo.ensure_file("timeline_events.csv", EVENT_FIELDS)
        self.repo.ensure_file("tags.csv", TAG_FIELDS)
        self.repo.ensure_file("event_tags.csv", EVENT_TAG_FIELDS)
        self.repo.ensure_file("memos.csv", MEMO_FIELDS)
        self.repo.ensure_file("survey_answers.csv", SURVEY_FIELDS)
        self.repo.ensure_file("log_events.csv", LOG_FIELDS)
        self.repo.ensure_file("event_evidence.csv", EVIDENCE_FIELDS)

    def load_yaml(self, filename: str) -> dict[str, Any]:
        path = self.config_dir / filename
        if not path.exists():
            return {}
        with path.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
        return data

    def list_config_files(self) -> list[dict[str, str]]:
        files = []
        for name, filename in self.EDITABLE_CONFIG_FILES.items():
            path = self.config_dir / filename
            files.append(
                {
                    "name": name,
                    "path": str(path.relative_to(self.project_root)),
                    "content": path.read_text(encoding="utf-8") if path.exists() else "",
                }
            )
        return files

    def get_config_file(self, name: str) -> dict[str, str]:
        filename = self.EDITABLE_CONFIG_FILES.get(name)
        if not filename:
            raise ValueError(f"Unknown config file: {name}")
        path = self.config_dir / filename
        return {
            "name": name,
            "path": str(path.relative_to(self.project_root)),
            "content": path.read_text(encoding="utf-8") if path.exists() else "",
        }

    def update_config_file(self, name: str, content: str) -> dict[str, str]:
        filename = self.EDITABLE_CONFIG_FILES.get(name)
        if not filename:
            raise ValueError(f"Unknown config file: {name}")
        try:
            yaml.safe_load(content or "")
        except yaml.YAMLError as exc:
            raise ValueError(f"Invalid YAML for {filename}: {exc}") from exc

        path = self.config_dir / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(
            "w",
            encoding="utf-8",
            delete=False,
            dir=path.parent,
        ) as tmp:
            tmp.write(content)
            temp_path = Path(tmp.name)
        temp_path.replace(path)
        return {
            "name": name,
            "path": str(path.relative_to(self.project_root)),
            "content": path.read_text(encoding="utf-8"),
        }

    def project_summary(self) -> ProjectSummary:
        project_config = self.load_yaml("project.yaml")
        return ProjectSummary(
            project_name=project_config.get("project_name", "CTF-P Annotation Project"),
            participant_id_regex=project_config.get("matching", {}).get(
                "participant_id_regex", "(?P<participant_id>[A-Za-z0-9_-]+)"
            ),
            paths=project_config.get("paths", {}),
        )

    def list_sessions(self) -> list[SessionSummary]:
        sessions = self.repo.read_rows("sessions.csv", SESSIONS_FIELDS)
        events = self.repo.read_rows("timeline_events.csv", EVENT_FIELDS)
        counts_by_session = defaultdict(int)
        starred_by_session = defaultdict(int)
        last_updated_by_session: dict[str, str] = {}

        for event in events:
            session_id = event.get("session_id", "")
            if not session_id:
                continue
            counts_by_session[session_id] += 1
            if event.get("starred", "").lower() == "true":
                starred_by_session[session_id] += 1
            updated_at = event.get("updated_at", "")
            if updated_at and updated_at > last_updated_by_session.get(session_id, ""):
                last_updated_by_session[session_id] = updated_at

        results: list[SessionSummary] = []
        for row in sessions:
            video_path = row.get("video_path", "")
            results.append(
                SessionSummary(
                    session_id=row.get("session_id", ""),
                    participant_id=row.get("participant_id", ""),
                    status=row.get("status", "active"),
                    video_path=video_path,
                    video_url=self.asset_url(video_path),
                    log_path=row.get("log_path", ""),
                    pre_survey_path=row.get("pre_survey_path", ""),
                    progression_survey_path=row.get("progression_survey_path", ""),
                    post_survey_path=row.get("post_survey_path", ""),
                    annotation_count=counts_by_session.get(row.get("session_id", ""), 0),
                    starred_count=starred_by_session.get(row.get("session_id", ""), 0),
                    last_updated=last_updated_by_session.get(row.get("session_id", "")),
                )
            )
        return sorted(results, key=lambda session: session.participant_id)

    def get_session(self, session_id: str) -> SessionSummary | None:
        for session in self.list_sessions():
            if session.session_id == session_id:
                return session
        return None

    def list_events(self, session_id: str) -> list[dict[str, Any]]:
        events = self.repo.read_rows("timeline_events.csv", EVENT_FIELDS)
        event_tags = self.repo.read_rows("event_tags.csv", EVENT_TAG_FIELDS)
        tags = {
            row["tag_id"]: row
            for row in self.repo.read_rows("tags.csv", TAG_FIELDS)
            if row.get("tag_id")
        }
        tags_by_event: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in event_tags:
            tag = tags.get(row.get("tag_id", ""))
            if tag:
                tags_by_event[row.get("event_id", "")].append(tag)

        results: list[dict[str, Any]] = []
        for event in events:
            if event.get("session_id") != session_id:
                continue
            event_copy = dict(event)
            event_copy["tag_ids"] = [tag["tag_id"] for tag in tags_by_event.get(event["event_id"], [])]
            event_copy["tags"] = tags_by_event.get(event["event_id"], [])
            results.append(event_copy)
        return sorted(results, key=lambda row: float(row.get("start_time_sec", 0) or 0))

    def create_event(self, session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        session = self.get_session(session_id)
        if not session:
            raise ValueError(f"Unknown session: {session_id}")
        existing = self.repo.read_rows("timeline_events.csv", EVENT_FIELDS)
        event_id = f"E{len(existing) + 1:04d}"
        timestamp = now_iso()
        row = {
            "event_id": event_id,
            "session_id": session_id,
            "participant_id": session.participant_id,
            "start_time_sec": payload.get("start_time_sec", 0),
            "end_time_sec": payload.get("end_time_sec", ""),
            "source_type": payload.get("source_type", "video"),
            "task_path": payload.get("task_path", ""),
            "event_type": payload.get("event_type", "other"),
            "title": payload.get("title", ""),
            "observation": payload.get("observation", ""),
            "interpretation": payload.get("interpretation", ""),
            "evidence_note": payload.get("evidence_note", ""),
            "confidence": payload.get("confidence", "medium"),
            "follow_up": payload.get("follow_up", ""),
            "starred": payload.get("starred", False),
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        self.repo.append_row("timeline_events.csv", EVENT_FIELDS, row)
        self._set_event_tags(event_id, payload.get("tag_ids", []))
        return row

    def update_event(self, event_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        rows = self.repo.read_rows("timeline_events.csv", EVENT_FIELDS)
        updated: dict[str, Any] | None = None
        for row in rows:
            if row.get("event_id") != event_id:
                continue
            for key, value in payload.items():
                if key == "tag_ids" or value is None:
                    continue
                row[key] = value
            row["updated_at"] = now_iso()
            updated = row
            break
        if not updated:
            raise ValueError(f"Unknown event: {event_id}")
        self.repo.write_rows("timeline_events.csv", EVENT_FIELDS, rows)
        if payload.get("tag_ids") is not None:
            self._set_event_tags(event_id, payload["tag_ids"])
        return updated

    def delete_event(self, event_id: str) -> None:
        rows = self.repo.read_rows("timeline_events.csv", EVENT_FIELDS)
        kept_rows = [row for row in rows if row.get("event_id") != event_id]
        self.repo.write_rows("timeline_events.csv", EVENT_FIELDS, kept_rows)
        event_tags = self.repo.read_rows("event_tags.csv", EVENT_TAG_FIELDS)
        kept_tags = [row for row in event_tags if row.get("event_id") != event_id]
        self.repo.write_rows("event_tags.csv", EVENT_TAG_FIELDS, kept_tags)

    def list_tags(self) -> list[dict[str, str]]:
        rows = self.repo.read_rows("tags.csv", TAG_FIELDS)
        return sorted(rows, key=lambda row: (row.get("archived", "false"), row.get("name", "")))

    def create_tag(self, payload: dict[str, Any]) -> dict[str, str]:
        existing = self.repo.read_rows("tags.csv", TAG_FIELDS)
        tag_id = f"T{len(existing) + 1:03d}"
        row = {
            "tag_id": tag_id,
            "name": payload["name"],
            "category": payload["category"],
            "color": payload.get("color", ""),
            "description": payload.get("description", ""),
            "archived": False,
        }
        self.repo.append_row("tags.csv", TAG_FIELDS, row)
        return row

    def update_tag(self, tag_id: str, payload: dict[str, Any]) -> dict[str, str]:
        rows = self.repo.read_rows("tags.csv", TAG_FIELDS)
        updated: dict[str, str] | None = None
        for row in rows:
            if row.get("tag_id") != tag_id:
                continue
            for key, value in payload.items():
                if value is None:
                    continue
                row[key] = value
            updated = row
            break
        if not updated:
            raise ValueError(f"Unknown tag: {tag_id}")
        self.repo.write_rows("tags.csv", TAG_FIELDS, rows)
        return updated

    def get_memo(self, session_id: str) -> dict[str, str]:
        session = self.get_session(session_id)
        if not session:
            raise ValueError(f"Unknown session: {session_id}")
        memos = self.repo.read_rows("memos.csv", MEMO_FIELDS)
        for memo in memos:
            if memo.get("session_id") == session_id:
                return memo
        return {
            "memo_id": "",
            "session_id": session_id,
            "participant_id": session.participant_id,
            "title": f"{session.participant_id} session memo",
            "body": "",
            "last_updated": "",
        }

    def upsert_memo(self, session_id: str, title: str, body: str) -> dict[str, str]:
        session = self.get_session(session_id)
        if not session:
            raise ValueError(f"Unknown session: {session_id}")
        rows = self.repo.read_rows("memos.csv", MEMO_FIELDS)
        timestamp = now_iso()
        for row in rows:
            if row.get("session_id") == session_id:
                row["title"] = title
                row["body"] = body
                row["last_updated"] = timestamp
                self.repo.write_rows("memos.csv", MEMO_FIELDS, rows)
                return row
        memo = {
            "memo_id": f"M{len(rows) + 1:03d}",
            "session_id": session_id,
            "participant_id": session.participant_id,
            "title": title,
            "body": body,
            "last_updated": timestamp,
        }
        rows.append(memo)
        self.repo.write_rows("memos.csv", MEMO_FIELDS, rows)
        return memo

    def list_logs(self, session_id: str) -> list[dict[str, str]]:
        return [
            row
            for row in self.repo.read_rows("log_events.csv", LOG_FIELDS)
            if row.get("session_id") == session_id
        ]

    def list_surveys(self, session_id: str) -> list[dict[str, str]]:
        return [
            row
            for row in self.repo.read_rows("survey_answers.csv", SURVEY_FIELDS)
            if row.get("session_id") == session_id
        ]

    def list_session_csv_files(self, session_id: str) -> list[dict[str, Any]]:
        session = self.get_session(session_id)
        if not session:
            raise ValueError(f"Unknown session: {session_id}")

        files = []
        for definition in self._session_csv_definitions(session):
            rows = definition["rows"]()
            files.append(
                {
                    "file_id": definition["file_id"],
                    "label": definition["label"],
                    "path": f"data/{definition['filename']}",
                    "description": definition["description"],
                    "row_count": len(rows),
                }
            )
        return files

    def get_session_csv_preview(self, session_id: str, file_id: str) -> dict[str, Any]:
        session = self.get_session(session_id)
        if not session:
            raise ValueError(f"Unknown session: {session_id}")

        definition = next(
            (item for item in self._session_csv_definitions(session) if item["file_id"] == file_id),
            None,
        )
        if not definition:
            raise ValueError(f"Unknown session CSV file: {file_id}")

        rows = definition["rows"]()
        return {
            "file_id": definition["file_id"],
            "label": definition["label"],
            "path": f"data/{definition['filename']}",
            "description": definition["description"],
            "columns": definition["fieldnames"],
            "rows": rows,
            "row_count": len(rows),
        }

    def list_project_csv_files(self) -> list[dict[str, Any]]:
        files = []
        for definition in self._project_csv_definitions():
            try:
                preview = self._read_csv_preview(definition["path"])
            except ValueError:
                continue
            files.append(
                {
                    "file_id": definition["file_id"],
                    "label": definition["label"],
                    "path": definition["path"],
                    "description": definition["description"],
                    "row_count": preview["row_count"],
                }
            )
        return files

    def get_project_csv_preview(self, file_id: str) -> dict[str, Any]:
        definition = next(
            (item for item in self._project_csv_definitions() if item["file_id"] == file_id),
            None,
        )
        if not definition:
            raise ValueError(f"Unknown project CSV file: {file_id}")

        preview = self._read_csv_preview(definition["path"])
        return {
            "file_id": definition["file_id"],
            "label": definition["label"],
            "path": definition["path"],
            "description": definition["description"],
            "columns": preview["columns"],
            "rows": preview["rows"],
            "row_count": preview["row_count"],
        }

    def ingest(self) -> dict[str, int]:
        project_config = self.load_yaml("project.yaml")
        survey_config = self.load_yaml("survey_mappings.yaml")
        log_config = self.load_yaml("log_mappings.yaml")
        codebook = self.load_yaml("codebook.yaml")
        asset_mappings = self.load_yaml("asset_mappings.yaml")

        paths = project_config.get("paths", {})
        videos_dir = self.project_root / paths.get("videos_dir", "assets/videos")
        logs_dir = self.project_root / paths.get("logs_dir", "assets/logs")
        participant_regex = re.compile(
            project_config.get("matching", {}).get(
                "participant_id_regex", "(?P<participant_id>[A-Za-z0-9_-]+)"
            )
        )
        mapped_assets = self._asset_mappings_by_participant(asset_mappings)

        survey_rows, participant_metadata = self._parse_surveys(survey_config)
        self.repo.write_rows("survey_answers.csv", SURVEY_FIELDS, survey_rows)

        log_rows = self._parse_logs(logs_dir, participant_regex, log_config, mapped_assets)
        self.repo.write_rows("log_events.csv", LOG_FIELDS, log_rows)

        participant_ids = {
            *mapped_assets.keys(),
            *participant_metadata.keys(),
            *{row["participant_id"] for row in survey_rows},
            *{row["participant_id"] for row in log_rows},
        }
        for video_path in videos_dir.glob("*.mp4"):
            participant_id = self._participant_id_for_video_path(
                str(video_path.relative_to(self.project_root)),
                participant_regex,
                mapped_assets,
            )
            if participant_id:
                participant_ids.add(participant_id)

        participants_rows = []
        for participant_id in sorted(participant_ids):
            metadata = participant_metadata.get(participant_id, {})
            participants_rows.append(
                {
                    "participant_id": participant_id,
                    "experience_level": metadata.get("experience_level", ""),
                    "ctf_familiarity": metadata.get("ctf_familiarity", ""),
                    "notes": metadata.get("notes", ""),
                }
            )
        self.repo.write_rows("participants.csv", PARTICIPANTS_FIELDS, participants_rows)

        sessions_rows = []
        for participant_id in sorted(participant_ids):
            video_path = self._match_video_path(videos_dir, participant_id, mapped_assets)
            log_path = self._match_log_path(logs_dir, participant_id, mapped_assets)
            sessions_rows.append(
                {
                    "session_id": f"S_{participant_id}",
                    "participant_id": participant_id,
                    "video_path": video_path,
                    "log_path": log_path,
                    "pre_survey_path": self._survey_source_for_participant(survey_rows, participant_id, "pre"),
                    "progression_survey_path": self._survey_source_for_participant(
                        survey_rows, participant_id, "progression"
                    ),
                    "post_survey_path": self._survey_source_for_participant(
                        survey_rows, participant_id, "post"
                    ),
                    "status": "active",
                    "created_at": now_iso(),
                }
            )
        self.repo.write_rows("sessions.csv", SESSIONS_FIELDS, sessions_rows)

        tags_seeded = self._sync_codebook(codebook)
        return {
            "participants": len(participants_rows),
            "sessions": len(sessions_rows),
            "surveys": len(survey_rows),
            "logs": len(log_rows),
            "tags_seeded": tags_seeded,
        }

    def export_csv(self, name: str) -> str:
        allowed = {
            "events": ("timeline_events.csv", EVENT_FIELDS),
            "sessions": ("sessions.csv", SESSIONS_FIELDS),
            "design_issues": ("timeline_events.csv", EVENT_FIELDS),
            "merged": ("merged_export.csv", []),
        }
        if name not in allowed:
            raise ValueError(f"Unsupported export: {name}")

        if name == "merged":
            return self._build_merged_csv()

        filename, fieldnames = allowed[name]
        rows = self.repo.read_rows(filename, fieldnames)
        if name == "design_issues":
            rows = [row for row in rows if row.get("event_type") == "design_issue"]
        return rows_to_csv(fieldnames, rows)

    def asset_url(self, relative_path: str) -> str | None:
        if not relative_path:
            return None
        if relative_path.startswith("assets/"):
            return "/project-assets/" + relative_path.removeprefix("assets/")
        return None

    def _set_event_tags(self, event_id: str, tag_ids: list[str]) -> None:
        rows = self.repo.read_rows("event_tags.csv", EVENT_TAG_FIELDS)
        rows = [row for row in rows if row.get("event_id") != event_id]
        rows.extend({"event_id": event_id, "tag_id": tag_id} for tag_id in tag_ids)
        self.repo.write_rows("event_tags.csv", EVENT_TAG_FIELDS, rows)

    def _project_csv_definitions(self) -> list[dict[str, str]]:
        definitions = [
            {
                "file_id": "participants",
                "label": "Participants",
                "path": "data/participants.csv",
                "description": "Participant metadata for the study.",
            },
            {
                "file_id": "sessions",
                "label": "Sessions",
                "path": "data/sessions.csv",
                "description": "Session-level matched records.",
            },
            {
                "file_id": "survey_answers",
                "label": "Survey answers",
                "path": "data/survey_answers.csv",
                "description": "Normalized survey answer rows.",
            },
            {
                "file_id": "log_events",
                "label": "Log events",
                "path": "data/log_events.csv",
                "description": "Parsed log rows from participant sessions.",
            },
            {
                "file_id": "timeline_events",
                "label": "Timeline events",
                "path": "data/timeline_events.csv",
                "description": "Created annotation moments.",
            },
            {
                "file_id": "event_tags",
                "label": "Event tags",
                "path": "data/event_tags.csv",
                "description": "Event-to-tag join table.",
            },
            {
                "file_id": "tags",
                "label": "Tags",
                "path": "data/tags.csv",
                "description": "Codebook tags used in annotation.",
            },
            {
                "file_id": "memos",
                "label": "Memos",
                "path": "data/memos.csv",
                "description": "Session memo records.",
            },
            {
                "file_id": "event_evidence",
                "label": "Event evidence",
                "path": "data/event_evidence.csv",
                "description": "Evidence links tied to annotations.",
            },
        ]

        survey_config = self.load_yaml("survey_mappings.yaml")
        seen_paths = {item["path"] for item in definitions}
        for survey in survey_config.get("surveys", []):
            file_path = survey.get("file", "")
            if file_path and file_path not in seen_paths and file_path.endswith(".csv"):
                definitions.append(
                    {
                        "file_id": f"raw_survey_{survey.get('survey_name', 'survey')}",
                        "label": f"Raw survey: {survey.get('survey_name', 'survey')}",
                        "path": file_path,
                        "description": "Original uploaded survey CSV.",
                    }
                )
                seen_paths.add(file_path)

            mapping = survey.get("participant_id_mapping", {})
            mapping_file = mapping.get("file", "")
            if mapping_file and mapping_file not in seen_paths and mapping_file.endswith(".csv"):
                definitions.append(
                    {
                        "file_id": f"lookup_{Path(mapping_file).stem}",
                        "label": f"Lookup: {Path(mapping_file).name}",
                        "path": mapping_file,
                        "description": "Participant ID lookup mapping.",
                    }
                )
                seen_paths.add(mapping_file)

        return definitions

    def _read_csv_preview(self, relative_path: str) -> dict[str, Any]:
        path = (self.project_root / relative_path).resolve()
        project_root = self.project_root.resolve()
        try:
            path.relative_to(project_root)
        except ValueError as exc:
            raise ValueError(f"Invalid project CSV path: {relative_path}") from exc
        if not path.exists() or not path.is_file():
            raise ValueError(f"CSV file not found: {relative_path}")

        with path.open("r", newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            columns = reader.fieldnames or []
            rows = [dict(row) for row in reader]

        return {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
        }

    def _session_csv_definitions(self, session: SessionSummary) -> list[dict[str, Any]]:
        return [
            {
                "file_id": "session_record",
                "label": "Session record",
                "filename": "sessions.csv",
                "fieldnames": SESSIONS_FIELDS,
                "description": "Canonical session row from the study dataset.",
                "rows": lambda: [
                    row
                    for row in self.repo.read_rows("sessions.csv", SESSIONS_FIELDS)
                    if row.get("session_id") == session.session_id
                ],
            },
            {
                "file_id": "participant_record",
                "label": "Participant record",
                "filename": "participants.csv",
                "fieldnames": PARTICIPANTS_FIELDS,
                "description": "Participant metadata used for the session join.",
                "rows": lambda: [
                    row
                    for row in self.repo.read_rows("participants.csv", PARTICIPANTS_FIELDS)
                    if row.get("participant_id") == session.participant_id
                ],
            },
            {
                "file_id": "survey_answers",
                "label": "Survey answers",
                "filename": "survey_answers.csv",
                "fieldnames": SURVEY_FIELDS,
                "description": "Normalized survey rows for this session.",
                "rows": lambda: self.list_surveys(session.session_id),
            },
            {
                "file_id": "log_events",
                "label": "Log events",
                "filename": "log_events.csv",
                "fieldnames": LOG_FIELDS,
                "description": "Parsed log rows tied to this session.",
                "rows": lambda: self.list_logs(session.session_id),
            },
            {
                "file_id": "timeline_events",
                "label": "Timeline events",
                "filename": "timeline_events.csv",
                "fieldnames": EVENT_FIELDS,
                "description": "Saved annotations for this session.",
                "rows": lambda: self.list_events(session.session_id),
            },
            {
                "file_id": "memos",
                "label": "Memos",
                "filename": "memos.csv",
                "fieldnames": MEMO_FIELDS,
                "description": "Session-level memo records.",
                "rows": lambda: [
                    row
                    for row in self.repo.read_rows("memos.csv", MEMO_FIELDS)
                    if row.get("session_id") == session.session_id
                ],
            },
        ]

    def _asset_mappings_by_participant(
        self, asset_mappings: dict[str, Any]
    ) -> dict[str, dict[str, str]]:
        mappings: dict[str, dict[str, str]] = {}
        for session in asset_mappings.get("sessions", []):
            participant_id = session.get("participant_id", "").strip()
            if not participant_id:
                continue
            mappings[participant_id] = {
                "video_file": session.get("video_file", "").strip(),
                "log_dir": session.get("log_dir", "").strip(),
            }
        return mappings

    def _load_lookup_map(self, mapping_config: dict[str, Any]) -> dict[str, str]:
        cache_key = (
            mapping_config["file"],
            mapping_config["key_column"],
            mapping_config["value_column"],
            mapping_config.get("normalize", "lower"),
        )
        if cache_key in self._lookup_map_cache:
            return self._lookup_map_cache[cache_key]
        source_path = self.project_root / mapping_config["file"]
        key_column = mapping_config["key_column"]
        value_column = mapping_config["value_column"]
        normalize = mapping_config.get("normalize", "lower")
        results: dict[str, str] = {}
        if not source_path.exists():
            return results
        with source_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                key = self._normalize_lookup_value(row.get(key_column, ""), normalize)
                value = row.get(value_column, "").strip()
                if key and value:
                    results[key] = value
        self._lookup_map_cache[cache_key] = results
        return results

    @staticmethod
    def _normalize_lookup_value(value: str, mode: str) -> str:
        cleaned = value.strip()
        if mode == "lower":
            return cleaned.lower()
        return cleaned

    def _map_participant_id(self, raw_value: str, mapping_config: dict[str, Any] | None) -> str:
        if not raw_value:
            return ""
        if not mapping_config:
            return raw_value.strip()
        mapping = self._load_lookup_map(mapping_config)
        lookup_key = self._normalize_lookup_value(
            raw_value, mapping_config.get("normalize", "lower")
        )
        return mapping.get(lookup_key, "")

    def _parse_surveys(
        self, survey_config: dict[str, Any]
    ) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]]]:
        rows: list[dict[str, Any]] = []
        participant_metadata: dict[str, dict[str, str]] = {}
        row_id = 1
        for survey in survey_config.get("surveys", []):
            survey_name = survey["survey_name"]
            source_path = self.project_root / survey["file"]
            if not source_path.exists():
                continue
            if survey.get("format") == "qualtrics":
                file_rows, file_metadata, row_id = self._parse_qualtrics_survey(
                    source_path, survey, row_id
                )
            else:
                file_rows, file_metadata, row_id = self._parse_standard_survey(
                    source_path, survey, row_id
                )
            rows.extend(file_rows)
            for participant_id, metadata in file_metadata.items():
                participant_metadata.setdefault(participant_id, {}).update(metadata)
        return rows, participant_metadata

    def _parse_standard_survey(
        self, source_path: Path, survey: dict[str, Any], row_id: int
    ) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]], int]:
        rows: list[dict[str, Any]] = []
        participant_metadata: dict[str, dict[str, str]] = {}
        participant_column = survey["participant_id_column"]
        question_columns = survey.get("question_columns", [])
        metadata_columns = survey.get("participant_metadata_columns", {})
        mapping_config = survey.get("participant_id_mapping")
        with source_path.open("r", newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            for source_row in reader:
                raw_participant = source_row.get(participant_column, "").strip()
                participant_id = self._map_participant_id(raw_participant, mapping_config)
                if not participant_id:
                    continue
                participant_metadata.setdefault(participant_id, {})
                for key, column in metadata_columns.items():
                    participant_metadata[participant_id][key] = source_row.get(column, "").strip()
                columns_to_use = question_columns or [
                    {
                        "column": key,
                        "question_id": key,
                        "question_text": key.replace("_", " ").title(),
                    }
                    for key in source_row.keys()
                    if key != participant_column and key not in metadata_columns.values()
                ]
                for question in columns_to_use:
                    column_name = question["column"]
                    rows.append(
                        {
                            "row_id": row_id,
                            "session_id": f"S_{participant_id}",
                            "participant_id": participant_id,
                            "survey_name": survey["survey_name"],
                            "question_id": question.get("question_id", column_name),
                            "question_text": question.get("question_text", column_name),
                            "response": source_row.get(column_name, "").strip(),
                            "source_path": survey["file"],
                        }
                    )
                    row_id += 1
        return rows, participant_metadata, row_id

    def _parse_qualtrics_survey(
        self, source_path: Path, survey: dict[str, Any], row_id: int
    ) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]], int]:
        rows: list[dict[str, Any]] = []
        participant_metadata: dict[str, dict[str, str]] = {}
        header_row_index = survey.get("machine_header_row_index", 0)
        question_text_row_index = survey.get("question_text_row_index", 1)
        data_start_row_index = survey.get("data_start_row_index", 3)
        participant_column = survey["participant_id_column"]
        mapping_config = survey.get("participant_id_mapping")
        metadata_columns = survey.get("participant_metadata_columns", {})
        question_columns = survey.get("question_columns", [])
        skip_columns = set(survey.get("skip_columns", []))
        include_only_non_empty = survey.get("include_only_non_empty", True)

        with source_path.open("r", newline="", encoding="utf-8-sig") as handle:
            source_rows = list(csv.reader(handle))
        if len(source_rows) <= header_row_index:
            return rows, participant_metadata, row_id

        headers = source_rows[header_row_index]
        question_texts = (
            source_rows[question_text_row_index]
            if len(source_rows) > question_text_row_index
            else headers
        )
        data_rows = source_rows[data_start_row_index:]

        for raw_row in data_rows:
            if not any(cell.strip() for cell in raw_row):
                continue
            source_row = {
                header: raw_row[index] if index < len(raw_row) else ""
                for index, header in enumerate(headers)
            }
            raw_participant = source_row.get(participant_column, "").strip()
            participant_id = self._map_participant_id(raw_participant, mapping_config)
            if not participant_id:
                continue

            participant_metadata.setdefault(participant_id, {})
            for key, column in metadata_columns.items():
                participant_metadata[participant_id][key] = source_row.get(column, "").strip()

            columns_to_use = question_columns or [
                {
                    "column": header,
                    "question_id": header,
                    "question_text": question_texts[index] if index < len(question_texts) else header,
                }
                for index, header in enumerate(headers)
                if header
                and header not in skip_columns
                and header != participant_column
                and header not in metadata_columns.values()
            ]
            for question in columns_to_use:
                column_name = question["column"]
                response = source_row.get(column_name, "").strip()
                if include_only_non_empty and not response:
                    continue
                rows.append(
                    {
                        "row_id": row_id,
                        "session_id": f"S_{participant_id}",
                        "participant_id": participant_id,
                        "survey_name": survey["survey_name"],
                        "question_id": question.get("question_id", column_name),
                        "question_text": question.get("question_text", column_name),
                        "response": response,
                        "source_path": survey["file"],
                    }
                )
                row_id += 1

        return rows, participant_metadata, row_id

    def _parse_logs(
        self,
        logs_dir: Path,
        participant_regex: re.Pattern[str],
        log_config: dict[str, Any],
        mapped_assets: dict[str, dict[str, str]],
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        log_event_id = 1
        timestamp_patterns = [
            re.compile(pattern["regex"]) for pattern in log_config.get("timestamp_patterns", [])
        ]
        command_patterns = [
            re.compile(pattern["regex"]) for pattern in log_config.get("command_patterns", [])
        ]
        event_class_rules = log_config.get("event_class_rules", [])
        default_event_class = log_config.get("default_event_class", "raw")
        file_rules = log_config.get("file_rules", [])
        participant_by_log_dir = {
            mapping["log_dir"]: participant_id
            for participant_id, mapping in mapped_assets.items()
            if mapping.get("log_dir")
        }

        if not logs_dir.exists():
            return rows

        for participant_dir in sorted(path for path in logs_dir.iterdir() if path.is_dir()):
            relative_dir = str(participant_dir.relative_to(self.project_root))
            participant_id = participant_by_log_dir.get(relative_dir) or self._extract_participant_id(
                participant_dir.name, participant_regex
            )
            if not participant_id:
                continue
            for log_file in sorted(participant_dir.rglob("*.log")):
                rule = self._matching_log_rule(log_file.name, file_rules)
                with log_file.open("r", encoding="utf-8", errors="ignore") as handle:
                    for index, line in enumerate(handle, start=1):
                        raw_text = line.rstrip("\n")
                        timestamp_sec = ""
                        stripped_text = raw_text
                        command = ""
                        extra_json: dict[str, Any] = {}
                        event_class = default_event_class

                        if rule:
                            parsed = self._parse_log_line_with_rule(raw_text, rule)
                            if parsed.get("skip"):
                                continue
                            stripped_text = parsed.get("raw_text", raw_text)
                            command = parsed.get("command", "")
                            event_class = parsed.get("event_class", default_event_class)
                            extra_json = parsed.get("extra_json", {})
                        else:
                            for pattern in timestamp_patterns:
                                match = pattern.search(raw_text)
                                if match:
                                    timestamp_sec = match.groupdict().get("timestamp_sec", "")
                                    stripped_text = (
                                        match.groupdict().get("raw")
                                        or match.groupdict().get("message")
                                        or raw_text
                                    )
                                    break
                            for pattern in command_patterns:
                                match = pattern.search(stripped_text)
                                if match:
                                    command = match.groupdict().get("command", "")
                                    break
                            lowered = stripped_text.lower()
                            for rule_entry in event_class_rules:
                                if rule_entry.get("contains", "").lower() in lowered:
                                    event_class = rule_entry["event_class"]
                                    break
                        rows.append(
                            {
                                "log_event_id": f"L{log_event_id:05d}",
                                "session_id": f"S_{participant_id}",
                                "participant_id": participant_id,
                                "source_file": str(log_file.relative_to(self.project_root)),
                                "line_number": index,
                                "timestamp_sec": timestamp_sec,
                                "event_class": event_class,
                                "raw_text": stripped_text,
                                "command": command,
                                "path": "",
                                "exit_code": "",
                                "extra_json": json.dumps(extra_json),
                            }
                        )
                        log_event_id += 1
        return rows

    def _sync_codebook(self, codebook: dict[str, Any]) -> int:
        rows = []
        for tag in codebook.get("tags", []):
            rows.append(
                {
                    "tag_id": tag["tag_id"],
                    "name": tag["name"],
                    "category": tag["category"],
                    "color": tag.get("color", ""),
                    "description": tag.get("description", ""),
                    "archived": tag.get("archived", False),
                }
            )
        if rows:
            self.repo.write_rows("tags.csv", TAG_FIELDS, rows)
        return len(rows)

    def _match_video_path(
        self, videos_dir: Path, participant_id: str, mapped_assets: dict[str, dict[str, str]]
    ) -> str:
        mapped_video = mapped_assets.get(participant_id, {}).get("video_file", "")
        if mapped_video:
            return mapped_video
        for candidate in sorted(videos_dir.glob("*.mp4")):
            if participant_id.lower() in candidate.stem.lower():
                return str(candidate.relative_to(self.project_root))
        return ""

    def _match_log_path(
        self, logs_dir: Path, participant_id: str, mapped_assets: dict[str, dict[str, str]]
    ) -> str:
        mapped_log_dir = mapped_assets.get(participant_id, {}).get("log_dir", "")
        if mapped_log_dir:
            return mapped_log_dir
        if not logs_dir.exists():
            return ""
        participant_dir = logs_dir / participant_id
        if participant_dir.exists():
            return str(participant_dir.relative_to(self.project_root))
        for candidate in sorted(path for path in logs_dir.iterdir() if path.is_dir()):
            if participant_id.lower() in candidate.name.lower():
                return str(candidate.relative_to(self.project_root))
        return ""

    def _survey_source_for_participant(
        self, survey_rows: list[dict[str, Any]], participant_id: str, survey_name: str
    ) -> str:
        for row in survey_rows:
            if row["participant_id"] == participant_id and row["survey_name"] == survey_name:
                return row["source_path"]
        return ""

    def _participant_id_for_video_path(
        self,
        relative_path: str,
        participant_regex: re.Pattern[str],
        mapped_assets: dict[str, dict[str, str]],
    ) -> str | None:
        for participant_id, mapping in mapped_assets.items():
            if mapping.get("video_file") == relative_path:
                return participant_id
        return self._extract_participant_id(Path(relative_path).stem, participant_regex)

    @staticmethod
    def _matching_log_rule(filename: str, file_rules: list[dict[str, Any]]) -> dict[str, Any] | None:
        for rule in file_rules:
            if fnmatch.fnmatch(filename, rule.get("glob", "")):
                return rule
        return None

    def _parse_log_line_with_rule(self, raw_text: str, rule: dict[str, Any]) -> dict[str, Any]:
        parsed = {
            "raw_text": raw_text,
            "command": "",
            "event_class": rule.get("default_event_class", "raw"),
            "extra_json": {},
            "skip": False,
        }
        line_regex = rule.get("line_regex")
        if line_regex:
            match = re.search(line_regex, raw_text)
            if match:
                groups = match.groupdict()
                parsed["raw_text"] = groups.get("raw", raw_text)
                parsed["event_class"] = groups.get(
                    "event_class", parsed["event_class"]
                ).lower()
                extra_json = {
                    key: value
                    for key, value in groups.items()
                    if key not in {"raw", "event_class"}
                    and value not in {None, ""}
                }
                parsed["extra_json"] = extra_json
        for skip_regex in rule.get("skip_raw_regexes", []):
            if re.search(skip_regex, parsed["raw_text"]):
                parsed["skip"] = True
                return parsed
        command_regex = rule.get("command_regex")
        if command_regex:
            command_match = re.search(command_regex, parsed["raw_text"])
            if command_match:
                parsed["command"] = command_match.groupdict().get("command", "")
        return parsed

    @staticmethod
    def _extract_participant_id(text: str, pattern: re.Pattern[str]) -> str | None:
        match = pattern.search(text)
        if not match:
            return None
        group = match.groupdict().get("participant_id")
        return (group or match.group(0)).strip()

    def _build_merged_csv(self) -> str:
        fieldnames = [
            "event_id",
            "session_id",
            "participant_id",
            "start_time_sec",
            "end_time_sec",
            "event_type",
            "title",
            "observation",
            "interpretation",
            "confidence",
            "starred",
            "tag_names",
        ]
        tags_by_id = {row["tag_id"]: row["name"] for row in self.list_tags() if row.get("tag_id")}
        event_tags = self.repo.read_rows("event_tags.csv", EVENT_TAG_FIELDS)
        tag_names_by_event: dict[str, list[str]] = defaultdict(list)
        for row in event_tags:
            tag_name = tags_by_id.get(row.get("tag_id", ""))
            if tag_name:
                tag_names_by_event[row["event_id"]].append(tag_name)
        rows = []
        for event in self.repo.read_rows("timeline_events.csv", EVENT_FIELDS):
            rows.append(
                {
                    "event_id": event["event_id"],
                    "session_id": event["session_id"],
                    "participant_id": event["participant_id"],
                    "start_time_sec": event["start_time_sec"],
                    "end_time_sec": event["end_time_sec"],
                    "event_type": event["event_type"],
                    "title": event["title"],
                    "observation": event["observation"],
                    "interpretation": event["interpretation"],
                    "confidence": event["confidence"],
                    "starred": event["starred"],
                    "tag_names": "|".join(sorted(tag_names_by_event.get(event["event_id"], []))),
                }
            )
        return rows_to_csv(fieldnames, rows)


def rows_to_csv(fieldnames: list[str], rows: list[dict[str, Any]]) -> str:
    from io import StringIO

    buffer = StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()
