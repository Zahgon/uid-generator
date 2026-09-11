/*
 * Reimplementation shim: `org.apache.commons.lang.ClassUtils.getShortClassName`,
 * used by `NamingThreadFactory` to derive a thread-name prefix from the caller.
 */

/**
 * `ClassUtils.getShortClassName(String)`: strip the package, and render a
 * nested class with `.` where the binary name uses `$`.
 */
export function getShortClassName(className: string | null | undefined): string {
  if (className === null || className === undefined || className.length === 0) {
    return '';
  }
  const lastDot = className.lastIndexOf('.');
  const withoutPackage = lastDot === -1 ? className : className.slice(lastDot + 1);
  return withoutPackage.replace(/\$/g, '.');
}

export const ClassUtils = { getShortClassName } as const;
