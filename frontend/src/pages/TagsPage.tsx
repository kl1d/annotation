import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function TagsPage() {
  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: api.getTags,
  });

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Codebook</p>
          <h2>Tags and categories</h2>
          <p className="muted">
            Tags are currently seeded from `project/config/codebook.yaml` during ingest.
          </p>
        </div>
      </header>

      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th>Tag</th>
              <th>Category</th>
              <th>Description</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tagsQuery.data?.map((tag) => (
              <tr key={tag.tag_id}>
                <td>{tag.name}</td>
                <td>{tag.category}</td>
                <td>{tag.description}</td>
                <td>{tag.archived === "true" ? "Archived" : "Active"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

