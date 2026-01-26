import { startDevServer } from '@farmjs/core/server'

startDevServer({
  root: process.cwd()
}, 3001).catch(console.error)
