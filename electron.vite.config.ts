import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: resolve('out/main') },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: resolve('out/preload') },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    build: { outDir: resolve('out/renderer') },
  },
})
