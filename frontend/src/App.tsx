import { useEffect } from 'react';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { NewJob } from './pages/NewJob';
import { JobDetail } from './pages/JobDetail';
import { History } from './pages/History';
import { Workers } from './pages/Workers';
import { Settings } from './pages/Settings';
import { useStore, registerProgressHandler, startPolling, recoverJobsOnLoad } from './store';

function Layout() {
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // 启动后台进度推送 + 轮询 + 恢复进行中的 job（全局一次）
  useEffect(() => {
    registerProgressHandler();
    startPolling();
    recoverJobsOnLoad();
  }, []);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'var(--color-surface)',
            color: 'var(--color-fg)',
            border: '1px solid var(--color-border)',
          },
        }}
      />
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<NewJob />} />
            <Route path="/jobs" element={<History />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/workers" element={<Workers />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="grid h-full place-items-center">
      <div className="text-center">
        <div className="text-3xl font-semibold text-muted">404</div>
        <p className="mt-2 text-sm text-muted">页面不存在</p>
        <button
          onClick={() => navigate('/')}
          className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
        >
          返回首页
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Layout />
    </HashRouter>
  );
}
