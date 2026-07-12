import { useEffect } from 'react';

import { AiPanel } from './components/AiPanel';
import { EditorPane } from './components/EditorPane';
import { NewBookDialog } from './components/NewBookDialog';
import { ProvidersModal } from './components/ProvidersModal';
import { Sidebar } from './components/Sidebar';
import { SyncModal } from './components/SyncModal';
import { TopBar } from './components/TopBar';
import { useSessionStore } from './stores/session';

export function App() {
  const modal = useSessionStore((state) => state.modal);

  return (
    <div className="app">
      <TopBar />
      <div className="app-main">
        <Sidebar />
        <EditorPane />
        <AiPanel />
      </div>
      {modal === 'newBook' ? <NewBookDialog /> : null}
      {modal === 'providers' ? <ProvidersModal /> : null}
      {modal === 'sync' ? <SyncModal /> : null}
      <Toast />
    </div>
  );
}

function Toast() {
  const toast = useSessionStore((state) => state.toast);
  const clearToast = useSessionStore((state) => state.clearToast);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(clearToast, 5000);
    return () => window.clearTimeout(timer);
  }, [toast, clearToast]);

  if (!toast) {
    return null;
  }

  return (
    <div className={`toast toast-${toast.tone}`} onClick={clearToast}>
      {toast.message}
    </div>
  );
}
