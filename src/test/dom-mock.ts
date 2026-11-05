export class MockElement {
  tagName: string;
  className = '';
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  _textContent = '';
  _innerHTML = '';
  children: MockElement[] = [];
  parentNode: MockElement | null = null;
  ownerDocument: any = null;
  tabIndex = 0;
  type = '';
  value = '';
  placeholder = '';
  autocomplete = '';
  title = '';
  hidden = false;
  checked = false;
  disabled = false;
  draggable = false;
  src = '';
  href = '';
  download = '';
  width = 0;
  height = 0;
  files: Array<{ text: () => Promise<string>; name?: string; size?: number }> | null = null;
  onclick: ((e: any) => any) | null = null;
  onerror: ((e: any) => any) | null = null;
  attributes: Record<string, string> = {};
  listeners: Record<string, Array<(e: any) => any>> = {};

  constructor(tagName: string, ownerDocument?: any) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument ?? null;
  }

  get id(): string {
    return this.attributes['id'] ?? '';
  }

  set id(v: string) {
    this.attributes['id'] = v;
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(v: string) {
    this._innerHTML = v;
    if (v === '') {
      this.children = [];
      this._textContent = '';
    }
  }

  get textContent(): string {
    if (this._textContent) return this._textContent;
    if (this.children.length > 0) return this.children.map((c) => c.textContent).join('');
    if (this._innerHTML) return this._innerHTML.replace(/<[^>]*>/g, '');
    return '';
  }

  set textContent(v: string) {
    this._textContent = v;
    if (v === '') {
      this.children = [];
      this._innerHTML = '';
    }
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
        const span = new MockElement('span', this.ownerDocument);
        span.textContent = n;
        span.parentNode = this;
        this.children.push(span);
      } else if (n.tagName === '#DOCUMENT-FRAGMENT') {
        const fragChildren = [...n.children];
        n.children = [];
        for (const child of fragChildren) {
          child.parentNode = this;
          if (!child.ownerDocument) child.ownerDocument = this.ownerDocument;
          this.children.push(child);
        }
      } else {
        n.parentNode = this;
        if (!n.ownerDocument) n.ownerDocument = this.ownerDocument;
        this.children.push(n);
      }
    }
  }

  appendChild(child: MockElement | string): MockElement {
    if (typeof child === 'string') {
      const span = new MockElement('span', this.ownerDocument);
      span.textContent = child;
      span.parentNode = this;
      this.children.push(span);
      return span;
    }
    if (child.tagName === '#DOCUMENT-FRAGMENT') {
      const fragChildren = [...child.children];
      child.children = [];
      for (const c of fragChildren) {
        c.parentNode = this;
        if (!c.ownerDocument) c.ownerDocument = this.ownerDocument;
        this.children.push(c);
      }
      return child;
    }
    child.parentNode = this;
    if (!child.ownerDocument) child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  prepend(...nodes: (MockElement | string)[]): void {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (typeof n === 'string') {
        const span = new MockElement('span', this.ownerDocument);
        span.textContent = n;
        span.parentNode = this;
        this.children.unshift(span);
      } else if (n.tagName === '#DOCUMENT-FRAGMENT') {
        const fragChildren = [...n.children];
        n.children = [];
        for (let j = fragChildren.length - 1; j >= 0; j--) {
          const child = fragChildren[j];
          child.parentNode = this;
          if (!child.ownerDocument) child.ownerDocument = this.ownerDocument;
          this.children.unshift(child);
        }
      } else {
        n.parentNode = this;
        if (!n.ownerDocument) n.ownerDocument = this.ownerDocument;
        this.children.unshift(n);
      }
    }
  }

  replaceChildren(...nodes: (MockElement | string)[]): void {
    for (const c of this.children) {
      c.parentNode = null;
    }
    this.children = [];
    this._textContent = '';
    this._innerHTML = '';
    this.append(...nodes);
  }

  insertBefore(newNode: MockElement, refNode: MockElement | null): MockElement {
    newNode.remove();
    newNode.parentNode = this;
    if (!newNode.ownerDocument) newNode.ownerDocument = this.ownerDocument;
    if (!refNode) {
      this.children.push(newNode);
      return newNode;
    }
    const idx = this.children.indexOf(refNode);
    if (idx === -1) this.children.push(newNode);
    else this.children.splice(idx, 0, newNode);
    return newNode;
  }

  remove(): void {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
  }

  reset(): void {}

  getBoundingClientRect() {
    return { top: 0, height: 24, left: 0, width: 100, bottom: 24, right: 100 };
  }

  addEventListener(event: string, handler: (e: any) => any): void {
    this.listeners[event] = this.listeners[event] ?? [];
    this.listeners[event].push(handler);
  }

  async dispatchEvent(event: any = {}): Promise<void> {
    const type = event.type ?? 'click';
    let stopped = false;
    const stopPropagation = () => {
      stopped = true;
      event.stopPropagation?.();
    };
    const preventDefault = () => {
      event.preventDefault?.();
    };
    let curr: MockElement | null = this;
    while (curr) {
      const evt = {
        ...event,
        type,
        bubbles: Boolean(event.bubbles),
        target: event.target ?? this,
        currentTarget: curr,
        stopPropagation,
        preventDefault,
      };
      if (type === 'click' && typeof curr.onclick === 'function') {
        await curr.onclick(evt);
      }
      const handlers = curr.listeners[type] ?? [];
      for (const h of handlers) {
        await h(evt);
      }
      if (stopped || !event.bubbles) break;
      curr = curr.parentNode;
    }
  }

  async click(): Promise<void> {
    if (this.tagName === 'INPUT' && this.type === 'checkbox') {
      this.checked = !this.checked;
    }
    await this.dispatchEvent({ type: 'click' });
  }

  focus(): void {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  select(): void {}

  scrollIntoView(): void {}

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (matchesCompoundSelector(curr, selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const res: MockElement[] = [];
    for (const child of this.children) {
      if (matchesCompoundSelector(child, selector)) res.push(child);
      res.push(...child.querySelectorAll(selector));
    }
    return res;
  }
}

function matchesSimpleSelector(el: MockElement, sel: string): boolean {
  let rest = sel.trim();
  if (!rest) return false;

  if (rest.includes(':not([hidden])')) {
    if (el.hidden || el.attributes['hidden'] !== undefined) return false;
    rest = rest.replace(':not([hidden])', '');
  }
  if (rest.includes(':checked')) {
    if (!el.checked) return false;
    rest = rest.replace(':checked', '');
  }

  const attrMatch = rest.match(/\[([a-zA-Z0-9_-]+)=["']?([^"'\]]*)["']?\]/);
  if (attrMatch) {
    const [, attrName, attrVal] = attrMatch;
    const actual = attrName.startsWith('data-')
      ? (el.dataset[attrName.slice(5)] ?? el.attributes[attrName])
      : (el.attributes[attrName] ?? (el as any)[attrName]);
    if (actual !== attrVal) return false;
    rest = rest.replace(attrMatch[0], '');
  }

  const hasClass = (cls: string) =>
    el.classList.contains(cls) || (cls === 'alias-btn' && el.title === 'Add alias');

  if (!rest) return true;
  if (rest.startsWith('#')) {
    return el.id === rest.slice(1);
  }
  if (rest.startsWith('.')) {
    const classes = rest.split('.').filter(Boolean);
    return classes.every(hasClass);
  }
  if (rest.includes('.')) {
    const [tag, ...classes] = rest.split('.');
    if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    return classes.filter(Boolean).every(hasClass);
  }
  return el.tagName.toLowerCase() === rest.toLowerCase();
}

function matchesCompoundSelector(el: MockElement, selector: string): boolean {
  const groups = selector.split(',').map((s) => s.trim()).filter(Boolean);
  return groups.some((group) => {
    const parts = group.split(/\s+/).filter(Boolean);
    if (!matchesSimpleSelector(el, parts[parts.length - 1])) return false;
    let curr: MockElement | null = el.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (curr && !matchesSimpleSelector(curr, parts[i])) {
        curr = curr.parentNode;
      }
      if (!curr) return false;
      curr = curr.parentNode;
    }
    return true;
  });
}

