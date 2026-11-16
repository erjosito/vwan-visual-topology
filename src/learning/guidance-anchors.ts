export function visibleGuidanceBox(element: Element) {
  if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.matches(':disabled,[aria-disabled="true"]')) return
  const box = element.getBoundingClientRect()
  let left = Math.max(0, box.left), top = Math.max(0, box.top)
  let right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom)
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right) }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom) }
  }
  if (right - left < 4 || bottom - top < 4) return
  const foreground = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
  if (!foreground || !element.contains(foreground) && !foreground.contains(element)) return
  return { left, top, width: right - left, height: bottom - top }
}

export const registeredGuidanceAnchors = () =>
  Array.from(document.querySelectorAll('[data-learning-scope="azure-net"] [data-learning-anchor]'))

export function focusGuidanceTarget(anchors: string[]) {
  const registered = registeredGuidanceAnchors()
  for (const key of anchors) {
    const target = registered.find((element) => element.getAttribute('data-learning-anchor') === key && visibleGuidanceBox(element))
    if (!(target instanceof HTMLElement)) continue
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1')
      target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true })
    }
    target.focus({ preventScroll: true })
    return
  }
}
