FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /dashboard .

FROM alpine:3.20
COPY --from=build /dashboard /dashboard
EXPOSE 9000
CMD ["/dashboard"]
