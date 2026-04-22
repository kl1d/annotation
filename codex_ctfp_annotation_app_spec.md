# CTF-P Session Review and Annotation App

## Goal
Build a practical local-first web app for reviewing study sessions and annotating participant behavior across **screen recordings, terminal logs, and surveys**.

This is for a research workflow, not a generic ML labeling product.

The app should help the researcher:
- view all participants/sessions
- open one session workspace at a time
- watch the screen recording
- inspect parsed logs and survey responses side by side
- create timeline events with timestamps
- attach notes, tags, codes, comments, and hypotheses
- track interesting moments and design issues
- export clean CSV files for analysis

## Product framing
This is **not** a generic coding tool like NVivo, Label Studio, or CVAT.
Those tools are useful, but they are a poor fit for this study because the workflow is centered on:
- one participant/session at a time
- synchronized review of video + logs + surveys
- timeline/event creation
- structured notes for study design evaluation
- later export into CSV for mixed-method analysis

So the app should be a **thin custom research workbench** built from open-source components, not a large platform customized beyond recognition.

## Feasibility
Yes, this is absolutely possible for an MVP.

A good MVP can be built with:
- **frontend**: React + Vite + TypeScript
- **backend**: FastAPI + Python
- **data layer**: CSV-first storage with filesystem artifacts
- **query/join layer**: Polars (preferred) or DuckDB
- **video player**: ReactPlayer or HTML5 video
- **UI table/grid**: TanStack Table
- **state/query**: TanStack Query
- **forms**: React Hook Form + Zod
- **UI kit**: shadcn/ui

FastAPI supports file uploads/forms cleanly, and React + Vite remains a practical modern stack. citeturn605207search2turn605207search6turn605207search10turn605207search15

## Recommendation on storage
The user asked for a **CSV backend**.

Use this approach:
- CSV files are the **canonical storage** for researcher-created structured data.
- Raw study assets remain in the filesystem.
- The backend builds in-memory joins/views from CSV + raw files.

Do **not** use a pure handwritten spreadsheet workflow.
Do **not** make SQLite the only source of truth for the MVP.

Recommended compromise:
- Canonical data = CSV files
- App metadata/config = JSON
- Optional future cache = SQLite or DuckDB if needed for performance

This keeps the system transparent, portable, Git-friendly, and easy to inspect.

## Core user workflow

### 1. Session ingest
Researcher creates or imports a participant/session.

For each session, the app should accept:
- participant id
- video file path or uploaded recording
- log file(s): CSV, TXT, JSONL, or parsed command/event files
- pre-survey file
- progression survey file
- post-survey file
- optional memo file

### 2. Session workspace
The main review screen should show:
- video player
- current playback time
- button to create timeline event at current time
- timeline/event list
- log viewer
- survey viewer
- note panel
- code/tag picker

### 3. Create timeline events
While reviewing, the researcher should be able to create a structured event with:
- participant_id
- session_id
- event_id
- start_time_sec
- end_time_sec
- source_type (`video`, `log`, `survey`, `mixed`)
- task_path (`zip`, `sqli`, `mjohnson`, `dwilson`, `lgarcia`, etc.)
- event_type (`choice`, `attempt`, `failure`, `retry_loop`, `debug`, `pivot`, `suspected_deception`, `abandon`, `success`, `design_issue`, `other`)
- title
- observation
- interpretation
- evidence_note
- codes/tags
- confidence (`low`, `medium`, `high`)
- follow_up
- starred (`true/false`)

### 4. Link evidence
Each timeline event should be able to link to:
- one or more log lines
- one or more survey questions/responses
- a video time range

### 5. Session memo
Each participant/session should have a memo page with:
- summary of strategy
- key moments
- design validation observations
- unexpected behaviors
- possible paper-worthy examples
- possible new metrics/features
- issues with instructions/environment

### 6. Cross-session browsing
Researcher should be able to browse all sessions and filter by:
- participant
- challenge path
- event type
- tag/code
- starred moments
- suspected deception
- design issue

### 7. Export
The app should export:
- timeline events CSV
- session memo CSV or Markdown
- code frequency summary CSV
- event-level merged export CSV

## MVP scope
Build only what is needed for pilot analysis.

### Must have
- local project/session management
- CSV-backed structured annotation storage
- video playback with current time capture
- logs panel with search/filter
- surveys panel
- create/edit/delete timeline events
- tags/codes management
- session memo editor
- export CSV

### Nice to have
- keyboard shortcuts
- waveform/thumbnails
- side-by-side synchronization from clicked log line to nearest video time
- reusable codebook manager
- global search across all notes
- diff/history for edited events

