import { vi } from '../messages';

export type CalibrationPart = 'steering' | 'throttle' | 'brake' | 'reverse' | 'drive';

const PART_LABELS: Readonly<Record<CalibrationPart, string>> = {
  steering: vi.calibrationPartSteering,
  throttle: vi.calibrationPartThrottle,
  brake: vi.calibrationPartBrake,
  reverse: vi.calibrationPartReverse,
  drive: vi.calibrationPartDrive,
};

export function createControllerIllustration(
  kind: 'wheel' | 'gamepad', part: CalibrationPart,
): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 360 220');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${vi.controllerIllustration} — ${
    kind === 'wheel' ? vi.wheelIllustration : vi.gamepadIllustration
  } — ${PART_LABELS[part]}`);
  svg.setAttribute('data-controller-kind', kind);
  svg.setAttribute('data-highlighted-part', part);
  svg.classList.add('controller-illustration');
  svg.innerHTML = kind === 'wheel' ? `
    <path d="M25 168H335" fill="none" stroke="#58495f" stroke-width="3"/>
    <g data-part="steering">
      <circle cx="142" cy="87" r="62" fill="#211a25" stroke="#8a748f" stroke-width="10"/>
      <circle cx="142" cy="87" r="20" fill="#58495f"/>
      <path d="M142 68V35M125 97L94 111M159 97L190 111" fill="none" stroke="#8a748f" stroke-width="9"/>
    </g>
    <g data-part="throttle">
      <path d="M233 128L266 121L280 165L244 170Z" fill="#362b40" stroke="#8a748f" stroke-width="4"/>
    </g>
    <g data-part="brake">
      <path d="M286 123L319 129L309 171L274 166Z" fill="#362b40" stroke="#8a748f" stroke-width="4"/>
    </g>
    <g data-part="reverse">
      <path d="M225 58H247V79H225Z" fill="#362b40" stroke="#8a748f" stroke-width="4"/>
      <text x="231" y="74" fill="#f5f3f6" font-size="12">R</text>
    </g>
    <g data-part="drive">
      <path d="M278 58H300V79H278Z" fill="#362b40" stroke="#8a748f" stroke-width="4"/>
      <text x="284" y="74" fill="#f5f3f6" font-size="12">D</text>
    </g>` : `
    <path d="M65 70Q74 42 110 46L145 59H215L250 46Q286 42 295 70L325 153Q331 174 309 178L267 147H93L51 178Q29 174 35 153Z"
      fill="#211a25" stroke="#8a748f" stroke-width="8"/>
    <g data-part="steering">
      <circle cx="117" cy="106" r="28" fill="#362b40" stroke="#8a748f" stroke-width="7"/>
      <path d="M207 100V132M191 116H223" stroke="#8a748f" stroke-width="9"/>
    </g>
    <g data-part="throttle">
      <path d="M92 48V31Q92 20 104 20H155V48Z" fill="#362b40" stroke="#8a748f" stroke-width="4"/>
    </g>
    <g data-part="brake">
      <path d="M205 48V20H256Q268 20 268 31V48Z" fill="#362b40" stroke="#8a748f" stroke-width="4"/>
    </g>
    <g data-part="reverse">
      <rect x="96" y="53" width="56" height="14" rx="6" fill="#362b40" stroke="#8a748f" stroke-width="4"/>
      <text x="121" y="64" fill="#f5f3f6" font-size="10">R</text>
    </g>
    <g data-part="drive">
      <rect x="208" y="53" width="56" height="14" rx="6" fill="#362b40" stroke="#8a748f" stroke-width="4"/>
      <text x="231" y="64" fill="#f5f3f6" font-size="10">D</text>
    </g>
    <g fill="#8a748f">
      <circle cx="280" cy="94" r="8"/><circle cx="301" cy="115" r="8"/>
      <circle cx="259" cy="115" r="8"/><circle cx="280" cy="136" r="8"/>
    </g>`;
  svg.querySelectorAll(`[data-part="${part}"]`).forEach((element) => {
    element.setAttribute('data-active', 'true');
  });
  return svg;
}
