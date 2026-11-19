import { useEffect, useEffectEvent } from 'react'
import { guidanceAnchor } from './guidance'
import { registeredGuidanceAnchors, visibleGuidanceBox } from './guidance-anchors'
import type { LearningObservation } from './runner'

export function LearningInspection({ observation, prefixPresent, onObserve }: {
  observation: LearningObservation
  prefixPresent: boolean
  onObserve?: (event: LearningObservation) => void
}) {
  const report = useEffectEvent((event: LearningObservation) => onObserve?.(event))
  useEffect(() => {
    const key = observation.vnetId && observation.subnetId
      ? prefixPresent ? guidanceAnchor('effective-prefix', observation.vnetId, observation.subnetId, observation.prefix)
        : guidanceAnchor('effective-table', observation.vnetId, observation.subnetId)
      : observation.hubId && observation.tableId
        ? prefixPresent ? guidanceAnchor('hub-effective-prefix', observation.hubId, observation.tableId, observation.prefix)
          : guidanceAnchor('hub-effective-table', observation.hubId, observation.tableId)
        : observation.siteId
          ? prefixPresent ? guidanceAnchor('site-effective-prefix', observation.siteId, observation.prefix)
            : guidanceAnchor('site-effective-table', observation.siteId)
          : undefined
    let visibleSince: number | undefined
    const timer = setInterval(() => {
      const visible = document.visibilityState === 'visible' && key && registeredGuidanceAnchors().some((element) => {
        if (element.getAttribute('data-learning-anchor') !== key) return false
        const evidence = prefixPresent ? Array.from(element.querySelectorAll('code'))
          .find((candidate) => candidate.textContent === observation.prefix) : element
        if (!evidence) return false
        const box = visibleGuidanceBox(evidence), bounds = evidence.getBoundingClientRect()
        return box && (prefixPresent ? box.width + 1 >= bounds.width && box.height + 1 >= bounds.height
          : box.width >= 80 && box.height >= 18)
      })
      if (!visible) { visibleSince = undefined; return }
      visibleSince ??= performance.now()
      if (performance.now() - visibleSince < 750) return
      clearInterval(timer)
      report(observation)
    }, 150)
    return () => clearInterval(timer)
  }, [observation, prefixPresent])
  return null
}
