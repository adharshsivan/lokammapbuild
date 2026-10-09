import { beachCoast, buildings, eyerShoals, fortCoast, mainCoast, piers, pointString, portAprons, portChannelCenterline, portChannelWidth, portCoast, roads } from './mapData';

export function ReferenceMap({ className = '', full = false }: { className?: string; full?: boolean }) {
  return (
    <svg className={className} viewBox={full ? '180 -80 1268 1300' : '195 -60 1030 1120'} role="img" aria-label="Coordinate-traced guide to the supplied island map">
      <rect x="180" y="-80" width="1268" height="1300" fill="#538f94" />
      {[mainCoast,beachCoast,fortCoast,...eyerShoals].map((coast,i) => <polygon key={`shallows-${i}`} points={pointString(coast)} fill="none" stroke="#70b0a9" strokeWidth="24" strokeLinejoin="round" />)}
      {[mainCoast,beachCoast,fortCoast].map((coast,i) => <polygon key={i} points={pointString(coast)} fill="#aabb91" stroke="#e1d5aa" strokeWidth="10" strokeLinejoin="round" />)}
      {eyerShoals.map((coast,i) => <polygon key={`shoal-${i}`} points={pointString(coast)} fill="#e4d4a3" stroke="#e1d5aa" strokeWidth="7" strokeLinejoin="round" />)}
      <polygon points={pointString(portCoast)} fill="#b4c49a" stroke="#d7d0ac" strokeWidth="3" strokeLinejoin="round" />
      <polyline points={pointString(portChannelCenterline)} fill="none" stroke="#70b0a9" strokeWidth={portChannelWidth + 6} strokeLinejoin="round" strokeLinecap="round" opacity="0.55" />
      <polyline points={pointString(portChannelCenterline)} fill="none" stroke="#2f86a3" strokeWidth={portChannelWidth} strokeLinejoin="round" strokeLinecap="round" />
      {portAprons.map((apron,i) => <polygon key={`port-${i}`} points={pointString(apron)} fill="#c7b8a1" />)}
      {roads.map(road => <path key={`${road.id}-edge`} d={road.path} stroke="#e0d7b5" strokeWidth={road.width + 3} fill="none" strokeLinejoin="round" strokeLinecap="round" />)}
      {roads.map(road => <path key={road.id} d={road.path} stroke="#536064" strokeWidth={road.width} fill="none" strokeLinejoin="round" strokeLinecap="round" />)}
      {piers.map((pier,i) => <path key={`pier-${i}`} d={pier.path} stroke="#d5c1a3" strokeWidth={pier.width} fill="none" />)}
      <circle cx="618" cy="554" r="38" fill="#d8d2b0" />
      <circle cx="618" cy="554" r="29" fill="#a5b487" />
      {buildings.map((b,i) => <rect key={i} x={b.x-b.w/2} y={b.y-b.d/2} width={b.w} height={b.d} fill={b.district === 'port' ? '#d2d1bd' : '#e7e2c8'} stroke="#a4aa99" strokeWidth="1" transform={`rotate(${b.r},${b.x},${b.y})`} />)}
      <circle cx="753" cy="103" r="13" fill="#e4dfc9" />
      <circle cx="753" cy="103" r="5" fill="#f3f1df" />
      <circle cx="645" cy="477" r="10" fill="#e4dfc9" />
    </svg>
  );
}