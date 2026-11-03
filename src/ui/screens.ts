import type { AppState } from '../contracts';
import { vi } from '../messages';
import type { ScreenAction, ScreenContext, ShellView } from '../runtime-types';

export function mountScreen(
  root: HTMLElement,
  state: AppState,
  context: ScreenContext,
  onAction: (action: ScreenAction) => void,
  view?: ShellView,
): () => void {
  const screen = document.createElement('main');
  const preview = view?.preview ?? 'closed';
  screen.className = preview === 'running' ? 'preview-shell panel' : 'screen panel';
  const listeners = new AbortController();
  let firstButton: HTMLButtonElement | undefined;

  function text(tag: 'h1' | 'p', value: string) {
    const element = document.createElement(tag);
    element.textContent = value;
    screen.append(element);
    return element;
  }

  function button(label: string, handler: () => void) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', handler, { signal: listeners.signal });
    screen.append(element);
    firstButton ??= element;
  }

  if (state.kind === 'error') {
    text('h1', vi.appTitle);
    text('p', vi[state.messageKey]).setAttribute('role', 'alert');
    if (state.retryable) {
      if (state.messageKey === 'webglContextLost') {
        button(vi.reload, () => window.location.reload());
      } else button(vi.retry, () => onAction({ type: 'retry' }));
    }
    button(vi.closePreview, () => onAction({ type: 'menu' }));
  } else if (state.kind !== 'menu') {
    throw new Error(`Screen not implemented in Phase 2: ${state.kind}`);
  } else if (preview !== 'closed') {
    const badge = text('h1', vi.previewBadge);
    if (preview === 'running') badge.className = 'preview-badge';
    text('p', context.selectedVehicleId === 'sedan' ? vi.sedan : vi.cuv);
    text('p', preview === 'paused' ? vi.pausedNotice : vi.previewNotice);
    if (preview === 'paused') button(vi.resumePreview, () => onAction({ type: 'resume' }));
    button(vi.closePreview, () => onAction({ type: 'close-preview' }));
  } else {
    text('h1', vi.appTitle);
    text('p', vi.menuTitle);
    text('p', vi.menuNotice);
    const label = document.createElement('label');
    label.htmlFor = 'vehicle';
    label.textContent = vi.vehicleLabel;
    const select = document.createElement('select');
    select.id = 'vehicle';
    for (const id of ['sedan', 'cuv'] as const) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = vi[id];
      select.append(option);
    }
    select.value = context.selectedVehicleId;
    select.addEventListener('change', () => {
      if (select.value !== 'sedan' && select.value !== 'cuv') {
        throw new RangeError('Invalid vehicle selection');
      }
      onAction({ type: 'select-vehicle', vehicleId: select.value });
    }, { signal: listeners.signal });
    screen.append(label, select);
    button(vi.openPreview, () => onAction({ type: 'open-preview' }));
  }
  root.append(screen);
  firstButton?.focus();
  return () => {
    listeners.abort();
    screen.remove();
  };
}
