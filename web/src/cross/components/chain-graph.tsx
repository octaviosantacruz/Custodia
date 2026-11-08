import { ArrowRight, CircleHelp } from 'lucide-react';
import { formatNumber } from '../lib/format';
import './chain-graph.css';
import { t } from '../i18n/index.ts';

export type ChainGraphNode = {
  id: string;
  label: string;
  count: number | null;
  description: string;
  items?: string[];
  state?: 'ready' | 'pending' | 'empty';
  actionLabel?: string;
};

type ChainGraphProps = {
  title: string;
  description: string;
  nodes: ChainGraphNode[];
  statusLabel?: string;
  statusTone?: 'ready' | 'pending';
  compact?: boolean;
  onNodeActivate?: (node: ChainGraphNode) => void;
};

export function ChainGraph({ title, description, nodes, statusLabel, statusTone = 'ready', compact = false, onNodeActivate }: ChainGraphProps) {
  return <section className={'chain-graph-panel' + (compact ? ' is-compact' : '')} aria-label={title}>
    <div className="chain-graph-heading">
      <div><p className="eyebrow">{t('MAPA DE RELACIONES')}</p><h3>{title}</h3><p>{description}</p></div>
      {statusLabel && <span className={'chain-graph-status is-' + statusTone}>{statusLabel}</span>}
    </div>
    <div className="chain-graph-track">
      {nodes.map((node, index) => <div className="chain-graph-step" key={node.id}>
        {node.actionLabel && onNodeActivate
          ? <button type="button" className={'chain-graph-node is-action is-' + (node.state || (node.count === null ? 'pending' : node.count ? 'ready' : 'empty'))} aria-label={`${node.actionLabel}: ${node.label}, ${node.count === null ? 'pendiente' : formatNumber(node.count)}`} onClick={() => onNodeActivate(node)}>
            <div className="chain-graph-node-top"><span>{node.label}</span>{node.count === null && <CircleHelp size={13} aria-label={t('Estado pendiente')} />}</div>
            <strong>{node.count === null ? 'N/D' : formatNumber(node.count)}</strong>
            <small>{node.description}</small>
            {!compact && node.items?.length ? <div className="chain-graph-items">{node.items.slice(0, 3).map((item) => <span key={item}>{item}</span>)}{node.items.length > 3 && <span>+{formatNumber(node.items.length - 3)} más</span>}</div> : null}
            <em>{node.actionLabel}</em>
          </button>
          : <div className={'chain-graph-node is-' + (node.state || (node.count === null ? 'pending' : node.count ? 'ready' : 'empty'))} role="group" aria-label={node.label + ': ' + (node.count === null ? 'pendiente' : formatNumber(node.count))}>
          <div className="chain-graph-node-top"><span>{node.label}</span>{node.count === null && <CircleHelp size={13} aria-label={t('Estado pendiente')} />}</div>
          <strong>{node.count === null ? 'N/D' : formatNumber(node.count)}</strong>
          <small>{node.description}</small>
          {!compact && node.items?.length ? <div className="chain-graph-items">{node.items.slice(0, 3).map((item) => <span key={item}>{item}</span>)}{node.items.length > 3 && <span>+{formatNumber(node.items.length - 3)} más</span>}</div> : null}
          </div>}
        {index < nodes.length - 1 && <ArrowRight className="chain-graph-arrow" size={17} aria-hidden />}
      </div>)}
    </div>
  </section>;
}
