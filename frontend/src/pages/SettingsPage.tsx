import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api, ConfigFile } from "../lib/api";

const configOrder = [
  "project",
  "asset_mappings",
  "survey_mappings",
  "log_mappings",
  "annotation_schema",
  "codebook",
];

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
  const [selectedFile, setSelectedFile] = useState("project");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>("");

  const saveMutation = useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      api.saveConfigFile(name, content),
    onSuccess: async (saved) => {
      setMessage(`Saved ${saved.path}. Run ingest to apply mapping changes to normalized data.`);
      await queryClient.invalidateQueries({ queryKey: ["config-files"] });
      await queryClient.invalidateQueries({ queryKey: ["config"] });
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
      setMessage(`Switched to ${selection.active_project}. Reloaded project config, sessions, and data views.`);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      await queryClient.invalidateQueries({ queryKey: ["config-files"] });
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

  const configFiles = useMemo(() => {
    const source = configFilesQuery.data ?? [];
    return [...source].sort(
      (left, right) =>
        configOrder.indexOf(left.name) - configOrder.indexOf(right.name),
    );
  }, [configFilesQuery.data]);

  const activeFile = configFiles.find((file) => file.name === selectedFile) ?? configFiles[0];
  const activeContent = activeFile ? drafts[activeFile.name] ?? activeFile.content : "";

  function handleReload(file: ConfigFile) {
    setDrafts((current) => ({ ...current, [file.name]: file.content }));
    setMessage(`Reloaded ${file.path} from disk.`);
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
            </>
          ) : (
            <div className="empty-state">No config files found.</div>
          )}
        </section>
      </div>
    </section>
  );
}
