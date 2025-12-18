/**
 * EstimationPopUp Component
 * 
 * Displays workflow estimation with cost and time breakdown,
 * allowing the user to select different models and see updated estimates,
 * then approve or cancel the workflow.
 */

import { useState, useEffect } from 'react';
import { FaDollarSign, FaChevronDown, FaChevronUp, FaUser, FaRobot, FaExchangeAlt } from 'react-icons/fa';
import { formatDuration } from '../../utils';

export interface WorkflowStep {
  title: string;
  web_agent_duration_s: number;
  human_duration_s: number;
  num_tokens: number;
}

export interface WorkflowSummary {
  total_agent_duration_s: number;
  total_human_duration_s: number;
  total_tokens: number;
  estimated_cost_usd: number;
  model_name: string;
  provider: string;
  estimation_cost_usd: number;
}

export interface WorkflowEstimation {
  steps: WorkflowStep[];
  summary: WorkflowSummary;
}

export interface AvailableModel {
  provider: string;
  providerName: string;
  model: string;
}

interface EstimationPopUpProps {
  estimation: WorkflowEstimation;
  isDarkMode: boolean;
  availableModels?: AvailableModel[];
  onApprove: (selectedModel?: string, updatedEstimation?: WorkflowEstimation) => void;
  onCancel: () => void;
}

/**
 * Format cost in USD to human-readable string
 * Handles null/NaN/negative values - shows "—" when pricing unavailable
 */
