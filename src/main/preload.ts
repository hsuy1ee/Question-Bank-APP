import { contextBridge, ipcRenderer } from "electron";
import type { DashboardStats, ImportResult, PracticeMode, PracticeQuestion, PracticeSessionRestore, PracticeSessionSnapshot, QuestionBank, SubmitAnswerResult } from "../shared/types.js";

const api = {
  getStats: (bankId?: number) => ipcRenderer.invoke("stats:get", bankId) as Promise<DashboardStats>,
  listBanks: () => ipcRenderer.invoke("banks:list") as Promise<QuestionBank[]>,
  importJsonl: () => ipcRenderer.invoke("banks:import-jsonl") as Promise<ImportResult | null>,
  deleteBank: (bankId: number) => ipcRenderer.invoke("banks:delete", bankId) as Promise<void>,
  getPracticeQuestions: (bankId: number, mode: PracticeMode) => ipcRenderer.invoke("practice:list", bankId, mode) as Promise<PracticeQuestion[]>,
  submitAnswer: (questionId: number, selectedAnswer: string[]) => ipcRenderer.invoke("practice:submit", questionId, selectedAnswer) as Promise<SubmitAnswerResult>,
  savePracticeSession: (session: PracticeSessionSnapshot) => ipcRenderer.invoke("practice:save-session", session) as Promise<void>,
  getLastPracticeSession: (bankId?: number) => ipcRenderer.invoke("practice:get-last-session", bankId) as Promise<PracticeSessionRestore | null>,
  clearPracticeHistory: (bankId: number) => ipcRenderer.invoke("practice:clear-history", bankId) as Promise<void>,
  clearPracticeSession: (bankId?: number) => ipcRenderer.invoke("practice:clear-session", bankId) as Promise<void>,
  setFavorite: (questionId: number, favorite: boolean) => ipcRenderer.invoke("favorites:set", questionId, favorite) as Promise<void>,
  listFavoriteIds: () => ipcRenderer.invoke("favorites:list") as Promise<number[]>
};

contextBridge.exposeInMainWorld("quizApi", api);

export type QuizApi = typeof api;
