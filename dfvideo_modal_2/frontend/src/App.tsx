import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import HomePage from './pages/HomePage';
import VideoPage from './pages/VideoPage';
import TextPage from './pages/TextPage';
import DemoGeneratePage from './pages/DemoGeneratePage';
import './styles/global.css';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <Header />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/video" element={<VideoPage />} />
            <Route path="/text" element={<TextPage />} />
            {/* 시연 전용 독립 경로 (메인 내비 미노출) */}
            <Route path="/demo/generate" element={<DemoGeneratePage />} />
            <Route path="/generate" element={<DemoGeneratePage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
