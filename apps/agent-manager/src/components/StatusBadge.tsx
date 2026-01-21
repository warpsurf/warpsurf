import { FiActivity, FiCheckCircle, FiXCircle, FiAlertCircle, FiPauseCircle } from 'react-icons/fi';
import type { AgentStatus } from '@src/types';

interface StatusBadgeProps {
  status: AgentStatus;
  isDarkMode: boolean;
  compact?: boolean;
}

const statusConfig: Record<
  AgentStatus,
  { label: string; shortLabel: string; color: string; bgColor: string; Icon: typeof FiActivity }
> = {
  running: {
    label: 'Running',
    shortLabel: 'Running',
    color: 'text-green-500',
    bgColor: 'bg-green-500/10',
    Icon: FiActivity,
  },
  paused: {
    label: 'Paused',
    shortLabel: 'Paused',
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-500/10',
    Icon: FiPauseCircle,
  },
  needs_input: {
    label: 'Needs Input',
    shortLabel: 'Input',
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    Icon: FiAlertCircle,
  },
  completed: {
    label: 'Completed',
    shortLabel: 'Done',
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    Icon: FiCheckCircle,
  },
  failed: { label: 'Failed', shortLabel: 'Failed', color: 'text-red-500', bgColor: 'bg-red-500/10', Icon: FiXCircle },
  cancelled: {
    label: 'Cancelled',
    shortLabel: 'Cancelled',
    color: 'text-gray-500',
    bgColor: 'bg-gray-500/10',
    Icon: FiXCircle,
  },
};

export function StatusBadge({ status, isDarkMode, compact = false }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.running;
  const { label, shortLabel, color, bgColor, Icon } = config;
  const isActive = status === 'running';
  const needsAttention = status === 'needs_input';

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${color} ${bgColor}`}>
        <Icon className={`h-2.5 w-2.5 ${isActive ? 'status-pulse' : ''}`} />
        <span>{shortLabel}</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${color}`}>
      <Icon className={`h-3.5 w-3.5 ${isActive ? 'status-pulse' : ''}`} />
      <span className={needsAttention ? 'font-semibold' : ''}>{label}</span>
    </span>
  );
}
