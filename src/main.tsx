import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.js';
import { SplashScreen } from 'digital-boardgame-framework/client';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SplashScreen title="Tiny Epic Galaxies" appId="tiny-epic-galaxies" />
    <App />
  </React.StrictMode>,
);
