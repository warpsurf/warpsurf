# API Key Encryption

Secure storage for LLM provider API keys.

## Usage

### UI Contexts (Settings, Panel, Dashboard)

```typescript
import { secureProviderClient } from '@extension/storage';

// Get all providers
const providers = await secureProviderClient.getAllProviders();

// Save a provider
await secureProviderClient.setProvider('openai', {
  apiKey: 'sk-abc123...',
  name: 'OpenAI',
  modelNames: ['gpt-4', 'gpt-4o'],
});

// Get a single provider
const openai = await secureProviderClient.getProvider('openai');

// Remove a provider
await secureProviderClient.removeProvider('openai');

// Check if provider exists
const exists = await secureProviderClient.hasProvider('openai');
```

### Background Service Worker

```typescript
import { getAllProvidersDecrypted, getProviderApiKey } from './crypto';

const providers = await getAllProvidersDecrypted();
const apiKey = providers['openai']?.apiKey;

// Or get just the API key
const key = await getProviderApiKey('openai');
```

## File Structure

```
packages/storage/lib/crypto/
├── types.ts
├── encrypt.ts
├── client.ts
├── index.ts
└── README.md

apps/background/src/crypto/
├── service.ts
├── handlers.ts
└── index.ts
```
