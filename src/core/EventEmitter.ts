// ============================================================================
// treelet.js - Typed EventEmitter
// ============================================================================

type EventHandler<T> = (data: T) => void;

/**
 * Lightweight typed event emitter.
 * Uses a plain Map internally - no DOM dependency.
 *
 * A throwing handler never prevents other handlers (or the library code that
 * emitted the event) from running; the error is reported to the console.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class EventEmitter<TMap extends {}> {
  private listeners = new Map<keyof TMap, Set<EventHandler<unknown>>>();
  /** once() wrappers keyed by the user's handler, so off(handler) works for them too. */
  private onceWrappers = new Map<EventHandler<unknown>, EventHandler<unknown>>();

  /**
   * Register an event handler.
   */
  on<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler<unknown>);
    return this;
  }

  /**
   * Remove an event handler (also handlers registered with once()).
   */
  off<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): this {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const h = handler as EventHandler<unknown>;
      const wrapper = this.onceWrappers.get(h);
      handlers.delete(h);
      if (wrapper) {
        handlers.delete(wrapper);
        this.onceWrappers.delete(h);
      }
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    }
    return this;
  }

  /**
   * Register a one-shot event handler.
   */
  once<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): this {
    const original = handler as EventHandler<unknown>;
    const wrapper: EventHandler<TMap[K]> = (data) => {
      this.off(event, handler);
      handler(data);
    };
    this.onceWrappers.set(original, wrapper as EventHandler<unknown>);
    return this.on(event, wrapper);
  }

  /** Number of handlers registered for `event`. */
  listenerCount<K extends keyof TMap>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /**
   * Emit an event to all registered handlers.
   */
  protected emit<K extends keyof TMap>(event: K, data: TMap[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(data);
      } catch (err) {
        console.error(`treelet: error in "${String(event)}" event handler`, err);
      }
    }
  }

  /**
   * Remove all handlers for all events.
   */
  protected removeAllListeners(): void {
    this.listeners.clear();
    this.onceWrappers.clear();
  }
}
