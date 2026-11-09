-- +goose Up
-- Custodia's own history: connections, the runs each one completed and the
-- records each run observed. Identity is connection + collection + external
-- ID: equal IDs from two connections never meet.
CREATE TABLE settings (
    key   text PRIMARY KEY,
    value text NOT NULL
);

CREATE TABLE connections (
    id         bigserial PRIMARY KEY,
    name       text NOT NULL UNIQUE,
    source     text NOT NULL CHECK (source IN ('identity', 'pam', 'netskope')),
    synthetic  boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE runs (
    id            bigserial PRIMARY KEY,
    connection_id bigint NOT NULL REFERENCES connections (id),
    label         text NOT NULL,
    system        text NOT NULL,
    file          text NOT NULL,
    status        text NOT NULL CHECK (status IN ('completed', 'partial')),
    started_at    timestamptz NOT NULL,
    completed_at  timestamptz NOT NULL CHECK (completed_at >= started_at),
    UNIQUE (connection_id, label)
);
CREATE INDEX runs_by_connection ON runs (connection_id, completed_at DESC);

CREATE TABLE observations (
    connection_id  bigint NOT NULL REFERENCES connections (id),
    collection     text NOT NULL CHECK (collection IN ('users', 'accounts', 'devices')),
    external_id    text NOT NULL CHECK (external_id <> ''),
    schema_version integer NOT NULL CHECK (schema_version > 0),
    attrs          jsonb NOT NULL CHECK (jsonb_typeof(attrs) = 'object'),
    observed_at    timestamptz NOT NULL,
    run_id         bigint NOT NULL REFERENCES runs (id),
    PRIMARY KEY (connection_id, collection, external_id)
);
CREATE INDEX observations_by_run ON observations (run_id);

-- +goose Down
DROP TABLE observations;
DROP TABLE runs;
DROP TABLE connections;
DROP TABLE settings;
