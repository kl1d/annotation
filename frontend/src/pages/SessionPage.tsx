import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Dispatch, FormEvent, type MouseEvent, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, API_BASE_URL, TimelineEvent } from "../lib/api";

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

type CanvasTab = "video" | "logs" | "surveys" | "notes";

const EVENT_TYPE_OPTIONS = [
  "choice",
  "attempt",
  "failure",
  "retry_loop",
  "debug",
  "pivot",
  "suspected_deception",
  "abandon",
  "success",
  "design_issue",
  "other",
];

const TASK_PATH_OPTIONS = [
  { value: "", label: "No task path" },
  { value: "setup", label: "Setup" },
  { value: "orientation", label: "Orientation" },
  { value: "recon", label: "Recon" },
  { value: "analysis", label: "Analysis" },
  { value: "attempt", label: "Attempt" },
  { value: "debug", label: "Debug" },
  { value: "pivot", label: "Pivot" },
  { value: "reflection", label: "Reflection" },
  { value: "other", label: "Other / custom" },
];

const OBSERVATION_OPTIONS = [
  "Exploring a new path",
  "Retrying",
  "Blocked",
  "Made progress",
  "Confused",
  "Interface friction",
  "Using hints or cues",
  "High confidence",
];

export default function SessionPage() {
  const { sessionId = "" } = useParams();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<EventDraft>(initialDraft);
  const [taskPreset, setTaskPreset] = useState("");
  const [observationChoices, setObservationChoices] = useState<string[]>([]);
  const [interpretationChoices, setInterpretationChoices] = useState<string[]>([]);
  const [followUpChoices, setFollowUpChoices] = useState<string[]>([]);
  const [timeError, setTimeError] = useState("");
  const [memoBody, setMemoBody] = useState("");
  const [workspaceNotes, setWorkspaceNotes] = useState("");
  const [canvasTab, setCanvasTab] = useState<CanvasTab>("video");
  const [selectedLogFile, setSelectedLogFile] = useState("all");
  const [startTimeInput, setStartTimeInput] = useState("00:00");
  const [endTimeInput, setEndTimeInput] = useState("");
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [selectedTimelineEventId, setSelectedTimelineEventId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const savedVideoTimeRef = useRef(0);

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
    mutationFn: (payload: EventDraft) => api.createEvent(sessionId, payload),
    onSuccess: async () => {
      setDraft(initialDraft);
      setTaskPreset("");
      setObservationChoices([]);
      setInterpretationChoices([]);
      setFollowUpChoices([]);
      setStartTimeInput("00:00");
      setEndTimeInput("");
      setTimeError("");
      await queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const updateEventMutation = useMutation({
    mutationFn: ({ eventId, payload }: { eventId: string; payload: EventDraft }) =>
      api.updateEvent(eventId, payload),
    onSuccess: async () => {
      setTimeError("");
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
      clearEventDraft();
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

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    const saved = window.localStorage.getItem(`workspace-notes:${sessionId}`);
    setWorkspaceNotes(saved ?? "");
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    window.localStorage.setItem(`workspace-notes:${sessionId}`, workspaceNotes);
  }, [sessionId, workspaceNotes]);

  const groupedSurveys = useMemo(() => {
    const source = sessionQuery.data?.surveys ?? [];
    return source.reduce<Record<string, typeof source>>((acc, row) => {
      acc[row.survey_name] = acc[row.survey_name] ?? [];
      acc[row.survey_name].push(row);
      return acc;
    }, {});
  }, [sessionQuery.data?.surveys]);

  const logFiles = useMemo(() => {
    const files = Array.from(
      new Set((sessionQuery.data?.logs ?? []).map((row) => row.source_file)),
    );
    return files.sort();
  }, [sessionQuery.data?.logs]);

  const filteredLogs = useMemo(() => {
    const rows = sessionQuery.data?.logs ?? [];
    if (selectedLogFile === "all") {
      return rows;
    }
    return rows.filter((row) => row.source_file === selectedLogFile);
  }, [selectedLogFile, sessionQuery.data?.logs]);

  const generatedTitle = useMemo(
    () => buildGeneratedTitle(draft.event_type, taskPreset, observationChoices),
    [draft.event_type, taskPreset, observationChoices],
  );

  const timelineEvents = sessionQuery.data?.events ?? [];
  const timelineLanes = useMemo(() => buildTimelineLanes(timelineEvents), [timelineEvents]);
  const timelineMaxSec = useMemo(() => {
    const eventMax = timelineEvents.reduce((max, item) => {
      const endTime = Number(item.end_time_sec || item.start_time_sec || 0);
      const startTime = Number(item.start_time_sec || 0);
      return Math.max(max, startTime, endTime);
    }, 0);

    return Math.max(videoDuration, eventMax, draft.start_time_sec, 1);
  }, [draft.start_time_sec, timelineEvents, videoDuration]);

  function buildEventPayload(): EventDraft | null {
    const startTime = parseTimeInput(startTimeInput);
    const endTime = parseTimeInput(endTimeInput);

    if (startTime === null) {
      setTimeError("Start time must use mm:ss, for example 05:27 or 36:58.");
      return null;
    }

    if (endTimeInput.trim() && endTime === null) {
      setTimeError("End time must use mm:ss when provided.");
      return null;
    }

    if (endTime !== null && endTime < startTime) {
      setTimeError("End time must be the same as or after the start time.");
      return null;
    }

    setTimeError("");
    return {
      ...draft,
      start_time_sec: startTime,
      end_time_sec: endTime ?? undefined,
      task_path: taskPreset === "other" ? draft.task_path.trim() : taskPreset,
      title: draft.title.trim() || generatedTitle,
      observation: mergeStructuredText(observationChoices, draft.observation),
      interpretation: mergeStructuredText(interpretationChoices, draft.interpretation),
      follow_up: mergeStructuredText(followUpChoices, draft.follow_up),
    };
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const payload = buildEventPayload();
    if (!payload) {
      return;
    }

    if (selectedTimelineEventId) {
      updateEventMutation.mutate({ eventId: selectedTimelineEventId, payload });
      return;
    }

    createEventMutation.mutate(payload);
  }

  function clearEventDraft() {
    setDraft(initialDraft);
    setTaskPreset("");
    setObservationChoices([]);
    setInterpretationChoices([]);
    setFollowUpChoices([]);
    setStartTimeInput("00:00");
    setEndTimeInput("");
    setTimeError("");
    setSelectedTimelineEventId(null);
  }

  function updateStartTimeInput(value: string) {
    setStartTimeInput(value);
    setTimeError("");
    const parsed = parseTimeInput(value);
    if (parsed !== null) {
      setDraft((current) => ({ ...current, start_time_sec: parsed }));
    }
  }

  function updateEndTimeInput(value: string) {
    setEndTimeInput(value);
    setTimeError("");
    const parsed = parseTimeInput(value);
    setDraft((current) => ({
      ...current,
      end_time_sec: parsed ?? undefined,
    }));
  }

  function jumpVideo(seconds: number) {
    const video = videoRef.current;
    savedVideoTimeRef.current = seconds;
    if (!video) {
      setVideoCurrentTime(Math.max(0, seconds));
      return;
    }
    const nextTime = Math.max(0, Math.min(video.duration || Infinity, seconds));
    video.currentTime = nextTime;
    savedVideoTimeRef.current = nextTime;
    setVideoCurrentTime(nextTime);
  }

  function useCurrentVideoTimeFor(field: "start" | "end") {
    const formatted = formatTimeInput(videoCurrentTime);
    if (field === "start") {
      updateStartTimeInput(formatted);
      return;
    }
    updateEndTimeInput(formatted);
  }

  function jumpToTimelineEvent(item: TimelineEvent) {
    const startTime = Number(item.start_time_sec || 0);
    setSelectedTimelineEventId(item.event_id);
    setDraft({
      start_time_sec: startTime,
      end_time_sec: item.end_time_sec ? Number(item.end_time_sec) : undefined,
      source_type: item.source_type || "video",
      task_path: item.task_path || "",
      event_type: item.event_type || "other",
      title: item.title || "",
      observation: item.observation || "",
      interpretation: item.interpretation || "",
      evidence_note: item.evidence_note || "",
      confidence: item.confidence || "medium",
      follow_up: item.follow_up || "",
      starred: item.starred === "true",
      tag_ids: item.tag_ids ?? [],
    });
    if (TASK_PATH_OPTIONS.some((option) => option.value === item.task_path)) {
      setTaskPreset(item.task_path || "");
    } else if (item.task_path) {
      setTaskPreset("other");
    } else {
      setTaskPreset("");
    }
    setObservationChoices([]);
    setInterpretationChoices([]);
    setFollowUpChoices([]);
    updateStartTimeInput(formatTimeInput(startTime));
    updateEndTimeInput(item.end_time_sec ? formatTimeInput(Number(item.end_time_sec)) : "");
    jumpVideo(startTime);
  }

  function timeFromTimelinePointer(event: MouseEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeX = event.clientX - bounds.left;
    const percent = Math.min(1, Math.max(0, relativeX / bounds.width));
    return percent * timelineMaxSec;
  }

  function createDraftFromTimeline(event: MouseEvent<HTMLDivElement>) {
    const selectedTime = timeFromTimelinePointer(event);
    clearEventDraft();
    updateStartTimeInput(formatTimeInput(selectedTime));
    jumpVideo(selectedTime);
  }

  function toggleChoice(
    value: string,
    setter: Dispatch<SetStateAction<string[]>>,
  ) {
    setter((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }

  function toggleTag(tagId: string) {
    setDraft((current) => ({
      ...current,
      tag_ids: current.tag_ids.includes(tagId)
        ? current.tag_ids.filter((value) => value !== tagId)
        : [...current.tag_ids, tagId],
    }));
  }

  if (sessionQuery.isLoading) {
    return <section className="page">Loading session...</section>;
  }

  if (!session) {
    return <section className="page">Session not found.</section>;
  }

  return (
    <section className="page session-workspace-page">
      <header className="page-header session-topbar">
        <div className="session-topbar-main">
          <span className="session-topbar-label">Session</span>
          <strong className="session-topbar-participant">{session.participant_id}</strong>
          <span className="pill subtle">{session.session_id}</span>
          <span className="pill">{session.status}</span>
        </div>
        <div className="session-header-actions">
          <span className="pill">{sessionQuery.data?.events.length ?? 0} events</span>
          <span className="pill subtle">
            {(sessionQuery.data?.logs.length ?? 0).toLocaleString()} log rows
          </span>
        </div>
      </header>

      <div className="review-workspace-grid">
        <div className="review-panel review-canvas-panel">
          <div className="review-panel-header">
            <div className="panel-tab-row">
              {(["video", "logs", "surveys", "notes"] as CanvasTab[]).map((tab) => (
                <button
                  className={`panel-tab ${canvasTab === tab ? "active" : ""}`}
                  key={tab}
                  onClick={() => setCanvasTab(tab)}
                  type="button"
                >
                  {labelForTab(tab)}
                </button>
              ))}
            </div>
            <p className="muted small">Main evidence canvas</p>
          </div>

          <div className="review-canvas">
            {canvasTab === "video" ? (
              session.video_url ? (
                <div className="canvas-stack">
                  <video
                    className="video-frame"
                    controls
                    preload="metadata"
                    ref={videoRef}
                    src={`${API_BASE_URL}/sessions/${session.session_id}/video`}
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      const duration = video.duration || 0;
                      const restoredTime = Math.min(savedVideoTimeRef.current, duration || savedVideoTimeRef.current);
                      setVideoDuration(duration);
                      if (restoredTime > 0) {
                        video.currentTime = restoredTime;
                      }
                      setVideoCurrentTime(restoredTime || video.currentTime || 0);
                    }}
                    onTimeUpdate={(event) => {
                      const currentTime = event.currentTarget.currentTime || 0;
                      savedVideoTimeRef.current = currentTime;
                      setVideoCurrentTime(currentTime);
                    }}
                  />
                  <div className="video-transport-bar">
                    <button
                      className="ghost-button video-jump-button"
                      disabled={videoDuration <= 0}
                      onClick={() => jumpVideo(Math.max(0, videoCurrentTime - 10))}
                      type="button"
                    >
                      -10s
                    </button>
                    <span className="timeline-time-readout video-time-readout">
                      {formatSeconds(String(videoCurrentTime))} / {formatSeconds(String(timelineMaxSec))}
                    </span>
                    <button
                      className="ghost-button video-jump-button"
                      disabled={videoDuration <= 0}
                      onClick={() => jumpVideo(videoCurrentTime + 10)}
                      type="button"
                    >
                      +10s
                    </button>
                  </div>
                </div>
              ) : (
                <div className="review-empty">
                  No matched video for this session yet. Add or fix the mapping in `asset_mappings`.
                </div>
              )
            ) : null}

            {canvasTab === "logs" ? (
              <div className="canvas-stack">
                <div className="toolbar-row">
                  <label className="toolbar-field">
                    Log file
                    <select
                      value={selectedLogFile}
                      onChange={(event) => setSelectedLogFile(event.target.value)}
                    >
                      <option value="all">All files</option>
                      {logFiles.map((file) => (
                        <option key={file} value={file}>
                          {file.split("/").pop()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="pill subtle">{filteredLogs.length} rows</span>
                </div>
                <div className="canvas-scroll surface-terminal">
                  {filteredLogs.slice(0, 300).map((row) => (
                    <div className="canvas-log-row" key={row.log_event_id}>
                      <span className="log-meta">{row.source_file.split("/").pop()}</span>
                      <span className="log-meta">#{row.line_number}</span>
                      <span className={`timeline-dot tone-${toneForEventType(row.event_class)}`} />
                      <code>{row.raw_text}</code>
                    </div>
                  ))}
                  {filteredLogs.length === 0 ? (
                    <div className="review-empty">No parsed log rows for this filter.</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {canvasTab === "surveys" ? (
              <div className="canvas-stack">
                <div className="toolbar-row">
                  <span className="pill subtle">
                    {Object.keys(groupedSurveys).length} survey groups
                  </span>
                  <span className="pill subtle">
                    {(sessionQuery.data?.surveys.length ?? 0).toLocaleString()} answers
                  </span>
                </div>
                <div className="canvas-scroll survey-canvas-grid">
                  {Object.entries(groupedSurveys).map(([surveyName, rows]) => (
                    <section className="survey-canvas-card" key={surveyName}>
                      <div className="section-header">
                        <h4>{surveyName}</h4>
                        <span className="pill subtle">{rows.length}</span>
                      </div>
                      <div className="survey-canvas-table">
                        {rows.slice(0, 40).map((row) => (
                          <div className="survey-canvas-row" key={row.row_id}>
                            <p className="small muted">{row.question_id}</p>
                            <p>{row.question_text}</p>
                            <p className="response">{row.response}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                  {(sessionQuery.data?.surveys.length ?? 0) === 0 ? (
                    <div className="review-empty">No normalized survey rows yet.</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {canvasTab === "notes" ? (
              <div className="canvas-notes-grid">
                <article className="note-surface">
                  <div className="section-header">
                    <h4>Session memo</h4>
                  </div>
                  <textarea
                    className="memo-textarea note-inline-textarea"
                    value={memoBody}
                    onChange={(event) => setMemoBody(event.target.value)}
                    placeholder="Summarize strategy, key moments, design observations, and paper-worthy examples."
                  />
                  <button
                    className="primary-button"
                    onClick={() => saveMemoMutation.mutate(memoBody)}
                    type="button"
                  >
                    {saveMemoMutation.isPending ? "Saving..." : "Save memo"}
                  </button>
                </article>
                <article className="note-surface">
                  <div className="section-header">
                    <h4>Workspace notes</h4>
                    <span className="pill subtle">local</span>
                  </div>
                  <textarea
                    className="memo-textarea note-inline-textarea"
                    value={workspaceNotes}
                    onChange={(event) => setWorkspaceNotes(event.target.value)}
                    placeholder="Capture quick thoughts, questions to revisit, and candidate annotations while reviewing."
                  />
                </article>
              </div>
            ) : null}

          </div>

        </div>

        <div className="review-panel review-workbench-panel event-inspector-panel">
          <div className="event-inspector-header">
            <div>
              <h3>{selectedTimelineEventId ? "Edit event" : "New event"}</h3>
              <span className="timeline-time-readout">
                {startTimeInput}
                {endTimeInput ? ` - ${endTimeInput}` : ""}
              </span>
            </div>
            <div className="event-inspector-actions">
              <button className="ghost-button" onClick={clearEventDraft} type="button">
                Clear
              </button>
              {selectedTimelineEventId ? (
                <button
                  className="ghost-button"
                  disabled={deleteEventMutation.isPending}
                  onClick={() => deleteEventMutation.mutate(selectedTimelineEventId)}
                  type="button"
                >
                  Delete
                </button>
              ) : null}
            </div>
          </div>

          <form className="event-inspector-form" noValidate onSubmit={handleSubmit}>
            <div className="event-time-grid">
              <label>
                Start
                <div className="input-with-action">
                  <input
                    aria-invalid={Boolean(timeError)}
                    inputMode="numeric"
                    placeholder="00:00"
                    value={startTimeInput}
                    onChange={(event) => updateStartTimeInput(event.target.value)}
                  />
                  <button
                    aria-label="Use current video time for start time"
                    className="icon-button"
                    disabled={videoDuration <= 0}
                    onClick={() => useCurrentVideoTimeFor("start")}
                    type="button"
                  >
                    <TimeCaptureIcon />
                  </button>
                </div>
              </label>
              <label>
                End
                <div className="input-with-action">
                  <input
                    aria-invalid={Boolean(timeError)}
                    inputMode="numeric"
                    placeholder="optional"
                    value={endTimeInput}
                    onChange={(event) => updateEndTimeInput(event.target.value)}
                  />
                  <button
                    aria-label="Use current video time for end time"
                    className="icon-button"
                    disabled={videoDuration <= 0}
                    onClick={() => useCurrentVideoTimeFor("end")}
                    type="button"
                  >
                    <TimeCaptureIcon />
                  </button>
                </div>
              </label>
            </div>
            {timeError ? (
              <div className="form-error" role="alert">
                {timeError}
              </div>
            ) : null}
            <label>
              Event type
              <select
                value={draft.event_type}
                onChange={(event) => setDraft({ ...draft, event_type: event.target.value })}
              >
                {EVENT_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {formatOptionLabel(option)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Task path
              <select
                value={taskPreset}
                onChange={(event) => {
                  setTaskPreset(event.target.value);
                  if (event.target.value !== "other") {
                    setDraft((current) => ({ ...current, task_path: "" }));
                  }
                }}
              >
                {TASK_PATH_OPTIONS.map((option) => (
                  <option key={option.value || "blank"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {taskPreset === "other" ? (
              <label>
                Custom task
                <input
                  placeholder="Optional"
                  value={draft.task_path}
                  onChange={(event) => setDraft({ ...draft, task_path: event.target.value })}
                />
              </label>
            ) : null}
            <label>
              Title
              <input
                placeholder={generatedTitle}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label>
              Notes
              <textarea
                className="compact-notes"
                placeholder="Optional notes"
                value={draft.evidence_note}
                onChange={(event) => setDraft({ ...draft, evidence_note: event.target.value })}
              />
            </label>
            <div className="choice-chip-grid compact-chip-grid">
              {OBSERVATION_OPTIONS.map((option) => (
                <button
                  className={`choice-chip ${observationChoices.includes(option) ? "active" : ""}`}
                  key={option}
                  onClick={() => toggleChoice(option, setObservationChoices)}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
            <div className="choice-chip-grid compact-chip-grid">
              {tagsQuery.data?.filter((tag) => tag.archived !== "true").map((tag) => (
                <button
                  className={`choice-chip ${draft.tag_ids.includes(tag.tag_id) ? "active" : ""}`}
                  key={tag.tag_id}
                  onClick={() => toggleTag(tag.tag_id)}
                  type="button"
                >
                  {tag.category} / {tag.name}
                </button>
              ))}
            </div>
            <div className="event-inspector-footer">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.starred}
                  onChange={(event) => setDraft({ ...draft, starred: event.target.checked })}
                />
                Starred
              </label>
              <button
                className="primary-button"
                disabled={createEventMutation.isPending || updateEventMutation.isPending}
                type="submit"
              >
                {selectedTimelineEventId
                  ? updateEventMutation.isPending
                    ? "Updating..."
                    : "Update"
                  : createEventMutation.isPending
                    ? "Saving..."
                    : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="review-panel timeline-editor-panel">
        <div className="timeline-editor-header">
          <div>
            <h3>Timeline editor</h3>
            <span className="timeline-time-readout">
              {formatSeconds(String(videoCurrentTime))} / {formatSeconds(String(timelineMaxSec))}
            </span>
          </div>
          <div className="timeline-dock-actions">
            <span className="pill subtle">{timelineEvents.length} events</span>
          </div>
        </div>

        <div className="timeline-ruler">
          {buildTimelineTicks(timelineMaxSec).map((tick) => (
            <span
              className={`timeline-ruler-tick ${tick.major ? "major" : ""}`}
              key={tick.value}
              style={{ left: `${toTimelinePercent(tick.value, timelineMaxSec)}%` }}
            >
              {tick.major ? formatTickLabel(tick.value) : ""}
            </span>
          ))}
        </div>

        <div className="timeline-track-shell">
          <div
            className="timeline-editor-track"
            onClick={createDraftFromTimeline}
            style={{
              height: `${Math.max(84, 36 + timelineLanes.length * 28)}px`,
            }}
            role="presentation"
          >
            <div className="timeline-frame-strip" />
            {timelineLanes.map((_, index) => (
              <div
                className="timeline-lane-row"
                key={`lane-${index}`}
                style={{ top: `${20 + index * 28}px` }}
              />
            ))}
            <div
              className="timeline-playhead"
              style={{ left: `${toTimelinePercent(videoCurrentTime, timelineMaxSec)}%` }}
            />
            {timelineEvents.map((item) => {
              const startPercent = toTimelinePercent(Number(item.start_time_sec || 0), timelineMaxSec);
              const endValue = Number(item.end_time_sec || item.start_time_sec || 0);
              const endPercent = toTimelinePercent(endValue, timelineMaxSec);
              const widthPercent = Math.max(endPercent - startPercent, 1.2);
              const isActive = selectedTimelineEventId === item.event_id;

              return (
                <button
                  className={`timeline-marker tone-${toneForEventType(item.event_type)} ${isActive ? "active" : ""}`}
                  key={item.event_id}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    jumpToTimelineEvent(item);
                  }}
                  style={{
                    left: `${startPercent}%`,
                    top: `${24 + (timelineLanes.findIndex((lane) => lane.some((candidate) => candidate.event_id === item.event_id)) * 28)}px`,
                    width: `${widthPercent}%`,
                  }}
                  title={`${formatSeconds(item.start_time_sec)} • ${item.title || item.event_type}`}
                  type="button"
                >
                  <span className="timeline-marker-dot" />
                </button>
              );
            })}
          </div>
        </div>

        <div className="timeline-dock-list">
          {timelineEvents.length ? (
            timelineEvents.map((item) => (
              <div
                className={`timeline-dock-row ${selectedTimelineEventId === item.event_id ? "active" : ""}`}
                key={item.event_id}
              >
                <button
                  className="timeline-dock-item"
                  onClick={() => jumpToTimelineEvent(item)}
                  type="button"
                >
                  <span className="timeline-time">{formatSeconds(item.start_time_sec)}</span>
                  <span className={`timeline-dot tone-${toneForEventType(item.event_type)}`} />
                  <span className="timeline-dock-item-copy">
                    <strong>{item.title || formatOptionLabel(item.event_type)}</strong>
                    <span className="muted small">{item.observation || item.interpretation || item.event_type}</span>
                  </span>
                </button>
                <button
                  className="ghost-button timeline-delete-button"
                  onClick={() => deleteEventMutation.mutate(item.event_id)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            ))
          ) : (
            <div className="review-empty timeline-dock-empty">
              No timeline events yet. Add an event and it will appear here.
            </div>
          )}
        </div>
      </div>

    </section>
  );
}

function labelForTab(tab: CanvasTab) {
  return tab.charAt(0).toUpperCase() + tab.slice(1);
}

function formatOptionLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildGeneratedTitle(eventType: string, taskPreset: string, observationChoices: string[]) {
  const parts = [formatOptionLabel(eventType)];

  if (taskPreset && taskPreset !== "other") {
    parts.push(formatOptionLabel(taskPreset));
  }

  if (observationChoices.length > 0) {
    parts.push(observationChoices[0]);
  }

  return parts.join(" • ");
}

function mergeStructuredText(choices: string[], freeText: string) {
  const cleanedFreeText = freeText.trim();
  const structuredText = choices.join("; ");

  if (structuredText && cleanedFreeText) {
    return `${structuredText}. ${cleanedFreeText}`;
  }

  return structuredText || cleanedFreeText;
}

function toTimelinePercent(value: number, max: number) {
  if (!max) {
    return 0;
  }
  return Math.min(100, Math.max(0, (value / max) * 100));
}

function buildTimelineTicks(max: number) {
  const step = chooseTimelineTickStep(max);
  const ticks = [];

  for (let value = 0; value <= max; value += step) {
    ticks.push({
      value,
      major: value % (step * 2) === 0 || value === 0 || value + step > max || value === max,
    });
  }

  if (ticks[ticks.length - 1]?.value !== max) {
    ticks.push({ value: max, major: true });
  }

  return ticks;
}

function formatTickLabel(value: number) {
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60)
    .toString()
    .padStart(2, "0");

  if (hours > 0) {
    const hourMinutes = Math.floor((total % 3600) / 60)
      .toString()
      .padStart(2, "0");
    return `${hours}:${hourMinutes}`;
  }

  return `${minutes}:${seconds}`;
}

function chooseTimelineTickStep(max: number) {
  const steps = [10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((step) => max / step <= 10) ?? 3600;
}

function buildTimelineLanes(events: TimelineEvent[]) {
  const lanes: TimelineEvent[][] = [];

  for (const event of events) {
    const start = Number(event.start_time_sec || 0);
    const end = Number(event.end_time_sec || event.start_time_sec || 0);
    let placed = false;

    for (const lane of lanes) {
      const overlaps = lane.some((existing) => {
        const existingStart = Number(existing.start_time_sec || 0);
        const existingEnd = Number(existing.end_time_sec || existing.start_time_sec || 0);
        return start <= existingEnd && end >= existingStart;
      });

      if (!overlaps) {
        lane.push(event);
        placed = true;
        break;
      }
    }

    if (!placed) {
      lanes.push([event]);
    }
  }

  return lanes.length ? lanes : [[]];
}

function formatSeconds(value: string) {
  const total = Math.max(0, Math.floor(Number(value || 0)));
  const hours = Math.floor(total / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(total % 60)
    .toString()
    .padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatTimeInput(value: number) {
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(total % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function parseTimeInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^(\d{1,3}):([0-5]\d)$/);
  if (!match) {
    return null;
  }
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  return minutes * 60 + seconds;
}

function toneForEventType(value: string) {
  const normalized = value.toLowerCase();
  if (["choice", "decision"].includes(normalized)) {
    return "decision";
  }
  if (["attempt", "action", "success", "pivot", "debug"].includes(normalized)) {
    return "action";
  }
  if (["failure", "design_issue", "observation", "retry_loop"].includes(normalized)) {
    return "observation";
  }
  if (["insight", "mixed", "survey", "suspected_deception"].includes(normalized)) {
    return "insight";
  }
  return "default";
}

function TimeCaptureIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="6.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6.2v4l2.6 1.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}
