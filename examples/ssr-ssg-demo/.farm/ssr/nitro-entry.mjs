// Farm.js Nitro Entry
// This file imports h3 and the SSR handler, wrapping it for Nitro

import { fromWebHandler } from 'h3'
import handler from './_virtual_farm-ssr-entry.js'

// Export the wrapped handler for Nitro
export default fromWebHandler(handler.fetch)