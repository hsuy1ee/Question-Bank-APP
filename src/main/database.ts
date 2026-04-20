import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import type {
  DashboardStats,
  JsonlQuestion,
  PracticeMode,
  PracticeQuestion,
  PracticeSessionRestore,
  PracticeSessionSnapshot,
  QuestionBank,
  QuestionType,
  SubmitAnswerResult
} from "../shared/types.js";

const nodeRequire = createRequire(__filename);
type SqlParam = number | string | Uint8Array | null;
let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let dbPath = "";

function now() {
  return new Date().toISOString();
}

function getDb() {
  if (!db) throw new Error("Database is not initialized.");
  return db;
}

function rows<T>(stmt: ReturnType<Database["prepare"]>, params: SqlParam[] = []): T[] {
  stmt.bind(params);
  const result: T[] = [];
  while (stmt.step()) result.push(stmt.getAsObject() as T);
  stmt.free();
  return result;
}

function scalar<T>(sql: string, params: SqlParam[] = []): T {
  const stmt = getDb().prepare(sql);
  stmt.bind(params);
  const value = stmt.step() ? (stmt.get()[0] as T) : (undefined as T);
  stmt.free();
  return value;
}

export async function initDatabase() {
  if (!SQL) {
    SQL = await initSqlJs({ locateFile: () => nodeRequire.resolve("sql.js/dist/sql-wasm.wasm") });
  }
  dbPath = path.join(app.getPath("userData"), "question-bank.sqlite");
  db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
  getDb().run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS question_banks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_id INTEGER NOT NULL,
      external_id TEXT NOT NULL,
      type TEXT NOT NULL,
      question TEXT NOT NULL,
      options_json TEXT NOT NULL,
      answer_json TEXT NOT NULL,
      explanation TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      difficulty TEXT,
      source TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(bank_id, external_id),
      FOREIGN KEY(bank_id) REFERENCES question_banks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      selected_answer_json TEXT NOT NULL,
      correct INTEGER NOT NULL,
      answered_at TEXT NOT NULL,
      FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS favorites (
      question_id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL,
      FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS practice_sessions (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bank_id INTEGER NOT NULL,
      mode TEXT NOT NULL,
      question_ids_json TEXT NOT NULL,
      current_index INTEGER NOT NULL,
      answer_states_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(bank_id) REFERENCES question_banks(id) ON DELETE CASCADE
    );
  `);
  persistDatabase();
}

export function persistDatabase() {
  if (!db || !dbPath) return;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

export function createQuestionBank(name: string) {
  getDb().run("INSERT INTO question_banks (name, created_at) VALUES (?, ?)", [name, now()]);
  const bankId = scalar<number>("SELECT id FROM question_banks ORDER BY id DESC LIMIT 1");
  persistDatabase();
  return bankId;
}

export function importQuestions(bankId: number, questions: JsonlQuestion[]) {
  const database = getDb();
  const insert = database.prepare(`
    INSERT OR REPLACE INTO questions
    (bank_id, external_id, type, question, options_json, answer_json, explanation, tags_json, difficulty, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let imported = 0;
  database.run("BEGIN TRANSACTION");
  try {
    for (const item of questions) {
      insert.run([bankId, item.id, item.type, item.question, JSON.stringify(item.options ?? []), JSON.stringify(item.answer), item.explanation ?? "", JSON.stringify(item.tags ?? []), item.difficulty ?? null, item.source ?? null, now()]);
      imported += 1;
    }
    insert.free();
    database.run("COMMIT");
  } catch (error) {
    insert.free();
    database.run("ROLLBACK");
    throw error;
  }
  persistDatabase();
  return imported;
}

export function listQuestionBanks(): QuestionBank[] {
  return rows<QuestionBank>(getDb().prepare(`
    SELECT b.id, b.name, b.created_at as createdAt, COUNT(q.id) as questionCount
    FROM question_banks b
    LEFT JOIN questions q ON q.bank_id = b.id
    GROUP BY b.id
    ORDER BY b.created_at DESC
  `));
}

export function deleteQuestionBank(bankId: number) {
  getDb().run("DELETE FROM practice_sessions WHERE bank_id = ?", [bankId]);
  getDb().run("DELETE FROM attempts WHERE question_id IN (SELECT id FROM questions WHERE bank_id = ?)", [bankId]);
  getDb().run("DELETE FROM favorites WHERE question_id IN (SELECT id FROM questions WHERE bank_id = ?)", [bankId]);
  getDb().run("DELETE FROM questions WHERE bank_id = ?", [bankId]);
  getDb().run("DELETE FROM question_banks WHERE id = ?", [bankId]);
  persistDatabase();
}

export function clearPracticeHistory(bankId: number) {
  getDb().run("DELETE FROM practice_sessions WHERE bank_id = ?", [bankId]);
  getDb().run("DELETE FROM attempts WHERE question_id IN (SELECT id FROM questions WHERE bank_id = ?)", [bankId]);
  persistDatabase();
}

export function getPracticeQuestions(bankId: number, mode: "sequential" | "random" | "wrong" | "favorite") {
  const orderClause = mode === "random" ? "ORDER BY random()" : "ORDER BY q.id ASC";
  const whereParts = ["q.bank_id = ?"];
  if (mode === "wrong") whereParts.push("EXISTS (SELECT 1 FROM attempts a WHERE a.question_id = q.id AND a.correct = 0)");
  if (mode === "favorite") whereParts.push("EXISTS (SELECT 1 FROM favorites f WHERE f.question_id = q.id)");

  const records = rows<{ id: number; externalId: string; bankId: number; type: QuestionType; question: string; optionsJson: string; explanation: string; tagsJson: string }>(
    getDb().prepare(`
      SELECT q.id, q.external_id as externalId, q.bank_id as bankId, q.type, q.question,
             q.options_json as optionsJson, q.explanation, q.tags_json as tagsJson
      FROM questions q
      WHERE ${whereParts.join(" AND ")}
      ${orderClause}
    `),
    [bankId]
  );

  return records.map<PracticeQuestion>((record) => ({
    id: record.id,
    externalId: record.externalId,
    bankId: record.bankId,
    type: record.type,
    question: record.question,
    options: JSON.parse(record.optionsJson) as string[],
    explanation: record.explanation,
    tags: JSON.parse(record.tagsJson) as string[]
  }));
}

export function getPracticeQuestionsByIds(questionIds: number[]) {
  if (questionIds.length === 0) return [];
  const placeholders = questionIds.map(() => "?").join(", ");
  const records = rows<{ id: number; externalId: string; bankId: number; type: QuestionType; question: string; optionsJson: string; explanation: string; tagsJson: string }>(
    getDb().prepare(`
      SELECT q.id, q.external_id as externalId, q.bank_id as bankId, q.type, q.question,
             q.options_json as optionsJson, q.explanation, q.tags_json as tagsJson
      FROM questions q
      JOIN question_banks b ON b.id = q.bank_id
      WHERE q.id IN (${placeholders})
    `),
    questionIds
  );
  const byId = new Map(records.map((record) => [record.id, record]));
  return questionIds.flatMap<PracticeQuestion>((id) => {
    const record = byId.get(id);
    if (!record) return [];
    return [{
      id: record.id,
      externalId: record.externalId,
      bankId: record.bankId,
      type: record.type,
      question: record.question,
      options: JSON.parse(record.optionsJson) as string[],
      explanation: record.explanation,
      tags: JSON.parse(record.tagsJson) as string[]
    }];
  });
}

export function savePracticeSession(session: PracticeSessionSnapshot) {
  getDb().run(
    `
      INSERT OR REPLACE INTO practice_sessions
      (id, bank_id, mode, question_ids_json, current_index, answer_states_json, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?)
    `,
    [
      session.bankId,
      session.mode,
      JSON.stringify(session.questionIds),
      session.currentIndex,
      JSON.stringify(session.answerStates),
      now()
    ]
  );
  persistDatabase();
}

export function getLastPracticeSession(): PracticeSessionRestore | null {
  const record = rows<{
    bankId: number;
    mode: PracticeMode;
    questionIdsJson: string;
    currentIndex: number;
    answerStatesJson: string;
  }>(
    getDb().prepare(`
      SELECT bank_id as bankId, mode, question_ids_json as questionIdsJson,
             current_index as currentIndex, answer_states_json as answerStatesJson
      FROM practice_sessions
      WHERE id = 1
    `)
  )[0];

  if (!record) return null;

  const questionIds = JSON.parse(record.questionIdsJson) as number[];
  const questions = getPracticeQuestionsByIds(questionIds);
  if (questions.length !== questionIds.length) {
    clearPracticeSession();
    return null;
  }

  return {
    bankId: record.bankId,
    mode: record.mode,
    questionIds,
    currentIndex: Math.min(record.currentIndex, Math.max(questions.length - 1, 0)),
    answerStates: JSON.parse(record.answerStatesJson) as PracticeSessionRestore["answerStates"],
    questions
  };
}

export function clearPracticeSession() {
  getDb().run("DELETE FROM practice_sessions WHERE id = 1");
  persistDatabase();
}

export function submitAnswer(questionId: number, selectedAnswer: string[]): SubmitAnswerResult {
  const record = rows<{ answerJson: string; explanation: string }>(getDb().prepare("SELECT answer_json as answerJson, explanation FROM questions WHERE id = ?"), [questionId])[0];
  if (!record) throw new Error("题目不存在。");

  const correctAnswer = JSON.parse(record.answerJson) as string[];
  const normalize = (values: string[]) => [...values].sort().join("|");
  const correct = normalize(selectedAnswer) === normalize(correctAnswer);
  getDb().run("INSERT INTO attempts (question_id, selected_answer_json, correct, answered_at) VALUES (?, ?, ?, ?)", [questionId, JSON.stringify(selectedAnswer), correct ? 1 : 0, now()]);
  persistDatabase();
  return { correct, correctAnswer, explanation: record.explanation };
}

export function setFavorite(questionId: number, favorite: boolean) {
  if (favorite) getDb().run("INSERT OR IGNORE INTO favorites (question_id, created_at) VALUES (?, ?)", [questionId, now()]);
  else getDb().run("DELETE FROM favorites WHERE question_id = ?", [questionId]);
  persistDatabase();
}

export function listFavoriteIds() {
  return rows<{ questionId: number }>(getDb().prepare("SELECT question_id as questionId FROM favorites")).map((row) => row.questionId);
}

export function getDashboardStats(bankId?: number): DashboardStats {
  const bankFilter = typeof bankId === "number" ? " AND q.bank_id = ?" : "";
  const bankParams = typeof bankId === "number" ? [bankId] : [];
  const bankCount = scalar<number>("SELECT COUNT(*) FROM question_banks") ?? 0;
  const questionCount = scalar<number>(`SELECT COUNT(*) FROM questions q JOIN question_banks b ON b.id = q.bank_id WHERE 1=1${bankFilter}`, bankParams) ?? 0;
  const attemptedCount = scalar<number>(`SELECT COUNT(DISTINCT a.question_id) FROM attempts a JOIN questions q ON q.id = a.question_id JOIN question_banks b ON b.id = q.bank_id WHERE 1=1${bankFilter}`, bankParams) ?? 0;
  const favoriteCount = scalar<number>(`SELECT COUNT(*) FROM favorites f JOIN questions q ON q.id = f.question_id JOIN question_banks b ON b.id = q.bank_id WHERE 1=1${bankFilter}`, bankParams) ?? 0;
  const wrongCount = scalar<number>(`SELECT COUNT(DISTINCT a.question_id) FROM attempts a JOIN questions q ON q.id = a.question_id JOIN question_banks b ON b.id = q.bank_id WHERE a.correct = 0${bankFilter}`, bankParams) ?? 0;
  const totalAttempts = scalar<number>(`SELECT COUNT(*) FROM attempts a JOIN questions q ON q.id = a.question_id JOIN question_banks b ON b.id = q.bank_id WHERE 1=1${bankFilter}`, bankParams) ?? 0;
  const correctAttempts = scalar<number>(`SELECT COUNT(*) FROM attempts a JOIN questions q ON q.id = a.question_id JOIN question_banks b ON b.id = q.bank_id WHERE a.correct = 1${bankFilter}`, bankParams) ?? 0;
  return { bankCount, questionCount, attemptedCount, favoriteCount, wrongCount, accuracy: totalAttempts === 0 ? 0 : Math.round((correctAttempts / totalAttempts) * 1000) / 10 };
}
