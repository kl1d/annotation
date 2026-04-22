import { useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import ExportsPage from "./pages/ExportsPage";
import SessionPage from "./pages/SessionPage";
import TagsPage from "./pages/TagsPage";

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-copy">
            <p className="eyebrow">CTF-P</p>
            <h1>Annotation Workbench</h1>
            <p className="muted">
              Dockerized, config-driven session review for screen recordings, logs, and surveys.
            </p>
          </div>
          <button
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((current) => !current)}
            type="button"
          >
            {sidebarCollapsed ? ">" : "<"}
          </button>
        </div>
        <nav className="nav">
          <NavLink title="Dashboard" to="/">
            <span className="nav-label">Dashboard</span>
          </NavLink>
          <NavLink title="Codebook" to="/tags">
            <span className="nav-label">Codebook</span>
          </NavLink>
          <NavLink title="Exports" to="/exports">
            <span className="nav-label">Exports</span>
          </NavLink>
        </nav>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/sessions/:sessionId" element={<SessionPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/exports" element={<ExportsPage />} />
        </Routes>
      </main>
    </div>
  );
}
