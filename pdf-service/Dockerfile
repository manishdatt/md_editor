# ---- build stage ----
FROM golang:1.23-bookworm AS build
WORKDIR /src
COPY go.mod ./
# No external dependencies; go.sum is intentionally absent.
RUN go mod download || true
COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/pdf-service .

# ---- runtime stage ----
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Pin a specific typst release; bump deliberately, not incidentally.
ARG TYPST_VERSION=0.13.1
ADD https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz /tmp/typst.tar.xz
RUN tar -xJf /tmp/typst.tar.xz -C /usr/local/bin --strip-components=1 \
        typst-x86_64-unknown-linux-musl/typst \
    && rm /tmp/typst.tar.xz \
    && chmod +x /usr/local/bin/typst \
    && useradd --uid 65532 --no-create-home --shell /usr/sbin/nologin typst

COPY --from=build /out/pdf-service /usr/local/bin/pdf-service

ENV PORT=8080
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/pdf-service"]
