from pathlib import Path
from typing import Iterator

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import FileResponse, StreamingResponse

from app.models.schemas import (
    ConfigFile,
    ConfigFileUpdate,
    EventCreate,
    EventUpdate,
    IngestResult,
    MemoUpdate,
    ProjectSelection,
    ProjectSelectionUpdate,
    ProjectSummary,
    SessionCsvFile,
    SessionCsvPreview,
    SessionDetail,
    SessionSummary,
    TagCreate,
    TagUpdate,
)
from app.services.project_manager import ProjectManager
from app.services.project_service import ProjectService


def build_router(project_manager: ProjectManager) -> APIRouter:
    router = APIRouter(prefix="/api")

    def current_service() -> ProjectService:
        return project_manager.get_service()

    @router.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @router.get("/projects", response_model=ProjectSelection)
    def projects() -> ProjectSelection:
        return ProjectSelection(**project_manager.list_projects())

    @router.put("/projects/active", response_model=ProjectSelection)
    def set_active_project(payload: ProjectSelectionUpdate) -> ProjectSelection:
        try:
            return ProjectSelection(**project_manager.set_active_project(payload.project_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/config", response_model=ProjectSummary)
    def config() -> ProjectSummary:
        return current_service().project_summary()

    @router.get("/config/files", response_model=list[ConfigFile])
    def config_files() -> list[ConfigFile]:
        return [ConfigFile(**item) for item in current_service().list_config_files()]

    @router.get("/data/files", response_model=list[SessionCsvFile])
    def data_files() -> list[SessionCsvFile]:
        return [SessionCsvFile(**item) for item in current_service().list_project_csv_files()]

    @router.get("/data/files/{file_id}", response_model=SessionCsvPreview)
    def data_file_preview(file_id: str) -> SessionCsvPreview:
        try:
            return SessionCsvPreview(**current_service().get_project_csv_preview(file_id))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/config/files/{name}", response_model=ConfigFile)
    def config_file(name: str) -> ConfigFile:
        try:
            return ConfigFile(**current_service().get_config_file(name))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.put("/config/files/{name}", response_model=ConfigFile)
    def update_config_file(name: str, payload: ConfigFileUpdate) -> ConfigFile:
        try:
            return ConfigFile(**current_service().update_config_file(name, payload.content))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/sessions", response_model=list[SessionSummary])
    def sessions() -> list[SessionSummary]:
        return current_service().list_sessions()

    @router.post("/sessions/ingest", response_model=IngestResult)
    def ingest() -> IngestResult:
        return IngestResult(**current_service().ingest())

    @router.get("/sessions/{session_id}", response_model=SessionDetail)
    def session_detail(session_id: str) -> SessionDetail:
        service = current_service()
        session = service.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return SessionDetail(
            session=session,
            events=service.list_events(session_id),
            memo=service.get_memo(session_id),
            logs=service.list_logs(session_id),
            surveys=service.list_surveys(session_id),
        )

    @router.get("/sessions/{session_id}/csv-files", response_model=list[SessionCsvFile])
    def session_csv_files(session_id: str) -> list[SessionCsvFile]:
        try:
            return [SessionCsvFile(**item) for item in current_service().list_session_csv_files(session_id)]
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/sessions/{session_id}/csv-files/{file_id}", response_model=SessionCsvPreview)
    def session_csv_preview(session_id: str, file_id: str) -> SessionCsvPreview:
        try:
            return SessionCsvPreview(**current_service().get_session_csv_preview(session_id, file_id))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/sessions/{session_id}/video")
    def session_video(session_id: str, request: Request) -> Response:
        service = current_service()
        session = service.get_session(session_id)
        if not session or not session.video_path:
            raise HTTPException(status_code=404, detail="Video not found")
        video_path = (service.project_root / session.video_path).resolve()
        project_root = service.project_root.resolve()
        try:
            video_path.relative_to(project_root)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid video path") from exc
        if not video_path.exists() or not video_path.is_file():
            raise HTTPException(status_code=404, detail="Video file missing")
        range_header = request.headers.get("range")
        file_size = video_path.stat().st_size
        if not range_header:
            response = FileResponse(
                path=Path(video_path),
                media_type="video/mp4",
                filename=video_path.name,
            )
            response.headers["Accept-Ranges"] = "bytes"
            return response

        start, end = parse_range_header(range_header, file_size)
        content_length = end - start + 1
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(content_length),
        }
        return StreamingResponse(
            stream_file_range(video_path, start, end),
            media_type="video/mp4",
            status_code=status.HTTP_206_PARTIAL_CONTENT,
            headers=headers,
        )

    @router.get("/sessions/{session_id}/events")
    def session_events(session_id: str) -> list[dict]:
        return current_service().list_events(session_id)

    @router.post("/sessions/{session_id}/events")
    def create_event(session_id: str, payload: EventCreate) -> dict:
        try:
            return current_service().create_event(session_id, payload.model_dump())
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.patch("/events/{event_id}")
    def update_event(event_id: str, payload: EventUpdate) -> dict:
        try:
            return current_service().update_event(event_id, payload.model_dump(exclude_unset=True))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.delete("/events/{event_id}", status_code=204)
    def delete_event(event_id: str) -> Response:
        current_service().delete_event(event_id)
        return Response(status_code=204)

    @router.get("/tags")
    def tags() -> list[dict]:
        return current_service().list_tags()

    @router.post("/tags")
    def create_tag(payload: TagCreate) -> dict:
        return current_service().create_tag(payload.model_dump())

    @router.patch("/tags/{tag_id}")
    def update_tag(tag_id: str, payload: TagUpdate) -> dict:
        try:
            return current_service().update_tag(tag_id, payload.model_dump(exclude_unset=True))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/sessions/{session_id}/logs")
    def logs(session_id: str) -> list[dict]:
        return current_service().list_logs(session_id)

    @router.get("/sessions/{session_id}/surveys")
    def surveys(session_id: str) -> list[dict]:
        return current_service().list_surveys(session_id)

    @router.get("/sessions/{session_id}/memo")
    def memo(session_id: str) -> dict:
        try:
            return current_service().get_memo(session_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.put("/sessions/{session_id}/memo")
    def update_memo(session_id: str, payload: MemoUpdate) -> dict:
        try:
            return current_service().upsert_memo(session_id, payload.title, payload.body)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/export/{name}.csv")
    def export_csv(name: str) -> Response:
        try:
            data = current_service().export_csv(name)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return Response(
            content=data,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
        )

    return router


def parse_range_header(range_header: str, file_size: int) -> tuple[int, int]:
    if not range_header.startswith("bytes="):
        raise HTTPException(status_code=416, detail="Unsupported range unit")
    byte_range = range_header.replace("bytes=", "", 1)
    start_str, _, end_str = byte_range.partition("-")
    if start_str == "":
        suffix_length = int(end_str)
        start = max(file_size - suffix_length, 0)
        end = file_size - 1
    else:
        start = int(start_str)
        end = int(end_str) if end_str else file_size - 1
    if start < 0 or end >= file_size or start > end:
        raise HTTPException(status_code=416, detail="Invalid range")
    return start, end


def stream_file_range(path: Path, start: int, end: int, chunk_size: int = 1024 * 1024) -> Iterator[bytes]:
    with path.open("rb") as handle:
        handle.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            read_size = min(chunk_size, remaining)
            data = handle.read(read_size)
            if not data:
                break
            remaining -= len(data)
            yield data
