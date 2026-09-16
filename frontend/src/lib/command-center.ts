import type { WorkspaceView } from './workspaces';

export type CommandCenterCommand = {
  id: string;
  group: 'recent' | 'tools' | 'actions';
  label: string;
  detail: string;
  keywords: string[];
  permission?: string | string[];
  workspace?: WorkspaceView;
  run?: () => void;
};

export function availableCommands(
  commands: CommandCenterCommand[],
  query: string,
  permissions: string[],
): CommandCenterCommand[] {
  const normalized = query.trim().toLocaleLowerCase();
  return commands.filter((command) => {
    if (command.permission) {
      const required = Array.isArray(command.permission) ? command.permission : [command.permission];
      if (!required.some((code) => permissions.includes(code))) return false;
    }
    if (!normalized) return true;
    return [command.label, command.detail, ...command.keywords]
      .some((value) => value.toLocaleLowerCase().includes(normalized));
  });
}

export function commandShortcutLabel(userAgent: string): string {
  return /Mac|iPhone|iPad|iPod/.test(userAgent) ? '⌘ K' : 'Ctrl K';
}

export function recordRecentWorkspace<T extends string>(view: T, recent: T[], limit = 8): T[] {
  return [view, ...recent.filter((item) => item !== view)].slice(0, limit);
}
