import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Helper function to capitalize first letter and convert to proper title case
function capitalizeFirstLetter(str: string): string {
  // Handle snake_case: convert to Title Case
  if (str.includes('_')) {
    return str
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  // Handle camelCase: add spaces before capital letters and capitalize
  const withSpaces = str.replace(/([a-z])([A-Z])/g, '$1 $2');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

// Post-process callback to add titles to properties
function addTitlesToProperties(jsonSchema: Record<string, unknown>): Record<string, unknown> {
  if (!jsonSchema || typeof jsonSchema !== 'object') {
    return jsonSchema;
  }

  // If this object has properties, add titles to them
  if (jsonSchema.properties && typeof jsonSchema.properties === 'object') {
    for (const [propertyName, propertySchema] of Object.entries(jsonSchema.properties)) {
      if (propertySchema && typeof propertySchema === 'object') {
        const schema = propertySchema as Record<string, unknown>;
        // Only add title if it doesn't already exist
        if (!schema.title) {
          schema.title = capitalizeFirstLetter(propertyName);
        }
        // Recursively process nested properties
        addTitlesToProperties(schema);
      }
    }
  }

  // Handle array items
  if (jsonSchema.items) {
    addTitlesToProperties(jsonSchema.items as Record<string, unknown>);
  }

  // Handle oneOf, anyOf, allOf
  if (Array.isArray(jsonSchema.oneOf)) {
    for (const schema of jsonSchema.oneOf) {
      addTitlesToProperties(schema as Record<string, unknown>);
    }
  }
  if (Array.isArray(jsonSchema.anyOf)) {
    for (const schema of jsonSchema.anyOf) {
      addTitlesToProperties(schema as Record<string, unknown>);
    }
  }
  if (Array.isArray(jsonSchema.allOf)) {
    for (const schema of jsonSchema.allOf) {
      addTitlesToProperties(schema as Record<string, unknown>);
    }
  }

  return jsonSchema;
}

export function convertZodToJsonSchema(zodSchema: z.ZodType, name: string, addTitle = false): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(zodSchema, {
    name: name,
    nameStrategy: 'title',
    target: 'openApi3',
    allowedAdditionalProperties: undefined,
    rejectedAdditionalProperties: undefined,
    postProcess: addTitle
      ? schema => {
          // Titles of the properties of the schema will make some models follow the schema better, especially for Haiku
          if (schema && typeof schema === 'object') {
            return addTitlesToProperties(schema as Record<string, unknown>);
          }
          return schema;
        }
      : undefined,
  });

  return jsonSchema;
}

