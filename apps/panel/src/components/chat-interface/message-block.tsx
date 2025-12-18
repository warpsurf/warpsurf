import type { Message } from '@extension/storage';
import { useMemo, useState, useRef, useEffect, lazy, Suspense, CSSProperties } from 'react';
import { Actors } from '@extension/storage';
import { FiCopy, FiClock } from 'react-icons/fi';
import { FaBrain, FaSearch, FaRobot, FaRandom, FaMagic, FaCog, FaChessKing } from 'react-icons/fa';
import { ACTOR_PROFILES } from '../../types/message';
import { formatUsd, formatTimestamp, formatDuration, hexToRgba } from '../../utils';
import type { JobSummary, MessageMetadata, TraceItem, WorkerItem } from './types';
import CodeBlock from './code-block';

const MarkdownRenderer = lazy(() => import('./markdown-renderer'));
const EstimationPopUp = lazy(() => import('../modals/estimation-popup'));

const ACTOR_TINTS: Record<string, { dark: string; light: string }> = {
  [Actors.CHAT]: { dark: 'bg-violet-900/20 border border-violet-700/40 text-slate-200', light: 'bg-violet-50 border border-violet-200 text-violet-800' },
  [Actors.SEARCH]: { dark: 'bg-teal-900/20 border border-teal-700/40 text-slate-200', light: 'bg-teal-50 border border-teal-200 text-teal-800' },
  [Actors.AUTO]: { dark: 'bg-black/30 border border-slate-700/60 text-slate-200', light: 'bg-black/5 border border-gray-300 text-gray-900' },
  [Actors.ESTIMATOR]: { dark: 'bg-amber-900/20 border border-amber-700/40 text-slate-200', light: 'bg-amber-50 border border-amber-200 text-amber-800' },
  [Actors.AGENT_NAVIGATOR]: { dark: 'bg-amber-900/20 border border-amber-700/40 text-slate-200', light: 'bg-amber-50 border border-amber-200 text-amber-800' },
  default: { dark: 'bg-slate-800/70 border border-slate-700/60 text-slate-200', light: 'bg-gray-50 border border-gray-200 text-gray-800' },
};

