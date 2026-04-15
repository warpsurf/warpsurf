import type { ComponentType } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  children: string;
  // biome-ignore lint/suspicious/noExplicitAny: react-markdown component typings
  components?: any;
  isDarkMode?: boolean;
}

// react-markdown's default export is typed in a way that triggers TS2786 with current @types/react JSX checks.
const Markdown = ReactMarkdown as ComponentType<
  Pick<MarkdownRendererProps, 'children' | 'components'> & { remarkPlugins?: unknown[] }
>;

export default function MarkdownRenderer({ children, components }: MarkdownRendererProps) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </Markdown>
  );
}
