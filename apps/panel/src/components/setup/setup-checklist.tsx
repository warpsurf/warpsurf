import { FaCheckCircle, FaTimesCircle, FaCogs, FaKey, FaGlobe } from 'react-icons/fa';

interface SetupChecklistProps {
  hasProviders: boolean;
  hasAgentModels: boolean;
  isDarkMode?: boolean;
  onOpenApiKeys: () => void;
  onOpenWorkflowSettings: () => void;
}

export default function SetupChecklist({ hasProviders, hasAgentModels, isDarkMode = false, onOpenApiKeys, onOpenWorkflowSettings }: SetupChecklistProps) {
  const StepIcon = ({ ok }: { ok: boolean }) => (
    ok ? <FaCheckCircle className={isDarkMode ? 'text-emerald-400' : 'text-emerald-600'} /> : <FaTimesCircle className={isDarkMode ? 'text-red-400' : 'text-red-500'} />
  );

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${isDarkMode ? 'border-slate-700 bg-slate-900/70 text-gray-200' : 'border-gray-200 bg-white/90 text-gray-800'}`}>
      <div className="mb-3 flex items-center gap-2">
        <FaCogs className={isDarkMode ? 'text-violet-300' : 'text-violet-600'} />
        <h3 className="text-sm font-semibold">Welcome! Let’s get set up</h3>
      </div>
      <ol className="space-y-2 text-sm">
        <li className="flex items-center gap-2">
          <StepIcon ok={hasProviders} />
          <span className="flex-1">Add at least one API provider</span>
          <button type="button" onClick={onOpenApiKeys} className={`rounded px-2 py-1 text-xs ${isDarkMode ? 'bg-violet-500 text-white hover:bg-violet-400' : 'bg-violet-400 text-white hover:bg-violet-500'}`}>API Keys</button>
        </li>
        <li className="flex items-center gap-2">
          <StepIcon ok={hasAgentModels} />
          <span className="flex-1">Select models for each workflow</span>
          <button type="button" onClick={onOpenWorkflowSettings} className={`rounded px-2 py-1 text-xs ${isDarkMode ? 'bg-violet-500 text-white hover:bg-violet-400' : 'bg-violet-400 text-white hover:bg-violet-500'}`}>Workflow Settings</button>
        </li>
      </ol>
      {!hasProviders && (
        <div className={`mt-3 flex items-center gap-2 rounded px-2 py-1 text-xs ${isDarkMode ? 'bg-amber-900/30 text-amber-200' : 'bg-amber-50 text-amber-700'}`}>
          <FaKey />
          <span>API keys are required to use models. Add one in Settings.</span>
        </div>
      )}
      <div className={`mt-3 flex items-center gap-2 rounded px-2 py-1 text-xs ${isDarkMode ? 'bg-sky-900/30 text-sky-200' : 'bg-sky-50 text-sky-700'}`}>
        <FaGlobe />
        <span>All URLs are enabled by default. Configure allowed/blocked sites in Web Settings.</span>
      </div>
    </div>
  );
}


