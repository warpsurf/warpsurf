# Warpsurf Privacy Policy

This policy explains how data is handled by warpsurf.

## Code

The entire warpsurf codebase is publicly available in this [GitHub repository](https://github.com/warpsurf/warpsurf), released under an Apache 2.0 License. Warpsurf is developed as an open source community project to develop browser copilots, grow the browser automation ecosystem and find bugs and interesting use cases. To facilitate contributions and maximise transparency, code for the extension can be downloaded via this repository (or through the chrome store).

## Data Collection

- **Local by default**: Warpsurf operates entirely within your Chrome browser. All user data (chat history, settings, API keys) is stored locally using Chrome's storage API.
- **No user analytics**: Warpsurf does not collect analytics, telemetry, or usage data. Data is never sold or shared with advertisers.
- **No external servers**: Warpsurf does not operate any backend servers. There is no warpsurf server that receives your data.
- Sessions run locally and your login credentials and cookies don't leave the browser

### LLM Provider Interactions

When using warpsurf workflows, the extension sends requests directly to your selected LLM provider (e.g., OpenAI, Anthropic, Google, xAI, OpenRouter), including:
- **Text content**: The task/query you provide 
- **Chat context**: Previous messages in your current session
  
Additionally, for agent and multi-agent workflows, this also includes:
- **Webpage content**: Webpage element data (interactive elements, text content)
- **Screenshots** (if vision is enabled (disabled by default)): JPEG images of the current browser tab

Your data privacy with LLM providers is subject to their respective privacy policies. Warpsurf does not store, process, or transmit your data to any other destination.

## Browser History (disabled by default)

The warpsurf browser history feature is disabled by default. If you enable the "History Context" feature, warpsurf accesses your recent browsing history (via Chrome's History API) to provide context to the agents. This data:
- Is processed locally within your browser
- Is only sent to your selected LLM provider when this feature is enabled
- Is not collected, stored, or transmitted by warpsurf to any other party

## External Services (disabled by default)

For model pricing and availability information, when enabled, warpsurf contacts:
- Helicone API (helicone.ai) - for pricing data
- OpenRouter API (openrouter.ai) - for model listings

These requests do not include any user data. This feature is disabled by default; cached pricing data is used instead.

## API Keys
- You provide your own API keys for LLM providers
- Keys are stored locally in your browser only
- Keys are never transmitted except directly to the respective LLM provider
- You are responsible for key security per your provider's terms

## User Control
- Clear conversation history anytime
- Remove API keys from settings
- Disable browser history context
- Disable agent/multi-agent workflow screenshots
- Disable live data (pricing and model availability) updates
- Uninstall the extension to remove all local data


## Changes to This Privacy Policy

We may update this policy to reflect changes in the extension's functionality or to comply with regulations. Please review it regularly for changes. For significant changes, we will:
- Update this document with a new "Last Updated" date
- Note material changes in the GitHub repository release notes

We reserve the right to collect anonymized, aggregated data in the future to improve the extension. If we implement such collection, we will update this policy beforehand.

## Contact
Questions or concerns? Please raise an issue in this repository or contact us at warpsurfai@gmail.com.

Last Updated: December 28, 2025
