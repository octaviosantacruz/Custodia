export type AccessAssetAttributes = {
  access_method: string;
  asset_category: string;
  asset_type: string;
  platform_type: string;
  platform_subtype: string;
  protocol: string;
  workflow_status: string;
  is_favorite: boolean;
  connection_components: string[];
  port: number | string | null;
  platform_id: string;
};

export type AccessAssetRow = {
  object_id: number;
  display_name: string;
  source_id: string;
  attributes: AccessAssetAttributes;
  platform_name: string | null;
};

export type AccessAssetListResponse = {
  rows: AccessAssetRow[];
  total: number;
  limit: number;
  offset: number;
  search: string;
  asset_type: string;
};
