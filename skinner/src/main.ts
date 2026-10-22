import './game/style.css';
import { startGame } from './game/app';

const root = document.getElementById('app');
if (!root) throw new Error('Elemento #app não encontrado');
startGame(root);
