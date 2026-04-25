// Конфигурация vitest для frontend unit-тестов.
// Редактирование: менять только при добавлении нового алиаса/окружения.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/frontend/**/*.test.js'],
    globals: false,
  },
});
