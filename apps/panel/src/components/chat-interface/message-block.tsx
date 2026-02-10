import type { Message } from '@extension/storage';
import { useMemo, useState, useRef, useEffect, lazy, Suspense, CSSProperties } from 'react';
import { Actors } from '@extension/storage';
import { FiCopy, FiClock, FiUser } from 'react-icons/fi';
import { FaBrain, FaSearch, FaRobot, FaRandom, FaMagic, FaCog, FaChessKing } from 'react-icons/fa';
import { FaFileAlt } from 'react-icons/fa';
import { ACTOR_PROFILES } from '../../types/message';
import { formatUsd, formatTimestamp, formatDuration, hexToRgba } from '../../utils';
import type { JobSummary, MessageMetadata, TraceItem, WorkerItem, ContextTabInfo } from './types';
import CodeBlock from './code-block';
import { AgentTrajectory } from './agent-trajectory';

const MarkdownRenderer = lazy(() => import('./markdown-renderer'));
const EstimationPopUp = lazy(() => import('../modals/estimation-popup'));

const ACTOR_TINTS: Record<string, { dark: string; light: string }> = {
  [Actors.USER]: { dark: 'text-slate-200', light: 'text-green-900' },
  [Actors.CHAT]: { dark: 'text-slate-200', light: 'text-violet-900' },
  [Actors.SEARCH]: { dark: 'text-slate-200', light: 'text-teal-900' },
  [Actors.AUTO]: { dark: 'text-slate-200', light: 'text-gray-900' },
  [Actors.ESTIMATOR]: { dark: 'text-slate-200', light: 'text-amber-900' },
  [Actors.AGENT_NAVIGATOR]: { dark: 'text-slate-200', light: 'text-amber-900' },
  default: { dark: 'text-slate-200', light: 'text-gray-800' },
};

// Gradient backgrounds that fade to transparent
const ACTOR_GRADIENTS: Record<string, { dark: string; light: string }> = {
  [Actors.USER]: {
    dark: 'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.02) 100%)',
    light: 'linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(34,197,94,0.02) 100%)',
  },
  [Actors.CHAT]: {
    dark: 'linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(139,92,246,0.02) 100%)',
    light: 'linear-gradient(135deg, rgba(139,92,246,0.10) 0%, rgba(139,92,246,0.01) 100%)',
  },
  [Actors.SEARCH]: {
    dark: 'linear-gradient(135deg, rgba(20,184,166,0.18) 0%, rgba(20,184,166,0.02) 100%)',
    light: 'linear-gradient(135deg, rgba(20,184,166,0.10) 0%, rgba(20,184,166,0.01) 100%)',
  },
  [Actors.AUTO]: {
    dark: 'linear-gradient(135deg, rgba(30,30,30,0.25) 0%, rgba(30,30,30,0.02) 100%)',
    light: 'linear-gradient(135deg, rgba(100,100,100,0.08) 0%, rgba(100,100,100,0.01) 100%)',
  },
  [Actors.ESTIMATOR]: {
    dark: 'linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0.02) 100%)',
    light: 'linear-gradient(135deg, rgba(245,158,11,0.10) 0%, rgba(245,158,11,0.01) 100%)',
  },
  [Actors.AGENT_NAVIGATOR]: {
    dark: 'linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0.02) 100%)',
    light: 'linear-gradient(135deg, rgba(245,158,11,0.10) 0%, rgba(245,158,11,0.01) 100%)',
  },
  default: {
    dark: 'linear-gradient(135deg, rgba(51,65,85,0.25) 0%, rgba(51,65,85,0.02) 100%)',
    light: 'linear-gradient(135deg, rgba(100,116,139,0.08) 0%, rgba(100,116,139,0.01) 100%)',
  },
};

