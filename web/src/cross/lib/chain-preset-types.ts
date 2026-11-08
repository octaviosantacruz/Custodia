import type { ChainDirection, ChainNodeType } from './chains-api';

export type ChainPresetSearch = {
  query: string;
  types: ChainNodeType[];
  standardSeat?: '' | 'reconciled' | 'unreconciled';
  status?: '' | 'suspended';
};

export type ChainPreset = {
  id: string;
  label: string;
  hint: string;
  /** Only enabled when the current node has this type. */
  requiresType?: ChainNodeType;
  /** Direction to switch to when the current node matches `requiresType`. */
  direction?: ChainDirection;
  /** Server-side search, always resolved from persisted fields. */
  search?: ChainPresetSearch;
};
