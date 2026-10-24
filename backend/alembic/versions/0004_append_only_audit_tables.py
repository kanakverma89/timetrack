"""append-only audit tables

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-24
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

AUDIT_TABLES = ("approval_events", "time_entry_events")


def upgrade() -> None:
    # Audit history must never be edited or deleted (spec §7.9, §11.4). Enforcing it in the database
    # protects it from application bugs as well as from people. TRUNCATE is deliberately not blocked
    # so disposable test databases can still be reset.
    op.execute(
        """
        CREATE FUNCTION prevent_audit_mutation() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    for table in AUDIT_TABLES:
        op.execute(
            f"""
            CREATE TRIGGER {table}_append_only
            BEFORE UPDATE OR DELETE ON {table}
            FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation()
            """
        )


def downgrade() -> None:
    for table in AUDIT_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS {table}_append_only ON {table}")
    op.execute("DROP FUNCTION IF EXISTS prevent_audit_mutation()")
