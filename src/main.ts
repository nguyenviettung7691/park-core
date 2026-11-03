import './style.css';
import { createApp } from './app';

const root = document.getElementById('app');
if (!root) throw new Error('Application root missing');
const app = createApp(root);
if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
