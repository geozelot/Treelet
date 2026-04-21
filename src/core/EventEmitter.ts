// ============================================================================
// treelet.js - Typed EventEmitter
// ============================================================================

type EventHandler<T> = (data: T) => void;

/**
 * Lightweight typed event emitter.
 * Uses a plain Map internally - no DOM dependency.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export class EventEmitter<TMap extends {}> {
  private listeners = new Map<keyof TMap, Set<EventHandler<unknown>>>();

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
   * Remove an event handler.
   */
  off<K extends keyof TMap>(event: K, handler: EventHandler<TMap[K]>): this {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler<unknown>);
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
    const wrapper: EventHandler<TMap[K]> = (data) => {
      this.off(event, wrapper);
      handler(data);
    };
    return this.on(event, wrapper);
  }

  /**
   * Emit an event to all registered handlers.
   */
  protected emit<K extends keyof TMap>(event: K, data: TMap[K]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) handler(data);
    }
  }

  /**
   * Remove all handlers for all events.
   */
  protected removeAllListeners(): void {
    this.listeners.clear();
  }
}
