export function BeltIcon({ belt, width = 24, height = 20 }: {
  belt: { color: string; secondaryColor?: string }; width?: number; height?: number
}) {
  return <svg aria-hidden="true" width={width} height={height} viewBox="0 0 24 20">
    <path d="M2 5h20v6H2zM10 10l-3 8 5-2 2-6 3 8 4-2-5-7" fill={belt.color} stroke="currentColor" strokeWidth=".5" />
    {belt.secondaryColor && <path d="M2 8h20v3H2zM14 10l3 8 4-2-5-7" fill={belt.secondaryColor} />}
  </svg>
}
