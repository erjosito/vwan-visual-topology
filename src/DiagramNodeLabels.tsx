import { useId } from 'react'

export function DiagramNodeText({ text, title = text, x, y, width, fontSize = 12.5, className = '', fill, anchor = 'start', weight = 600 }: {
  text: string; x: number; y: number; width: number; fontSize?: number; className?: string; fill?: string;
  anchor?: 'start' | 'middle'; weight?: number; title?: string
}) {
  const clip = useId()
  const characters = [...text]
  const advances = characters.map((character) => (
    character.codePointAt(0)! > 127 || /[MW@%]/.test(character) ? 1.1 : /[ilI1.,:;/| ]/.test(character) ? .35 : .65
  ) * fontSize)
  let used = 0, end = 0
  for (const advance of advances) {
    if (used + advance > width - fontSize) break
    used += advance
    end++
  }
  const display = advances.reduce((sum, advance) => sum + advance, 0) <= width ? text : characters.slice(0, end).join('') + '\u2026'
  return <g className={`network-node-label ${className}`} fill={fill ?? 'var(--text)'}>
    <title>{title}</title>
    <defs><clipPath id={clip}><rect x={anchor === 'middle' ? x - width / 2 : x} y={y - fontSize * 1.15} width={width} height={fontSize * 1.6} /></clipPath></defs>
    <text x={x} y={y} textAnchor={anchor} fontSize={fontSize} fontWeight={weight} fill={fill} clipPath={`url(#${clip})`}>{display}</text>
  </g>
}

export function DiagramNodeBadge({ label, x, y, width, tone = 'muted', title = label }: {
  label: string; x: number; y: number; width: number; tone?: 'muted' | 'info' | 'warning' | 'success' | 'purple'; title?: string
}) {
  return <g className={`network-node-badge tone-${tone}`}>
    <title>{title}</title>
    <rect x={x} y={y} width={width} height={20} rx={5} />
    <DiagramNodeText text={label} title={title} x={x + width / 2} y={y + 13.5} width={width - 10} fontSize={9.5} anchor="middle" fill="currentColor" weight={700} />
  </g>
}
