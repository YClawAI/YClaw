# Onboarding

Guided setup flow for configuring a YClaw AI organization. Covers question-driven org framing, asset ingestion, department configuration, and artifact generation with operator approval.

Source: `packages/core/src/onboarding/`

---

## Stages

Source: `packages/core/src/onboarding/types.ts`

The onboarding session progresses through 6 ordered stages:

| # | Stage | Purpose |
|---|-------|---------|
| 1 | `org_framing` | Organizational profile, priorities, brand voice, departments, tools |
| 2 | `ingestion` | Import documents, URLs, GitHub repos, text |
| 3 | `departments` | Review and customize department configurations |
| 4 | `operators` | Invite additional operators |
| 5 | `validation` | Validate configuration before deployment |
| 6 | `completed` | Onboarding finished |

Stage order is enforced by the `STAGE_ORDER` constant.

---

## Questions

Source: `packages/core/src/onboarding/questions.ts`

8 questions across 4 stages. Each question has an ID, a stage, a prompt, help text, and optionally maps to an artifact type.

### Stage 1: `org_framing` (5 questions)

| ID | Prompt | Artifact |
|----|--------|----------|
| `org_mission` | What does your organization do? | `org_profile` |
| `org_priorities` | What are your top 3 priorities for the next 30 days? | `priorities` |
| `org_voice` | How does your organization communicate? What's your tone? | `brand_voice` |
| `org_departments` | What departments should your AI org have? | `departments` |
| `org_tools` | What tools and services does your organization use? | `tools` |

All 5 questions have default answers and help text. `org_departments` also has a `followUp` prompt for customization.

### Stage 2: `ingestion` (1 question)

| ID | Prompt | Artifact |
|----|--------|----------|
| `ingestion_prompt` | Do you have any documents, repos, or URLs you'd like to import? | none |

This question has no artifact mapping. It prompts the operator to use the ingestion endpoints. Default answer: "Skip for now."

### Stage 3: `departments` (1 question)

| ID | Prompt | Artifact |
|----|--------|----------|
| `department_review` | Review your department configuration. Would you like to make any changes? | none |

### Stage 4: `operators` (1 question)

| ID | Prompt | Artifact |
|----|--------|----------|
| `operator_invite` | Would you like to invite additional operators? | none |

### Helpers

- `getQuestionsForStage(stage)` --- returns all questions for a stage
- `getQuestionById(id)` --- returns a single question by ID

---

## Artifact Types

Source: `packages/core/src/onboarding/types.ts`

7 artifact types generated from question answers:

| Type | Generated From | Description |
|------|----------------|-------------|
| `org_profile` | `org_mission` answer | Organizational profile for agents |
| `priorities` | `org_priorities` answer | 30-day priority list |
| `brand_voice` | `org_voice` answer | Communication tone guidelines |
| `departments` | `org_departments` answer | Department structure and charters |
| `tools` | `org_tools` answer | Tool and service integrations |
| `knowledge_index` | Ingested assets | Index of imported knowledge |
| `operators` | `operator_invite` answer | Operator configuration |

### Artifact Lifecycle

Each artifact is an `ArtifactDraft` with a status:

```
draft -> approved     (operator approves via POST /v1/onboarding/artifacts/:id/approve)
draft -> rejected     (operator rejects via POST /v1/onboarding/artifacts/:id/reject)
rejected -> draft     (regenerated after rejection with feedback)
```

**`ArtifactDraft` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique artifact ID |
| `type` | `ArtifactType` | One of the 7 types above |
| `filename` | `string` | Generated filename |
| `content` | `string` | Generated content |
| `status` | `'draft' \| 'approved' \| 'rejected'` | Current status |
| `generatedAt` | `Date` | When the artifact was generated |
| `approvedAt` | `Date?` | When approved |
| `rejectionFeedback` | `string?` | Operator feedback on rejection |

---

## Asset Ingestion

