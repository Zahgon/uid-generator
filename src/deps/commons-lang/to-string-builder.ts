/*
 * Reimplementation shim: `org.apache.commons.lang.builder.ToStringBuilder`
 * / `ReflectionToStringBuilder` under `ToStringStyle.SHORT_PREFIX_STYLE`.
 *
 * Two classes render themselves this way — `BitsAllocator` and
 * `WorkerNodeEntity` — and both end up in log output, so the exact spelling is
 * part of the observable surface:
 *
 *   ClassName[field=value,field=value]
 *
 * short class name, no identity hash code, `,` between fields, `=` between a
 * field name and its value, `<null>` for a null value, `{a,b}` for an array,
 * and the fields in *declaration* order.
 *
 * Java reads that order from `Class.getDeclaredFields()`. The equivalent here is
 * `Object.keys`, which yields own string-keyed properties in creation order —
 * which, with `useDefineForClassFields`, is exactly the order the fields are
 * declared in the class body.
 */

import { javaToString } from '../java/to-string.js';
import { dateToString } from '../java/java-date.js';

export interface ToStringStyle {
  readonly useShortClassName: boolean;
  readonly contentStart: string;
  readonly contentEnd: string;
  readonly fieldSeparator: string;
  readonly fieldNameValueSeparator: string;
  readonly nullText: string;
  readonly arrayStart: string;
  readonly arrayEnd: string;
  readonly arraySeparator: string;
}

export const SHORT_PREFIX_STYLE: ToStringStyle = {
  useShortClassName: true,
  contentStart: '[',
  contentEnd: ']',
  fieldSeparator: ',',
  fieldNameValueSeparator: '=',
  nullText: '<null>',
  arrayStart: '{',
  arrayEnd: '}',
  arraySeparator: ',',
};

function renderValue(value: unknown, style: ToStringStyle): string {
  if (value === null || value === undefined) {
    return style.nullText;
  }
  if (value instanceof Date) {
    return dateToString(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => renderValue(item, style)).join(style.arraySeparator);
    return `${style.arrayStart}${items}${style.arrayEnd}`;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return javaToString(value);
}

/**
 * `ToStringBuilder.reflectionToString(Object, ToStringStyle)`.
 *
 * `Function`-valued properties are skipped: they are the target-language stand-in
 * for a Java method reference held in a field, which the JDK's reflection would
 * see as a synthetic member and omit.
 */
export function reflectionToString(target: object, style: ToStringStyle = SHORT_PREFIX_STYLE): string {
  const className = style.useShortClassName
    ? target.constructor.name
    : target.constructor.name;
  const fields = Object.entries(target)
    .filter(([, value]) => typeof value !== 'function')
    .map(([name, value]) => `${name}${style.fieldNameValueSeparator}${renderValue(value, style)}`)
    .join(style.fieldSeparator);
  return `${className}${style.contentStart}${fields}${style.contentEnd}`;
}

export const ToStringBuilder = { reflectionToString } as const;
export const ReflectionToStringBuilder = { toString: reflectionToString } as const;
export const ToStringStyleConstants = { SHORT_PREFIX_STYLE } as const;