function makeTagConstructor(tagName: string) {
  return class extends MockElement {
    static [Symbol.hasInstance](instance: unknown): boolean {
      return instance instanceof MockElement && instance.tagName === tagName.toUpperCase();
    }
  };
}

export function installDomGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  g.HTMLElement = MockElement;
  g.HTMLInputElement = makeTagConstructor('INPUT');
  g.HTMLTextAreaElement = makeTagConstructor('TEXTAREA');
  g.HTMLSelectElement = makeTagConstructor('SELECT');
  g.HTMLLIElement = makeTagConstructor('LI');
  g.HTMLButtonElement = makeTagConstructor('BUTTON');
  g.HTMLAnchorElement = makeTagConstructor('A');
  g.HTMLFormElement = makeTagConstructor('FORM');
  g.HTMLUListElement = makeTagConstructor('UL');
  g.HTMLDivElement = makeTagConstructor('DIV');
  g.HTMLSpanElement = makeTagConstructor('SPAN');
}

export function createDomMock() {
  installDomGlobals();
  const listeners: Record<string, Array<(e: any) => any>> = {};
  const doc: any = {
    body: null as unknown as MockElement,
    activeElement: null as MockElement | null,
    createElement: (tag: string) => new MockElement(tag, doc),
    createDocumentFragment: () => new MockElement('#document-fragment', doc),
    createTextNode: (text: string) => text,
    getElementById: (id: string) => doc.body.querySelector(`#${id}`),
    querySelector: (selector: string) => doc.body.querySelector(selector),
    querySelectorAll: (selector: string) => doc.body.querySelectorAll(selector),
    addEventListener: (event: string, handler: (e: any) => any) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(handler);
    },
    dispatchEvent: async (event: any) => {
      const handlers = listeners[event.type] ?? [];
      const evt = {
        preventDefault: () => {},
        stopPropagation: () => {},
        ...event,
      };
      for (const h of handlers) await h(evt);
    },
    reset: () => {
      doc.body.children = [];
      doc.body.className = '';
      doc.activeElement = null;
    },
  };
  doc.body = new MockElement('body', doc);

  return { doc, body: doc.body, listeners };
}
