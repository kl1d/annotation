from fastapi import APIRouter, HTTPException, Response

from app.models.schemas import (
    EventCreate,
    EventUpdate,
    IngestResult,
    MemoUpdate,
    ProjectSummary,
    SessionDetail,
    SessionSummary,
    TagCreate,
    TagUpdate,
)
from app.services.project_service import ProjectService


def build_router(project_service: ProjectService) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @router.get("/config", response_model=ProjectSummary)
    def config() -> ProjectSummary:
        return project_service.project_summary()

    @router.get("/sessions", response_model=list[SessionSummary])
    def sessions() -> list[SessionSummary]:
        return project_service.list_sessions()

    @router.post("/sessions/ingest", response_model=IngestResult)
    def ingest() -> IngestResult:
        return IngestResult(**project_service.ingest())

    @router.get("/sessions/{session_id}", response_model=SessionDetail)
    def session_detail(session_id: str) -> SessionDetail:
        session = project_service.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        return SessionDetail(
            session=session,
            events=project_service.list_events(session_id),
            memo=project_service.get_memo(session_id),
            logs=project_service.list_logs(session_id),
            surveys=project_service.list_surveys(session_id),
        )

    @router.get("/sessions/{session_id}/events")
    def session_events(session_id: str) -> list[dict]:
        return project_service.list_events(session_id)

    @router.post("/sessions/{session_id}/events")
    def create_event(session_id: str, payload: EventCreate) -> dict:
        try:
            return project_service.create_event(session_id, payload.model_dump())
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.patch("/events/{event_id}")
    def update_event(event_id: str, payload: EventUpdate) -> dict:
        try:
            return project_service.update_event(event_id, payload.model_dump(exclude_unset=True))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.delete("/events/{event_id}", status_code=204)
    def delete_event(event_id: str) -> Response:
        project_service.delete_event(event_id)
        return Response(status_code=204)

    @router.get("/tags")
    def tags() -> list[dict]:
        return project_service.list_tags()

    @router.post("/tags")
    def create_tag(payload: TagCreate) -> dict:
        return project_service.create_tag(payload.model_dump())

    @router.patch("/tags/{tag_id}")
    def update_tag(tag_id: str, payload: TagUpdate) -> dict:
        try:
            return project_service.update_tag(tag_id, payload.model_dump(exclude_unset=True))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/sessions/{session_id}/logs")
    def logs(session_id: str) -> list[dict]:
        return project_service.list_logs(session_id)

    @router.get("/sessions/{session_id}/surveys")
    def surveys(session_id: str) -> list[dict]:
        return project_service.list_surveys(session_id)

    @router.get("/sessions/{session_id}/memo")
    def memo(session_id: str) -> dict:
        try:
            return project_service.get_memo(session_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.put("/sessions/{session_id}/memo")
    def update_memo(session_id: str, payload: MemoUpdate) -> dict:
        try:
            return project_service.upsert_memo(session_id, payload.title, payload.body)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/export/{name}.csv")
    def export_csv(name: str) -> Response:
        try:
            data = project_service.export_csv(name)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return Response(
            content=data,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
        )

    return router

