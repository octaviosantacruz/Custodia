"""Shared role-template and workspace preference response contracts."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class DashboardRoleTemplateRow(BaseModel):
    role_code: str
    role_name: str
    version: int
    widgets: list[dict]
    published_at: datetime


class DashboardRoleTemplatesResponse(BaseModel):
    templates: list[DashboardRoleTemplateRow]


class WorkspacePreferencesResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    visible_workspaces: list[str]
    hidden_workspaces: list[str]
    recent_workspaces: list[str]
    updated_at: datetime | None = None
