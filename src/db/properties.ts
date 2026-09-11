/*
 * Replacement for Spring's `PropertiesFactoryBean` +
 * `PropertyPlaceholderConfigurer`, which the original points at
 * `classpath:/uid/*.properties`.
 *
 * The datasource settings stay in `.properties` files with their original keys,
 * so an existing deployment's `mysql.properties` keeps working unedited. This
 * reads the same format: `key=value` per line, `#` and `!` comments, `\` line
 * continuations, and later files overriding earlier ones.
 */

import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export type Properties = ReadonlyMap<string, string>;

function unescape(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_match, escape: string) => {
    if (escape.startsWith('u')) {
      return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    }
    switch (escape) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'f': return '\f';
      default: return escape;
    }
  });
}

/** Parse one `.properties` document. */
export function parseProperties(text: string): Map<string, string> {
  const properties = new Map<string, string>();
  // Strip a UTF-8 BOM and join backslash continuations before splitting.
  const lines = text.replace(/^\uFEFF/, '').replace(/\\\r?\n[ \t]*/g, '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    const separator = /(?<!\\)[=:]|\s/.exec(line);
    if (separator === null) {
      properties.set(unescape(line), '');
      continue;
    }
    const key = line.slice(0, separator.index);
    const value = line.slice(separator.index + separator[0].length).replace(/^[ \t]*[=:]?[ \t]*/, '');
    properties.set(unescape(key.trim()), unescape(value));
  }
  return properties;
}

/**
 * Load every `.properties` file in `directory`, in name order, later files
 * overriding earlier ones — the merge order Spring's `PropertiesFactoryBean`
 * applies to a `classpath:/uid/*.properties` location list.
 */
export function loadProperties(directory: string): Properties {
  const merged = new Map<string, string>();
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.properties'))
    .sort();
  for (const name of names) {
    for (const [key, value] of parseProperties(readFileSync(join(directory, name), 'utf8'))) {
      merged.set(key, value);
    }
  }
  return merged;
}

/** Read a required property, failing the way an unresolved `${…}` placeholder does. */
export function requireProperty(properties: Properties, key: string): string {
  const value = properties.get(key);
  if (value === undefined) {
    throw new Error(`Could not resolve placeholder '${key}'`);
  }
  return value;
}
