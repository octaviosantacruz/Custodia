import { createContext, useContext, type ReactNode } from 'react';
import type { IngestionRun } from '../types/ingestion';
import type { ActivityEvent } from '../lib/activity-events-api';

/* Scoped to the header (NotificationMenu + ProfileMenu account actions).
   General page-level errors/notices (AppNotifications, workspace forms)
   keep their own onError/onNotice props from App.tsx. */
type NotificationContextValue = {
  latestRun: IngestionRun | null;
  latestEvent: ActivityEvent | null;
  unreadEventCount: number;
  onEventsSeen: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ value, children }: { value: NotificationContextValue; children: ReactNode }) {
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotificationContext(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotificationContext must be used within a NotificationProvider');
  return context;
}
