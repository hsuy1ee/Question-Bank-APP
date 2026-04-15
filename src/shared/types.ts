export type QuestionType = "single" | "multiple" | "judge";

export type Difficulty = "easy" | "medium" | "hard";

export interface JsonlQuestion {
  id: string;
  type: QuestionType;
  question: string;
  options?: string[];
  answer: string[];
  explanation?: string;
  tags?: string[];
  difficulty?: Difficulty;
  source?: string;
}

export interface QuestionBank {
  id: number;
  name: string;
  questionCount: number;
  createdAt: string;
}

export interface PracticeQuestion {
  id: number;
  externalId: string;
  bankId: number;
  type: QuestionType;
  question: string;
  options: string[];
  explanation: string;
  tags: string[];
}

export interface ImportResult {
  bankId: number;
  bankName: string;
  imported: number;
  skipped: number;
  errors: string[];
}

export interface SubmitAnswerResult {
  correct: boolean;
  correctAnswer: string[];
  explanation: string;
}

export interface DashboardStats {
  bankCount: number;
  questionCount: number;
  attemptedCount: number;
  favoriteCount: number;
  wrongCount: number;
  accuracy: number;
}
