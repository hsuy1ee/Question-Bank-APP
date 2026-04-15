/// <reference types="vite/client" />

import type { QuizApi } from "../main/preload";

declare global {
  interface Window {
    quizApi: QuizApi;
  }
}
