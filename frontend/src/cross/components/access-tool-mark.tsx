import { Blocks, Waypoints } from 'lucide-react';
import type { AccessTool } from '../lib/access-tool-groups';
import './access-tool-mark.css';

export function AccessToolMark({ tool }: { tool: AccessTool }) {
  return <span className={`access-tool-mark is-${tool.id === 'netskope' ? 'wide' : 'compact'}`} aria-hidden="true">
    {tool.dark && tool.light ? <><img className="access-tool-mark-dark" src={tool.dark} alt="" /><img className="access-tool-mark-light" src={tool.light} alt="" /></> : tool.id === 'hub' ? <Waypoints size={21} /> : <Blocks size={21} />}
  </span>;
}