function ProgressBar({ estimation, startTime, isCompleted, isDarkMode }: { estimation: any; startTime: number; isCompleted: boolean; isDarkMode: boolean }) {
  const [progress, setProgress] = useState(0);
  const duration = estimation?.summary?.total_agent_duration_s || 60;
  useEffect(() => {
    if (isCompleted) { setProgress(100); return; }
    const interval = setInterval(() => setProgress(Math.min(98, ((Date.now() - startTime) / 1000 / duration) * 100)), 500);
    return () => clearInterval(interval);
  }, [startTime, duration, isCompleted]);
  return (
    <div className="mt-2">
      <div className={`h-1.5 w-full overflow-hidden rounded-full ${isDarkMode ? 'bg-slate-700' : 'bg-gray-200'}`}>
        <div className={`h-full transition-all duration-500 ${isDarkMode ? 'bg-violet-500' : 'bg-violet-600'}`} style={{ width: `${progress}%` }} />
      </div>
      <div className={`mt-0.5 text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Estimated: {formatDuration(duration)} • Progress: {Math.round(progress)}%</div>
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
}

export default function MessageBlock({
  message, isDarkMode = false, compactMode = false, jobSummary, metadata, isAgentAggregate = false,
  onRetryRequest, agentColorHex, isAgentWorking = false, onTakeControl, pinnedMessageIds,
  pendingEstimation, availableModelsForEstimation, onApproveEstimation, onCancelEstimation,
}: MessageBlockProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [copied, setCopied] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<'above' | 'below'>('below');
  const tooltipTriggerRef = useRef<HTMLDivElement>(null);
  const [pricingCacheStatus, setPricingCacheStatus] = useState<{ isUsingCache: boolean; cacheDate: string | null } | null>(null);

  // Fetch pricing cache status once on mount
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'get_pricing_cache_status' })
      .then((res: any) => { if (res?.ok) setPricingCacheStatus({ isUsingCache: res.isUsingCache, cacheDate: res.cacheDate }); })
      .catch(() => {});
  }, []);

  if (!message.actor) return <div />;
  const isUser = message.actor === Actors.USER;
  const isProgress = message.content === 'Showing progress...';
  const isEstimator = message.actor === Actors.ESTIMATOR;
  const isEstimatorActive = isEstimator && metadata?.traceItems && !metadata?.estimation && !metadata?.isCompleted;
  const content = useMemo(() => String(message.content || ''), [message.content]);
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
  const activeWorkers = useMemo(() => workerItems?.filter(w => { const t = (w.text || '').toLowerCase(); return !t.startsWith('completed subtask') && !(t.includes('worker') && t.includes('ready')); }).length, [workerItems]);
  const showMultiAvatar = (workerItems?.length || totalWorkers) && (isProgress || isAgentAggregate);
  const isAgentMessage = message.actor !== Actors.USER && message.actor !== Actors.SYSTEM;
  const useDynamicColor = !!agentColorHex && isAgentMessage;
  const actorTint = useDynamicColor ? (isDarkMode ? 'border text-slate-200' : 'border text-gray-800') : (ACTOR_TINTS[message.actor] || ACTOR_TINTS.default)[isDarkMode ? 'dark' : 'light'];
  const dynamicStyles: CSSProperties | undefined = useDynamicColor ? { borderColor: agentColorHex, background: hexToRgba(agentColorHex!, isDarkMode ? 0.12 : 0.08) } : undefined;
  const bubbleClass = compactMode ? 'relative max-w-[85%] rounded-xl px-2.5 py-1.5 shadow-sm' : 'relative max-w-[85%] rounded-2xl px-3 py-2 shadow-sm';
  const messageId = `${message.timestamp}-${message.actor}`;
  const isPinned = pinnedMessageIds?.has(messageId);

  const getAvatarBackground = () => {
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
    const ic = 'h-3.5 w-3.5 text-white';
    if (currentPhase === 'planner') return <FaChessKing className={ic} />;
    if (currentPhase === 'processing') return <FaCog className={`${ic} phase-spin`} />;
    if (currentPhase === 'refiner') return <FaMagic className={ic} />;
    if (currentPhase === 'workers') {
      const count = Math.max(1, Math.min(6, activeWorkers ?? totalWorkers ?? 1));
      return showMultiAvatar ? <span className="inline-flex items-center gap-0.5">{Array.from({ length: count }).map((_, i) => <FaRobot key={i} className={`${ic} phase-bob`} />)}</span> : <FaRobot className={`${ic} phase-bob`} />;
    }
    if (isEstimatorActive) return <FiClock className={ic} />;
    // Actor-specific icons (including during progress/aggregate states)
    if (message.actor === Actors.CHAT) return <FaBrain className={ic} />;
    if (message.actor === Actors.SEARCH) return <FaSearch className={ic} />;
    if (message.actor === Actors.AUTO) return <FaRandom className={ic} />;
    if (message.actor === Actors.MULTIAGENT) return <FaChessKing className={ic} />;
    // Fallback for other agent types during progress/aggregate
    if (isProgress || (isAgentAggregate && !isEstimator)) return <FaRobot className={ic} />;
    if (actor?.icon) return <img src={actor.icon} alt={actor.name} className="h-3.5 w-3.5 opacity-100 drop-shadow invert" />;
    return null;
  };

  const LinkComponent = ({ node, ...props }: any) => <a {...props} className={`underline ${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`} target="_blank" rel="noopener noreferrer" />;
  const transformWorkerLabel = (text: string) => text.replace(/\bWorker\s*w(\d+)\b/gi, 'Web Agent $1');
  const controlBtnClass = `rounded px-3 py-1.5 text-sm font-medium ${isDarkMode ? 'bg-amber-600 text-white hover:bg-amber-500' : 'bg-amber-500 text-white hover:bg-amber-600'}`;

  return (
    <div className={`group flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`${bubbleClass} ${actorTint} liquid-bubble`} style={dynamicStyles}>
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div className={`flex h-5 ${showMultiAvatar ? 'min-w-[30px] px-1' : 'w-5'} items-center justify-center rounded-full shadow-sm`} style={{ backgroundColor: getAvatarBackground() }}>{getAvatarIcon()}</div>
            {isPinned && <span className={`ml-1 text-[10px] ${isDarkMode ? 'text-amber-300' : 'text-amber-600'}`}>📌</span>}
            {(isProgress || isAgentAggregate) && lastTrace?.actor && ['agent_navigator', 'agent_planner', 'agent_validator', 'planner', 'refiner'].includes(lastTrace.actor) && (() => {
              const role = ACTOR_PROFILES[lastTrace.actor as keyof typeof ACTOR_PROFILES];
              return role?.icon ? <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: isDarkMode ? '#f59e0b' : '#fbbf24' }}><img src={role.icon} alt="" className="h-3.5 w-3.5 opacity-100 invert" /></span> : null;
            })()}
          </div>
          {isAgentAggregate && isAgentWorking && <span className={`ml-2 inline-block h-3 w-3 rounded-full border-2 border-t-transparent animate-spin ${isDarkMode ? 'border-slate-400' : 'border-gray-500'}`} />}
          <div className="flex items-center gap-1">
            {isAgentAggregate && (
              <button type="button" onClick={() => setCollapsed(!collapsed)} className={`opacity-60 hover:opacity-100 rounded px-1.5 py-0.5 text-xs font-medium transition-all ${isDarkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}>
                <span className="flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points={collapsed ? '6,9 12,15 18,9' : '18,15 12,9 6,15'} /></svg>{collapsed ? 'Details' : 'Hide'}</span>
              </button>
            )}
            <div className="relative">
              <button type="button" title="Copy" onClick={() => { navigator.clipboard.writeText(content).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className={`opacity-0 group-hover:opacity-100 rounded p-1 ${isDarkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-gray-600 hover:bg-gray-100'}`}><FiCopy size={14} /></button>
              {copied && <div className={`absolute right-0 bottom-full mb-1 rounded px-1.5 py-0.5 text-[10px] shadow ${isDarkMode ? 'bg-slate-800 text-slate-200 border border-slate-600/50' : 'bg-white text-gray-700 border border-gray-200'}`}>Copied</div>}
            </div>
          </div>
        </div>

        <div className={`whitespace-pre-wrap break-words ${compactMode ? 'text-[13px] leading-[1.35]' : 'text-sm'} ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          {isProgress ? <div className={`h-1 overflow-hidden rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}><div className="animate-progress h-full bg-violet-400" /></div>
           : isEstimatorActive ? <div className={`h-1 overflow-hidden rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}><div className="animate-progress h-full bg-amber-400" /></div>
           : currentPhase ? <div><div className="mb-1">{content}</div><div className={`h-1 overflow-hidden rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}><div className={`animate-progress h-full ${currentPhase === 'planner' || currentPhase === 'refiner' ? 'bg-orange-400' : currentPhase === 'processing' ? 'bg-sky-400' : 'bg-amber-400'}`} /></div></div>
           : <>
            {(!isAgentAggregate || !collapsed) && <Suspense fallback={<div className={`${isDarkMode ? 'bg-slate-800/60' : 'bg-gray-100/70'} h-16 w-full animate-pulse rounded`} />}><MarkdownRenderer components={{ a: LinkComponent, code: ({ className, children }: any) => <CodeBlock isDarkMode={isDarkMode} className={className}>{String(children)}</CodeBlock> }}>{content}</MarkdownRenderer></Suspense>}
            {isAgentAggregate && collapsed && <div>{lastTrace?.content || content}</div>}
            {isEstimator && metadata?.estimation && metadata?.workflowStartTime && !metadata?.isCompleted && <ProgressBar estimation={metadata.estimation} startTime={metadata.workflowStartTime} isCompleted={!!metadata.isCompleted} isDarkMode={isDarkMode} />}
            {isEstimator && pendingEstimation && onApproveEstimation && onCancelEstimation && !metadata?.workflowStartTime && !metadata?.isCompleted && <Suspense fallback={<div className="animate-pulse h-32 bg-slate-700/20 rounded" />}><EstimationPopUp estimation={pendingEstimation} isDarkMode={isDarkMode} availableModels={availableModelsForEstimation || []} onApprove={onApproveEstimation} onCancel={onCancelEstimation} /></Suspense>}
            {!isAgentAggregate && metadata?.controlRequest?.type === 'request_user_control' && typeof metadata.controlRequest.tabId === 'number' && onTakeControl && <div className="mt-2"><button type="button" className={controlBtnClass} onClick={() => onTakeControl(metadata.controlRequest!.tabId)}>Take Control</button></div>}
            {isAgentAggregate && !collapsed && workerItems?.length && (
              <div className="mt-2 rounded-md border p-2 text-xs" style={agentColorHex ? { borderColor: agentColorHex } : undefined}>
                <div className={`mb-1 font-medium ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>Web Agents</div>
                <div className="space-y-1">
                  {workerItems.slice().sort((a, b) => a.workerId.localeCompare(b.workerId)).map((worker) => {
                    const num = worker.workerId.replace(/\D/g, '') || '';
                    return (
                      <div key={worker.workerId} className="flex items-start gap-2">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]" style={{ backgroundColor: worker.color || agentColorHex || (isDarkMode ? '#334155' : '#f1f5f9'), color: '#fff' }}>{num || '•'}</span>
                        <div className="min-w-0">
                          <div className={`${isDarkMode ? 'text-slate-200' : 'text-gray-800'} truncate`} style={{ color: worker.color || undefined }}>{worker.text || (num ? `Web Agent ${num}` : worker.agentName || worker.workerId) || 'Working...'}</div>
                          <div className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>{formatTimestamp(worker.timestamp)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {isAgentAggregate && !collapsed && traceItems.length > 0 && (
              <div className="mt-2 group"><div className="space-y-1">
                {traceItems.map((trace, index) => {
                  const opacity = Math.max(0.45, 1 - (traceItems.length - 1 - index) * 0.12);
                  const controlRequest = trace.controlRequest;
                  const text = transformWorkerLabel(trace.content);
                  return (
                    <div key={index} className="text-sm flex items-start gap-2 transition-opacity group-hover:opacity-100" style={{ opacity }}>
                      <span className={`mt-[6px] h-1.5 w-1.5 rounded-full ${isDarkMode ? 'bg-amber-400' : 'bg-amber-500'}`} />
                      <div className="min-w-0 flex-1">
                        <div className={`flex items-center gap-2 ${isDarkMode ? 'text-slate-200' : 'text-gray-900'}`}><span className="font-medium truncate max-w-[50%]">{trace.actor}</span><span className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>{formatTimestamp(trace.timestamp)}</span></div>
                        <div className="whitespace-pre-wrap break-words leading-5">
                          {controlRequest?.type === 'request_user_control' ? (
                            <div className="space-y-2"><Suspense fallback={<span>{text}</span>}><MarkdownRenderer components={{ a: LinkComponent }}>{text}</MarkdownRenderer></Suspense>{typeof controlRequest.tabId === 'number' && onTakeControl && <button type="button" className={controlBtnClass} onClick={() => onTakeControl(controlRequest.tabId)}>Take Control</button>}</div>
                          ) : <Suspense fallback={<span>{text}</span>}><MarkdownRenderer components={{ a: LinkComponent }}>{text}</MarkdownRenderer></Suspense>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div></div>
            )}
            {!isUser && jobSummary && (
              <div ref={tooltipTriggerRef} className="inline-block relative ml-2" onMouseEnter={() => {
                if (tooltipTriggerRef.current) {
                  const rect = tooltipTriggerRef.current.getBoundingClientRect();
                  // Find closest scrollable parent to get actual container bounds
                  let parent = tooltipTriggerRef.current.parentElement;
                  let containerBottom = window.innerHeight;
                  while (parent) {
                    const style = getComputedStyle(parent);
                    if (style.overflow === 'auto' || style.overflow === 'scroll' || style.overflowY === 'auto' || style.overflowY === 'scroll') {
                      containerBottom = parent.getBoundingClientRect().bottom;
                      break;
                    }
                    parent = parent.parentElement;
                  }
                  setTooltipPosition(containerBottom - rect.bottom < 220 ? 'above' : 'below');
                }
                setShowTooltip(true);
              }} onMouseLeave={() => setShowTooltip(false)}>
                <button type="button" className={`inline-flex items-center gap-1 px-2 py-1 rounded-full cursor-default text-xs font-medium ${isDarkMode ? 'bg-slate-800/80 text-slate-300 border border-slate-600/50' : 'bg-gray-100/80 text-gray-600 border border-gray-200/50'}`}><span className="text-[10px]">💰</span><span>{formatUsd(jobSummary.cost)}</span><FiClock size={12} /><span>{jobSummary.latency}s</span></button>
                {showTooltip && (
                  <div className={`absolute left-0 rounded-lg text-[11px] z-[1000] shadow-lg backdrop-blur-sm min-w-[180px] max-w-[280px] ${isDarkMode ? 'bg-slate-800/98 text-slate-200 border border-slate-600/50' : 'bg-white/98 text-gray-700 border border-gray-200/70'} ${tooltipPosition === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
                    {tooltipPosition === 'above' ? <div className={`absolute top-full left-4 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent ${isDarkMode ? 'border-t-slate-800/98' : 'border-t-white/98'}`} /> : <div className={`absolute bottom-full left-4 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-transparent ${isDarkMode ? 'border-b-slate-800/98' : 'border-b-white/98'}`} />}
                    <div className="px-3 py-2 space-y-1.5">
                      {jobSummary.modelName && <div className="flex justify-between gap-3 pb-1 border-b border-gray-200/30"><span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Model:</span><span className="font-medium text-right">{jobSummary.provider || 'Unknown'} ({jobSummary.modelName})</span></div>}
                      <div className="flex justify-between gap-3"><span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Input:</span><span className="font-medium">{jobSummary.inputTokens.toLocaleString()}</span></div>
                      <div className="flex justify-between gap-3"><span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Output:</span><span className="font-medium">{jobSummary.outputTokens.toLocaleString()}</span></div>
                      <div className="flex justify-between gap-3"><span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Latency:</span><span className="font-medium">{jobSummary.latency}s</span></div>
                      <div className="flex justify-between gap-3"><span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Cost Est:</span><span className="font-medium">{formatUsd(jobSummary.cost)}</span></div>
                      <div className="flex justify-between gap-3"><span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>API Calls:</span><span className="font-medium">{jobSummary.apiCalls}</span></div>
                      <div className={`text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                        Costs estimated without prompt caching
                        {pricingCacheStatus?.isUsingCache && pricingCacheStatus.cacheDate && (
                          <span> | Using pricing data from {new Date(pricingCacheStatus.cacheDate).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {!isUser && (() => {
              try {
                const obj = content.startsWith('{') ? JSON.parse(content) : null;
                if (obj?.type === 'job_summary') return (
                  <div className={`mt-2 inline-flex items-center gap-2 rounded-full px-2 py-1 text-[11px] ${isDarkMode ? 'bg-slate-800/80 text-slate-300 border border-slate-700/60' : 'bg-gray-100/80 text-gray-700 border border-gray-300/60'}`}>
                    <span>💰</span>
                    <span>{(obj.totalTokens || (obj.inputTokens + obj.outputTokens)).toLocaleString()} tokens</span>
                    <FiClock size={12} />
                    <span>{obj.totalLatencySec}s</span>
                  </div>
                );
              } catch {}
              return null;
            })()}
          </>}
        </div>
        {!isProgress && <div className={`mt-1 ${compactMode ? 'text-[9px]' : 'text-[10px]'} ${isDarkMode ? 'text-gray-500' : 'text-gray-400'} ${isUser ? 'text-right' : 'text-left'}`}>{formatTimestamp(displayTimestamp)}</div>}
        {!isProgress && onRetryRequest && message.actor === 'validator' && (
          <div className={`mt-2 flex flex-wrap gap-2 ${isUser ? 'justify-end' : 'justify-start'} opacity-0 group-hover:opacity-100 transition-opacity`}>
            {['chat', 'search', 'agent'].map((type) => <button key={type} type="button" onClick={() => onRetryRequest(content, type as any)} className={`rounded-full px-2 py-0.5 text-xs ${isDarkMode ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Retry with {type.charAt(0).toUpperCase() + type.slice(1)}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}
