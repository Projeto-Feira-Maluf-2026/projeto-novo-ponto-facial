interface ConstructionScene3DProps {
  compact?: boolean;
  className?: string;
}

export function ConstructionScene3D({ compact = false, className = '' }: ConstructionScene3DProps) {
  return (
    <div
      className={`construction-scene ${className}`.trim()}
      data-compact={compact}
      aria-hidden="true"
    >
      <div className="construction-scene-grid" />
      <div className="construction-coordinate construction-coordinate-x">EIXO 04</div>
      <div className="construction-coordinate construction-coordinate-y">NÍVEL +18.40</div>

      <div className="construction-viewport">
        <div className="construction-model">
          <div className="construction-ground">
            <span className="ground-line ground-line-a" />
            <span className="ground-line ground-line-b" />
            <span className="ground-mark ground-mark-a" />
            <span className="ground-mark ground-mark-b" />
          </div>

          <div className="building-model">
            <div className="building-base building-volume">
              <span className="building-face building-face-front" />
              <span className="building-face building-face-side" />
              <span className="building-face building-face-top" />
            </div>

            <div className="building-tower building-volume">
              <span className="building-face building-face-front building-windows" />
              <span className="building-face building-face-side building-windows" />
              <span className="building-face building-face-top" />
              <span className="building-floor building-floor-1" />
              <span className="building-floor building-floor-2" />
              <span className="building-floor building-floor-3" />
              <span className="building-floor building-floor-4" />
            </div>

            <div className="building-core building-volume">
              <span className="building-face building-face-front" />
              <span className="building-face building-face-side" />
              <span className="building-face building-face-top" />
            </div>

            <div className="building-scaffold">
              <span /><span /><span /><span />
            </div>
          </div>

          <div className="crane-model">
            <span className="crane-foot" />
            <span className="crane-mast" />
            <span className="crane-boom" />
            <span className="crane-counterweight" />
            <span className="crane-cable" />
            <span className="crane-hook" />
          </div>
        </div>
      </div>

      <div className="construction-legend">
        <span>MODELO ESTRUTURAL</span>
        <strong>OBRA / 01</strong>
      </div>
      <div className="construction-scale"><span /> 0&nbsp;&nbsp;5&nbsp;&nbsp;10m</div>
    </div>
  );
}
