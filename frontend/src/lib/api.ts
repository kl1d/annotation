export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api";
export const APP_BASE_URL = API_BASE_URL.replace(/\/api$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export type SessionSummary = {
  session_id: string;
  participant_id: string;
  status: string;
  video_path: string;
  video_url?: string | null;
  log_path: string;
  pre_survey_path: string;
  progression_survey_path: string;
  post_survey_path: string;
  annotation_count: number;
  starred_count: number;
  last_updated?: string | null;
};

export type SessionDetail = {
  session: SessionSummary;
  events: TimelineEvent[];
  memo: MemoRecord;
  logs: LogRow[];
  surveys: SurveyRow[];
};

export type TimelineEvent = {
  event_id: string;
  session_id: string;
  participant_id: string;
  start_time_sec: string;
  end_time_sec: string;
  source_type: string;
  task_path: string;
  event_type: string;
  title: string;
  observation: string;
  interpretation: string;
  evidence_note: string;
  confidence: string;
  follow_up: string;
  starred: string;
  created_at: string;
  updated_at: string;
  tag_ids?: string[];
  tags?: Tag[];
};

export type Tag = {
  tag_id: string;
  name: string;
  category: string;
  color: string;
  description: string;
  archived: string;
};

export type MemoRecord = {
  memo_id: string;
  session_id: string;
  participant_id: string;
  title: string;
  body: string;
  last_updated: string;
};

export type SurveyRow = {
  row_id: string;
  session_id: string;
  participant_id: string;
  survey_name: string;
  question_id: string;
  question_text: string;
  response: string;
  source_path: string;
};

export type LogRow = {
  log_event_id: string;
  session_id: string;
  participant_id: string;
  source_file: string;
  line_number: string;
  timestamp_sec: string;
  event_class: string;
  raw_text: string;
  command: string;
  path: string;
  exit_code: string;
  extra_json: string;
};

export type ProjectConfig = {
  project_name: string;
  participant_id_regex: string;
  paths: Record<string, string>;
};

export type ProjectTarget = {
  project_id: string;
  label: string;
  path: string;
  active: boolean;
};

export type ProjectSelection = {
  active_project: string;
  available_projects: ProjectTarget[];
};

export type ConfigFile = {
  name: string;
  path: string;
  content: string;
};

export type IngestResult = {
  participants: number;
  sessions: number;
  surveys: number;
  logs: number;
  tags_seeded: number;
};

export type SessionCsvFile = {
  file_id: string;
  label: string;
  path: string;
  description: string;
  row_count: number;
};

export type SessionCsvPreview = {
  file_id: string;
  label: string;
  path: string;
  description: string;
  columns: string[];
  rows: Record<string, string>[];
  row_count: number;
};

export const api = {
  getProjects: () => request<ProjectSelection>("/projects"),
  setActiveProject: (projectId: string) =>
    request<ProjectSelection>("/projects/active", {
      method: "PUT",
      body: JSON.stringify({ project_id: projectId }),
    }),
  getConfig: () => request<ProjectConfig>("/config"),
  getConfigFiles: () => request<ConfigFile[]>("/config/files"),
  getDataFiles: () => request<SessionCsvFile[]>("/data/files"),
  getDataFilePreview: (fileId: string) =>
    request<SessionCsvPreview>(`/data/files/${fileId}`),
  saveConfigFile: (name: string, content: string) =>
    request<ConfigFile>(`/config/files/${name}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  getSessions: () => request<SessionSummary[]>("/sessions"),
  ingestSessions: () => request<IngestResult>("/sessions/ingest", { method: "POST" }),
  getSession: (sessionId: string) => request<SessionDetail>(`/sessions/${sessionId}`),
  getSessionCsvFiles: (sessionId: string) =>
    request<SessionCsvFile[]>(`/sessions/${sessionId}/csv-files`),
  getSessionCsvPreview: (sessionId: string, fileId: string) =>
    request<SessionCsvPreview>(`/sessions/${sessionId}/csv-files/${fileId}`),
  getTags: () => request<Tag[]>("/tags"),
  createEvent: (sessionId: string, payload: Record<string, unknown>) =>
    request<TimelineEvent>(`/sessions/${sessionId}/events`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateEvent: (eventId: string, payload: Record<string, unknown>) =>
    request<TimelineEvent>(`/events/${eventId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteEvent: (eventId: string) =>
    request<void>(`/events/${eventId}`, { method: "DELETE" }),
  saveMemo: (sessionId: string, payload: Pick<MemoRecord, "title" | "body">) =>
    request<MemoRecord>(`/sessions/${sessionId}/memo`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
};
