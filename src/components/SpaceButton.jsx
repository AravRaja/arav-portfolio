export default function SpaceButton({
  stateClass,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
}) {
  return (
    <div className="space-full">
      <svg
        id="rectangle"
        className={stateClass}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        viewBox="0 0 400 50"
        xmlns="http://www.w3.org/2000/svg"
     >
        <path
          id="base-stroke"
          d="M 4 25 Q 4 5 26 5 H 376 Q 396 5 396 25
M 4 25 Q 4 45 26 45 H 376 Q 396 45 396 25"
        />
        <path
          id="stroke-top"
          d="M 4 25 Q 4 5 26 5 H 376 Q 396 5 396 25"
        />
        <path
          id="stroke-bottom"
          d="M 4 25 Q 4 45 26 45 H 376 Q 396 45 396 25"
        />
        <text
          className="space-label"
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          style={{ userSelect: 'none', pointerEvents: 'none' }}
        >
          HOLD SPACE
        </text>
      </svg>
      <svg id="space-base" viewBox="0 0 400 50" xmlns="http://www.w3.org/2000/svg">
        <path id="stroke-bottom-base" d="M 4 19 Q 4 45 26 45 H 376 Q 396 45 396 19" />
      </svg>
    </div>
  );
}
