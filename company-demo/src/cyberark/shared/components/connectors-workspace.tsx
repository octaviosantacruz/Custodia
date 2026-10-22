import { useState } from 'react';
import { CompactSelect } from '../../../cross/components/compact-select';
import { PamConnectorsWorkspace } from '../../pam/components/pam-platforms-workspace';
import { ConnectorManagerCatalog } from '../../connector_manager/components/connector-manager-catalog';
import { usePamRefreshKey } from '../refresh-context';

type Props = {
  authChecked: boolean; authenticated: boolean; onUnauthorized: () => void; onError: (message: string) => void;
  onOpenPlatforms: (query: string) => void; initialQuery?: string;
};
type Inventory = 'psm' | 'sia' | 'pools' | 'networks';

/** Only this compositor knows the tool-owned catalogs; their data stays separate. */
export function ConnectorsWorkspace(props: Props) {
  const [inventory, setInventory] = useState<Inventory>('psm');
  const refreshKey = usePamRefreshKey();
  const selector = <CompactSelect ariaLabel="Elegir inventario de conectores" value={inventory} options={[
    { value: 'psm', label: 'PSM' }, { value: 'sia', label: 'SIA' },
    { value: 'pools', label: 'Pools · Connector Manager' }, { value: 'networks', label: 'Redes · Connector Manager' },
  ]} onChange={(value) => setInventory(value as Inventory)} />;
  return inventory === 'psm' || inventory === 'sia'
    ? <PamConnectorsWorkspace {...props} activeSection={inventory} inventorySelector={selector} />
    : <ConnectorManagerCatalog key={inventory} catalog={inventory} selector={selector} refreshKey={refreshKey} authChecked={props.authChecked} authenticated={props.authenticated} onUnauthorized={props.onUnauthorized} />;
}
