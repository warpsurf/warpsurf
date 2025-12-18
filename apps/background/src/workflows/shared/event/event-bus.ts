import type { AgentEvent, EventType, EventCallback } from './types';
import { createLogger } from '@src/log';

const logger = createLogger('event-manager');

export class EventManager {
  private _subscribers: Map<EventType, EventCallback[]>;
  private _eventBuffer: Map<EventType, AgentEvent[]>; // Buffer for events with no subscribers

  constructor() {
    this._subscribers = new Map();
    this._eventBuffer = new Map();
  }

  subscribe(eventType: EventType, callback: EventCallback): void {
    if (!this._subscribers.has(eventType)) {
      this._subscribers.set(eventType, []);
    }

    const callbacks = this._subscribers.get(eventType);
    if (callbacks && !callbacks.includes(callback)) {
      callbacks.push(callback);
    }

    // If there are buffered events for this type, replay them to the new subscriber
    const buffered = this._eventBuffer.get(eventType);
    if (buffered && buffered.length > 0) {
      buffered.forEach(event => {
        try {
          callback(event);
        } catch (error) {
          logger.error('Error executing buffered event callback:', error);
        }
      });
      this._eventBuffer.set(eventType, []); // Clear buffer after replay
    }
  }

  unsubscribe(eventType: EventType, callback: EventCallback): void {
    if (this._subscribers.has(eventType)) {
      const callbacks = this._subscribers.get(eventType);
      if (callbacks) {
        this._subscribers.set(
          eventType,
          callbacks.filter(cb => cb !== callback),
        );
      }
    }
  }

  clearSubscribers(eventType: EventType): void {
    if (this._subscribers.has(eventType)) {
      this._subscribers.set(eventType, []);
    }
  }

  async emit(event: AgentEvent): Promise<void> {
    const callbacks = this._subscribers.get(event.type);
    if (callbacks && callbacks.length > 0) {
      try {
        await Promise.all(callbacks.map(async callback => await callback(event)));
      } catch (error) {
        logger.error('Error executing event callbacks:', error);
      }
    } else {
      // Buffer the event if no subscribers yet
      if (!this._eventBuffer.has(event.type)) {
        this._eventBuffer.set(event.type, []);
      }
      this._eventBuffer.get(event.type)!.push(event);
    }
  }
}

