const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api";

const exportsList = [
  { name: "events", label: "Timeline events" },
  { name: "sessions", label: "Sessions" },
  { name: "design_issues", label: "Design issues" },
  { name: "merged", label: "Merged event export" },
];

export default function ExportsPage() {
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Exports</p>
          <h2>CSV outputs</h2>
          <p className="muted">These routes expose the canonical CSVs for downstream analysis in Python or R.</p>
        </div>
      </header>

      <div className="card-grid">
        {exportsList.map((item) => (
          <a className="session-card" href={`${API_BASE_URL}/export/${item.name}.csv`} key={item.name} target="_blank" rel="noreferrer">
            <div className="card-topline">
              <span>CSV export</span>
              <span className="pill">{item.name}</span>
            </div>
            <h3>{item.label}</h3>
            <p className="muted">Open the generated CSV directly from the API.</p>
          </a>
        ))}
      </div>
    </section>
  );
}

