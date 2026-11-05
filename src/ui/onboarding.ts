import { vi } from '../messages';
import type { ScreenAction, ScreenContext, ShellOverlay } from '../runtime-types';
import type { InputSetup } from './screens';
import { createParkingIllustration } from './illustrations';

export function mountOnboarding(
  root: HTMLElement, overlay: Extract<ShellOverlay, { kind: 'onboarding' }>,
  context: ScreenContext, input: InputSetup | undefined,
  onAction: (action: ScreenAction) => void,
): () => void {
  const screen = document.createElement('main');
  screen.className = 'screen panel onboarding';
  screen.dataset.screen = 'onboarding';
  screen.dataset.onboardingStep = String(overlay.step);
  const listeners = new AbortController();
  const steps = [vi.tutorialStepGoal, vi.tutorialStepControls, vi.tutorialStepReady];
  function node(tag: string, text: string, parent: HTMLElement = screen, className = '') {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    parent.append(element);
    return element;
  }
  function button(label: string, action: ScreenAction, primary = false) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.dataset.action = action.type;
    element.className = primary ? 'primary-action' : 'quiet-action';
    element.addEventListener('click', () => onAction(action), { signal: listeners.signal });
    footer.append(element);
    return element;
  }
  const header = node('header', '', screen, 'screen-brand');
  node('h1', vi.appTitle, header);
  node('span', vi.tutorialLabel, header, 'eyebrow');
  const layout = node('div', '', screen, 'intro-layout');
  const art = node('figure', '', layout, 'lesson-art');
  art.append(createParkingIllustration(context.selectedStageId));
  const copy = node('section', '', layout, 'intro-copy');
  node('p', `0${overlay.step + 1} / 03 · ${steps[overlay.step]}`, copy, 'eyebrow');
  node('h2', [vi.tutorialGoal, vi.tutorialControls, vi.tutorialReady][overlay.step]!, copy);
  if (overlay.step === 0) node('p', vi.tutorialGoalCopy, copy, 'lead');
  else if (overlay.step === 1) {
    const keyboard = context.settings.inputSource === 'keyboard';
    for (const text of keyboard ? [vi.keyboardPedals, vi.keyboardSteer, vi.keyboardGear] :
      [vi.gamepadControls, ...(input?.ready ? [] : [vi.controllerNeedsSetup])]) {
      node('p', text, copy, 'control-card');
    }
  } else {
    node('p', vi.tutorialReadyCopy, copy, 'lead');
    node('p', vi.menuNotice, copy, 'safety-note');
  }
  if (context.onboarding.status !== 'persistent') {
    const notice = node('p', `${vi.tutorialRecord}: ${context.onboarding.status === 'reset-required'
      ? vi.unreadableRecord : vi.sessionOnlyRecord}`, copy, 'storage-notice');
    notice.setAttribute('role', context.onboarding.status === 'reset-required' ? 'alert' : 'status');
  }
  const footer = node('footer', '', copy, 'action-row');
  if (overlay.step > 0) button(vi.tutorialBack, { type: 'tutorial-back' });
  const next = button(overlay.step === 2 ? vi.finishTutorial : vi.tutorialNext,
    { type: overlay.step === 2 ? 'dismiss-tutorial' : 'tutorial-next' }, true);
  button(vi.skipTutorial, { type: 'dismiss-tutorial' });
  if (overlay.step === 1) button(vi.inputSetup, { type: 'open-settings', tab: 'input' });
  const progress = node('ol', '', screen, 'tutorial-progress');
  steps.forEach((text, index) => {
    const step = node('li', text, progress);
    if (index === overlay.step) step.setAttribute('aria-current', 'step');
  });
  root.append(screen);
  next.focus();
  return () => { listeners.abort(); screen.remove(); };
}
