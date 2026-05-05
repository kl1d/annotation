import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function NotebooksPage() {
  const queryClient = useQueryClient();
  const [iframeRevision, setIframeRevision] = useState(0);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [appTheme, setAppTheme] = useState<"light" | "dark">(
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const notebookQuery = useQuery({
    queryKey: ["notebooks-config"],
    queryFn: api.getNotebookConfig,
  });
  const themeMutation = useMutation({
    mutationFn: api.setNotebookTheme,
    onSuccess: async () => {
      setIframeRevision((current) => current + 1);
      await queryClient.invalidateQueries({ queryKey: ["notebooks-config"] });
    },
  });

  const notebookConfig = notebookQuery.data;
  const notebookAvailable = Boolean(notebookConfig?.enabled && notebookConfig.available);
  const selectedTheme = notebookConfig?.theme ?? "JupyterLab Dark";
  const appMatchedTheme = appTheme === "light" ? "JupyterLab Light" : "JupyterLab Dark";
  const notebookSrc = notebookConfig?.launch_url ?? "";

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setAppTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    });
    observer.observe(document.documentElement, {
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  function updateTheme(theme: string) {
    if (!notebookAvailable || !theme || theme === selectedTheme || themeMutation.isPending) {
      return;
    }
    themeMutation.mutate(theme);
  }

  async function copyStartCommand() {
    const command = notebookConfig?.start_command ?? "docker compose --profile notebooks up -d notebooks";
    await navigator.clipboard.writeText(command);
    setCopiedCommand(true);
    window.setTimeout(() => setCopiedCommand(false), 1600);
  }

  return (
    <section className="notebooks-page">
      <header className="panel notebooks-toolbar">
        <div className="notebooks-toolbar-title">
          <p className="eyebrow">Notebooks</p>
          <h2>JupyterLab</h2>
        </div>

        <div className="notebooks-toolbar-controls">
          <span className="pill subtle">Project: {notebookConfig?.active_project ?? "..."}</span>
          <label className="notebooks-theme-control">
            <span className="muted small">Theme</span>
            <select
              disabled={!notebookAvailable || themeMutation.isPending}
              onChange={(event) => updateTheme(event.target.value)}
              value={selectedTheme}
            >
              {(notebookConfig?.available_themes ?? ["JupyterLab Dark", "JupyterLab Light"]).map((theme) => (
                <option key={theme} value={theme}>
                  {theme.replace("JupyterLab ", "")}
                </option>
              ))}
            </select>
          </label>
          <button
            className="ghost-button"
            disabled={!notebookAvailable || selectedTheme === appMatchedTheme || themeMutation.isPending}
            onClick={() => updateTheme(appMatchedTheme)}
            type="button"
          >
            Match app
          </button>
          {notebookAvailable && notebookConfig ? (
            <a className="primary-button" href={notebookConfig.launch_url} rel="noreferrer" target="_blank">
              Open
            </a>
          ) : null}
        </div>
      </header>

      {themeMutation.isError ? (
        <div className="callout">
          {themeMutation.error instanceof Error
            ? themeMutation.error.message
            : "Unable to update the notebook theme."}
        </div>
      ) : null}

      <section className="panel notebooks-frame-panel">
        {notebookQuery.isLoading ? (
          <div className="empty-state">Loading notebook configuration...</div>
        ) : notebookQuery.isError ? (
          <div className="empty-state">
            Unable to load notebook configuration. Confirm the backend is running and try again.
          </div>
        ) : notebookAvailable ? (
          <iframe
            key={`${notebookSrc}-${iframeRevision}`}
            className="notebooks-frame"
            src={notebookSrc}
            title="Embedded JupyterLab"
          />
        ) : notebookConfig?.enabled ? (
          <div className="notebooks-unavailable">
            <div className="notebooks-unavailable-card">
              <p className="eyebrow">Optional service</p>
              <h3>JupyterLab is not running</h3>
              <p className="muted">
                {notebookConfig.status_message} The rest of Annotation Workbench works normally without it.
              </p>
              <div className="notebooks-command-row">
                <code>{notebookConfig.start_command}</code>
                <button className="primary-button" onClick={copyStartCommand} type="button">
                  {copiedCommand ? "Copied" : "Copy command"}
                </button>
              </div>
              <p className="muted small">
                Run that command from the repository root, then refresh this page to embed JupyterLab.
              </p>
            </div>
          </div>
        ) : (
          <div className="empty-state">Embedded notebooks are disabled for this environment.</div>
        )}
      </section>
    </section>
  );
}
