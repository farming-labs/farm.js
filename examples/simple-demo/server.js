import { startDevServer } from '@farm.js/core/server'

startDevServer({
  root: process.cwd()
}, 3001).catch(console.error)
