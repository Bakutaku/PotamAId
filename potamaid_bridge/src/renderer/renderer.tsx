import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('root 要素が見つかりません');
}

createRoot(container).render(<App />);
