import { useState } from 'react';
import { NavLink } from 'react-router-dom';

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="header">
      <div className="header-inner">
        <NavLink to="/" className="logo" onClick={() => setMenuOpen(false)}>
          🛡️ <span className="logo-text">Fact-Trace AI</span>
        </NavLink>
        <button
          className="menu-toggle"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="메뉴 열기/닫기"
        >
          {menuOpen ? '✕' : '☰'}
        </button>
        <nav className={`nav ${menuOpen ? 'nav--open' : ''}`}>
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            onClick={() => setMenuOpen(false)}
          >
            홈
          </NavLink>
          <NavLink
            to="/video"
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            onClick={() => setMenuOpen(false)}
          >
            영상 탐지
          </NavLink>
          <NavLink
            to="/text"
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            onClick={() => setMenuOpen(false)}
          >
            텍스트 탐지
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
