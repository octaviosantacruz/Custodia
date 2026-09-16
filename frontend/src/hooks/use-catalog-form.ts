import { useState, type FormEvent } from 'react';
import { createBusinessUnit, createResponsible } from '../lib/catalog-api';

type CatalogKind = 'unit' | 'responsible';
type LoadDashboard = (options?: { refreshStatic?: boolean }) => Promise<void>;

type UseCatalogFormOptions = {
  loadDashboard: LoadDashboard;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

export function useCatalogForm({ loadDashboard, onError, onNotice }: UseCatalogFormOptions) {
  const [catalogModal, setCatalogModal] = useState<CatalogKind | null>(null);
  const [catalogDraft, setCatalogDraft] = useState({ code: '', name: '', email: '' });
  const [catalogBusy, setCatalogBusy] = useState(false);

  const openCatalogModal = (kind: CatalogKind) => {
    setCatalogDraft({ code: '', name: '', email: '' });
    setCatalogModal(kind);
  };

  const saveCatalogEntry = async (event: FormEvent) => {
    event.preventDefault();
    if (!catalogModal) return;
    setCatalogBusy(true);
    try {
      if (catalogModal === 'unit') {
        await createBusinessUnit({ unit_code: catalogDraft.code.trim(), unit_name: catalogDraft.name.trim() });
      } else {
        await createResponsible({ display_name: catalogDraft.name.trim(), email: catalogDraft.email.trim() });
      }
      await loadDashboard({ refreshStatic: true });
      setCatalogModal(null);
      onNotice(catalogModal === 'unit' ? 'Unidad agregada' : 'Responsable agregado');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo guardar');
    } finally {
      setCatalogBusy(false);
    }
  };

  return { catalogModal, setCatalogModal, catalogDraft, setCatalogDraft, catalogBusy, openCatalogModal, saveCatalogEntry };
}
