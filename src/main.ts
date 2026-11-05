import './style.css';
import { createApp } from './app';
import { dispatchAppObservation } from './app-observation';

const root = document.getElementById('app');
if (!root) throw new Error('Application root missing');
const app = createApp(root, import.meta.env.DEV ? { onObservation: dispatchAppObservation } : {});
if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());