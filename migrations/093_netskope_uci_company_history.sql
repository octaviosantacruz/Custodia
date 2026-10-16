-- NSK-EXP-UEBA-001: weekly counts of users with a Poor/Moderate UCI per company.
-- Counts only (company label, users, poor, moderate): never a user, email or score.
-- One row per company and week; the last UCI sync of the week wins. It feeds the
-- "vs. semana anterior" column of the per-company view and is purged after 26 weeks.
BEGIN;

CREATE TABLE IF NOT EXISTS public.netskope_uci_company_history (
    week_start DATE NOT NULL,
    company TEXT NOT NULL CHECK (company <> ''),
    users INTEGER NOT NULL CHECK (users >= 0),
    poor INTEGER NOT NULL CHECK (poor >= 0),
    moderate INTEGER NOT NULL CHECK (moderate >= 0),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (week_start, company)
);

COMMIT;
