import { executePlatform } from './service'

self.onmessage = ({ data }: MessageEvent<unknown>) => {
  self.postMessage(executePlatform(data))
}
