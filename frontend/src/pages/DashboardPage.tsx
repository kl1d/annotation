import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export default function DashboardPage() {
  const queryClient = useQueryClient();
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
        <button
          className="primary-button"
          onClick={() => ingestMutation.mutate()}
          disabled={ingestMutation.isPending}
        >
          {ingestMutation.isPending ? "Ingesting..." : "Run ingest"}
        </button>
      </header>

      {ingestMutation.data ? (
        <div className="callout">
          Ingested {ingestMutation.data.sessions} sessions, {ingestMutation.data.surveys} survey rows,
          {" "}{ingestMutation.data.logs} log rows, and seeded {ingestMutation.data.tags_seeded} tags.
        </div>
      ) : null}

      <div className="card-grid">
        {sessionsQuery.data?.map((session) => (
          <Link className="session-card" key={session.session_id} to={`/sessions/${session.session_id}`}>
            <div className="card-topline">
              <span>{session.participant_id}</span>
              <span className="pill">{session.status}</span>
            </div>
            <h3>{session.session_id}</h3>
            <p className="muted">{session.video_path || "No video matched yet"}</p>
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

      {!sessionsQuery.isLoading && (sessionsQuery.data?.length ?? 0) === 0 ? (
        <div className="empty-state">
          No sessions yet. Add videos, survey CSVs, and participant log folders under `project/`, then run ingest.
        </div>
      ) : null}
    </section>
  );
}

