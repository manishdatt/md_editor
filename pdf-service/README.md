# pdf-service

Minimal HTTP service that compiles Typst source to PDF. Deployed to Google Cloud Run
via the Cloud Build trigger in this repository (path filter: `pdf-service/**`).

See `../TYPST_PDF_PLAN.md` for the full design.

## API

### `POST /compile`

| | |
|---|---|
| Header | `x-api-key: <PDF_SERVICE_API_KEY>` (required) |
| Body | `{"source": "<raw .typ text>"}` |
| Max source | 512 KB |

Responses:

- `200` — `application/pdf`
- `401` — missing/invalid api key
- `400` — invalid JSON, empty source
- `413` — source too large
- `422` — typst compile failure (`{"error","detail"}`, detail truncated to 500 chars)
- `408` — compile exceeded timeout
- `500` — unexpected

### `GET /healthz`

Returns `200 ok` (for Cloud Run startup probes).

## Environment

| Var | Required | Default | Purpose |
|---|---|---|---|
| `PDF_SERVICE_API_KEY` | yes | — | Shared secret; compared in constant time. Injected from Secret Manager. |
| `PORT` | no | `8080` | Set by Cloud Run. |
| `COMPILE_TIMEOUT_SECS` | no | `20` | Hard kill for runaway compiles. |

## Local development

```bash
# build the image
docker build -t pdf-service .

# run it
docker run --rm -p 8080:8080 -e PDF_SERVICE_API_KEY=dev-secret pdf-service

# happy path
curl -s -H "x-api-key: dev-secret" -H "content-type: application/json" \
  -d '{"source":"= Hello Typst"}' \
  http://localhost:8080/compile -o out.pdf && open out.pdf

# wrong key -> 401
curl -i -H "x-api-key: nope" -H "content-type: application/json" \
  -d '{"source":"= x"}' http://localhost:8080/compile

# bad typst -> 422 with detail
curl -i -H "x-api-key: dev-secret" -H "content-type: application/json" \
  -d '{"source":"#this-is-not-valid()"}' http://localhost:8080/compile
```

Or without Docker, if you have Go + typst installed:

```bash
go run . # needs typst on PATH and PDF_SERVICE_API_KEY set
```

## Deployment

Automatic: pushing to `main` with changes under `pdf-service/**` runs
`cloudbuild.yaml`, which builds/pushes the image to Artifact Registry and deploys the
`pdf-service` Cloud Run service.

One-time setup (see plan §3.6): enable Cloud Build/Run/Artifact Registry/Secret
Manager APIs, create the Artifact Registry repo, create secret `pdf-service-api-key`,
create the trigger (config file `cloudbuild.yaml`, dir `pdf-service/`, included-files
filter `pdf-service/**`), and grant the build SA Cloud Run Admin + AR Writer +
Secret Accessor.

Tune substitutions (`_REGION`, `_TYPST_VERSION`) at the top of `cloudbuild.yaml`.

## Security notes

- Runs as non-root (`USER 65532`); Cloud Run should mount read-only root FS with
  `/tmp` writable (the only place job dirs are created).
- `--ignore-system-fonts` keeps output deterministic using typst's embedded fonts.
- v1 has no egress controls; documents that import `@preview` packages would attempt
  network downloads. Authenticated-users-only makes this low risk; add a VPC
  connector/deny rule if you need strict isolation.
