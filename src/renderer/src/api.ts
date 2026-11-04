import type { PriceyApi } from '../../shared/ipc.js'

declare global {
  interface Window {
    pricey: PriceyApi
  }
}

function resolveBridge(): PriceyApi {
  const bridge = (window as unknown as { pricey?: PriceyApi }).pricey
  if (!bridge) {
    throw new Error(
      'Pricey bridge (window.pricey) is missing — the preload script did not expose it. ' +
        'The app cannot talk to its database.',
    )
  }
  return bridge
}

/**
 * The renderer-side API. Access is lazy so a missing preload bridge throws a
 * clear error at the call site instead of failing silently at import time.
 */
export const api: PriceyApi = new Proxy({} as PriceyApi, {
  get(_target, prop) {
    const bridge = resolveBridge()
    const value = (bridge as unknown as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function' ? value.bind(bridge) : value
  },
})
