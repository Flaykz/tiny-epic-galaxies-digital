import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.js';
import { SplashScreen } from 'digital-boardgame-framework/client';
import './ui/styles.css';

async function renderApp() {
  const isLayoutLab = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('ui-lab') === 'board';

  if (isLayoutLab) {
    const { LayoutLab } = await import('./ui-lab/LayoutLab.js');
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <LayoutLab />
      </React.StrictMode>,
    );
    return;
  }

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <SplashScreen title="Tiny Epic Galaxies" appId="tiny-epic-galaxies" />
      <App />
    </React.StrictMode>,
  );
}

void renderApp();
