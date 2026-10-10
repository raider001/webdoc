import { registerWidget } from './registry.js';

registerWidget({
  name: 'panel', displayName: 'Panel', icon: '▣',
  description: 'Frame Markdown with a titled panel.',
  editor: { fields: [{ name: 'title', label: 'Panel title', type: 'text', default: 'Panel', required: true }] },
  render({ options, content }) {
    const panel = document.createElement('aside');
    panel.className = 'wd-extension-panel';
    const title = document.createElement('strong');
    title.textContent = String(options.title || 'Panel');
    panel.append(title, content);
    return panel;
  },
  mount({ host }) { host.dataset.panelMounted = 'true'; },
  update({ host }) { host.dataset.panelUpdated = 'true'; },
  destroy({ host }) { delete host.dataset.panelMounted; },
});
