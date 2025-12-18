import { HumanMessage, type SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/workflows/shared/agent-types';
import { wrapUntrustedContent } from '@src/workflows/shared/messages/utils';
import { createLogger } from '@src/log';

const logger = createLogger('BasePrompt');
/**
 * Abstract base class for all prompt types
 */
abstract class BasePrompt {
  /**
   * Returns the system message that defines the AI's role and behavior
   * @returns SystemMessage from LangChain
   */
  abstract getSystemMessage(): SystemMessage;

  /**
   * Returns the user message for the specific prompt type
   * @param context - Optional context data needed for generating the user message
   * @returns HumanMessage from LangChain
   */
  abstract getUserMessage(context: AgentContext): Promise<HumanMessage>;

  /**
   * Builds the user message containing the browser state
   * @param context - The agent context
   * @returns HumanMessage from LangChain
   */
  async buildBrowserStateUserMessage(context: AgentContext): Promise<HumanMessage> {
    // In worker mode with no bound tab, return a placeholder message
    try {
      // Prefer smart state retrieval to avoid heavy DOM scans between action batches
      const browserState = await (context.browserContext as any).getSmartState?.(context.options.useVision)
        .catch(() => context.browserContext.getState(context.options.useVision))
        || await context.browserContext.getState(context.options.useVision);
      const rawElementsText = browserState.elementTree.clickableElementsToString(context.options.includeAttributes);

      let formattedElementsText = '';
      if (rawElementsText !== '') {
        const scrollInfo = `[Scroll info of current page] window.scrollY: ${browserState.scrollY}, document.body.scrollHeight: ${browserState.scrollHeight}, window.visualViewport.height: ${browserState.visualViewportHeight}, visual viewport height as percentage of scrollable distance: ${Math.round((browserState.visualViewportHeight / (browserState.scrollHeight - browserState.visualViewportHeight)) * 100)}%\n`;
        logger.info(scrollInfo);
        const elementsText = wrapUntrustedContent(rawElementsText);
        formattedElementsText = `${scrollInfo}[Start of page]\n${elementsText}\n[End of page]\n`;
      } else {
        formattedElementsText = 'empty page';
      }

      let stepInfoDescription = '';
      if (context.stepInfo) {
        stepInfoDescription = `Current step: ${context.stepInfo.stepNumber + 1}/${context.stepInfo.maxSteps}`;
      }

      const timeStr = new Date().toISOString().slice(0, 16).replace('T', ' '); // Format: YYYY-MM-DD HH:mm
      stepInfoDescription += `Current date and time: ${timeStr}`;

      let actionResultsDescription = '';
      let extractionContent = '';  // Separate handling for extraction results (full content, temporary)
      
      if (context.actionResults.length > 0) {
        // Keep only last 3 unique action result texts (to cap prompt bloat)
        const uniques: string[] = [];
        const extractions: string[] = [];
        const maxKeep = 3;
        for (let i = context.actionResults.length - 1; i >= 0 && uniques.length < maxKeep; i--) {
          const result = context.actionResults[i];
          if (result.extractedContent) {
            const text = String(result.extractedContent);
            
            // Separate extraction results (show full, temporary) from other results (truncate, persist)
            if (text.includes('Extraction completed successfully')) {
              if (extractions.length === 0) {  // Keep only most recent extraction
                extractions.push(text);
              }
            } else {
              // Non-extraction results (clicks, navigation, cache_content, etc.)
              if (!uniques.includes(text)) {
                uniques.push(text);
              }
            }
          }
          if (result.error) {
            const error = result.error.split('\n').pop() || '';
            const tag = `Error: ${error}`;
            if (!uniques.includes(tag) && uniques.length < maxKeep) {
              uniques.push(tag);
            }
          }
        }
        
        // Format non-extraction action results (truncated to 1,000 chars)
        const trimmed = uniques.reverse().map((text, idx) => {
          const t = text.length > 1000 ? (text.slice(0, 1000) + '…[truncated]') : text;
          return `Action ${idx + 1}/${uniques.length}: ${t}`;
        });
        if (trimmed.length > 0) actionResultsDescription = '\n' + trimmed.join('\n');
        
        // Add extraction content FULL (no truncation) - agent needs complete content to process
        if (extractions.length > 0) {
          extractionContent = '\n\n' + extractions[0];
        }
      }

      const currentTab = `{id: ${browserState.tabId}, url: ${browserState.url}, title: ${browserState.title}}`;
      const otherTabs = (browserState.tabs as Array<{ id: number; url: string; title: string }> | undefined)
        ?.filter((tab: { id: number }) => tab.id !== browserState.tabId)
        ?.map((tab: { id: number; url: string; title: string }) => `- {id: ${tab.id}, url: ${tab.url}, title: ${tab.title}}`) || [];
      const stateDescription = `
[Task history memory ends]
[Current state starts here]
The following is one-time information - if you need to remember it write it to memory:
Current tab: ${currentTab}
Other available tabs:
  ${otherTabs.join('\n')}
Interactive elements from top layer of the current page inside the viewport:
${formattedElementsText}
${stepInfoDescription}
${actionResultsDescription}
${extractionContent}
`;

      if (browserState.screenshot && context.options.useVision) {
        return new HumanMessage({
          content: [
            { type: 'text', text: stateDescription },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${browserState.screenshot}` },
            },
          ],
        });
      }

      return new HumanMessage(stateDescription);
    } catch (error) {
      // Worker mode with no bound tab yet or attach failure - return a minimal state message so agent can proceed and open a new tab
      const msg = error instanceof Error ? String(error.message || '') : String(error);
      const attachFailure =
        msg.includes('No worker tab bound yet') ||
        msg.includes('Puppeteer is not connected') ||
        msg.includes('Puppeteer page is not connected') ||
        msg.includes('Another debugger is already attached') ||
        msg.includes('Current page is no longer accessible');
      if (attachFailure) {
        let stepInfoDescription = '';
        if (context.stepInfo) {
          stepInfoDescription = `Current step: ${context.stepInfo.stepNumber + 1}/${context.stepInfo.maxSteps}`;
        }
        const timeStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
        stepInfoDescription += `Current date and time: ${timeStr}`;

        const stateDescription = `
[Task history memory ends]
[Current state starts here]
No usable worker tab is currently bound (attach failed or in use). Use go_to_url, open_tab, or search_google to navigate to a page first.
${stepInfoDescription}
`;
        return new HumanMessage(stateDescription);
      }
      // Re-throw other errors
      throw error;
    }
  }
}

export { BasePrompt };

