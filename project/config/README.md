# Sample Project Config

This `project/` directory is the public sample project included with the repository.

It contains generic configuration files that let the app start without exposing any real study data.

If you want to work with a private local study:

1. Keep your real files in `project.local/`
2. Run Docker with:

```bash
PROJECT_DIR=project.local docker compose up --build
```

The files in this folder are safe-to-publish examples:

- `project.yaml`
- `survey_mappings.yaml`
- `log_mappings.yaml`
- `annotation_schema.yaml`
- `codebook.yaml`
- `asset_mappings.yaml`

The `.example.yaml` versions are reusable templates for creating new projects from scratch.
