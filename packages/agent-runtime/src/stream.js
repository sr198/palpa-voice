class SubscriptionQueue {
  constructor() {
    this.buffer = [];
    this.waiters = [];
    this.closed = false;
  }

  push(value) {
    if (this.closed) {
      return;
    }

    if (this.waiters.length) {
      const waiter = this.waiters.shift();
      waiter({ value, done: false });
      return;
    }

    this.buffer.push(value);
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  next() {
    if (this.buffer.length) {
      return Promise.resolve({ value: this.buffer.shift(), done: false });
    }

    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  return() {
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

export class EventFanout {
  constructor() {
    this.subscribers = new Set();
  }

  push(value) {
    for (const subscriber of this.subscribers) {
      subscriber.push(value);
    }
  }

  subscribe(signal) {
    const queue = new SubscriptionQueue();
    this.subscribers.add(queue);

    if (signal) {
      if (signal.aborted) {
        queue.close();
      } else {
        signal.addEventListener('abort', () => queue.close(), { once: true });
      }
    }

    const fanout = this;
    return {
      async next() {
        return queue.next();
      },
      async return() {
        fanout.subscribers.delete(queue);
        return queue.return();
      },
      [Symbol.asyncIterator]() {
        return this;
      }
    };
  }

  close() {
    for (const subscriber of this.subscribers) {
      subscriber.close();
    }

    this.subscribers.clear();
  }
}
