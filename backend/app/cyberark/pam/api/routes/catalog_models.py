from pydantic import AliasChoices, BaseModel, Field


class BusinessUnitResponse(BaseModel):
    business_unit_id: int = Field(validation_alias=AliasChoices('business_unit_id', 'id'))
    unit_code: str
    unit_name: str
    is_active: bool = True


class ResponsibleResponse(BaseModel):
    responsible_id: int = Field(validation_alias=AliasChoices('responsible_id', 'id'))
    display_name: str
    email: str
    is_active: bool = True


class AccountTypeCatalogResponse(BaseModel):
    key: str
    count: int
    safes: int


class CatalogsResponse(BaseModel):
    business_units: list[BusinessUnitResponse]
    responsibles: list[ResponsibleResponse]
    account_types: list[AccountTypeCatalogResponse]
