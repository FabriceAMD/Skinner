import './ui/styles.css';
import { startApp } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('Elemento #app não encontrado');
startApp(root);
