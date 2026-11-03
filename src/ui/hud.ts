export function mountHud(root: HTMLElement): () => void {
  const hud = document.createElement('div');
  hud.id = 'hud';
  for (const id of [
    'lesson-strip', 'proximity-front', 'proximity-rear', 'telemetry',
    'view-controls', 'overhead-frame', 'status-message',
  ]) {
    const element = document.createElement('div');
    element.id = id;
    if (id === 'status-message') {
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
    } else element.hidden = true;
    hud.append(element);
  }
  root.append(hud);
  return () => hud.remove();
}
