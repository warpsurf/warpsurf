import baseConfig from '@extension/tailwindcss-config';
import { withUI } from '@extension/ui';

export default withUI({
  ...baseConfig,
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    // Scan panel chat components for Tailwind classes (shared via @panel alias)
    '../panel/src/components/chat-interface/**/*.{ts,tsx}',
    '../panel/src/components/multiagent-visualization/**/*.{ts,tsx}',
  ],
});
