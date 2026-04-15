import { BrowserWindow, app, dialog, ipcMain } from "electron";
import path from "node:path";
import {
  clearPracticeSession,
  deleteQuestionBank,
  getDashboardStats,
  getLastPracticeSession,
  getPracticeQuestions,
  initDatabase,
  listFavoriteIds,
  listQuestionBanks,
  savePracticeSession,
  setFavorite,
  submitAnswer
} from "./database.js";
import { importJsonlFile } from "./importer.js";

const windowIcon = app.isPackaged ? undefined : path.join(__dirname, "../../build/icon.ico");

async function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    icon: windowIcon,
    title: "题库刷题软件",
    backgroundColor: "#f7f8fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await window.loadFile(path.join(__dirname, "../../dist/index.html"));
}

app.whenReady().then(async () => {
  await initDatabase();
  ipcMain.handle("stats:get", (_event, bankId?: number) => getDashboardStats(bankId));
  ipcMain.handle("banks:list", () => listQuestionBanks());
  ipcMain.handle("banks:import-jsonl", async () => {
    const result = await dialog.showOpenDialog({ title: "选择 JSONL 题库文件", filters: [{ name: "JSONL 题库", extensions: ["jsonl"] }], properties: ["openFile"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return importJsonlFile(result.filePaths[0]);
  });
  ipcMain.handle("banks:delete", (_event, bankId: number) => deleteQuestionBank(bankId));
  ipcMain.handle("practice:list", (_event, bankId: number, mode: "sequential" | "random" | "wrong" | "favorite") => getPracticeQuestions(bankId, mode));
  ipcMain.handle("practice:submit", (_event, questionId: number, selectedAnswer: string[]) => submitAnswer(questionId, selectedAnswer));
  ipcMain.handle("practice:save-session", (_event, session) => savePracticeSession(session));
  ipcMain.handle("practice:get-last-session", () => getLastPracticeSession());
  ipcMain.handle("practice:clear-session", () => clearPracticeSession());
  ipcMain.handle("favorites:set", (_event, questionId: number, favorite: boolean) => setFavorite(questionId, favorite));
  ipcMain.handle("favorites:list", () => listFavoriteIds());

  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
