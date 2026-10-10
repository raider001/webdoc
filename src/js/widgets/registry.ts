export interface WidgetField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'document' | 'section' | 'columns' | 'data-source' | 'interval';
  default?: unknown;
  min?: number;
  max?: number;
  required?: boolean;
  hint?: string;
  documentField?: string;
  dependsOn?: string[];
  choices?: readonly string[] | ((options: Record<string, unknown>, signal: AbortSignal) => readonly string[] | Promise<readonly string[]>);
  visibleWhen?: (options: Record<string, unknown>) => boolean;
  validate?: (value: unknown, options: Record<string, unknown>) => string | undefined;
}

export interface WidgetEditorContext {
  options: Record<string, unknown>;
  docId: string;
  signal: AbortSignal;
  change: (patch: Record<string, unknown>) => void;
  setError: (field: string, message?: string) => void;
}

export interface CustomWidgetEditor {
  element: HTMLElement;
  destroy?: () => void;
  validate?: () => boolean;
}

export interface WidgetEditorDefinition {
  fields?: WidgetField[];
  inlineContent?: boolean;
  /** DOM component; Svelte plugins can mount their component into element. */
  component?: (context: WidgetEditorContext) => HTMLElement | CustomWidgetEditor;
}

export interface WidgetContext {
  host: HTMLElement;
  options: Record<string, unknown>;
  innerMarkdown: string;
  /** Sanitized, decorated Markdown. Move this node into the rendered widget. */
  content: HTMLElement;
  innerHTML: string;
  docId: string;
  pageId: string;
  key: string;
  depth: number;
  signal: AbortSignal;
  renderContent: (markdown: string, docId?: string) => HTMLElement;
  teardown: (root: Element) => void;
  reportError: (error: unknown) => void;
  /** Use for event listeners/timers so asynchronous errors stay inside the widget. */
  guard: <T extends unknown[]>(fn: (...args: T) => void | Promise<void>) => (...args: T) => void;
  /** Notify the registered update hook after changing local content/options. */
  update: (options?: Record<string, unknown>) => Promise<void>;
}

export interface WidgetDefinition {
  name: string;
  label?: string;
  displayName?: string;
  icon?: string;
  description?: string;
  editor?: WidgetEditorDefinition;
  /** First-generation plugin compatibility; prefer editor.fields. */
  fields?: WidgetField[];
  render: (context: WidgetContext) => Node | void | Promise<Node | void>;
  mount?: (context: WidgetContext) => void | Promise<void>;
  update?: (context: WidgetContext) => void | Promise<void>;
  destroy?: (context: WidgetContext) => void | Promise<void>;
}

const registry = new Map<string, WidgetDefinition>();

export function registerWidget(definition: WidgetDefinition): void {
  if (!/^[a-z][a-z0-9-]*$/.test(definition.name) || typeof definition.render !== 'function') {
    throw new Error('A widget needs a lower-case name and a render function');
  }
  if (registry.has(definition.name)) throw new Error('Widget already registered: ' + definition.name);
  registry.set(definition.name, definition);
}

export function widgetDefinition(name: string): WidgetDefinition | undefined { return registry.get(name); }
export function registeredWidgets(): WidgetDefinition[] { return [...registry.values()]; }
export function widgetFields(definition?: WidgetDefinition): WidgetField[] { return definition?.editor?.fields || definition?.fields || []; }
export function widgetDisplayName(definition: WidgetDefinition): string { return definition.displayName || definition.label || definition.name; }
