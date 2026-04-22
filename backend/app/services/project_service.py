import csv
import re
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
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
    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root
        self.config_dir = project_root / "config"
        self.data_dir = project_root / "data"
        self.assets_dir = project_root / "assets"
        self.repo = CsvRepository(self.data_dir)
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
        with path.open("r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
        return data

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

    def ingest(self) -> dict[str, int]:
        project_config = self.load_yaml("project.yaml")
        survey_config = self.load_yaml("survey_mappings.yaml")
        log_config = self.load_yaml("log_mappings.yaml")
        codebook = self.load_yaml("codebook.yaml")

        paths = project_config.get("paths", {})
        videos_dir = self.project_root / paths.get("videos_dir", "assets/videos")
        logs_dir = self.project_root / paths.get("logs_dir", "assets/logs")
        participant_regex = re.compile(
            project_config.get("matching", {}).get(
                "participant_id_regex", "(?P<participant_id>[A-Za-z0-9_-]+)"
            )
        )

        survey_rows, participant_metadata = self._parse_surveys(survey_config)
        self.repo.write_rows("survey_answers.csv", SURVEY_FIELDS, survey_rows)

        log_rows = self._parse_logs(logs_dir, participant_regex, log_config)
        self.repo.write_rows("log_events.csv", LOG_FIELDS, log_rows)

        participant_ids = {
            *participant_metadata.keys(),
            *{row["participant_id"] for row in survey_rows},
            *{row["participant_id"] for row in log_rows},
        }
        for video_path in videos_dir.glob("*.mp4"):
            participant_id = self._extract_participant_id(video_path.stem, participant_regex)
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
            video_path = self._match_video_path(videos_dir, participant_id)
            log_path = self._match_log_path(logs_dir, participant_id)
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

    def _parse_surveys(
        self, survey_config: dict[str, Any]
    ) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]]]:
        rows: list[dict[str, Any]] = []
        participant_metadata: dict[str, dict[str, str]] = {}
        row_id = 1
        for survey in survey_config.get("surveys", []):
            survey_name = survey["survey_name"]
            source_path = self.project_root / survey["file"]
            participant_column = survey["participant_id_column"]
            question_columns = survey.get("question_columns", [])
            metadata_columns = survey.get("participant_metadata_columns", {})
            if not source_path.exists():
                continue
            with source_path.open("r", newline="", encoding="utf-8-sig") as handle:
                reader = csv.DictReader(handle)
                for source_row in reader:
                    participant_id = source_row.get(participant_column, "").strip()
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
                                "survey_name": survey_name,
                                "question_id": question.get("question_id", column_name),
                                "question_text": question.get("question_text", column_name),
                                "response": source_row.get(column_name, "").strip(),
                                "source_path": survey["file"],
                            }
                        )
                        row_id += 1
        return rows, participant_metadata

    def _parse_logs(
        self, logs_dir: Path, participant_regex: re.Pattern[str], log_config: dict[str, Any]
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

        if not logs_dir.exists():
            return rows

        for participant_dir in sorted(path for path in logs_dir.iterdir() if path.is_dir()):
            participant_id = self._extract_participant_id(participant_dir.name, participant_regex)
            if not participant_id:
                continue
            for log_file in sorted(participant_dir.rglob("*.log")):
                with log_file.open("r", encoding="utf-8", errors="ignore") as handle:
                    for index, line in enumerate(handle, start=1):
                        raw_text = line.rstrip("\n")
                        timestamp_sec = ""
                        stripped_text = raw_text
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
                        command = ""
                        for pattern in command_patterns:
                            match = pattern.search(stripped_text)
                            if match:
                                command = match.groupdict().get("command", "")
                                break
                        event_class = default_event_class
                        lowered = stripped_text.lower()
                        for rule in event_class_rules:
                            if rule.get("contains", "").lower() in lowered:
                                event_class = rule["event_class"]
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
                                "extra_json": "{}",
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

    def _match_video_path(self, videos_dir: Path, participant_id: str) -> str:
        for candidate in sorted(videos_dir.glob("*.mp4")):
            if participant_id.lower() in candidate.stem.lower():
                return str(candidate.relative_to(self.project_root))
        return ""

    def _match_log_path(self, logs_dir: Path, participant_id: str) -> str:
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
