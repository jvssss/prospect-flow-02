import { useEffect, useState } from "react";

type Props = {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  glow?: boolean;
  children?: React.ReactNode;
};

export function RadialProgress({
  value,
  max,
  size = 128,
  stroke = 12,
  color = "var(--primary)",
  trackColor = "color-mix(in oklab, var(--primary) 10%, transparent)",
  glow = false,
  children,
}: Props) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [offset, setOffset] = useState(c);

  useEffect(() => {
    const t = requestAnimationFrame(() => setOffset(c * (1 - pct)));
    return () => cancelAnimationFrame(t);
  }, [c, pct]);

  return (
    <div
      className="relative grid place-items-center"
      style={{ width: size, height: size, filter: glow ? `drop-shadow(0 0 18px ${color})` : undefined }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 800ms cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}