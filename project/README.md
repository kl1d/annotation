# Sample Project

This `project/` directory is the public sample project bundled with the repository.

It is safe to commit and push:

- generic config files
- placeholder asset folders
- tiny generated sample CSVs created from the sample asset mapping

Your real study files should stay in `project.local/`, which is ignored by Git.

Run the public sample:

```bash
docker compose up --build
```

Run your local private study instead:

```bash
PROJECT_DIR=project.local docker compose up --build
```