### Not needed in MVP
- multi-user auth
- cloud deployment
- role permissions
- enterprise annotation features
- auto transcription
- ML-assisted coding
- heavy audit logging

## Suggested filesystem layout
Use a transparent project folder like this:

```text
ctfp-review/
  data/
    participants.csv
    sessions.csv
    timeline_events.csv
    tags.csv
    event_tags.csv
    memos.csv
    survey_answers.csv
    log_events.csv
  assets/
    P01/
      session.mp4
      logs/
        raw_terminal.csv
        parsed_commands.csv
      surveys/
        pre_survey.json
        progression_survey.json
        post_survey.json
      notes/
        session_memo.md
  config/
    codebook.json
    app_config.json
```

## Canonical CSV schemas

### participants.csv
```csv
participant_id,experience_level,ctf_familiarity,notes
P01,intermediate,several_intermediate,
```

### sessions.csv
```csv
session_id,participant_id,video_path,log_path,pre_survey_path,progression_survey_path,post_survey_path,status,created_at
S01,P01,assets/P01/session.mp4,assets/P01/logs/parsed_commands.csv,assets/P01/surveys/pre_survey.json,assets/P01/surveys/progression_survey.json,assets/P01/surveys/post_survey.json,active,2026-04-22T12:00:00
```

### timeline_events.csv
```csv
event_id,session_id,participant_id,start_time_sec,end_time_sec,source_type,task_path,event_type,title,observation,interpretation,evidence_note,confidence,follow_up,starred,created_at,updated_at
E001,S01,P01,34,85,mixed,zip,choice,Starts with ZIP,"Participant opens the archive path first and talks about payoff","Possible reward-driven start","Confirmed by survey first-choice answer",medium,"Check if this pattern repeats",true,2026-04-22T12:10:00,2026-04-22T12:10:00
```

### tags.csv
```csv
tag_id,name,category,color,description
T01,persistence,trait,,Sustained effort on same path
T02,confusion,emergent,,Visible uncertainty or misunderstanding
T03,design_issue,meta,,Possible flaw or ambiguity in study design
```

### event_tags.csv
```csv
event_id,tag_id
E001,T01
E001,T03
```

### memos.csv
```csv
memo_id,session_id,participant_id,title,body,last_updated
M01,S01,P01,"P01 session memo","Long-form markdown/plaintext memo here",2026-04-22T12:30:00
```

### survey_answers.csv
Flatten survey data into a long format.

```csv
row_id,session_id,participant_id,survey_name,question_id,question_text,response,source_path
1,S01,P01,pre,Q01,"Years of experience in cybersecurity",1-3 years,assets/P01/surveys/pre_survey.json
```

### log_events.csv
Normalize logs into a row-per-event format.

```csv
log_event_id,session_id,participant_id,timestamp_sec,event_class,raw_text,command,path,exit_code,extra_json
L001,S01,P01,42,command,"john corporate_credentials_backup.zip",john,,0,"{}"
```

## Parsing strategy
The backend should include lightweight parsers.

### Logs
Support at least:
- CSV logs
- newline-delimited JSON logs
- plain text terminal history

Backend parser should normalize logs into `log_events.csv` fields like:
- timestamp_sec
- event_class
- command
- raw_text
- path
- extra_json

### Surveys
Support:
- JSON
- CSV
- possibly Qualtrics exports after preprocessing

Convert survey files into a normalized long table:
- question_id
- question_text
- response
- survey_name

## Frontend pages

### 1. Dashboard
Show all sessions as cards/table with:
- participant id
- status
- number of annotations
- number of starred moments
- available artifacts
- last edited date

### 2. Session workspace
Main split layout:
- left: video player + transport + create event button
- center: timeline/events table
- right tabs: logs / surveys / memo / inspector

### 3. Codebook page
Manage codes/tags:
- add/edit/archive tags
- categories such as `trait`, `emergent`, `design`, `strategy`, `emotion`, `quality`

### 4. Export page
Allow export by:
- current session
- all sessions
- only starred events
- only design issues
- only events with selected tags

## UX requirements
- Fast keyboard-friendly workflow
- Minimal clicking for event creation
- Event creation should auto-fill current video time
- Allow creation from selected log line or selected survey item
- Allow quick tagging with search
- Autosave drafts
- Keep everything local-first where possible

## Suggested event creation flow
1. User pauses video at an interesting moment.
2. Clicks `Create event`.
3. Modal opens with start time prefilled.
4. User can set end time manually or click `Use current time` later.
5. User adds event type, title, observation, interpretation, evidence note, and tags.
6. Save writes to `timeline_events.csv` and `event_tags.csv`.

## Architecture

