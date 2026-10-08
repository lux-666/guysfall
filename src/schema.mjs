export class RuleError extends Error {}
export const ensure = (ok, message) => { if (!ok) throw new RuleError(message); };
export function validate(value, schema, at = 'arguments') {
  if (schema.type === 'object') {
    ensure(value && typeof value === 'object' && !Array.isArray(value), `${at}: object required`);
    for (const key of schema.required ?? []) ensure(Object.hasOwn(value, key), `${at}.${key}: required`);
    for (const [key, child] of Object.entries(value)) { ensure(Object.hasOwn(schema.properties, key), `${at}.${key}: unknown field`); validate(child, schema.properties[key], `${at}.${key}`); }
  } else if (schema.type === 'array') {
    ensure(Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems, `${at}: invalid array`);
    value.forEach(item => validate(item, schema.items, at));
  } else if (schema.type === 'string') {
    ensure(typeof value === 'string', `${at}: string required`);
    ensure(value.trim().length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity), `${at}: invalid length (allowed ${schema.minLength??0}–${schema.maxLength??'unbounded'}, got ${value.length})`);
  } else if (schema.type === 'boolean') ensure(typeof value === 'boolean', `${at}: boolean required`);
  if (schema.type === 'integer') ensure(Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum, `${at}: invalid integer`);
  if (schema.enum) ensure(schema.enum.includes(value), `${at}: invalid choice`);
}
