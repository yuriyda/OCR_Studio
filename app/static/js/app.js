// Точка входа frontend.
// Редактирование: только подключение модулей и биндинг event-обработчиков верхнего уровня.

import { state } from './state.js';

state.load();
console.log('OCR Service frontend loaded, active project:', state.activeProjectId);
