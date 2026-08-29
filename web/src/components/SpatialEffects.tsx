import type { CSSProperties } from 'react';

export function TerminalTotem3D({ active, faceCount }: { active: boolean; faceCount: number }) {
  return (
    <div className="terminal-spatial-layer" data-active={active} data-faces={faceCount > 0} aria-hidden="true">
      <div className="terminal-depth-grid" />
      <div className="terminal-scan-volume" />
      <div className="terminal-totem-3d">
        <span className="terminal-totem-head"><i /></span>
        <span className="terminal-totem-neck" />
        <span className="terminal-totem-body"><i /><i /><i /></span>
        <span className="terminal-totem-base" />
      </div>
    </div>
  );
}

export function GlassCheckmark3D() {
  return (
    <span className="glass-checkmark-3d" aria-hidden="true">
      <i />
    </span>
  );
}

export function DataFlowCubes() {
  return (
    <div className="data-flow-cubes" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span key={index} style={{ '--cube-index': index } as CSSProperties}>
          <i /><i /><i />
        </span>
      ))}
    </div>
  );
}
