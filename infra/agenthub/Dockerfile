# Build stage — runs on native platform, cross-compiles to amd64
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder
RUN apk add --no-cache git
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /agenthub-server ./cmd/agenthub-server
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /ah ./cmd/ah

# Runtime stage — amd64 for Fargate
FROM --platform=linux/amd64 alpine:3.19
RUN apk add --no-cache git ca-certificates
COPY --from=builder /agenthub-server /usr/local/bin/agenthub-server
COPY --from=builder /ah /usr/local/bin/ah
EXPOSE 8080
ENTRYPOINT ["agenthub-server"]
