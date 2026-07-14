import { useEffect } from 'react';

import { AiPanel } from './components/AiPanel';
import { EditorPane } from './components/EditorPane';
import { NewBookDialog } from './components/NewBookDialog';
import { ProvidersModal } from './components/ProvidersModal';
import { Sidebar } from './components/Sidebar';
import { SyncModal } from './components/SyncModal';
import { TopBar } from './components/TopBar';
import { useSessionStore } from './stores/session';
import { useUiStore } from './stores/ui';

export function App() {
  const modal = useSessionStore((state) => state.modal);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === '\\') {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar]);

  return (
    <div className="app">
      <TopBar />
      <div className={`app-main${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <Sidebar inert={sidebarCollapsed} />
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
