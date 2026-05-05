import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  api,
  type AiProviderConfigStatus,
  type AnnotationSchema,
  type AnnotationSchemaField,
  ConfigFile,
} from "../lib/api";

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

type AiConfigDraft = {
  enabled: boolean;
  provider: string;
  model: string;
  base_url: string;
  api_key: string;
  clear_api_key: boolean;
  temperature: string;
  max_output_tokens: string;
};

type SettingsTab = "project" | "ai" | "config";

const defaultAiConfigDraft: AiConfigDraft = {
  enabled: false,
  provider: "",
  model: "",
  base_url: "",
  api_key: "",
  clear_api_key: false,
  temperature: "0.2",
  max_output_tokens: "1200",
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
  const aiConfigQuery = useQuery({
    queryKey: ["ai-config"],
    queryFn: api.getAiConfig,
  });
  const [selectedFile, setSelectedFile] = useState("project");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [annotationSchemaDraft, setAnnotationSchemaDraft] = useState<AnnotationSchema | null>(null);
  const [aiConfigDraft, setAiConfigDraft] = useState<AiConfigDraft>(defaultAiConfigDraft);
  const [activeTab, setActiveTab] = useState<SettingsTab>("project");
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

  const saveAiConfigMutation = useMutation({
    mutationFn: () => api.saveAiConfig(buildAiConfigPayload(aiConfigDraft)),
    onSuccess: async (config) => {
      setAiConfigDraft(draftFromAiConfig(config));
      setMessage(
        config.enabled
          ? `Saved AI Assistant settings for ${config.provider_label || config.provider}.`
          : "Saved AI Assistant settings. AI remains disabled.",
      );
      await queryClient.invalidateQueries({ queryKey: ["ai-config"] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Failed to save AI Assistant settings.");
    },
  });

  const testAiConfigMutation = useMutation({
    mutationFn: async () => {
      await api.saveAiConfig(buildAiConfigPayload(aiConfigDraft));
      return api.testAiConfig();
    },
    onSuccess: async (result) => {
      setMessage(result.message);
      setAiConfigDraft(draftFromAiConfig(result.config));
      await queryClient.invalidateQueries({ queryKey: ["ai-config"] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Failed to test AI Assistant settings.");
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

  useEffect(() => {
    if (!aiConfigQuery.data) {
      return;
    }
    setAiConfigDraft(draftFromAiConfig(aiConfigQuery.data));
  }, [aiConfigQuery.data]);

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
  const selectedAiProvider = aiConfigQuery.data?.available_providers.find(
    (provider) => provider.provider === aiConfigDraft.provider,
  );
  const aiConfig = aiConfigQuery.data;
  const savedAiProviderId = aiConfig?.provider || "";
  const draftUsesSavedKey = Boolean(
    selectedAiProvider?.requires_api_key &&
      aiConfigDraft.provider === savedAiProviderId &&
      aiConfig?.api_key_configured &&
      !aiConfigDraft.clear_api_key,
  );
  const draftApiKeyConfigured = Boolean(aiConfigDraft.api_key.trim() || draftUsesSavedKey);
  const aiConfigMissing = [
    ...(!aiConfigDraft.provider ? ["provider"] : []),
    ...(aiConfigDraft.provider && !aiConfigDraft.model.trim() ? ["model"] : []),
    ...(selectedAiProvider?.requires_api_key && !draftApiKeyConfigured ? ["api_key"] : []),
    ...(selectedAiProvider?.provider === "openai_compatible" && !aiConfigDraft.base_url.trim() ? ["base_url"] : []),
  ];
  const aiDraftReady = Boolean(aiConfigDraft.enabled && selectedAiProvider && aiConfigMissing.length === 0);
  const aiSavedActive = Boolean(aiConfig?.enabled && aiConfig?.configured);
  const aiProviderRows = useMemo(() => {
    const providers = aiConfig?.available_providers ?? [];
    const visibleProviderIds = new Set([savedAiProviderId, aiConfigDraft.provider].filter(Boolean));
    return providers.filter((provider) => visibleProviderIds.has(provider.provider)).map((provider) => {
      const isSavedProvider = Boolean(savedAiProviderId) && provider.provider === savedAiProviderId;
      const isSelectedProvider = Boolean(aiConfigDraft.provider) && provider.provider === aiConfigDraft.provider;
      const model = isSelectedProvider ? aiConfigDraft.model.trim() : aiConfig?.model || "";
      const baseUrl = isSelectedProvider ? aiConfigDraft.base_url.trim() : aiConfig?.base_url || "";
      const apiKeyConfigured = isSelectedProvider
        ? draftApiKeyConfigured
        : Boolean(isSavedProvider && aiConfig?.api_key_configured);
      const missing = [
        ...(!model ? ["model"] : []),
        ...(provider.requires_api_key && !apiKeyConfigured ? ["api_key"] : []),
        ...(provider.provider === "openai_compatible" && !baseUrl ? ["base_url"] : []),
      ];
      const hasMinimumConfig =
        Boolean(model) &&
        (!provider.requires_api_key || apiKeyConfigured) &&
        (provider.provider !== "openai_compatible" || Boolean(baseUrl));
      const isInUse = Boolean(aiConfig?.enabled && aiConfig?.configured && isSavedProvider);
      const status = isInUse
        ? "Active"
        : hasMinimumConfig
          ? isSavedProvider
            ? aiConfig?.enabled
              ? "Saved"
              : "Configured"
            : "Ready to save"
          : isSelectedProvider || isSavedProvider
            ? "Needs setup"
            : "Not configured";

      return {
        ...provider,
        isSavedProvider,
        isSelectedProvider,
        isInUse,
        missing,
        hasMinimumConfig,
        model,
        status,
      };
    });
  }, [aiConfig, aiConfigDraft, draftApiKeyConfigured, savedAiProviderId]);

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

  function updateAiConfigDraft(patch: Partial<AiConfigDraft>) {
    setAiConfigDraft((current) => ({ ...current, ...patch }));
    setMessage("");
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Workbench settings</h2>
          <p className="muted">
            Manage the active study folder, AI provider, and project configuration.
          </p>
        </div>
      </header>

      {message ? <div className="callout">{message}</div> : null}

      <div className="settings-tab-row" role="tablist" aria-label="Settings sections">
        {[
          { id: "project", label: "Project" },
          { id: "ai", label: "AI Assistant" },
          { id: "config", label: "Config files" },
        ].map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className={`settings-tab ${activeTab === tab.id ? "active" : ""}`}
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id as SettingsTab);
              setMessage("");
            }}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "project" ? (
      <section className="panel project-switcher-panel">
        <div className="section-header">
          <div>
            <h3>Active project folder</h3>
            <p className="muted small">
              Switch between the mounted sample and your private local project without restarting Docker.
            </p>
          </div>
          <span className="settings-status-badge">{projectsQuery.data?.active_project ?? "Loading..."}</span>
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
      ) : null}

      {activeTab === "ai" ? (
      <section className="panel ai-settings-panel">
        <div className="section-header">
          <div>
            <h3>AI Assistant</h3>
            <p className="muted small">
              {aiSavedActive
                ? `Ready with ${aiConfig?.provider_label || aiConfig?.provider}.`
                : aiDraftReady
                  ? "Ready to save and test."
                  : aiConfigDraft.enabled
                  ? "Configuration is incomplete."
                  : "Disabled until a provider is configured."}
            </p>
          </div>
          <div className="ai-settings-header-actions">
            <span className={`ai-status-badge ${aiSavedActive || aiDraftReady ? "ready" : aiConfigDraft.enabled ? "warning" : ""}`}>
              {aiSavedActive ? "Configured" : aiDraftReady ? "Ready to save" : aiConfigDraft.enabled ? "Needs setup" : "Disabled"}
            </span>
            <label className="switch-field">
              <span>Enable</span>
              <input
                checked={aiConfigDraft.enabled}
                onChange={(event) => updateAiConfigDraft({ enabled: event.target.checked })}
                type="checkbox"
              />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
            </label>
          </div>
        </div>

        <div className="ai-settings-grid">
          <label>
            <span className="muted small">Provider</span>
            <select
              onChange={(event) => {
                const provider = event.target.value;
                const providerMeta = aiConfigQuery.data?.available_providers.find((item) => item.provider === provider);
                updateAiConfigDraft({
                  provider,
                  base_url: providerMeta?.supports_base_url
                    ? provider === "ollama" && !aiConfigDraft.base_url
                      ? "http://host.docker.internal:11434"
                      : aiConfigDraft.base_url
                    : "",
                  api_key: "",
                  clear_api_key: false,
                });
              }}
              value={aiConfigDraft.provider}
            >
              <option value="">Select provider</option>
              {(aiConfigQuery.data?.available_providers ?? []).map((provider) => (
                <option key={provider.provider} value={provider.provider}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="muted small">Model</span>
            <input
              onChange={(event) => updateAiConfigDraft({ model: event.target.value })}
              placeholder={aiConfigDraft.provider === "ollama" ? "llama3.1" : "model name"}
              value={aiConfigDraft.model}
            />
          </label>

          <label>
            <span className="muted small">Base URL</span>
            <input
              disabled={!selectedAiProvider?.supports_base_url}
              onChange={(event) => updateAiConfigDraft({ base_url: event.target.value })}
              placeholder={selectedAiProvider?.supports_base_url ? "http://localhost:11434" : "Provider default"}
              value={aiConfigDraft.base_url}
            />
          </label>

          <label>
            <span className="muted small">API key</span>
            <input
              autoComplete="off"
              disabled={!selectedAiProvider?.requires_api_key}
              onChange={(event) => updateAiConfigDraft({ api_key: event.target.value, clear_api_key: false })}
              placeholder={
                selectedAiProvider?.requires_api_key
                  ? aiConfig?.api_key_configured
                    ? "Saved key is set"
                    : "Paste key"
                  : "No key required"
              }
              type="password"
              value={aiConfigDraft.api_key}
            />
          </label>

          <label>
            <span className="muted small">Temperature</span>
            <input
              inputMode="decimal"
              onChange={(event) => updateAiConfigDraft({ temperature: event.target.value })}
              value={aiConfigDraft.temperature}
            />
          </label>

          <label>
            <span className="muted small">Max output tokens</span>
            <input
              inputMode="numeric"
              onChange={(event) => updateAiConfigDraft({ max_output_tokens: event.target.value })}
              value={aiConfigDraft.max_output_tokens}
            />
          </label>
        </div>

        <div className="ai-settings-footer">
          <div className="ai-settings-status">
            {aiConfigMissing.length ? (
              <span className="muted small">Missing: {aiConfigMissing.join(", ")}</span>
            ) : (
              <span className="muted small">
                {selectedAiProvider?.local
                  ? "Local provider"
                  : selectedAiProvider
                    ? "Remote provider: selected session context may leave this machine."
                    : "Provider not selected"}
              </span>
            )}
            {aiConfig?.api_key_configured && selectedAiProvider?.requires_api_key ? (
              <label className="checkbox-label">
                <input
                  checked={aiConfigDraft.clear_api_key}
                  onChange={(event) =>
                    updateAiConfigDraft({
                      clear_api_key: event.target.checked,
                      api_key: event.target.checked ? "" : aiConfigDraft.api_key,
                    })
                  }
                  type="checkbox"
                />
                <span>Clear saved key</span>
              </label>
            ) : null}
          </div>

          <div className="action-row">
            <button
              className="ghost-button"
              disabled={testAiConfigMutation.isPending}
              onClick={() => testAiConfigMutation.mutate()}
              type="button"
            >
              {testAiConfigMutation.isPending ? "Testing..." : "Save and test"}
            </button>
            <button
              className="primary-button"
              disabled={saveAiConfigMutation.isPending}
              onClick={() => saveAiConfigMutation.mutate()}
              type="button"
            >
              {saveAiConfigMutation.isPending ? "Saving..." : "Save AI settings"}
            </button>
          </div>
        </div>

        <div className="ai-provider-list" aria-label="AI providers">
          <div className="ai-provider-list-header">
            <div>
              <h4>Provider status</h4>
              <p className="muted small">Configured provider and active runtime for this workbench.</p>
            </div>
            <span className="muted small">{aiConfig?.source === "environment" ? "Environment" : "Local file"}</span>
          </div>

          <div className="ai-provider-rows">
            {aiProviderRows.map((provider) => (
              <div className={`ai-provider-row ${provider.isInUse ? "active" : ""}`} key={provider.provider}>
                <div className="ai-provider-row-main">
                  <div>
                    <strong>{provider.label}</strong>
                    <p className="muted small">
                  {provider.local ? "Local model host" : "Remote API"}
                      {provider.model ? ` · ${provider.model}` : ""}
                    </p>
                  </div>
                  <div className="ai-provider-badges">
                    {provider.isSelectedProvider && !provider.isSavedProvider ? (
                      <span className="ai-provider-badge selected">Selected</span>
                    ) : null}
                    {provider.isSavedProvider ? (
                      <span className="ai-provider-badge configured">
                        {provider.hasMinimumConfig ? "Configured" : "Added"}
                      </span>
                    ) : null}
                    {provider.isInUse ? <span className="ai-provider-badge active">In use</span> : null}
                    <span className={`ai-provider-badge ${provider.status === "Needs setup" ? "warning" : provider.status === "Ready to save" ? "selected" : ""}`}>
                      {provider.status}
                    </span>
                  </div>
                </div>
                <div className="ai-provider-row-meta">
                  <span>{provider.requires_api_key ? "API key required" : "No API key required"}</span>
                  <span>{provider.supports_base_url ? "Custom base URL" : "Provider default URL"}</span>
                  {provider.missing.length ? <span>Missing {provider.missing.join(", ")}</span> : null}
                </div>
              </div>
            ))}
            {!aiProviderRows.length ? (
              <div className="ai-provider-empty">
                <strong>No provider added yet.</strong>
                <span className="muted small">Choose a provider above, add its model and credentials, then save.</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>
      ) : null}

      {activeTab === "config" ? (
      <>
      <section className="panel settings-config-toolbar">
        <div>
          <h3>Config files</h3>
          <p className="muted small">
            Edit mounted YAML files and re-run ingest when mappings or schema settings change.
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
      </>
      ) : null}
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

function draftFromAiConfig(config: AiProviderConfigStatus): AiConfigDraft {
  return {
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    base_url: config.base_url,
    api_key: "",
    clear_api_key: false,
    temperature: String(config.temperature),
    max_output_tokens: String(config.max_output_tokens),
  };
}

function buildAiConfigPayload(draft: AiConfigDraft) {
  const apiKey = draft.api_key.trim();
  return {
    enabled: draft.enabled,
    provider: draft.provider.trim(),
    model: draft.model.trim(),
    base_url: draft.base_url.trim(),
    ...(apiKey ? { api_key: apiKey } : {}),
    clear_api_key: draft.clear_api_key,
    temperature: parseNumberOrDefault(draft.temperature, 0.2),
    max_output_tokens: Math.round(parseNumberOrDefault(draft.max_output_tokens, 1200)),
  };
}

function parseNumberOrDefault(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
