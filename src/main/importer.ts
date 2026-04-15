import fs from "node:fs";
import path from "node:path";
import type { ImportResult, JsonlQuestion, QuestionType } from "../shared/types.js";
import { createQuestionBank, importQuestions } from "./database.js";

const difficulties = new Set(["easy", "medium", "hard"]);
const typeMap: Record<string, QuestionType> = {
  single: "single",
  multiple: "multiple",
  judge: "judge",
  单选: "single",
  多选: "multiple",
  判断: "judge"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateQuestion(value: unknown, line: number): { question?: JsonlQuestion; error?: string } {
  if (!isRecord(value)) return { error: `第 ${line} 行不是对象。` };
  if (typeof value.id !== "string" || value.id.trim() === "") return { error: `第 ${line} 行缺少有效 id。` };
  if (typeof value.type !== "string" || !typeMap[value.type]) return { error: `第 ${line} 行 type 必须是 单选、多选、判断。` };
  if (typeof value.question !== "string" || value.question.trim() === "") return { error: `第 ${line} 行缺少题干 question。` };
  if (!Array.isArray(value.answer) || value.answer.length === 0 || !value.answer.every((item) => typeof item === "string")) return { error: `第 ${line} 行 answer 必须是非空字符串数组。` };

  const type = typeMap[value.type];
  if ((type === "single" || type === "multiple") && (!Array.isArray(value.options) || !value.options.every((item) => typeof item === "string"))) {
    return { error: `第 ${line} 行单选/多选题必须提供 options 字符串数组。` };
  }
  if (type === "single" && value.answer.length !== 1) return { error: `第 ${line} 行单选题只能有一个答案。` };
  if (type === "judge" && !["true", "false"].includes(value.answer[0] as string)) return { error: `第 ${line} 行判断题 answer 必须是 ["true"] 或 ["false"]。` };
  if (value.tags !== undefined && (!Array.isArray(value.tags) || !value.tags.every((item) => typeof item === "string"))) return { error: `第 ${line} 行 tags 必须是字符串数组。` };
  if (value.difficulty !== undefined && (typeof value.difficulty !== "string" || !difficulties.has(value.difficulty))) return { error: `第 ${line} 行 difficulty 必须是 easy、medium 或 hard。` };

  return {
    question: {
      id: value.id.trim(),
      type,
      question: value.question.trim(),
      options: Array.isArray(value.options) ? value.options.map(String) : [],
      answer: value.answer.map(String),
      explanation: typeof value.explanation === "string" ? value.explanation : "",
      tags: [],
      difficulty: value.difficulty as JsonlQuestion["difficulty"],
      source: typeof value.source === "string" ? value.source : undefined
    }
  };
}

export function importJsonlFile(filePath: string): ImportResult {
  const content = fs.readFileSync(filePath, "utf8");
  const questions: JsonlQuestion[] = [];
  const errors: string[] = [];

  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const result = validateQuestion(JSON.parse(trimmed) as unknown, index + 1);
      if (result.question) questions.push(result.question);
      if (result.error) errors.push(result.error);
    } catch {
      errors.push(`第 ${index + 1} 行不是合法 JSON。`);
    }
  });

  if (questions.length === 0) {
    throw new Error(errors.length > 0 ? errors.join("\n") : "没有找到可导入的题目。");
  }

  const bankName = path.basename(filePath, path.extname(filePath));
  const bankId = createQuestionBank(bankName);
  const imported = importQuestions(bankId, questions);
  return { bankId, bankName, imported, skipped: errors.length, errors };
}
