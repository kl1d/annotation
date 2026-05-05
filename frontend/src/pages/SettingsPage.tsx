import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, type AnnotationSchema, type AnnotationSchemaField, ConfigFile } from "../lib/api";

const configOrder = [
  "project",
  "asset_mappings",
  "survey_mappings",
  "log_mappings",
  "annotation_schema",
  "codebook",
];

const annotationSchemaFieldOrder = [
  "start_time_sec",
  "end_time_sec",
  "event_type",
  "task_path",
  "title",
  "evidence_note",
  "tag_ids",
] as const;

const annotationSchemaFieldDefaults: Record<(typeof annotationSchemaFieldOrder)[number], AnnotationSchemaField> = {
  start_time_sec: {
    key: "start_time_sec",
    label: "Start",
    required: true,
    input: "timecode",
    options: [],
    suggestions: [],
  },
  end_time_sec: {
    key: "end_time_sec",
    label: "End",
    required: false,
    input: "timecode",
    options: [],
    suggestions: [],
  },
  event_type: {
    key: "event_type",
    label: "Event type",
    required: true,
    input: "select",
    options: [],
    suggestions: [],
  },
  task_path: {
    key: "task_path",
    label: "Task name",
    required: false,
    input: "text",
    options: [],
    suggestions: ["A1", "A2", "B1", "B2", "B3"],
  },
  title: {
    key: "title",
    label: "Title",
    required: true,
    input: "text",
    options: [],
    suggestions: [],
  },
  evidence_note: {
    key: "evidence_note",
    label: "Notes",
    required: false,
    input: "textarea",
    options: [],
    suggestions: [],
  },
  tag_ids: {
    key: "tag_ids",
    label: "Tags",
    required: false,
    input: "tags",
    options: [],
    suggestions: [],
  },
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.getProjects,
  });
  const configFilesQuery = useQuery({
    queryKey: ["config-files"],
    queryFn: api.getConfigFiles,
  });
  const annotationSchemaQuery = useQuery({
    queryKey: ["annotation-schema"],
    queryFn: api.getAnnotationSchema,
  });
  const [selectedFile, setSelectedFile] = useState("project");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [annotationSchemaDraft, setAnnotationSchemaDraft] = useState<AnnotationSchema | null>(null);
  const [message, setMessage] = useState<string>("");

  const saveMutation = useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      api.saveConfigFile(name, content),
    onSuccess: async (saved, variables) => {
      if (variables.name === "annotation_schema") {
        setAnnotationSchemaDraft(null);
      }
      setMessage(`Saved ${saved.path}. Run ingest to apply mapping changes to normalized data.`);
      await queryClient.invalidateQueries({ queryKey: ["config-files"] });
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      await queryClient.invalidateQueries({ queryKey: ["annotation-schema"] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Failed to save config file.");
    },
  });

  const ingestMutation = useMutation({
    mutationFn: api.ingestSessions,
    onSuccess: async (result) => {
      setMessage(
        `Re-ingested ${result.sessions} sessions, ${result.surveys} survey rows, and ${result.logs} log rows.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["config-files"] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Failed to run ingest.");
    },
  });

  const switchProjectMutation = useMutation({
    mutationFn: api.setActiveProject,
    onSuccess: async (selection) => {
      setSelectedProjectId(selection.active_project);
      setDrafts({});
      setAnnotationSchemaDraft(null);
      setMessage(`Switched to ${selection.active_project}. Reloaded project config, sessions, and data views.`);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      await queryClient.invalidateQueries({ queryKey: ["config-files"] });
      await queryClient.invalidateQueries({ queryKey: ["annotation-schema"] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["data-files"] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Failed to switch project.");
    },
  });

  useEffect(() => {
    if (!configFilesQuery.data) {
      return;
    }
    setDrafts((current) => {
      const next = { ...current };
      for (const file of configFilesQuery.data) {
        if (!(file.name in next)) {
          next[file.name] = file.content;
        }
      }
      return next;
    });
  }, [configFilesQuery.data]);

  useEffect(() => {
    if (!projectsQuery.data) {
      return;
    }
    setSelectedProjectId((current) => current || projectsQuery.data.active_project);
  }, [projectsQuery.data]);

  useEffect(() => {
    if (!annotationSchemaQuery.data || annotationSchemaDraft) {
      return;
    }
    const normalized = normalizeEditableAnnotationSchema(annotationSchemaQuery.data);
    setAnnotationSchemaDraft(normalized);
    setDrafts((current) => ({
      ...current,
      annotation_schema: serializeAnnotationSchema(normalized),
    }));
  }, [annotationSchemaDraft, annotationSchemaQuery.data]);

  const configFiles = useMemo(() => {
    const source = configFilesQuery.data ?? [];
    return [...source].sort(
      (left, right) =>
        configOrder.indexOf(left.name) - configOrder.indexOf(right.name),
    );
  }, [configFilesQuery.data]);

  const activeFile = configFiles.find((file) => file.name === selectedFile) ?? configFiles[0];
  const activeContent = activeFile ? drafts[activeFile.name] ?? activeFile.content : "";
  const editableAnnotationSchema = annotationSchemaDraft
    ? normalizeEditableAnnotationSchema(annotationSchemaDraft)
    : annotationSchemaQuery.data
      ? normalizeEditableAnnotationSchema(annotationSchemaQuery.data)
      : null;

  function handleReload(file: ConfigFile) {
    setDrafts((current) => ({ ...current, [file.name]: file.content }));
    if (file.name === "annotation_schema" && annotationSchemaQuery.data) {
      const normalized = normalizeEditableAnnotationSchema(annotationSchemaQuery.data);
      setAnnotationSchemaDraft(normalized);
      setDrafts((current) => ({
        ...current,
        annotation_schema: serializeAnnotationSchema(normalized),
      }));
    }
    setMessage(`Reloaded ${file.path} from disk.`);
  }

  function updateAnnotationSchema(updater: (current: AnnotationSchema) => AnnotationSchema) {
    setAnnotationSchemaDraft((current) => {
      const base = normalizeEditableAnnotationSchema(current ?? annotationSchemaQuery.data ?? emptyAnnotationSchema());
      const next = normalizeEditableAnnotationSchema(updater(base));
      setDrafts((draftCurrent) => ({
        ...draftCurrent,
        annotation_schema: serializeAnnotationSchema(next),
      }));
      return next;
    });
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Project config editor</h2>
          <p className="muted">
            Edit the mounted YAML config files here, save them back to disk, then re-run ingest when mappings change.
          </p>
        </div>
        <button
          className="primary-button"
          disabled={ingestMutation.isPending}
          onClick={() => ingestMutation.mutate()}
          type="button"
        >
          {ingestMutation.isPending ? "Re-ingesting..." : "Run ingest"}
        </button>
      </header>

      {message ? <div className="callout">{message}</div> : null}

      <section className="panel project-switcher-panel">
        <div className="section-header">
          <div>
            <h3>Active project folder</h3>
            <p className="muted small">
              Switch between the mounted sample and your private local project without restarting Docker.
            </p>
          </div>
          <span className="pill subtle">{projectsQuery.data?.active_project ?? "Loading..."}</span>
        </div>
        <div className="project-switcher-row">
          <label className="project-switcher-field">
            <span className="muted small">Mounted project</span>
            <select
              onChange={(event) => {
                setSelectedProjectId(event.target.value);
                setMessage("");
              }}
              value={selectedProjectId}
            >
              {(projectsQuery.data?.available_projects ?? []).map((project) => (
                <option key={project.project_id} value={project.project_id}>
                  {project.label} ({project.path})
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button"
            disabled={
              switchProjectMutation.isPending ||
              !selectedProjectId ||
              selectedProjectId === projectsQuery.data?.active_project
            }
            onClick={() => switchProjectMutation.mutate(selectedProjectId)}
            type="button"
          >
            {switchProjectMutation.isPending ? "Switching..." : "Switch project"}
          </button>
        </div>
      </section>

      <div className="settings-layout">
        <aside className="panel settings-list">
          <h3>Config files</h3>
          <div className="settings-file-list">
            {configFiles.map((file) => (
              <button
                className={`settings-file-button ${activeFile?.name === file.name ? "active" : ""}`}
                key={file.name}
                onClick={() => {
                  setSelectedFile(file.name);
                  setMessage("");
                }}
                type="button"
              >
                <strong>{file.name}</strong>
                <span className="muted small">{file.path}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel settings-editor">
          {activeFile ? (
            <>
              <div className="section-header">
                <div>
                  <h3>{activeFile.name}</h3>
                  <p className="muted small">{activeFile.path}</p>
                </div>
                <div className="action-row">
                  <button className="ghost-button" onClick={() => handleReload(activeFile)} type="button">
                    Reload
                  </button>
                  <button
                    className="primary-button"
                    disabled={saveMutation.isPending}
                    onClick={() =>
                      saveMutation.mutate({
                        name: activeFile.name,
                        content: drafts[activeFile.name] ?? "",
                      })
                    }
                    type="button"
                  >
                    {saveMutation.isPending ? "Saving..." : "Save file"}
                  </button>
                </div>
              </div>
              {activeFile.name === "annotation_schema" && editableAnnotationSchema ? (
                <div className="annotation-schema-editor">
                  <section className="annotation-schema-section">
                    <div className="section-header">
                      <div>
                        <h4>Event form fields</h4>
                        <p className="muted small">These rows drive what appears in the session event editor.</p>
                      </div>
                    </div>
                    <div className="annotation-schema-field-list">
                      {annotationSchemaFieldOrder.map((fieldKey) => {
                        const field = editableAnnotationSchema.fields.find((item) => item.key === fieldKey) ?? annotationSchemaFieldDefaults[fieldKey];
                        const enabled =
                          editableAnnotationSchema.required_event_fields.includes(fieldKey) ||
                          editableAnnotationSchema.optional_event_fields.includes(fieldKey);
                        const required = editableAnnotationSchema.required_event_fields.includes(fieldKey);

                        return (
                          <div className="annotation-schema-field-row" key={fieldKey}>
                            <div className="annotation-schema-field-meta">
                              <strong>{fieldKey}</strong>
                              <span className="muted small">{field.input}</span>
                            </div>
                            <label className="annotation-schema-toggle">
                              <span>Show</span>
                              <input
                                checked={enabled}
                                onChange={(event) =>
                                  updateAnnotationSchema((current) =>
                                    setAnnotationFieldEnabled(current, fieldKey, event.target.checked),
                                  )
                                }
                                type="checkbox"
                              />
                            </label>
                            <label className="annotation-schema-toggle">
                              <span>Required</span>
                              <input
                                checked={required}
                                disabled={!enabled}
                                onChange={(event) =>
                                  updateAnnotationSchema((current) =>
                                    setAnnotationFieldRequired(current, fieldKey, event.target.checked),
                                  )
                                }
                                type="checkbox"
                              />
                            </label>
                            <label className="annotation-schema-label-field">
                              <span className="muted small">Label</span>
                              <input
                                onChange={(event) =>
                                  updateAnnotationSchema((current) =>
                                    updateAnnotationField(current, fieldKey, { label: event.target.value }),
                                  )
                                }
                                value={field.label}
                              />
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className="annotation-schema-section">
                    <div className="annotation-schema-grid">
                      <label>
                        <span className="muted small">Event type options</span>
                        <textarea
                          className="config-editor annotation-schema-textarea"
                          onChange={(event) =>
                            updateAnnotationSchema((current) =>
                              updateAnnotationField(current, "event_type", {
                                options: parseLineList(event.target.value),
                              }),
                            )
                          }
                          spellCheck={false}
                          value={(editableAnnotationSchema.fields.find((field) => field.key === "event_type")?.options ?? []).join("\n")}
                        />
                      </label>
                      <label>
                        <span className="muted small">Task name suggestions</span>
                        <textarea
                          className="config-editor annotation-schema-textarea"
                          onChange={(event) =>
                            updateAnnotationSchema((current) =>
                              updateAnnotationField(current, "task_path", {
                                suggestions: parseLineList(event.target.value),
                              }),
                            )
                          }
                          spellCheck={false}
                          value={(editableAnnotationSchema.fields.find((field) => field.key === "task_path")?.suggestions ?? []).join("\n")}
                        />
                      </label>
                    </div>
                  </section>

                  <details className="annotation-schema-raw">
                    <summary>Raw YAML</summary>
                    <textarea
                      className="config-editor"
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [activeFile.name]: event.target.value,
                        }))
                      }
                      spellCheck={false}
                      value={activeContent}
                    />
                  </details>
                </div>
              ) : (
                <textarea
                  className="config-editor"
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [activeFile.name]: event.target.value,
                    }))
                  }
                  spellCheck={false}
                  value={activeContent}
                />
              )}
            </>
          ) : (
            <div className="empty-state">No config files found.</div>
          )}
        </section>
      </div>
    </section>
  );
}

function emptyAnnotationSchema(): AnnotationSchema {
  return {
    event_types: [],
    required_event_fields: [],
    optional_event_fields: [],
    fields: [],
  };
}

function normalizeEditableAnnotationSchema(source: AnnotationSchema): AnnotationSchema {
  const fields = annotationSchemaFieldOrder.map((key) => {
    const existing = source.fields.find((field) => field.key === key);
    const defaults = annotationSchemaFieldDefaults[key];
    return {
      ...defaults,
      ...existing,
      key,
      label: existing?.label || defaults.label,
      input: existing?.input || defaults.input,
      options: existing?.options?.length ? existing.options : defaults.options,
      suggestions: existing?.suggestions?.length ? existing.suggestions : defaults.suggestions,
    };
  });

  return {
    event_types: source.event_types?.length
      ? source.event_types
      : fields.find((field) => field.key === "event_type")?.options ?? [],
    required_event_fields: annotationSchemaFieldOrder.filter((key) => source.required_event_fields.includes(key)),
    optional_event_fields: annotationSchemaFieldOrder.filter((key) => source.optional_event_fields.includes(key)),
    fields,
  };
}

function updateAnnotationField(
  schema: AnnotationSchema,
  key: (typeof annotationSchemaFieldOrder)[number],
  patch: Partial<AnnotationSchemaField>,
): AnnotationSchema {
  const fields = schema.fields.map((field) => (field.key === key ? { ...field, ...patch, key } : field));
  const next = {
    ...schema,
    fields,
  };
  if (key === "event_type" && patch.options) {
    next.event_types = patch.options;
  }
  return next;
}

function setAnnotationFieldEnabled(
  schema: AnnotationSchema,
  key: (typeof annotationSchemaFieldOrder)[number],
  enabled: boolean,
): AnnotationSchema {
  const required = schema.required_event_fields.filter((field) => field !== key);
  const optional = schema.optional_event_fields.filter((field) => field !== key);

  if (!enabled) {
    return {
      ...schema,
      required_event_fields: required,
      optional_event_fields: optional,
    };
  }

  return {
    ...schema,
    required_event_fields: required,
    optional_event_fields: [...optional, key],
  };
}

function setAnnotationFieldRequired(
  schema: AnnotationSchema,
  key: (typeof annotationSchemaFieldOrder)[number],
  required: boolean,
): AnnotationSchema {
  const nextRequired = schema.required_event_fields.filter((field) => field !== key);
  const nextOptional = schema.optional_event_fields.filter((field) => field !== key);

  if (required) {
    return {
      ...schema,
      required_event_fields: [...nextRequired, key],
      optional_event_fields: nextOptional,
    };
  }

  return {
    ...schema,
    required_event_fields: nextRequired,
    optional_event_fields: [...nextOptional, key],
  };
}

function parseLineList(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeAnnotationSchema(schema: AnnotationSchema) {
  const lines = [
    "event_types:",
    ...serializeYamlList(schema.event_types),
    "required_event_fields:",
    ...serializeYamlList(schema.required_event_fields),
    "optional_event_fields:",
    ...serializeYamlList(schema.optional_event_fields),
    "field_config:",
  ];

  for (const field of schema.fields) {
    lines.push(`  ${field.key}:`);
    lines.push(`    label: ${quoteYamlString(field.label)}`);
    lines.push(`    input: ${field.input}`);
    if (field.key === "event_type") {
      lines.push("    options_from: event_types");
    }
    if (field.suggestions.length) {
      lines.push("    suggestions:");
      for (const suggestion of field.suggestions) {
        lines.push(`      - ${quoteYamlString(suggestion)}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function serializeYamlList(values: string[]) {
  if (!values.length) {
    return ["  []"];
  }
  return values.map((value) => `  - ${quoteYamlString(value)}`);
}

function quoteYamlString(value: string) {
  return JSON.stringify(value);
}
