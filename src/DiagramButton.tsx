import { Children, cloneElement, isValidElement, useId, type ReactNode, type SVGProps } from 'react'
import { DiagramNodeBadge, DiagramNodeText } from './DiagramNodeLabels'

export function DiagramButton({ children, description, ...props }: SVGProps<SVGGElement> & { description?: ReactNode }) {
  const labelId = useId()
  const descriptionId = useId()
  const detailsId = useId()
  const labels: string[] = []
  // Reference the rendered SVG text, including clipping, instead of duplicating its content.
  const labelContent = (content: ReactNode): ReactNode => Children.map(content, (child) => {
    if (!isValidElement<{ id?: string; children?: ReactNode; 'aria-hidden'?: boolean | 'true' | 'false' }>(child)
      || child.props['aria-hidden'] === true || child.props['aria-hidden'] === 'true') return child
    if (child.type === DiagramNodeText || child.type === DiagramNodeBadge || child.type === 'text') {
      const id = `${labelId}-${labels.length}`
      labels.push(id)
      return cloneElement(child, { id, ...(child.type === 'text' ? { children: [child.props.children, ' '] } : {}) })
    }
    return typeof child.type === 'string' && child.props.children
      ? cloneElement(child, { children: labelContent(child.props.children) }) : child
  })
  const content = labelContent(children)
  return <>
    <g {...props} aria-labelledby={[descriptionId, ...labels].join(' ')}
      aria-describedby={[props['aria-describedby'], description ? detailsId : undefined].filter(Boolean).join(' ') || undefined}>
      {content}
      <desc id={descriptionId}>{props['aria-label']}</desc>
    </g>
    {description && <g id={detailsId} transform={props.transform} pointerEvents="none">{description}</g>}
  </>
}
