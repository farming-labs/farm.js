import { startDevServer } from 'farm/server'

startDevServer({
  root: process.cwd()
}, 3001).catch(console.error)
