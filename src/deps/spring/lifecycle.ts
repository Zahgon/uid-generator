/*
 * Reimplementation shim: the two Spring lifecycle callbacks the component
 * implements. Spring calls `afterPropertiesSet()` once every configured
 * property has been set, and `destroy()` when the container shuts down; the
 * target keeps both names so the ordering contract stays legible.
 *
 * Both are asynchronous here: assigning a worker id is a database round trip,
 * and every Node database driver is promise-based.
 */

/** `org.springframework.beans.factory.InitializingBean`. */
export interface InitializingBean {
  afterPropertiesSet(): Promise<void>;
}

/** `org.springframework.beans.factory.DisposableBean`. */
export interface DisposableBean {
  destroy(): Promise<void>;
}
