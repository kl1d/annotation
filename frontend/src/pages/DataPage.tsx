import { useQuery } from "@tanstack/react-query";
import { AllCommunityModule, ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

type ThemeMode = "light" | "dark";
type DataFile = Awaited<ReturnType<typeof api.getDataFiles>>[number];

type ExplorerNode =
  | {
      id: string;
      kind: "folder";
      name: string;
      path: string;
      children: ExplorerNode[];
    }
  | {
      id: string;
      kind: "file";
      name: string;
      path: string;
      file: DataFile;
    };

export default function DataPage() {
  const [selectedFileId, setSelectedFileId] = useState("");
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

  const filesQuery = useQuery({
    queryKey: ["data-files"],
    queryFn: api.getDataFiles,
  });

  const previewQuery = useQuery({
    queryKey: ["data-file-preview", selectedFileId],
    queryFn: () => api.getDataFilePreview(selectedFileId),
    enabled: Boolean(selectedFileId),
  });

  useEffect(() => {
    if (!filesQuery.data?.length) {
      return;
    }
    if (selectedFileId && filesQuery.data.some((file) => file.file_id === selectedFileId)) {
      return;
    }
    setSelectedFileId(filesQuery.data[0].file_id);
  }, [filesQuery.data, selectedFileId]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeMode(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => observer.disconnect();
  }, []);

  const columnDefs = useMemo<ColDef[]>(() => {
    const preview = previewQuery.data;
    if (!preview) {
      return [];
    }

    return preview.columns.map((column) => ({
      field: column,
      headerName: column,
      sortable: true,
      filter: true,
      resizable: true,
      minWidth: 140,
      flex: 1,
      autoHeight: false,
      wrapText: true,
      valueFormatter: isSecondsTimeColumn(column)
        ? ({ value }) => formatSecondsForDataGrid(value)
        : undefined,
    }));
  }, [previewQuery.data]);

  const explorerTree = useMemo(() => buildExplorerTree(filesQuery.data ?? []), [filesQuery.data]);
  const rowData = previewQuery.data?.rows ?? [];

  function toggleFolder(path: string) {
    setCollapsedFolders((current) => ({
      ...current,
      [path]: !current[path],
    }));
  }

  return (
    <section className="page data-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Data</p>
          <h2>Study Data Workspace</h2>
          <p className="muted">
            Browse uploaded CSVs and generated annotation data in a spreadsheet-style viewer.
          </p>
        </div>
      </header>

      <div className={`data-workspace ${explorerCollapsed ? "data-workspace-explorer-collapsed" : ""}`}>
        <aside className={`panel data-file-panel ${explorerCollapsed ? "collapsed" : ""}`}>
          <div className="section-header data-explorer-header">
            <h3>{explorerCollapsed ? "Files" : "Explorer"}</h3>
            <div className="data-explorer-actions">
              {!explorerCollapsed && (
                <span className="pill subtle">{(filesQuery.data?.length ?? 0).toLocaleString()} files</span>
              )}
              <button
                aria-label={explorerCollapsed ? "Expand explorer" : "Collapse explorer"}
                className="data-explorer-toggle"
                onClick={() => setExplorerCollapsed((current) => !current)}
                type="button"
              >
                <svg viewBox="0 0 20 20" fill="none">
                  <path
                    d={explorerCollapsed ? "M7 4.5 13 10l-6 5.5" : "M13 4.5 7 10l6 5.5"}
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
              </button>
            </div>
          </div>
          {explorerCollapsed ? (
            <div className="data-file-panel-collapsed">
              <span className="pill subtle">{(filesQuery.data?.length ?? 0).toLocaleString()} files</span>
            </div>
          ) : (
            <div className="data-file-list">
              {explorerTree.map((node) => (
                <ExplorerTreeNode
                  collapsedFolders={collapsedFolders}
                  key={node.id}
                  level={0}
                  node={node}
                  onSelect={setSelectedFileId}
                  onToggleFolder={toggleFolder}
                  selectedFileId={selectedFileId}
                />
              ))}
            </div>
          )}
        </aside>

        <section className="panel data-grid-panel">
          <div className="data-grid-header">
            <div>
              <h3>{previewQuery.data?.label ?? "Select a CSV file"}</h3>
              <p className="muted small">
                {previewQuery.data?.path ?? "Pick a file from the left to inspect its rows and columns."}
              </p>
            </div>
            <span className="pill subtle">
              {(previewQuery.data?.row_count ?? 0).toLocaleString()} rows
            </span>
          </div>

          <div className="data-grid-shell">
            {previewQuery.isLoading ? (
              <div className="review-empty">Loading data preview…</div>
            ) : previewQuery.data ? (
              <div className={`ag-grid-host ${themeMode === "light" ? "ag-theme-quartz" : "ag-theme-quartz-dark"}`}>
                <AgGridReact
                  columnDefs={columnDefs}
                  defaultColDef={{
                    sortable: true,
                    filter: true,
                    floatingFilter: true,
                    resizable: true,
                  }}
                  modules={[AllCommunityModule]}
                  animateRows
                  loading={previewQuery.isLoading}
                  paginationPageSizeSelector={[50, 100, 250, 500]}
                  pagination
                  paginationPageSize={100}
                  rowData={rowData}
                  theme="legacy"
                />
              </div>
            ) : (
              <div className="review-empty">Choose a file to view the dataset.</div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function ExplorerTreeNode({
  node,
  level,
  collapsedFolders,
  onToggleFolder,
  onSelect,
  selectedFileId,
}: {
  node: ExplorerNode;
  level: number;
  collapsedFolders: Record<string, boolean>;
  onToggleFolder: (path: string) => void;
  onSelect: (fileId: string) => void;
  selectedFileId: string;
}) {
  if (node.kind === "folder") {
    const isCollapsed = collapsedFolders[node.path] ?? false;
    return (
      <div className="data-tree-group">
        <button
          className="data-tree-folder"
          onClick={() => onToggleFolder(node.path)}
          style={{ paddingLeft: `${12 + level * 14}px` }}
          type="button"
        >
          <span aria-hidden="true" className={`tree-chevron ${isCollapsed ? "collapsed" : ""}`}>
            <svg viewBox="0 0 20 20" fill="none">
              <path
                d="M7 4.5 13 10l-6 5.5"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
          </span>
          <span aria-hidden="true" className="tree-folder-icon">
            <svg viewBox="0 0 20 20" fill="none">
              <path
                d="M2.8 5.5A1.7 1.7 0 0 1 4.5 3.8h3.1l1.3 1.4h6.6a1.7 1.7 0 0 1 1.7 1.7v6.6a1.7 1.7 0 0 1-1.7 1.7H4.5a1.7 1.7 0 0 1-1.7-1.7V5.5Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="tree-label">{node.name}</span>
        </button>
        {!isCollapsed &&
          node.children.map((child) => (
            <ExplorerTreeNode
              collapsedFolders={collapsedFolders}
              key={child.id}
              level={level + 1}
              node={child}
              onSelect={onSelect}
              onToggleFolder={onToggleFolder}
              selectedFileId={selectedFileId}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      className={`data-tree-file ${selectedFileId === node.file.file_id ? "active" : ""}`}
      onClick={() => onSelect(node.file.file_id)}
      style={{ paddingLeft: `${40 + level * 14}px` }}
      type="button"
    >
      <span aria-hidden="true" className="tree-file-icon">
        <svg viewBox="0 0 20 20" fill="none">
          <path
            d="M5.2 3.8h6.2l3.1 3.1v8.3A1.8 1.8 0 0 1 12.7 17H5.2a1.8 1.8 0 0 1-1.8-1.8V5.6a1.8 1.8 0 0 1 1.8-1.8Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M11.4 3.8v3.1h3.1" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="tree-file-body">
        <span className="tree-label">{node.name}</span>
        <span className="muted small">{node.file.row_count.toLocaleString()} rows</span>
      </span>
    </button>
  );
}

function buildExplorerTree(files: DataFile[]): ExplorerNode[] {
  const root: ExplorerNode[] = [];

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    insertNode(root, segments, file, "");
  }

  return sortTreeNodes(root);
}

function insertNode(nodes: ExplorerNode[], segments: string[], file: DataFile, parentPath: string) {
  const [segment, ...rest] = segments;
  const currentPath = parentPath ? `${parentPath}/${segment}` : segment;

  if (!segment) {
    return;
  }

  if (rest.length === 0) {
    nodes.push({
      id: file.file_id,
      kind: "file",
      name: segment,
      path: currentPath,
      file,
    });
    return;
  }

  let folder = nodes.find(
    (node): node is Extract<ExplorerNode, { kind: "folder" }> =>
      node.kind === "folder" && node.name === segment,
  );
  if (!folder) {
    folder = {
      id: currentPath,
      kind: "folder",
      name: segment,
      path: currentPath,
      children: [],
    };
    nodes.push(folder);
  }

  insertNode(folder.children, rest, file, currentPath);
}

function sortTreeNodes(nodes: ExplorerNode[]): ExplorerNode[] {
  return nodes
    .map((node) =>
      node.kind === "folder"
        ? { ...node, children: sortTreeNodes(node.children) }
        : node,
    )
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "folder" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
}

function isSecondsTimeColumn(column: string) {
  const normalized = column.toLowerCase();
  return normalized.endsWith("_time_sec") || normalized === "timestamp_sec";
}

function formatSecondsForDataGrid(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return String(value);
  }

  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = (total % 60).toString().padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds}`;
  }

  return `${minutes}:${remainingSeconds}`;
}
