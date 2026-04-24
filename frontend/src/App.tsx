import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import DataPage from "./pages/DataPage";
import ExportsPage from "./pages/ExportsPage";
import SettingsPage from "./pages/SettingsPage";
import SessionPage from "./pages/SessionPage";
import TagsPage from "./pages/TagsPage";

const navItems = [
  { to: "/", label: "Dashboard", icon: DashboardIcon },
  { to: "/data", label: "Data", icon: DataIcon },
  { to: "/tags", label: "Codebook", icon: CodebookIcon },
  { to: "/exports", label: "Exports", icon: ExportIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("annotation-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
      return;
    }
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setTheme(prefersDark ? "dark" : "light");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("annotation-theme", theme);
  }, [theme]);

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-main">
          <div className="sidebar-brand">
            <div className="sidebar-brand-mark">
              <img alt="Annotation logo" className="sidebar-logo" src="/logo.svg" />
              <p className="eyebrow">Annotation</p>
            </div>
            <h1 className="sidebar-title">Annotation Workbench</h1>
            <p className="muted sidebar-description">
              Dockerized, config-driven session review for screen recordings, logs, and surveys.
            </p>
          </div>

          <nav className="nav">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink key={item.to} title={item.label} to={item.to}>
                  <span className="nav-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="nav-label">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-footer">
          <button
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            type="button"
          >
            <span className="theme-icon" aria-hidden="true">
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
            </span>
            <span className="theme-label">{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
          <button
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="sidebar-toggle ide-toggle"
            onClick={() => setSidebarCollapsed((current) => !current)}
            type="button"
          >
            <ChevronIcon collapsed={sidebarCollapsed} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/sessions/:sessionId" element={<SessionPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/exports" element={<ExportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M3 3h6v6H3zM11 3h6v4h-6zM11 9h6v8h-6zM3 11h6v6H3z" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function CodebookIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M5 3.5h8a2 2 0 0 1 2 2v11H7a2 2 0 0 0-2 2V3.5Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 3.5v13a2 2 0 0 1 2-2h8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function DataIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v9A1.5 1.5 0 0 1 15.5 16h-11A1.5 1.5 0 0 1 3 14.5v-9Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 8h14M7 4v12M12 8v8" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M10 3v8m0 0 3-3m-3 3-3-3M4 13.5v1A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M10 6.7A3.3 3.3 0 1 0 10 13.3A3.3 3.3 0 1 0 10 6.7Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16.1 11.1V8.9l-1.7-.4a4.9 4.9 0 0 0-.5-1.1l.9-1.5-1.6-1.6-1.5.9a4.9 4.9 0 0 0-1.1-.5L10.1 3H7.9l-.4 1.7a4.9 4.9 0 0 0-1.1.5l-1.5-.9-1.6 1.6.9 1.5a4.9 4.9 0 0 0-.5 1.1L2 8.9v2.2l1.7.4c.1.4.3.8.5 1.1l-.9 1.5 1.6 1.6 1.5-.9c.3.2.7.4 1.1.5l.4 1.7h2.2l.4-1.7c.4-.1.8-.3 1.1-.5l1.5.9 1.6-1.6-.9-1.5c.2-.3.4-.7.5-1.1l1.7-.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 2.2v2.1M10 15.7v2.1M17.8 10h-2.1M4.3 10H2.2M15.5 4.5l-1.5 1.5M6 14l-1.5 1.5M15.5 15.5 14 14M6 6 4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path d="M12.8 2.8a6.8 6.8 0 1 0 4.4 11.6A7.6 7.6 0 1 1 12.8 2.8Z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none">
      <path
        d={collapsed ? "M7 4.5 13 10l-6 5.5" : "M13 4.5 7 10l6 5.5"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
