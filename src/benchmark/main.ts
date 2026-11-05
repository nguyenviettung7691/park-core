import './style.css';
import { createBenchmarkPage } from './page';

const root = document.getElementById('benchmark');
if (!root) throw new Error('Benchmark root missing');
const page = createBenchmarkPage(root);
if (import.meta.hot) import.meta.hot.dispose(() => page.dispose());
