export class MockElement {
  tagName: string;
  className = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  _textContent = '';
  innerHTML = '';
  children: MockElement[] = [];
  parentNode: MockElement | null = null;
  tabIndex = 0;
  type = '';
  value = '';
  placeholder = '';
  autocomplete = '';
  title = '';
  attributes: Record<string, string> = {};
  listeners: Record<string, Array<(e: any) => any>> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get textContent(): string {
    if (this._textContent) return this._textContent;
    if (this.children.length > 0) return this.children.map((c) => c.textContent).join('');
    if (this.innerHTML) return this.innerHTML.replace(/<[^>]*>/g, '');
    return '';
  }

  set textContent(v: string) {
    this._textContent = v;
  }

  get classList() {
    return {
      add: (...classes: string[]) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.forEach((c) => set.add(c));
        this.className = Array.from(set).join(' ');
      },
      remove: (...classes: string[]) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.forEach((c) => set.delete(c));
        this.className = Array.from(set).join(' ');
      },
      contains: (c: string) => this.className.split(/\s+/).includes(c),
      toggle: (c: string, force?: boolean) => {
        const has = this.className.split(/\s+/).includes(c);
        const shouldHave = force !== undefined ? force : !has;
        if (shouldHave) this.classList.add(c);
        else this.classList.remove(c);
        return shouldHave;
      },
    };
  }

  setAttribute(k: string, v: string): void {
    this.attributes[k] = v;
  }

  getAttribute(k: string): string | null {
    return this.attributes[k] ?? null;
  }

  append(...nodes: (MockElement | string)[]): void {
    for (const n of nodes) {
      if (typeof n === 'string') {
        const span = new MockElement('span');
        span.textContent = n;
        span.parentNode = this;
        this.children.push(span);
      } else {
        n.parentNode = this;
        this.children.push(n);
      }
    }
  }

  appendChild(child: MockElement): MockElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  prepend(...nodes: (MockElement | string)[]): void {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (typeof n === 'string') {
        const span = new MockElement('span');
        span.textContent = n;
        span.parentNode = this;
        this.children.unshift(span);
      } else {
        n.parentNode = this;
        this.children.unshift(n);
      }
    }
  }

  remove(): void {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
  }

  addEventListener(event: string, handler: (e: any) => any): void {
    this.listeners[event] = this.listeners[event] ?? [];
    this.listeners[event].push(handler);
  }

  async dispatchEvent(event: any = {}): Promise<void> {
    const type = event.type ?? 'click';
    const handlers = this.listeners[type] ?? [];
    for (const h of handlers) {
      await h({
        target: this,
        currentTarget: this,
        stopPropagation: () => {},
        preventDefault: () => {},
        ...event,
      });
    }
  }

  async click(): Promise<void> {
    await this.dispatchEvent({ type: 'click' });
  }

  focus(): void {}

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (matchesSelector(curr, selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  querySelector(selector: string): MockElement | null {
    for (const child of this.children) {
      if (matchesSelector(child, selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const res: MockElement[] = [];
    for (const child of this.children) {
      if (matchesSelector(child, selector)) res.push(child);
      res.push(...child.querySelectorAll(selector));
    }
    return res;
  }
}

function matchesSelector(el: MockElement, selector: string): boolean {
  if (selector.startsWith('.')) {
    const classes = selector.split('.').filter(Boolean);
    return classes.every((cls) => el.classList.contains(cls));
  }
  if (selector.startsWith('#')) {
    return el.attributes['id'] === selector.slice(1);
  }
  return el.tagName.toLowerCase() === selector.toLowerCase();
}

export function createDomMock() {
  const body = new MockElement('body');
  const listeners: Record<string, Array<(e: any) => any>> = {};

  const doc = {
    body,
    createElement: (tag: string) => new MockElement(tag),
    createTextNode: (text: string) => text,
    querySelector: (selector: string) => body.querySelector(selector),
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    addEventListener: (event: string, handler: (e: any) => any) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    },
    dispatchEvent: async (event: any) => {
      const handlers = listeners[event.type] ?? [];
      for (const h of handlers) await h(event);
    },
    reset: () => {
      body.children = [];
      body.className = '';
    },
  };

  return { doc, body, listeners };
}