### Frontend
- React
- Vite
- TypeScript
- TanStack Query
- TanStack Table
- React Hook Form
- Zod
- ReactPlayer or HTML5 video
- shadcn/ui

### Backend
- FastAPI
- Pydantic
- Polars or DuckDB for joins
- python-multipart for uploads
- standard filesystem storage

FastAPI handles file uploads and forms directly, which suits this app. citeturn605207search2turn605207search6

### Why not Label Studio or CVAT as the core app?
They are strong open-source annotation tools, but they are optimized for generic labeling workflows and dataset export, not this session-centered mixed-artifact study review flow. They are useful references, but likely the wrong backbone here. Label Studio and CVAT both center around generic project/task annotation and export pipelines. citeturn605207search0turn605207search5turn605207search9turn605207search16

## API design

### Sessions
- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/{session_id}`
- `POST /api/sessions/{session_id}/ingest`

### Timeline events
- `GET /api/sessions/{session_id}/events`
- `POST /api/sessions/{session_id}/events`
- `PATCH /api/events/{event_id}`
- `DELETE /api/events/{event_id}`

### Tags
- `GET /api/tags`
- `POST /api/tags`
- `PATCH /api/tags/{tag_id}`

### Logs
- `GET /api/sessions/{session_id}/logs`
- `POST /api/sessions/{session_id}/logs/parse`

### Surveys
- `GET /api/sessions/{session_id}/surveys`
- `POST /api/sessions/{session_id}/surveys/parse`

### Memos
- `GET /api/sessions/{session_id}/memo`
- `PUT /api/sessions/{session_id}/memo`

### Export
- `GET /api/export/events.csv`
- `GET /api/export/sessions.csv`
- `GET /api/export/design_issues.csv`

## Important implementation notes
- Keep IDs stable and explicit.
- Do not rely on row numbers as identifiers.
- Writes to CSV should be atomic.
- Use a repository/service layer so a future migration to SQLite or Postgres is easy.
- Treat CSV as canonical for MVP, but isolate storage access behind interfaces.
- Preserve raw uploaded artifacts untouched.
- Normalize logs/surveys into app-owned CSVs instead of querying raw files directly on every page load.

## Code organization

```text
/backend
  app/
    api/
    models/
    services/
    repositories/
    parsers/
    exports/
    main.py
/frontend
  src/
    pages/
    components/
    features/
      sessions/
      timeline/
      logs/
      surveys/
      memos/
      tags/
```

## Initial codebook suggestions
Seed the app with these default tag categories.

### trait
- persistence
- resilience
- risk_taking
- openness

### emergent_behavior
- confusion
- curiosity
- tunnel_vision
- overconfidence
- caution
- opportunistic_choice
- systematic_debugging
- trial_and_error
- sunk_cost

### design_validation
- good_probe
- unclear_instruction
- survey_influence
- unrealistic_signal
- environment_issue
- tool_issue
- ambiguous_feedback

### session_process
- target_selection
- failure_response
- pivot
- abandonment
- deception_suspicion
- success

## Priority roadmap

### Phase 1: MVP
- local project setup
- session list
- single session workspace
- video player
- logs panel
- survey panel
- create/edit timeline events
- tag management
- CSV persistence
- export

### Phase 2
- session memo UX polish
- keyboard shortcuts
- starred moments
- filters and saved views
- cross-session search

### Phase 3
- synchronization helpers
- lightweight charts
- inter-rater coding support
- transcript attachment
- codebook analytics

## Acceptance criteria for MVP
The app is successful if a researcher can:
1. create a session
2. upload/select a video, logs, and survey files
3. review the session in one screen
4. create timestamped timeline events
5. attach codes/tags and comments
6. write a session memo
7. browse all sessions
8. export annotations to CSV without opening a spreadsheet manually

## Build strategy for Codex
Implement in this order:
1. Backend project scaffold and CSV repository layer
2. Frontend scaffold and session dashboard
3. Session workspace layout
4. Video player with current-time capture
5. Timeline CRUD
6. Logs and survey viewers
7. Tags and memo support
8. CSV export

## Non-goals
- full qualitative analysis suite
- full transcript alignment engine
- enterprise-grade media asset management
- replacing NVivo entirely

## One important product decision
For the MVP, optimize for **researcher speed and clarity**, not theoretical purity.

That means:
- fewer fields are better than too many
- event creation must be fast
- timeline + notes must be searchable
- exports must be clean enough for later analysis in Python/R

## Deliverables Codex should produce first
1. A monorepo with `frontend/` and `backend/`
2. Working local development setup
3. Example seed CSV data
4. A session dashboard
5. A session review page with video + timeline + logs + surveys
6. CRUD for timeline events stored in CSV
7. CSV export routes

