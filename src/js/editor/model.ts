// Structural operations shared by the editor and its tests. Inline values stay HTML.
import type { Block } from '../editor.js';
import type { TableBlock } from './widgets.js';

export type TextBlock = Extract<Block, { html: string }>;
export const isText = (b: Block): b is TextBlock => b.type === 'paragraph' || b.type === 'heading' || b.type === 'quote';

export function splitBlock(blocks: Block[], index: number, left: string, right: string): boolean {
  const block = blocks[index];
  if (!block || !isText(block)) return false;
  block.html = left;
  blocks.splice(index + 1, 0, { type: 'paragraph', html: right });
  return true;
}
export function joinBlock(blocks: Block[], index: number): boolean {
  const before = blocks[index - 1], current = blocks[index];
  if (!before || !current || !isText(before) || !isText(current)) return false;
  before.html += current.html;
  blocks.splice(index, 1);
  return true;
}
export const TEXT_TYPES = ['paragraph', 'heading', 'quote', 'list', 'list-ordered', 'code'];
export function changeType(block: Block, type: string): Block {
  if (!TEXT_TYPES.includes(type) || !(isText(block) || block.type === 'list' || block.type === 'code')) return block;
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = isText(block) ? block.html : block.type === 'list' ? block.itemsHtml.join('<br>') : escape(block.code).replace(/\n/g, '<br>');
  if (type === 'heading') return { type, level: 2, html };
  if (type === 'paragraph' || type === 'quote') return { type, html };
  if (type === 'list' || type === 'list-ordered') return { type: 'list', ordered: type === 'list-ordered', itemsHtml: html.split(/<br\s*\/?\s*>/i) };
  const el = document.createElement('div'); el.innerHTML = html.replace(/<br\s*\/?\s*>/gi, '\n');
  return { type: 'code', lang: '', code: el.textContent || '' };
}
export function moveBlock(blocks: Block[], from: number, to: number): boolean {
  if (from < 0 || to < 0 || from >= blocks.length || to >= blocks.length || from === to) return false;
  blocks.splice(to, 0, blocks.splice(from, 1)[0]); return true;
}
export function tableRow(b: TableBlock, at: number, remove = false): void {
  if (at < 0 || at > b.rows.length) return;
  if (remove) b.rows.splice(at, 1);
  else b.rows.splice(at, 0, b.headers.map(() => ''));
}
export function tableColumn(b: TableBlock, at: number, remove = false): void {
  if (at < 0 || at > b.headers.length) return;
  if (remove && b.headers.length <= 1) return;
  if (remove) { b.headers.splice(at, 1); b.aligns.splice(at, 1); b.rows.forEach(r => r.splice(at, 1)); }
  else { b.headers.splice(at, 0, 'Column'); b.aligns.splice(at, 0, ''); b.rows.forEach(r => r.splice(at, 0, '')); }
}

// Store serialized snapshots: subsequent in-place field edits cannot mutate history.
export class EditorHistory<T> {
  private past: string[] = [];
  private future: string[] = [];
  private current: string;
  private saved: string | null;
  constructor(state: T, isNew = false) { this.current = JSON.stringify(state); this.saved = isNew ? null : this.current; }
  record(state: T): void {
    const next = JSON.stringify(state);
    if (next === this.current) return;
    this.past.push(this.current); if (this.past.length > 100) this.past.shift();
    this.current = next; this.future = [];
  }
  dirty(state: T): boolean { return JSON.stringify(state) !== this.saved; }
  markSaved(state: T): void { this.saved = JSON.stringify(state); }
  undo(state: T): T | null {
    this.record(state); const previous = this.past.pop(); if (previous === undefined) return null;
    this.future.push(this.current); this.current = previous; return JSON.parse(previous) as T;
  }
  redo(): T | null {
    const next = this.future.pop(); if (next === undefined) return null;
    this.past.push(this.current); this.current = next; return JSON.parse(next) as T;
  }
}
