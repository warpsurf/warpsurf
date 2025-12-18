import { useState } from 'react';

interface CodeBlockProps {
  children: string;
  isDarkMode: boolean;
  className?: string;
}

export default function CodeBlock({ children, isDarkMode, className }: CodeBlockProps) {
  const [isWrapped, setIsWrapped] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(children.split('\n').length > 200);
  const content = isCollapsed ? children.split('\n').slice(0, 200).join('\n') + '\n…' : children;
  const lineCount = children.split('\n').length;
  const btnClass = `rounded px-1 py-0.5 text-[10px] ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-gray-200 hover:bg-gray-300'}`;

  return (
    <div className={`relative rounded p-2 ${isDarkMode ? 'bg-slate-800 text-slate-200' : 'bg-gray-100 text-gray-800'}`}>
      <pre className={`${isWrapped ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'} overflow-auto text-[13px] leading-[1.35]`}>
        <code className={`${className || ''} ${isWrapped ? 'break-all' : ''}`}>{content}</code>
      </pre>
      <div className="absolute right-1 top-1 flex gap-1">
        <button type="button" className={btnClass} onClick={() => navigator.clipboard.writeText(children)}>Copy</button>
        <button type="button" className={btnClass} onClick={() => setIsWrapped(v => !v)}>{isWrapped ? 'Unwrap' : 'Wrap'}</button>
        {lineCount > 200 && (
          <button type="button" className={btnClass} onClick={() => setIsCollapsed(v => !v)}>
            {isCollapsed ? 'Expand' : 'Collapse'}
          </button>
        )}
      </div>
    </div>
  );
}