Source: `packages/core/src/onboarding/types.ts`, `packages/core/src/onboarding/constants.ts`

4 ingestion sources for importing organizational context:

| Source | Method | Description |
|--------|--------|-------------|
| `file` | Base64 JSON upload | File sent as `{ sessionId, filename, mimetype, content, size }` |
| `url` | URL fetch | Fetches and extracts content from a URL |
| `github` | Repo archive | Indexes key files from a GitHub repo (README, docs/, package.json, etc.) |
| `text` | Text paste | Direct text content with a title |

### File Limits

Source: `packages/core/src/onboarding/constants.ts`

| Limit | Value | Constant |
|-------|-------|----------|
| Single file max | 10 MB | `MAX_FILE_SIZE_BYTES` |
| Total ingestion quota per org | 100 MB | `MAX_TOTAL_INGESTION_BYTES` |
| GitHub repo archive max | 500 MB | `MAX_GITHUB_REPO_BYTES` |
| URL fetch timeout | 10 seconds | `URL_FETCH_TIMEOUT_MS` |
| Max URL redirects | 3 | `MAX_URL_REDIRECTS` |
| Session abandonment | 7 days | `SESSION_ABANDON_DAYS` |

### Supported MIME Types

**Text:** `text/plain`, `text/markdown`, `text/csv`, `text/html`

**Documents:** `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX)

**Data:** `application/json`, `application/x-yaml`, `text/yaml`

**Images** (stored as-is, no OCR): `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`

File extensions are mapped to MIME types via `EXTENSION_MIME_MAP` when the MIME type is not provided.

### GitHub Index Paths

When importing a GitHub repo, only these paths are read (not the full repo):

`README.md`, `README`, `readme.md`, `docs/`, `doc/`, `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `requirements.txt`

### Asset Classification

Each imported asset is classified:

| Classification | Description |
|----------------|-------------|
| `strategy_doc` | Strategy documents |
| `technical_spec` | Technical specifications |
| `brand_asset` | Brand guidelines and assets |
| `process_doc` | Process documentation |
| `financial_doc` | Financial documents |
| `support_doc` | Support documentation |
| `general` | Unclassified |

### Ingestion Jobs

Each ingestion operation creates an `IngestionJob` with status tracking:

```
queued -> running -> succeeded
                  -> failed
                  -> cancelled
```

Job fields include `jobId`, `sessionId`, `source`, `sourceUri`, `status`, `progress`, `error`, and `result` (containing `assetId` and `summary` on success).

---

## API Endpoints

Source: `packages/core/src/onboarding/routes.ts`, `packages/core/src/onboarding/schemas.ts`

All routes live under `/v1/onboarding/*` and require authenticated root operator. Session ownership is verified on every request.

### Session Management

| Method | Endpoint | Description | Body/Params |
|--------|----------|-------------|-------------|
| `POST` | `/v1/onboarding/start` | Start a new session | `{ orgId?: string }` |
| `GET` | `/v1/onboarding/status` | Get session status | `?sessionId=<id>` or `?orgId=<id>` |
| `DELETE` | `/v1/onboarding/session` | Cancel and reset session | `?sessionId=<id>` or `?orgId=<id>` |
| `POST` | `/v1/onboarding/complete` | Complete onboarding | `{ sessionId: string }` |

### Questions and Answers

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| `POST` | `/v1/onboarding/answer` | Answer a question | `{ sessionId: uuid, questionId: string, answer: string(1-10000) }` |

### Artifacts

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| `GET` | `/v1/onboarding/artifacts` | List artifacts | `?sessionId=<id>` |
| `POST` | `/v1/onboarding/artifacts/:id/approve` | Approve an artifact | `{ sessionId: uuid }` |
| `POST` | `/v1/onboarding/artifacts/:id/reject` | Reject an artifact | `{ sessionId: uuid, feedback?: string(0-5000) }` |

