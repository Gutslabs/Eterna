import { z } from "zod";

/**
 * Convert the flat JSON Schemas used by mcp-bridge/src/tool-schemas.ts into
 * zod objects so the bridge tools can be exposed to the core agent.
 *
 * Supports the subset the bridge actually uses: object roots with
 * string/number/boolean/array/enum/object properties, one level of nesting
 * inside array items, and a `required` list. Unknown shapes fall back to
 * z.unknown() rather than throwing, so a schema addition can never break the
 * harness.
 */

export interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty & {
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

function propertyToZod(prop: JsonSchemaProperty): z.ZodTypeAny {
  if (prop.enum && prop.enum.length > 0) {
    return z.enum(prop.enum as [string, ...string[]]);
  }
  switch (prop.type) {
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array": {
      const items = prop.items;
      if (items?.properties) {
        return z.array(objectToZod(items.properties, items.required));
      }
      return z.array(items ? propertyToZod(items) : z.unknown());
    }
    case "object":
      if (prop.properties) {
        return objectToZod(prop.properties, prop.required);
      }
      return z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}

function objectToZod(
  properties: Record<string, JsonSchemaProperty>,
  required: string[] | undefined,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const requiredSet = new Set(required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, prop] of Object.entries(properties)) {
    let field = propertyToZod(prop);
    if (prop.description) {
      field = field.describe(prop.description);
    }
    // Optional params are also .nullable() because some providers emit null
    // for omitted optional fields.
    shape[name] = requiredSet.has(name) ? field : field.nullable().optional();
  }
  return z.object(shape);
}

export function jsonSchemaToZod(
  schema: JsonSchemaObject,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  return objectToZod(
    schema.properties as Record<string, JsonSchemaProperty>,
    schema.required,
  );
}
