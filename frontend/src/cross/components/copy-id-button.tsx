import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyToClipboard } from '../lib/clipboard';

type CopyIdButtonProps = {
  value: string;
  label?: string;
};

/* Small inline affordance for copying a technical identifier (source_id,
   object_id) into the clipboard -- the exact value support/ops staff need
   to paste into a ticket. Mirrors the copy-to-clipboard pattern already
   used in user-admin.tsx for temporary passwords, generalized here as a
   shared component instead of being reimplemented per workspace. */
export function CopyIdButton({ value, label = 'Copiar identificador' }: CopyIdButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return <button
    type="button"
    className="copy-id-button"
    title={copied ? 'Copiado' : label}
    aria-label={copied ? 'Copiado' : label}
    onClick={(event) => { event.stopPropagation(); void handleClick(); }}
  >
    {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
  </button>;
}