function ProgressBar({
  estimation,
  startTime,
  isCompleted,
  isDarkMode,
}: {
  estimation: any;
  startTime: number;
  isCompleted: boolean;
  isDarkMode: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const duration = estimation?.summary?.total_agent_duration_s || 60;
  useEffect(() => {
    if (isCompleted) {
      setProgress(100);
      return;
    }
    const interval = setInterval(
      () => setProgress(Math.min(98, ((Date.now() - startTime) / 1000 / duration) * 100)),
      500,
    );
    return () => clearInterval(interval);
  }, [startTime, duration, isCompleted]);
  return (
    <div className="mt-2">
      <div className={`h-1.5 w-full overflow-hidden rounded-full ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>
        <div
          className={`h-full transition-all duration-500 ${isDarkMode ? 'bg-violet-500' : 'bg-violet-600'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className={`mt-0.5 text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        Estimated: {formatDuration(duration)} • Progress: {Math.round(progress)}%
      </div>
    </div>
  );
}

export interface MessageBlockProps {
  message: Message;
  isSameActor: boolean;
  isDarkMode?: boolean;
  compactMode?: boolean;
  jobSummary?: JobSummary;
  metadata?: MessageMetadata;
  isAgentAggregate?: boolean;
  onRetryRequest?: (text: string, agent: 'chat' | 'search' | 'agent') => void;
  agentColorHex?: string;
  isAgentWorking?: boolean;
  onTakeControl?: (tabId?: number) => void | Promise<void>;
  pinnedMessageIds?: Set<string>;
  onPinMessage?: (id: string) => void;
  onQuoteMessage?: (text: string) => void;
  pendingEstimation?: any;
  availableModelsForEstimation?: Array<{ provider: string; providerName: string; model: string }>;
  onApproveEstimation?: (selectedModel?: string, updatedEstimation?: any) => void;
  onCancelEstimation?: () => void;
  hasPreviewPanel?: boolean;
}

export default function MessageBlock({
  message,
  isDarkMode = false,
  compactMode = false,
  jobSummary,
  metadata,
  isAgentAggregate = false,
  onRetryRequest,
  agentColorHex,
  isAgentWorking = false,
  onTakeControl,
  pinnedMessageIds,
  pendingEstimation,
  availableModelsForEstimation,
  onApproveEstimation,
  onCancelEstimation,
  hasPreviewPanel = false,
}: MessageBlockProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showTabContextTooltip, setShowTabContextTooltip] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [copied, setCopied] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<'above' | 'below'>('below');
  const [tabContextTooltipPosition, setTabContextTooltipPosition] = useState<'above' | 'below'>('below');
  const tooltipTriggerRef = useRef<HTMLDivElement>(null);
  const tabContextTriggerRef = useRef<HTMLSpanElement>(null);
  const [pricingCacheStatus, setPricingCacheStatus] = useState<{
    isUsingCache: boolean;
    cacheDate: string | null;
  } | null>(null);

  // Fetch pricing cache status once on mount
  useEffect(() => {
    chrome.runtime
      .sendMessage({ type: 'get_pricing_cache_status' })
      .then((res: any) => {
        if (res?.ok) setPricingCacheStatus({ isUsingCache: res.isUsingCache, cacheDate: res.cacheDate });
      })
      .catch(() => {});
  }, []);

  if (!message.actor) return <div />;
  const isUser = message.actor === Actors.USER;
  const isProgress = message.content === 'Showing progress...';
  const isEstimator = message.actor === Actors.ESTIMATOR;
  const isEstimatorActive = isEstimator && metadata?.traceItems && !metadata?.estimation && !metadata?.isCompleted;
  const content = useMemo(() => String(message.content || ''), [message.content]);

  // DEBUG: Detect if content looks like a raw session/task ID
  useEffect(() => {
    if (content && /^\d{13,15}$/.test(content.trim())) {
      console.warn('[MessageBlock Debug] Content looks like a raw ID!', {
        content,
        actor: message.actor,
        timestamp: message.timestamp,
        messageId: `${message.timestamp}-${message.actor}`,
        hasMetadata: !!metadata,
        metadataKeys: metadata ? Object.keys(metadata) : [],
      });
    }
  }, [content, message.actor, message.timestamp, metadata]);
  const currentPhase = useMemo((): 'planner' | 'processing' | 'refiner' | 'workers' | null => {
    const lower = content.toLowerCase();
    if (lower.startsWith('creating plan')) return 'planner';
    if (lower.startsWith('processing plan')) return 'processing';
    if (lower.startsWith('refining plan') || lower.includes('refinement complete')) return 'refiner';
    if (/(\d+)\s+workers executing plan/i.test(content) || lower.includes('workers executing plan')) return 'workers';
    return null;
  }, [content]);

  const traceItems: TraceItem[] = metadata?.traceItems || [];
  const workerItems: WorkerItem[] | undefined = metadata?.workerItems;
  const lastTrace = traceItems[traceItems.length - 1];
  const displayTimestamp = isAgentAggregate && lastTrace ? lastTrace.timestamp : message.timestamp;
  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES] || { icon: '', name: '' };
  const totalWorkers = metadata?.totalWorkers || workerItems?.length;
  const activeWorkers = useMemo(
    () =>
      workerItems?.filter(w => {
        const t = (w.text || '').toLowerCase();
        return !t.startsWith('completed subtask') && !(t.includes('worker') && t.includes('ready'));
      }).length,
    [workerItems],
  );
  const showMultiAvatar = (workerItems?.length || totalWorkers) && (isProgress || isAgentAggregate);
  const isAgentMessage = message.actor !== Actors.USER && message.actor !== Actors.SYSTEM;
  const useDynamicColor = !!agentColorHex && isAgentMessage;
  const actorTint = useDynamicColor
    ? isDarkMode
      ? 'text-slate-200'
      : 'text-gray-800'
    : (ACTOR_TINTS[message.actor] || ACTOR_TINTS.default)[isDarkMode ? 'dark' : 'light'];
  const actorGradient = useDynamicColor
    ? `linear-gradient(135deg, ${hexToRgba(agentColorHex!, isDarkMode ? 0.15 : 0.1)} 0%, ${hexToRgba(agentColorHex!, 0.02)} 100%)`
    : (ACTOR_GRADIENTS[message.actor] || ACTOR_GRADIENTS.default)[isDarkMode ? 'dark' : 'light'];
  const dynamicStyles: CSSProperties = { background: actorGradient };
  const widthClass = isUser ? 'w-3/4' : 'w-full';
  const bubbleClass = compactMode
    ? `relative ${widthClass} rounded-xl px-2.5 py-1.5`
    : `relative ${widthClass} rounded-2xl px-3 py-2`;
  const messageId = `${message.timestamp}-${message.actor}`;
  const isPinned = pinnedMessageIds?.has(messageId);

  const getAvatarBackground = () => {
    if (isUser) return isDarkMode ? '#22c55e' : '#4ade80';
    if (currentPhase === 'planner' || currentPhase === 'refiner') return isDarkMode ? '#fb923c' : '#fdba74';
    if (currentPhase === 'processing') return isDarkMode ? '#0369a1' : '#38bdf8';
    if (currentPhase === 'workers') return isDarkMode ? '#f59e0b' : '#fbbf24';
    if (isEstimatorActive) return isDarkMode ? '#fbbf24' : '#fcd34d';
    if (message.actor === Actors.CHAT) return isDarkMode ? '#8b5cf6' : '#a78bfa';
    if (message.actor === Actors.SEARCH) return isDarkMode ? '#14b8a6' : '#5eead4';
    if (message.actor === Actors.AUTO) return '#000000';
    return isDarkMode ? '#f59e0b' : '#fbbf24';
  };

  const getAvatarIcon = () => {
    const ic = 'h-2.5 w-2.5 text-white';
    if (isUser) return <FiUser className={ic} />;
    if (currentPhase === 'planner') return <FaChessKing className={ic} />;
    if (currentPhase === 'processing') return <FaCog className={`${ic} phase-spin`} />;
    if (currentPhase === 'refiner') return <FaMagic className={ic} />;
    if (currentPhase === 'workers') {
      const count = Math.max(1, Math.min(4, activeWorkers ?? totalWorkers ?? 1));
      return showMultiAvatar ? (
        <span className="inline-flex items-center gap-0">
          {Array.from({ length: count }).map((_, i) => (
            <FaRobot key={i} className={`${ic} phase-bob`} />
          ))}
        </span>
      ) : (
        <FaRobot className={`${ic} phase-bob`} />
      );
    }
    if (isEstimatorActive) return <FiClock className={ic} />;
    if (message.actor === Actors.CHAT) return <FaBrain className={ic} />;
    if (message.actor === Actors.SEARCH) return <FaSearch className={ic} />;
    if (message.actor === Actors.AUTO) return <FaRandom className={ic} />;
    if (message.actor === Actors.MULTIAGENT) return <FaChessKing className={ic} />;
    if (isProgress || (isAgentAggregate && !isEstimator)) return <FaRobot className={ic} />;
    if (actor?.icon)
      return <img src={actor.icon} alt={actor.name} className="h-2.5 w-2.5 opacity-100 drop-shadow invert" />;
    return null;
  };

  const LinkComponent = ({ node, ...props }: any) => (
    <a
      {...props}
      className={`underline ${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}
      target="_blank"
      rel="noopener noreferrer"
    />
  );
  const transformWorkerLabel = (text: string) => text.replace(/\bWorker\s*w(\d+)\b/gi, 'Web Agent $1');
  const controlBtnClass = `rounded px-3 py-1.5 text-sm font-medium ${isDarkMode ? 'bg-amber-600 text-white hover:bg-amber-500' : 'bg-amber-500 text-white hover:bg-amber-600'}`;

  // Job summary tooltip component (inline)
  const JobSummaryChip =
    jobSummary && !isUser ? (
      <span
        ref={tooltipTriggerRef}
        className="relative ml-1 align-middle inline-flex"
        onMouseEnter={() => {
          if (tooltipTriggerRef.current) {
            const rect = tooltipTriggerRef.current.getBoundingClientRect();
            let parent = tooltipTriggerRef.current.parentElement;
            let containerBottom = window.innerHeight;
            while (parent) {
              const style = getComputedStyle(parent);
              if (
                style.overflow === 'auto' ||
                style.overflow === 'scroll' ||
                style.overflowY === 'auto' ||
                style.overflowY === 'scroll'
              ) {
                containerBottom = parent.getBoundingClientRect().bottom;
                break;
              }
              parent = parent.parentElement;
            }
            setTooltipPosition(containerBottom - rect.bottom < 220 ? 'above' : 'below');
          }
          setShowTooltip(true);
        }}
        onMouseLeave={() => setShowTooltip(false)}>
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full cursor-default text-[10px] font-medium ${isDarkMode ? 'bg-slate-700/80 text-slate-300 border border-slate-600/50' : 'bg-gray-100/80 text-gray-500 border border-gray-200/50'}`}>
          <span>💰</span>
          <span>{formatUsd(jobSummary.cost)}</span>
          <FiClock size={10} />
          <span>{jobSummary.latency}s</span>
        </span>
        {showTooltip && (
          <span
            className={`absolute left-0 rounded-lg text-[11px] z-[1000] shadow-lg backdrop-blur-sm min-w-[180px] max-w-[280px] ${isDarkMode ? 'bg-slate-800/98 text-slate-200 border border-slate-600/50' : 'bg-white/98 text-gray-700 border border-gray-200/70'} ${tooltipPosition === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
            {tooltipPosition === 'above' ? (
              <span
                className={`absolute top-full left-4 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent ${isDarkMode ? 'border-t-slate-800/98' : 'border-t-white/98'}`}
              />
            ) : (
              <span
                className={`absolute bottom-full left-4 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-transparent ${isDarkMode ? 'border-b-slate-800/98' : 'border-b-white/98'}`}
              />
            )}
            <span className="block px-3 py-2 space-y-1.5">
              {jobSummary.modelName && (
                <span className="flex justify-between gap-3 pb-1 border-b border-gray-200/30">
                  <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Model:</span>
                  <span className="font-medium text-right">
                    {jobSummary.provider || 'Unknown'} ({jobSummary.modelName})
                  </span>
                </span>
              )}
              <span className="flex justify-between gap-3">
                <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Input:</span>
                <span className="font-medium">{jobSummary.inputTokens.toLocaleString()}</span>
              </span>
              <span className="flex justify-between gap-3">
                <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Output:</span>
                <span className="font-medium">{jobSummary.outputTokens.toLocaleString()}</span>
              </span>
              <span className="flex justify-between gap-3">
                <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Latency:</span>
                <span className="font-medium">{jobSummary.latency}s</span>
              </span>
              <span className="flex justify-between gap-3">
                <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Cost Est:</span>
                <span className="font-medium">{formatUsd(jobSummary.cost)}</span>
              </span>
              <span className="flex justify-between gap-3">
                <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>API Calls:</span>
                <span className="font-medium">{jobSummary.apiCalls}</span>
              </span>
              <span className={`block text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                Costs estimated without prompt caching
                {pricingCacheStatus?.isUsingCache && pricingCacheStatus.cacheDate && (
                  <span> | Using pricing data from {new Date(pricingCacheStatus.cacheDate).toLocaleDateString()}</span>
                )}
              </span>
            </span>
          </span>
        )}
      </span>
    ) : null;

  // Helper to truncate tab title
  const truncateTabTitle = (title: string, maxLen = 25) =>
    title.length > maxLen ? title.slice(0, maxLen) + '...' : title;

  // Tab context tooltip component (inline) - shows for user messages with context tabs
  const contextTabs: ContextTabInfo[] = metadata?.contextTabs || [];
  const TabContextChip =
    isUser && contextTabs.length > 0 ? (
      <span
        ref={tabContextTriggerRef}
        className="relative ml-1 align-middle inline-flex"
        onMouseEnter={() => {
          if (tabContextTriggerRef.current) {
            const rect = tabContextTriggerRef.current.getBoundingClientRect();
            let parent = tabContextTriggerRef.current.parentElement;
            let containerBottom = window.innerHeight;
            while (parent) {
              const style = getComputedStyle(parent);
              if (
                style.overflow === 'auto' ||
                style.overflow === 'scroll' ||
                style.overflowY === 'auto' ||
                style.overflowY === 'scroll'
              ) {
                containerBottom = parent.getBoundingClientRect().bottom;
                break;
              }
              parent = parent.parentElement;
            }
            setTabContextTooltipPosition(containerBottom - rect.bottom < 180 ? 'above' : 'below');
          }
          setShowTabContextTooltip(true);
        }}
        onMouseLeave={() => setShowTabContextTooltip(false)}>
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full cursor-default text-[10px] font-medium ${isDarkMode ? 'bg-purple-900/60 text-purple-200 border border-purple-700/50' : 'bg-purple-100/80 text-purple-600 border border-purple-200/50'}`}>
          <FaFileAlt size={9} />
          <span>
            {contextTabs.length} tab{contextTabs.length > 1 ? 's' : ''}
          </span>
        </span>
        {showTabContextTooltip && (
          <span
            className={`absolute left-0 rounded-lg text-[11px] z-[1000] shadow-lg backdrop-blur-sm min-w-[200px] max-w-[300px] ${isDarkMode ? 'bg-slate-800/98 text-slate-200 border border-slate-600/50' : 'bg-white/98 text-gray-700 border border-gray-200/70'} ${tabContextTooltipPosition === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
            {tabContextTooltipPosition === 'above' ? (
              <span
                className={`absolute top-full left-4 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent ${isDarkMode ? 'border-t-slate-800/98' : 'border-t-white/98'}`}
              />
            ) : (
              <span
                className={`absolute bottom-full left-4 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-transparent ${isDarkMode ? 'border-b-slate-800/98' : 'border-b-white/98'}`}
              />
            )}
            <span className="block px-3 py-2">
              <span
                className={`block text-[10px] font-medium mb-1.5 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                Tab Context
              </span>
              <span className="block space-y-1.5">
                {contextTabs.map((tab, idx) => (
                  <span key={tab.id || idx} className="flex items-center gap-2">
                    {tab.favIconUrl ? (
                      <img
                        src={tab.favIconUrl}
                        alt=""
                        className="w-4 h-4 flex-shrink-0 rounded-sm"
                        onError={e => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <span
                        className={`w-4 h-4 flex-shrink-0 rounded-sm flex items-center justify-center ${isDarkMode ? 'bg-slate-600' : 'bg-gray-200'}`}>
                        <FaFileAlt size={8} className={isDarkMode ? 'text-slate-400' : 'text-gray-400'} />
                      </span>
                    )}
                    <span
                      className={`flex-1 truncate ${isDarkMode ? 'text-slate-200' : 'text-gray-700'}`}
                      title={tab.title}>
                      {truncateTabTitle(tab.title)}
                    </span>
                  </span>
                ))}
              </span>
            </span>
          </span>
        )}
      </span>
    ) : null;

  return (
    <div className={`group flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`${bubbleClass} ${actorTint} liquid-bubble`} style={dynamicStyles}>
        {/* Floating avatar */}
        <div
          className={`float-left mr-1.5 flex h-4 ${showMultiAvatar ? 'min-w-[24px] px-0.5' : 'w-4'} items-center justify-center rounded-full`}
          style={{ backgroundColor: getAvatarBackground() }}>
          {getAvatarIcon()}
        </div>
        {/* Secondary role indicator for agent aggregate */}
        {(isProgress || isAgentAggregate) &&
          lastTrace?.actor &&
          ['agent_navigator', 'agent_planner', 'agent_validator', 'planner', 'refiner'].includes(lastTrace.actor) &&
          (() => {
            const role = ACTOR_PROFILES[lastTrace.actor as keyof typeof ACTOR_PROFILES];
            return role?.icon ? (
              <span
                className="float-left mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full"
                style={{ backgroundColor: isDarkMode ? '#f59e0b' : '#fbbf24' }}>
                <img src={role.icon} alt="" className="h-2.5 w-2.5 opacity-100 invert" />
              </span>
            ) : null;
          })()}
        {/* Floating actions */}
        <div className="float-right flex items-center gap-1 ml-2">
          {isPinned && <span className={`text-[10px] ${isDarkMode ? 'text-amber-300' : 'text-amber-600'}`}>📌</span>}
          {isAgentAggregate && isAgentWorking && (
            <span
              className={`inline-block h-3 w-3 rounded-full border-2 border-t-transparent animate-spin ${isDarkMode ? 'border-slate-400' : 'border-gray-500'}`}
            />
          )}
          {isAgentAggregate && (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className={`opacity-60 hover:opacity-100 rounded px-1.5 py-0.5 text-xs font-medium transition-all ${isDarkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}>
              <span className="flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points={collapsed ? '6,9 12,15 18,9' : '18,15 12,9 6,15'} />
                </svg>
                {collapsed ? 'Details' : 'Hide'}
              </span>
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              title="Copy"
              onClick={() => {
                navigator.clipboard.writeText(content).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              className={`opacity-0 group-hover:opacity-100 rounded p-1 ${isDarkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}>
              <FiCopy size={14} />
            </button>
            {copied && (
              <div
                className={`absolute right-0 bottom-full mb-1 rounded px-1.5 py-0.5 text-[10px] shadow ${isDarkMode ? 'bg-slate-800 text-slate-200 border border-slate-600/50' : 'bg-white text-gray-700 border border-gray-200'}`}>
                Copied
              </div>
            )}
          </div>
        </div>
        {/* Content area */}
        <div
          className={`${compactMode ? 'text-[13px] leading-[1.35]' : 'text-sm'} ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          {isProgress ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex gap-0.5">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
              <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>working...</span>
            </span>
          ) : isEstimatorActive ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex gap-0.5">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
              <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Estimating...</span>
            </span>
          ) : currentPhase ? (
            <span className="inline-flex items-center gap-1.5">
              {content && <span>{content}</span>}
              <span className="inline-flex gap-0.5">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className={`h-1.5 w-1.5 rounded-full animate-pulse ${currentPhase === 'planner' || currentPhase === 'refiner' ? 'bg-orange-400' : currentPhase === 'processing' ? 'bg-sky-400' : 'bg-amber-400'}`}
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
            </span>
          ) : (
            <>
              <span className="inline-md-content whitespace-pre-wrap break-words">
                {(!isAgentAggregate || !collapsed) && (
                  <Suspense
                    fallback={
                      <span
                        className={`${isDarkMode ? 'bg-slate-800/60' : 'bg-gray-100/70'} inline-block h-4 w-32 animate-pulse rounded`}
                      />
                    }>
                    <MarkdownRenderer
                      components={{
                        a: LinkComponent,
                        code: ({ className, children }: any) => (
                          <CodeBlock isDarkMode={isDarkMode} className={className}>
                            {String(children)}
                          </CodeBlock>
                        ),
                      }}>
                      {content}
                    </MarkdownRenderer>
                  </Suspense>
                )}
                {isAgentAggregate && collapsed && <span>{lastTrace?.content || content}</span>}
              </span>
              {/* Inline timestamp, tab context, and job summary - rendered after content */}
              {TabContextChip}
              {JobSummaryChip}
              <span
                className={`ml-1.5 whitespace-nowrap ${compactMode ? 'text-[9px]' : 'text-[10px]'} ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {formatTimestamp(displayTimestamp)}
              </span>
              {isEstimator && metadata?.estimation && metadata?.workflowStartTime && !metadata?.isCompleted && (
                <ProgressBar
                  estimation={metadata.estimation}
                  startTime={metadata.workflowStartTime}
                  isCompleted={!!metadata.isCompleted}
                  isDarkMode={isDarkMode}
                />
              )}
              {isEstimator &&
                pendingEstimation &&
                onApproveEstimation &&
                onCancelEstimation &&
                !metadata?.workflowStartTime &&
                !metadata?.isCompleted && (
                  <Suspense fallback={<div className="animate-pulse h-32 bg-slate-700/20 rounded" />}>
                    <EstimationPopUp
                      estimation={pendingEstimation}
                      isDarkMode={isDarkMode}
                      availableModels={availableModelsForEstimation || []}
                      onApprove={onApproveEstimation}
                      onCancel={onCancelEstimation}
                    />
                  </Suspense>
                )}
              {!isAgentAggregate &&
                metadata?.controlRequest?.type === 'request_user_control' &&
                typeof metadata.controlRequest.tabId === 'number' &&
                onTakeControl && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className={controlBtnClass}
                      onClick={() => onTakeControl(metadata.controlRequest!.tabId)}>
                      Take Control
                    </button>
                  </div>
                )}
              {isAgentAggregate && !collapsed && workerItems?.length && (
                <div
                  className="mt-2 rounded-md border p-2 text-xs clear-both"
                  style={agentColorHex ? { borderColor: agentColorHex } : undefined}>
                  <div className={`mb-1 font-medium ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                    Web Agents
                  </div>
                  <div className="space-y-1">
                    {workerItems
                      .slice()
                      .sort((a, b) => a.workerId.localeCompare(b.workerId))
                      .map(worker => {
                        const num = worker.workerId.replace(/\D/g, '') || '';
                        return (
                          <div key={worker.workerId} className="flex items-start gap-2">
                            <span
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]"
                              style={{
                                backgroundColor: worker.color || agentColorHex || (isDarkMode ? '#334155' : '#f1f5f9'),
                                color: '#fff',
                              }}>
                              {num || '•'}
                            </span>
                            <div className="min-w-0">
                              <div
                                className={`${isDarkMode ? 'text-slate-200' : 'text-gray-800'} truncate`}
                                style={{ color: worker.color || undefined }}>
                                {worker.text ||
                                  (num ? `Web Agent ${num}` : worker.agentName || worker.workerId) ||
                                  'working...'}
                              </div>
                              <div className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                                {formatTimestamp(worker.timestamp)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
              {isAgentAggregate && !collapsed && traceItems.length > 0 && (
                <div className="mt-2 clear-both">
                  <AgentTrajectory traceItems={traceItems} isDarkMode={isDarkMode} compactMode={compactMode} />
                </div>
              )}
              {!isUser &&
                (() => {
                  try {
                    const obj = content.startsWith('{') ? JSON.parse(content) : null;
                    if (obj?.type === 'job_summary')
                      return (
                        <span
                          className={`ml-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${isDarkMode ? 'bg-slate-700/80 text-slate-300 border border-slate-600/50' : 'bg-gray-100/80 text-gray-500 border border-gray-200/50'}`}>
                          <span>💰</span>
                          <span>{(obj.totalTokens || obj.inputTokens + obj.outputTokens).toLocaleString()} tokens</span>
                          <FiClock size={10} />
                          <span>{obj.totalLatencySec}s</span>
                        </span>
                      );
                  } catch {}
                  return null;
                })()}
            </>
          )}
        </div>
        {!isProgress && onRetryRequest && message.actor === Actors.AGENT_VALIDATOR && (
          <div
            className={`mt-2 flex flex-wrap gap-2 ${isUser ? 'justify-end' : 'justify-start'} opacity-0 group-hover:opacity-100 transition-opacity`}>
            {['chat', 'search', 'agent'].map(type => (
              <button
                key={type}
                type="button"
                onClick={() => onRetryRequest(content, type as any)}
                className={`rounded-full px-2 py-0.5 text-xs ${isDarkMode ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                Retry with {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
