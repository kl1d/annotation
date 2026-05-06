import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";

type SortKey =
  | "participant_id"
  | "session_id"
  | "status"
  | "video_path"
  | "log_available"
  | "survey_available"
  | "annotation_count"
  | "starred_count";

type SortDirection = "asc" | "desc";

const SESSION_STATUS_OPTIONS = ["needs_review", "reviewed", "missing", "active", "skipped"];

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [sortKey, setSortKey] = useState<SortKey>("participant_id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [filters, setFilters] = useState({
    participant_id: "",
    session_id: "",
    status: "",
    video_path: "",
  });
  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });
  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: api.getSessions,
  });

  const ingestMutation = useMutation({
    mutationFn: api.ingestSessions,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
  const updateSessionMutation = useMutation({
    mutationFn: ({ sessionId, status }: { sessionId: string; status: string }) =>
      api.updateSession(sessionId, { status }),
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["session", session.session_id] });
    },
  });

  useEffect(() => {
    const savedView = window.localStorage.getItem("dashboard-view");
    if (savedView === "cards" || savedView === "table") {
      setViewMode(savedView);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("dashboard-view", viewMode);
  }, [viewMode]);

  const sessions = sessionsQuery.data ?? [];
  const statusOptions = [
    ...SESSION_STATUS_OPTIONS,
    ...Array.from(new Set(sessions.map((session) => session.status).filter(Boolean)))
      .filter((status) => !SESSION_STATUS_OPTIONS.includes(status))
      .sort(),
  ];

  const sortSessions = (items: typeof sessions) =>
    [...items].sort((left, right) => {
      const direction = sortDirection === "asc" ? 1 : -1;

      if (sortKey === "annotation_count" || sortKey === "starred_count") {
        return (left[sortKey] - right[sortKey]) * direction;
      }

      if (sortKey === "log_available" || sortKey === "survey_available") {
        const leftAvailable = sortKey === "log_available" ? hasLogs(left) : hasSurveyData(left);
        const rightAvailable = sortKey === "log_available" ? hasLogs(right) : hasSurveyData(right);
        return (Number(leftAvailable) - Number(rightAvailable)) * direction;
      }

      const leftValue = String(left[sortKey] ?? "");
      const rightValue = String(right[sortKey] ?? "");

      return (
        leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" }) * direction
      );
    });

  const filteredSessions = sessions.filter((session) => {
    const participantMatch = session.participant_id
      .toLowerCase()
      .includes(filters.participant_id.trim().toLowerCase());
    const sessionMatch = session.session_id
      .toLowerCase()
      .includes(filters.session_id.trim().toLowerCase());
    const statusMatch = filters.status ? session.status === filters.status : true;
    const videoMatch = (session.video_path || "No video matched yet")
      .toLowerCase()
      .includes(filters.video_path.trim().toLowerCase());

    return participantMatch && sessionMatch && statusMatch && videoMatch;
  });

  const sortedSessions = sortSessions(filteredSessions);
  const cardSessions = sortSessions(sessions);
  const dashboardStats = {
    total: sessions.length,
    needsReview: countSessionsByStatus(sessions, "needs_review"),
    reviewed: countSessionsByStatus(sessions, "reviewed"),
    missing: countSessionsByStatus(sessions, "missing"),
    active: countSessionsByStatus(sessions, "active"),
  };
  const tableCounts = sortedSessions.reduce(
    (counts, session) => ({
      sessions: counts.sessions + 1,
      videos: counts.videos + Number(hasVideo(session)),
      logs: counts.logs + Number(hasLogs(session)),
      surveys: counts.surveys + Number(hasSurveyData(session)),
      annotations: counts.annotations + session.annotation_count,
      starred: counts.starred + session.starred_count,
    }),
    { sessions: 0, videos: 0, logs: 0, surveys: 0, annotations: 0, starred: 0 },
  );

  const setTextFilter = (key: "participant_id" | "session_id" | "video_path", value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(
      key === "annotation_count" ||
        key === "starred_count" ||
        key === "log_available" ||
        key === "survey_available"
        ? "desc"
        : "asc",
    );
  };

  const sortMarker = (key: SortKey) => {
    if (sortKey !== key) {
      return "↕";
    }

    return sortDirection === "asc" ? "↑" : "↓";
  };

  const updateSessionStatus = (sessionId: string, status: string) => {
    updateSessionMutation.mutate({ sessionId, status });
  };

  const openSession = (sessionId: string) => {
    navigate(`/sessions/${sessionId}`);
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Project</p>
          <h2>{configQuery.data?.project_name ?? "Loading project..."}</h2>
          <p className="muted">
            Scan the mounted project folder, normalize surveys/logs, and review sessions one at a time.
          </p>
        </div>
        <div className="dashboard-actions">
          <div className="view-toggle" role="tablist" aria-label="Dashboard view">
            <button
              className={`view-toggle-button ${viewMode === "cards" ? "active" : ""}`}
              onClick={() => setViewMode("cards")}
              type="button"
            >
              Cards
            </button>
            <button
              className={`view-toggle-button ${viewMode === "table" ? "active" : ""}`}
              onClick={() => setViewMode("table")}
              type="button"
            >
              Table
            </button>
          </div>
          <button
            className="primary-button"
            onClick={() => ingestMutation.mutate()}
            disabled={ingestMutation.isPending}
          >
            {ingestMutation.isPending ? "Ingesting..." : "Run ingest"}
          </button>
        </div>
      </header>

      {ingestMutation.data ? (
        <div className="callout">
          Ingested {ingestMutation.data.sessions} sessions, {ingestMutation.data.surveys} survey rows,
          {" "}{ingestMutation.data.logs} log rows, and seeded {ingestMutation.data.tags_seeded} tags.
        </div>
      ) : null}

      <div className="dashboard-summary muted">
        Showing {sortedSessions.length} of {sessions.length} sessions
      </div>

      <div className="dashboard-stats-strip" aria-label="Session status summary">
        <SummaryStatCard label="Total" value={dashboardStats.total} />
        <SummaryStatCard label="Need Review" value={dashboardStats.needsReview} tone="needs-review" />
        <SummaryStatCard label="Reviewed" value={dashboardStats.reviewed} tone="reviewed" />
        <SummaryStatCard label="Missing" value={dashboardStats.missing} tone="missing" />
        <SummaryStatCard label="Active" value={dashboardStats.active} tone="active" />
      </div>

      {viewMode === "cards" ? (
        <div className="card-grid">
          {cardSessions.map((session) => (
            <article className="session-card" key={session.session_id}>
              <div className="card-topline">
                <Link
                  className="session-card-participant"
                  title={session.participant_id}
                  to={`/sessions/${session.session_id}`}
                >
                  {session.participant_id}
                </Link>
                <select
                  aria-label={`Set status for ${session.session_id}`}
                  className={`status-select session-card-status ${statusToneClass(session.status)}`}
                  disabled={updateSessionMutation.isPending}
                  onChange={(event) => updateSessionStatus(session.session_id, event.target.value)}
                  value={session.status}
                >
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {formatStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>
              <Link className="session-card-body" to={`/sessions/${session.session_id}`}>
                <h3 className="session-card-title" title={session.session_id}>
                  {session.session_id}
                </h3>
                <p
                  className="muted session-card-path"
                  title={session.video_path || "No video matched yet"}
                >
                  {session.video_path || "No video matched yet"}
                </p>
                <dl className="stats-grid">
                  <div>
                    <dt>Annotations</dt>
                    <dd>{session.annotation_count}</dd>
                  </div>
                  <div>
                    <dt>Starred</dt>
                    <dd>{session.starred_count}</dd>
                  </div>
                </dl>
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="table-panel">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>
                  <div className="table-header-cell">
                    <button className="sort-header-button" onClick={() => toggleSort("participant_id")} type="button">
                      Participant <span className="sort-indicator">{sortMarker("participant_id")}</span>
                    </button>
                    <input
                      aria-label="Filter participants"
                      className="table-filter-input"
                      onChange={(event) => setTextFilter("participant_id", event.target.value)}
                      placeholder="Filter"
                      type="text"
                      value={filters.participant_id}
                    />
                  </div>
                </th>
                <th>
                  <div className="table-header-cell">
                    <button className="sort-header-button" onClick={() => toggleSort("session_id")} type="button">
                      Session <span className="sort-indicator">{sortMarker("session_id")}</span>
                    </button>
                    <input
                      aria-label="Filter sessions"
                      className="table-filter-input"
                      onChange={(event) => setTextFilter("session_id", event.target.value)}
                      placeholder="Filter"
                      type="text"
                      value={filters.session_id}
                    />
                  </div>
                </th>
                <th>
                  <div className="table-header-cell">
                    <button className="sort-header-button" onClick={() => toggleSort("status")} type="button">
                      Status <span className="sort-indicator">{sortMarker("status")}</span>
                    </button>
                    <select
                      aria-label="Filter status"
                      className="table-filter-input"
                      onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
                      value={filters.status}
                    >
                      <option value="">All</option>
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {formatStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </div>
                </th>
                <th>
                  <div className="table-header-cell">
                    <button className="sort-header-button" onClick={() => toggleSort("video_path")} type="button">
                      Video <span className="sort-indicator">{sortMarker("video_path")}</span>
                    </button>
                    <input
                      aria-label="Filter videos"
                      className="table-filter-input"
                      onChange={(event) => setTextFilter("video_path", event.target.value)}
                      placeholder="Filter"
                      type="text"
                      value={filters.video_path}
                    />
                  </div>
                </th>
                <th>
                  <div className="table-header-cell compact">
                    <button className="sort-header-button" onClick={() => toggleSort("log_available")} type="button">
                      Logs <span className="sort-indicator">{sortMarker("log_available")}</span>
                    </button>
                    <span className="table-header-spacer" />
                  </div>
                </th>
                <th>
                  <div className="table-header-cell compact">
                    <button className="sort-header-button" onClick={() => toggleSort("survey_available")} type="button">
                      Survey <span className="sort-indicator">{sortMarker("survey_available")}</span>
                    </button>
                    <span className="table-header-spacer" />
                  </div>
                </th>
                <th>
                  <div className="table-header-cell">
                    <button className="sort-header-button" onClick={() => toggleSort("annotation_count")} type="button">
                      Annotations <span className="sort-indicator">{sortMarker("annotation_count")}</span>
                    </button>
                    <span className="table-header-spacer" />
                  </div>
                </th>
                <th>
                  <div className="table-header-cell">
                    <button className="sort-header-button" onClick={() => toggleSort("starred_count")} type="button">
                      Starred <span className="sort-indicator">{sortMarker("starred_count")}</span>
                    </button>
                    <span className="table-header-spacer" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedSessions.map((session) => (
                <tr
                  className="dashboard-table-row-link"
                  key={session.session_id}
                  onClick={() => openSession(session.session_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openSession(session.session_id);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`Open ${session.session_id}`}
                >
                  <td>{session.participant_id}</td>
                  <td>{session.session_id}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <select
                      aria-label={`Set status for ${session.session_id}`}
                      className={`status-select table-status-select ${statusToneClass(session.status)}`}
                      disabled={updateSessionMutation.isPending}
                      onChange={(event) => updateSessionStatus(session.session_id, event.target.value)}
                      value={session.status}
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {formatStatusLabel(status)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="dashboard-table-path">
                    {session.video_path || "No video matched yet"}
                  </td>
                  <td>
                    <AvailabilityBadge
                      available={hasLogs(session)}
                      availableLabel="Logs"
                      missingLabel="No logs"
                      title={session.log_path || "No log data matched yet"}
                    />
                  </td>
                  <td>
                    <AvailabilityBadge
                      available={hasSurveyData(session)}
                      availableLabel="Survey"
                      missingLabel="No survey"
                      title={surveyAvailabilityTitle(session)}
                    />
                  </td>
                  <td>{session.annotation_count}</td>
                  <td>{session.starred_count}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Showing {tableCounts.sessions} sessions</td>
                <td>{tableCounts.videos}</td>
                <td>{tableCounts.logs}</td>
                <td>{tableCounts.surveys}</td>
                <td>{tableCounts.annotations}</td>
                <td>{tableCounts.starred}</td>
              </tr>
            </tfoot>
          </table>
          {sortedSessions.length === 0 ? (
            <div className="empty-state">
              No sessions match the current table filters.
            </div>
          ) : null}
        </div>
      )}

      {!sessionsQuery.isLoading && sessions.length === 0 ? (
        <div className="empty-state">
          No sessions yet. Add videos, survey CSVs, and participant log folders under `project/`, then run ingest.
        </div>
      ) : null}
    </section>
  );
}

function formatStatusLabel(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusToneClass(status: string) {
  const normalized = status.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return normalized ? `status-${normalized}` : "status-unknown";
}

function countSessionsByStatus(sessions: Array<{ status: string }>, status: string) {
  return sessions.filter((session) => session.status === status).length;
}

function hasVideo(session: { video_path: string }) {
  return Boolean(session.video_path);
}

function hasLogs(session: { log_path: string }) {
  return Boolean(session.log_path);
}

function hasSurveyData(session: {
  pre_survey_path: string;
  progression_survey_path: string;
  post_survey_path: string;
}) {
  return Boolean(session.pre_survey_path || session.progression_survey_path || session.post_survey_path);
}

function surveyAvailabilityTitle(session: {
  pre_survey_path: string;
  progression_survey_path: string;
  post_survey_path: string;
}) {
  const availableSurveys = [
    session.pre_survey_path ? `Pre: ${session.pre_survey_path}` : "",
    session.progression_survey_path ? `Progression: ${session.progression_survey_path}` : "",
    session.post_survey_path ? `Post: ${session.post_survey_path}` : "",
  ].filter(Boolean);

  return availableSurveys.length > 0 ? availableSurveys.join("\n") : "No survey data matched yet";
}

function AvailabilityBadge({
  available,
  availableLabel,
  missingLabel,
  title,
}: {
  available: boolean;
  availableLabel: string;
  missingLabel: string;
  title: string;
}) {
  return (
    <span
      className={`availability-badge ${available ? "available" : "missing"}`}
      title={title}
    >
      {available ? availableLabel : missingLabel}
    </span>
  );
}

function SummaryStatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "needs-review" | "reviewed" | "missing" | "active";
}) {
  return (
    <div className={`dashboard-stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
