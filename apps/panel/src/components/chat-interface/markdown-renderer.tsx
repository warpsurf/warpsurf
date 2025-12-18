import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  children: string;
  // biome-ignore lint/suspicious/noExplicitAny: react-markdown component typings
  components?: any;
  isDarkMode?: boolean;
}

export default function MarkdownRenderer({ children, components }: MarkdownRendererProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  );
}


