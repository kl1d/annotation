import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

type SortKey =
  | "participant_id"
  | "session_id"
  | "status"
  | "video_path"
  | "annotation_count"
  | "starred_count";

type SortDirection = "asc" | "desc";

export default function DashboardPage() {
  const queryClient = useQueryClient();
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
  const statusOptions = Array.from(new Set(sessions.map((session) => session.status))).sort();

  const sortSessions = (items: typeof sessions) =>
    [...items].sort((left, right) => {
      const direction = sortDirection === "asc" ? 1 : -1;

      if (sortKey === "annotation_count" || sortKey === "starred_count") {
        return (left[sortKey] - right[sortKey]) * direction;
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

  const setTextFilter = (key: "participant_id" | "session_id" | "video_path", value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection(key === "annotation_count" || key === "starred_count" ? "desc" : "asc");
  };

  const sortMarker = (key: SortKey) => {
    if (sortKey !== key) {
      return "↕";
    }

    return sortDirection === "asc" ? "↑" : "↓";
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

      {viewMode === "cards" ? (
        <div className="card-grid">
          {cardSessions.map((session) => (
            <Link className="session-card" key={session.session_id} to={`/sessions/${session.session_id}`}>
              <div className="card-topline">
                <span className="session-card-participant" title={session.participant_id}>
                  {session.participant_id}
                </span>
                <span className="pill session-card-status">{session.status}</span>
              </div>
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
                          {status}
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
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {sortedSessions.map((session) => (
                <tr key={session.session_id}>
                  <td>{session.participant_id}</td>
                  <td>{session.session_id}</td>
                  <td>
                    <span className="pill">{session.status}</span>
                  </td>
                  <td className="dashboard-table-path">
                    {session.video_path || "No video matched yet"}
                  </td>
                  <td>{session.annotation_count}</td>
                  <td>{session.starred_count}</td>
                  <td>
                    <Link className="table-link" to={`/sessions/${session.session_id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
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
