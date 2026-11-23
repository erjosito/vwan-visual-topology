export function boundedCloudFetch(fetcher: typeof fetch, limit = 4 * 1024 * 1024): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init)
    if (!response.body) return response
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > limit) throw new Error('Cloud response is too large.')
        chunks.push(value)
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error }
    finally { reader.releaseLock() }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers })
  }
}