function formatCost(costUsd: number | null | undefined): string {
  // Handle null/undefined/NaN/negative - negative sentinel means no pricing available
  if (costUsd == null || isNaN(costUsd) || costUsd < 0) {
    return '—'; // Em dash indicates unavailable
  }
  if (costUsd < 0.001) {
    return '<$0.001';
  }
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(3)}`;
  }
  return `$${costUsd.toFixed(2)}`;
}

/**
 * Calculate cost for a given number of tokens using the cost calculator
 */
async function calculateTokenCost(totalTokens: number, modelName: string): Promise<number> {
  try {
    // Heuristic: 75% input, 25% output
    const inputTokens = Math.round(totalTokens * 0.75);
    const outputTokens = Math.round(totalTokens * 0.25);
    
    // Call background script to calculate cost
    const response = await chrome.runtime.sendMessage({
      type: 'calculate_cost',
      modelName,
      inputTokens,
      outputTokens
    });
    
    return response?.cost || 0;
  } catch (e) {
    console.warn('Failed to calculate cost:', e);
    return 0;
  }
}

/**
 * Get model latency (TTFA) from the latency calculator
 */
async function getModelLatency(modelName: string): Promise<number | null> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'get_model_latency',
      modelName
    });
    
    return response?.timeToFirstAnswerToken || null;
  } catch (e) {
    console.warn('Failed to get model latency:', e);
    return null;
  }
}

export default function EstimationPopUp({
  estimation,
  isDarkMode,
  availableModels = [],
  onApprove,
  onCancel,
}: EstimationPopUpProps) {
  const [showDetails, setShowDetails] = useState(false);
  // Safely access summary fields - handle cases where summary might be null/undefined
  const [selectedModel, setSelectedModel] = useState<string>(estimation?.summary?.model_name || '');
  const [recalculatedEstimation, setRecalculatedEstimation] = useState<WorkflowEstimation>(estimation);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [baseEstimation, setBaseEstimation] = useState<WorkflowEstimation | null>(null);
  const [pricingCacheStatus, setPricingCacheStatus] = useState<{ isUsingCache: boolean; cacheDate: string | null } | null>(null);

  // Fetch pricing cache status
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'get_pricing_cache_status' })
      .then((res: any) => { if (res?.ok) setPricingCacheStatus({ isUsingCache: res.isUsingCache, cacheDate: res.cacheDate }); })
      .catch(() => {});
  }, []);
  
  // Initialize: Add latency to the original estimation on first load
  useEffect(() => {
    async function addInitialLatency() {
      setIsRecalculating(true);
      try {
        // Get latency for the initial model
        const initialLatency = await getModelLatency(estimation.summary.model_name);
        
        // Store base estimation (without latency)
        setBaseEstimation(estimation);
        
        // Add latency to create the display version
        if (initialLatency !== null) {
          const stepsWithLatency = estimation.steps.map(step => ({
            ...step,
            web_agent_duration_s: step.web_agent_duration_s + initialLatency
          }));
          
          const total_agent_duration_s = stepsWithLatency.reduce((sum, step) => sum + step.web_agent_duration_s, 0);
          
          const estimationWithLatency: WorkflowEstimation = {
            steps: stepsWithLatency,
            summary: {
              ...estimation.summary,
              total_agent_duration_s
            }
          };
          
          setRecalculatedEstimation(estimationWithLatency);
        } else {
          // No latency data, use as-is
          setRecalculatedEstimation(estimation);
        }
      } catch (e) {
        console.error('Failed to add initial latency:', e);
        setRecalculatedEstimation(estimation);
      } finally {
        setIsRecalculating(false);
      }
    }
    
    addInitialLatency();
  }, [estimation]);
  
  // Recalculate estimation when model changes
  useEffect(() => {
    if (!baseEstimation || selectedModel === estimation.summary.model_name) {
      return;
    }
    
    async function recalculate() {
      if (!baseEstimation) return; // Safety check
      
      setIsRecalculating(true);
      
      try {
        // Get latency for the new model
        const newLatency = await getModelLatency(selectedModel);
        
        // Start from base estimation (without any latency added)
        const newSteps = baseEstimation.steps.map(step => {
          let adjustedDuration = step.web_agent_duration_s;
          
          // Add new model's latency
          if (newLatency !== null) {
            adjustedDuration += newLatency;
          }
          
          return {
            ...step,
            web_agent_duration_s: Math.max(1, adjustedDuration) // Ensure positive
          };
        });
        
        // Recalculate costs with new model
        const totalTokens = baseEstimation.steps.reduce((sum, step) => sum + step.num_tokens, 0);
        const newCost = await calculateTokenCost(totalTokens, selectedModel);
        
        // Calculate new totals
        const total_agent_duration_s = newSteps.reduce((sum, step) => sum + step.web_agent_duration_s, 0);
        const total_human_duration_s = newSteps.reduce((sum, step) => sum + step.human_duration_s, 0);
        
        const newEstimation: WorkflowEstimation = {
          steps: newSteps,
          summary: {
            ...baseEstimation.summary,
            model_name: selectedModel,
            total_agent_duration_s,
            total_human_duration_s,
            total_tokens: totalTokens,
            estimated_cost_usd: newCost
          }
        };
        
        setRecalculatedEstimation(newEstimation);
      } catch (e) {
        console.error('Failed to recalculate estimation:', e);
        // Fallback to base estimation
        setRecalculatedEstimation(baseEstimation);
      } finally {
        setIsRecalculating(false);
      }
    }
    
    recalculate();
  }, [selectedModel, baseEstimation]);
  
  // Safely destructure with defaults to handle malformed data
  const steps = recalculatedEstimation?.steps || [];
  const summary = recalculatedEstimation?.summary || {
    total_agent_duration_s: 0,
    total_human_duration_s: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    model_name: '',
    provider: '',
    estimation_cost_usd: 0,
  };
  
  return (
    <div className={`mx-auto my-2 p-2 rounded-lg border ${
      isDarkMode 
        ? 'bg-slate-800 border-violet-600' 
        : 'bg-white border-violet-400'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <FaRobot className={`w-3 h-3 ${isDarkMode ? 'text-violet-400' : 'text-violet-600'}`} />
        <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          Workflow Estimation
        </h3>
        {isRecalculating && (
          <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            (updating...)
          </span>
        )}
      </div>
      
      {/* Model Selector */}
      {availableModels.length > 0 && (
        <div className={`mb-2 p-1.5 rounded ${
          isDarkMode ? 'bg-slate-700' : 'bg-gray-50'
        }`}>
          <div className="flex items-center gap-1.5">
            <FaExchangeAlt className={`w-2.5 h-2.5 flex-shrink-0 ${
              isDarkMode ? 'text-violet-400' : 'text-violet-600'
            }`} />
            <label className={`text-[10px] font-medium flex-shrink-0 ${
              isDarkMode ? 'text-gray-300' : 'text-gray-600'
            }`}>
              Model:
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isRecalculating}
              className={`flex-1 text-[11px] px-1.5 py-0.5 rounded border ${
                isDarkMode
                  ? 'bg-slate-600 border-slate-500 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
              } ${isRecalculating ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {availableModels.map(({ provider, providerName, model }) => (
                <option key={`${provider}>${model}`} value={model}>
                  {providerName} - {model}
                </option>
              ))}
            </select>
          </div>
          {selectedModel !== estimation.summary.model_name && (
            <div className={`mt-1 text-[9px] ${
              isDarkMode ? 'text-amber-300' : 'text-amber-700'
            }`}>
              ℹ️ Estimates updated for selected model
            </div>
          )}
        </div>
      )}
      
      {/* Summary Cards - Compact Single Row */}
      <div className="flex gap-1.5 mb-2">
        {/* Agent Time */}
        <div className={`flex-1 p-1.5 rounded ${
          isDarkMode ? 'bg-slate-700' : 'bg-gray-50'
        }`}>
          <div className="flex items-center gap-0.5 mb-0.5">
            <FaRobot className={`w-2.5 h-2.5 ${isDarkMode ? 'text-violet-400' : 'text-violet-600'}`} />
            <span className={`text-[9px] font-medium ${
              isDarkMode ? 'text-gray-300' : 'text-gray-600'
            }`}>Agent</span>
          </div>
          <div className={`text-base font-bold ${
            isDarkMode ? 'text-violet-300' : 'text-violet-700'
          }`}>
            {formatDuration(summary.total_agent_duration_s)}
          </div>
        </div>
        
        {/* Human Time */}
        <div className={`flex-1 p-1.5 rounded ${
          isDarkMode ? 'bg-slate-700' : 'bg-gray-50'
        }`}>
          <div className="flex items-center gap-0.5 mb-0.5">
            <FaUser className={`w-2.5 h-2.5 ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
            <span className={`text-[9px] font-medium ${
              isDarkMode ? 'text-gray-300' : 'text-gray-600'
            }`}>Human</span>
          </div>
          <div className={`text-base font-bold ${
            isDarkMode ? 'text-blue-300' : 'text-blue-700'
          }`}>
            {formatDuration(summary.total_human_duration_s)}
          </div>
        </div>
        
        {/* Cost */}
        <div className={`flex-1 p-1.5 rounded ${
          isDarkMode ? 'bg-slate-700' : 'bg-gray-50'
        }`}>
          <div className="flex items-center gap-0.5 mb-0.5">
            <FaDollarSign className={`w-2.5 h-2.5 ${isDarkMode ? 'text-green-400' : 'text-green-600'}`} />
            <span className={`text-[9px] font-medium ${
              isDarkMode ? 'text-gray-300' : 'text-gray-600'
            }`}>Cost</span>
          </div>
          <div className={`text-base font-bold ${
            isDarkMode ? 'text-green-300' : 'text-green-700'
          }`}>
            {formatCost(summary.estimated_cost_usd)}
          </div>
        </div>
      </div>
      
      {/* Model Info */}
      <div className={`text-[10px] mb-2 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        ~{summary.total_tokens.toLocaleString()} tokens · {summary.model_name}
        {summary.estimation_cost_usd > 0.001 && (
          <span className="ml-1">
          </span>
        )}
      </div>
      
      {/* Steps Detail (Collapsible) */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className={`w-full flex items-center justify-between p-1 rounded mb-1.5 ${
          isDarkMode 
            ? 'bg-slate-700 hover:bg-slate-600 text-white' 
            : 'bg-gray-50 hover:bg-gray-100 text-gray-900'
        } transition-colors`}
      >
        <span className="text-[11px] font-medium">
          {steps.length} Steps
        </span>
        {showDetails ? (
          <FaChevronUp className="w-2.5 h-2.5" />
        ) : (
          <FaChevronDown className="w-2.5 h-2.5" />
        )}
      </button>
      
      {showDetails && (
        <div className={`mb-1.5 p-1.5 rounded ${
          isDarkMode ? 'bg-slate-700' : 'bg-gray-50'
        }`}>
          <div className="space-y-1">
            {steps.map((step, index) => (
              <div
                key={index}
                className={`p-1 rounded ${
                  isDarkMode ? 'bg-slate-600' : 'bg-white'
                }`}
              >
                <div className={`text-[11px] font-medium mb-0.5 ${
                  isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>
                  {index + 1}. {step.title}
                </div>
                <div className="flex items-center gap-1.5 text-[9px]">
                  <span className={`flex items-center gap-0.5 ${
                    isDarkMode ? 'text-violet-300' : 'text-violet-600'
                  }`}>
                    <FaRobot className="w-2 h-2" />
                    {formatDuration(step.web_agent_duration_s)}
                  </span>
                  <span className={`flex items-center gap-0.5 ${
                    isDarkMode ? 'text-blue-300' : 'text-blue-600'
                  }`}>
                    <FaUser className="w-2 h-2" />
                    {formatDuration(step.human_duration_s)}
                  </span>
                  <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>
                    ~{step.num_tokens.toLocaleString()} tokens
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Disclaimer - More compact */}
      <div className={`text-[9px] mb-1.5 p-1 rounded ${
        isDarkMode ? 'bg-slate-700 text-gray-300' : 'bg-gray-50 text-gray-600'
      }`}>
        <strong>Note:</strong> Estimates are approximate
        {pricingCacheStatus?.isUsingCache && pricingCacheStatus.cacheDate && (
          <span className="ml-1">
            | Using pricing data from {new Date(pricingCacheStatus.cacheDate).toLocaleDateString()}
          </span>
        )}
      </div>
      
      {/* Action Buttons - More compact */}
      <div className="flex gap-1.5">
        <button
          onClick={() => {
            const modelChanged = selectedModel !== estimation.summary.model_name;
            // Always pass recalculatedEstimation since it includes latency adjustments
            onApprove(modelChanged ? selectedModel : undefined, recalculatedEstimation);
          }}
          disabled={isRecalculating}
          className={`flex-1 py-1.5 px-2.5 rounded text-sm font-semibold transition-colors ${
            isRecalculating
              ? 'opacity-50 cursor-not-allowed bg-gray-400'
              : isDarkMode
              ? 'bg-violet-600 hover:bg-violet-700 text-white'
              : 'bg-violet-500 hover:bg-violet-600 text-white'
          }`}
        >
          Start Task
          {selectedModel !== estimation.summary.model_name && ` with ${selectedModel}`}
        </button>
        <button
          onClick={onCancel}
          className={`py-1.5 px-2.5 rounded text-sm font-medium transition-colors ${
            isDarkMode
              ? 'bg-slate-700 hover:bg-slate-600 text-gray-300'
              : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
          }`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}


