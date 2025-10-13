import { defineConfig } from 'farm/vite'

export default defineConfig({
  experimental: {
    serverComponents: true,
    serverActions: true
  }
})