### Ingestion

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| `POST` | `/v1/onboarding/ingest` | Upload file (base64) | `{ sessionId, filename, mimetype?, content, size? }` |
| `POST` | `/v1/onboarding/ingest/url` | Fetch URL | `{ sessionId: uuid, url: string(max 2000) }` |
| `POST` | `/v1/onboarding/ingest/github` | Import GitHub repo | `{ sessionId: uuid, repoUrl: string(max 500), branch?: string(max 200) }` |
| `POST` | `/v1/onboarding/ingest/text` | Paste text | `{ sessionId: uuid, content: string(1-100000), title: string(1-200) }` |

### Jobs

| Method | Endpoint | Description | Params |
|--------|----------|-------------|--------|
| `GET` | `/v1/onboarding/jobs` | List jobs for session | `?sessionId=<id>` |
| `GET` | `/v1/onboarding/jobs/:id` | Get single job status | path param `:id` |

### Validation

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| `POST` | `/v1/onboarding/validate` | Run validation checks | `{ sessionId: string }` |

### Error Handling

| HTTP Status | Condition |
|-------------|-----------|
| 400 | Missing required fields, invalid input |
| 401 | No authentication |
| 403 | Non-root operator |
| 404 | Session or job not found (`OnboardingNotFoundError`) |
| 409 | Conflict, e.g. session already exists (`OnboardingConflictError`) |
| 500 | Internal server error |

---

## Session State

Source: `packages/core/src/onboarding/types.ts`

The `OnboardingSession` tracks all state:

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `string` | UUID |
| `operatorId` | `string` | Owner (root operator) |
| `orgId` | `string` | Organization ID |
| `stage` | `OnboardingStage` | Current stage |
| `currentQuestion` | `number` | Question index within stage |
| `answers` | `Record<string, string>` | All answers keyed by question ID |
| `artifacts` | `ArtifactDraft[]` | Generated artifacts |
| `assets` | `OnboardingAsset[]` | Ingested asset metadata (files stored in IObjectStore) |
| `status` | `'active' \| 'completed' \| 'cancelled' \| 'abandoned'` | Session lifecycle |
| `version` | `number` | Optimistic concurrency control |
| `createdAt` | `Date` | Session creation time |
| `updatedAt` | `Date` | Last modification time |
| `completedAt` | `Date?` | When completed |

### Department Presets

Source: `packages/core/src/onboarding/constants.ts`

Available department presets: `development`, `marketing`, `operations`, `support`, `executive`, `finance`.

Each `DepartmentPreset` (defined in `types.ts`) includes `name`, `description`, `charter`, `agents`, `recurringTasks`, and `escalationRules`.

---

## Mission Control Onboarding Page

Source: `packages/mission-control/src/app/onboarding/`

The onboarding page (`/onboarding`) provides a guided wizard UI with four main components:

| Component | File | Purpose |
|-----------|------|---------|
| `ProgressSidebar` | `components/ProgressSidebar.tsx` | Stage progress, artifact/asset counts, reset button |
| `ConversationFlow` | `components/ConversationFlow.tsx` | Question display, answer input, help text |
| `ArtifactPreview` | `components/ArtifactPreview.tsx` | Artifact content preview with approve/reject buttons |
| `AssetDropZone` | `components/AssetDropZone.tsx` | File upload drop zone (shown during `ingestion` stage) |

### Flow

1. Landing state shows "Begin Onboarding" button
2. Clicking starts a session via `POST /api/onboarding`
3. Questions are presented one at a time via `ConversationFlow`
4. Answers submitted via `POST /api/onboarding/answer`
5. Generated artifacts appear with approve/reject controls
6. During the `ingestion` stage, `AssetDropZone` is displayed for file uploads
7. Session resumes on page reload (fetches status from `GET /api/onboarding?sessionId=...`)

The client fetches initial status server-side (Next.js RSC) via `GET /v1/onboarding/status?orgId=default`, then manages all state client-side. Artifacts of the same type are replaced (not appended) when regenerated.
