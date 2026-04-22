import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, TimelineEvent } from "../lib/api";

type EventDraft = {
  start_time_sec: number;
  end_time_sec?: number;
  source_type: string;
  task_path: string;
  event_type: string;
  title: string;
  observation: string;
  interpretation: string;
  evidence_note: string;
  confidence: string;
  follow_up: string;
  starred: boolean;
  tag_ids: string[];
};

const initialDraft: EventDraft = {
  start_time_sec: 0,
  end_time_sec: undefined,
  source_type: "video",
  task_path: "",
  event_type: "other",
  title: "",
  observation: "",
  interpretation: "",
  evidence_note: "",
  confidence: "medium",
  follow_up: "",
  starred: false,
  tag_ids: [],
};

export default function SessionPage() {
  const { sessionId = "" } = useParams();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<EventDraft>(initialDraft);
  const [memoBody, setMemoBody] = useState("");

  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.getSession(sessionId),
    enabled: Boolean(sessionId),
  });
  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: api.getTags,
  });

  const createEventMutation = useMutation({
    mutationFn: () => api.createEvent(sessionId, draft),
    onSuccess: async () => {
      setDraft(initialDraft);
      await queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const saveMemoMutation = useMutation({
    mutationFn: (body: string) =>
      api.saveMemo(sessionId, {
        title: `${sessionQuery.data?.session.participant_id ?? "Session"} memo`,
        body,
      }),
    onSuccess: async (memo) => {
      setMemoBody(memo.body);
      await queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: (eventId: string) => api.deleteEvent(eventId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const session = sessionQuery.data?.session;
  const memo = sessionQuery.data?.memo;

  useEffect(() => {
    if (memo && memoBody === "") {
      setMemoBody(memo.body);
    }
  }, [memo, memoBody]);

  const groupedSurveys = useMemo(() => {
    const source = sessionQuery.data?.surveys ?? [];
    return source.reduce<Record<string, typeof source>>((acc, row) => {
      acc[row.survey_name] = acc[row.survey_name] ?? [];
      acc[row.survey_name].push(row);
      return acc;
    }, {});
  }, [sessionQuery.data?.surveys]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    createEventMutation.mutate();
  }

  if (sessionQuery.isLoading) {
    return <section className="page">Loading session...</section>;
  }

  if (!session) {
    return <section className="page">Session not found.</section>;
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Session</p>
          <h2>{session.participant_id}</h2>
          <p className="muted">{session.session_id}</p>
        </div>
      </header>

      <div className="workspace-grid">
        <div className="panel">
          <h3>Video</h3>
          {session.video_url ? (
            <video className="video-frame" controls src={`http://localhost:8000${session.video_url}`} />
          ) : (
            <div className="empty-state">No matched video for this session yet.</div>
          )}
          <p className="muted small">
            For this first pass, enter the timestamp manually. Next we can sync the current player time into the event form.
          </p>
        </div>

        <div className="panel">
          <div className="section-header">
            <h3>Timeline events</h3>
            <span className="pill">{sessionQuery.data?.events.length ?? 0}</span>
          </div>
          <div className="event-list">
            {sessionQuery.data?.events.map((item: TimelineEvent) => (
              <article className="event-card" key={item.event_id}>
                <div className="card-topline">
                  <strong>{item.title || item.event_type}</strong>
                  <button className="ghost-button" onClick={() => deleteEventMutation.mutate(item.event_id)}>
                    Delete
                  </button>
                </div>
                <p className="muted small">
                  {item.start_time_sec}s {item.end_time_sec ? `to ${item.end_time_sec}s` : ""} • {item.event_type}
                </p>
                <p>{item.observation}</p>
                {item.tags?.length ? (
                  <div className="tag-row">
                    {item.tags.map((tag) => (
                      <span className="tag-chip" key={tag.tag_id}>
                        {tag.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
            {(sessionQuery.data?.events.length ?? 0) === 0 ? (
              <div className="empty-state">No events yet. Add the first annotation from the form.</div>
            ) : null}
          </div>
        </div>

        <div className="panel stack">
          <h3>Create event</h3>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              Start time (sec)
              <input
                type="number"
                min="0"
                step="0.1"
                value={draft.start_time_sec}
                onChange={(event) => setDraft({ ...draft, start_time_sec: Number(event.target.value) })}
              />
            </label>
            <label>
              End time (sec)
              <input
                type="number"
                min="0"
                step="0.1"
                value={draft.end_time_sec ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    end_time_sec: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
            </label>
            <label>
              Event type
              <input value={draft.event_type} onChange={(event) => setDraft({ ...draft, event_type: event.target.value })} />
            </label>
            <label>
              Task path
              <input value={draft.task_path} onChange={(event) => setDraft({ ...draft, task_path: event.target.value })} />
            </label>
            <label className="full-span">
              Title
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            </label>
            <label className="full-span">
              Observation
              <textarea value={draft.observation} onChange={(event) => setDraft({ ...draft, observation: event.target.value })} />
            </label>
            <label className="full-span">
              Interpretation
              <textarea
                value={draft.interpretation}
                onChange={(event) => setDraft({ ...draft, interpretation: event.target.value })}
              />
            </label>
            <label className="full-span">
              Evidence note
              <textarea
                value={draft.evidence_note}
                onChange={(event) => setDraft({ ...draft, evidence_note: event.target.value })}
              />
            </label>
            <label>
              Confidence
              <select value={draft.confidence} onChange={(event) => setDraft({ ...draft, confidence: event.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label>
              Source
              <select value={draft.source_type} onChange={(event) => setDraft({ ...draft, source_type: event.target.value })}>
                <option value="video">Video</option>
                <option value="log">Log</option>
                <option value="survey">Survey</option>
                <option value="mixed">Mixed</option>
              </select>
            </label>
            <label className="full-span">
              Tags
              <select
                multiple
                value={draft.tag_ids}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    tag_ids: Array.from(event.target.selectedOptions).map((option) => option.value),
                  })
                }
              >
                {tagsQuery.data?.filter((tag) => tag.archived !== "true").map((tag) => (
                  <option key={tag.tag_id} value={tag.tag_id}>
                    {tag.category} / {tag.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.starred}
                onChange={(event) => setDraft({ ...draft, starred: event.target.checked })}
              />
              Starred moment
            </label>
            <label className="full-span">
              Follow-up
              <textarea value={draft.follow_up} onChange={(event) => setDraft({ ...draft, follow_up: event.target.value })} />
            </label>
            <button className="primary-button full-span" disabled={createEventMutation.isPending} type="submit">
              {createEventMutation.isPending ? "Saving..." : "Save event"}
            </button>
          </form>
        </div>
      </div>

      <div className="workspace-grid workspace-grid-lower">
        <div className="panel">
          <h3>Logs</h3>
          <div className="scroll-panel">
            {sessionQuery.data?.logs.slice(0, 200).map((row) => (
              <div className="log-row" key={row.log_event_id}>
                <span className="pill subtle">{row.event_class}</span>
                <div>
                  <p className="small muted">{row.source_file}:{row.line_number}</p>
                  <p>{row.raw_text}</p>
                </div>
              </div>
            ))}
            {(sessionQuery.data?.logs.length ?? 0) === 0 ? (
              <div className="empty-state">No parsed logs yet.</div>
            ) : null}
          </div>
        </div>

        <div className="panel">
          <h3>Surveys</h3>
          <div className="scroll-panel">
            {Object.entries(groupedSurveys).map(([surveyName, rows]) => (
              <section className="survey-group" key={surveyName}>
                <h4>{surveyName}</h4>
                {rows.map((row) => (
                  <div className="survey-row" key={row.row_id}>
                    <p className="small muted">{row.question_id}</p>
                    <p>{row.question_text}</p>
                    <p className="response">{row.response || "No response"}</p>
                  </div>
                ))}
              </section>
            ))}
            {(sessionQuery.data?.surveys.length ?? 0) === 0 ? (
              <div className="empty-state">No normalized survey rows yet.</div>
            ) : null}
          </div>
        </div>

        <div className="panel stack">
          <h3>Memo</h3>
          <textarea
            className="memo-textarea"
            value={memoBody}
            onChange={(event) => setMemoBody(event.target.value)}
            placeholder="Summarize strategy, key moments, design observations, and paper-worthy examples."
          />
          <button className="primary-button" onClick={() => saveMemoMutation.mutate(memoBody)}>
            {saveMemoMutation.isPending ? "Saving..." : "Save memo"}
          </button>
        </div>
      </div>
    </section>
  );
}
