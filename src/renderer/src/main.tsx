import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.js'
import './design-tokens.css'
import './app.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
