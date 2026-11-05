import type { StageId } from '../contracts';
import { vi } from '../messages';

export function createParkingIllustration(stageId: StageId): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 560 390');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', vi.goalDiagram);
  svg.classList.add('parking-illustration');
  const parallel = stageId === 3 || stageId === 5;
  svg.innerHTML = `
    <ellipse cx="290" cy="320" rx="200" ry="28" fill="#100e13" opacity=".5"/>
    <g transform="translate(280 175) skewY(-12) scale(1 .85)">
      <path d="M-245 160H245M-245 65H245M-245-30H245M-200-130V180M-75-130V180M50-130V180M175-130V180"
        fill="none" stroke="#58495f" stroke-width="1"/>
      <g transform="rotate(${parallel ? 90 : 0})">
        <path d="M-67-120H67V118H-67Z" fill="#9b59b6" fill-opacity=".16" stroke="#d5b1e3" stroke-width="3"/>
        <path d="M-59 110H59" stroke="#9b59b6" stroke-width="7"/>
        <rect x="-48" y="-89" width="12" height="34" rx="4" fill="#100e13"/>
        <rect x="36" y="-89" width="12" height="34" rx="4" fill="#100e13"/>
        <rect x="-48" y="46" width="12" height="34" rx="4" fill="#100e13"/>
        <rect x="36" y="46" width="12" height="34" rx="4" fill="#100e13"/>
        <rect x="-41" y="-108" width="82" height="205" rx="22" fill="#dcd5e0" stroke="#f5f3f6" stroke-width="2"/>
        <path d="M-30-59L-22-75H22L30-59V50L22 68H-22L-30 50Z" fill="#362b40"/>
        <rect x="-25" y="-40" width="50" height="79" rx="9" fill="#9b59b6"/>
        <path d="M-30-89H-14M14-89H30" stroke="#fff" stroke-width="4"/>
      </g>
      <path d="M85-90H165" stroke="#d5b1e3" stroke-width="2"/>
      <circle cx="85" cy="-90" r="5" fill="#d5b1e3"/>
      <rect x="-194" y="-100" width="76" height="178" rx="15" fill="#65566f" opacity=".7"/>
      <rect x="123" y="0" width="76" height="178" rx="15" fill="#65566f" opacity=".7"/>
    </g>`;
  return svg;
}
