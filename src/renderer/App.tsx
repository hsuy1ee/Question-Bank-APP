import { useEffect, useMemo, useState } from "react";
import type { DashboardStats, ImportResult, PracticeQuestion, QuestionBank, SubmitAnswerResult } from "../shared/types";

type Page = "home" | "banks" | "practice";
type PracticeMode = "sequential" | "random" | "wrong" | "favorite";

const modeLabels: Record<PracticeMode, string> = {
  sequential: "顺序练习",
  random: "随机练习",
  wrong: "错题练习",
  favorite: "收藏练习"
};

const questionTypeLabels = {
  single: "单选",
  multiple: "多选",
  judge: "判断"
} as const;

function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

function formatCorrectAnswer(question: PracticeQuestion, answer: string[]) {
  if (question.type === "judge") {
    return answer[0] === "true" ? "TRUE" : "FALSE";
  }
  return answer.join("、");
}

function App() {
  const [page, setPage] = useState<Page>("home");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<number | null>(null);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("sequential");
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string[]>([]);
  const [answerResult, setAnswerResult] = useState<SubmitAnswerResult | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");

  const currentQuestion = questions[currentIndex];
  const visibleTags = currentQuestion ? currentQuestion.tags.filter((tag) => tag !== questionTypeLabels[currentQuestion.type]) : [];
  const selectedBank = useMemo(() => banks.find((bank) => bank.id === selectedBankId) ?? banks[0], [banks, selectedBankId]);
  const api = window.quizApi;

  function requireDesktopApi() {
    if (!api) {
      setMessage("桌面端接口未加载。请使用 npm run dev 启动 Electron 窗口，不要直接在浏览器里打开 127.0.0.1:5173。");
      return null;
    }
    return api;
  }

  async function refresh() {
    const desktopApi = requireDesktopApi();
    if (!desktopApi) return;
    const [nextStats, nextBanks, nextFavorites] = await Promise.all([desktopApi.getStats(), desktopApi.listBanks(), desktopApi.listFavoriteIds()]);
    setStats(nextStats);
    setBanks(nextBanks);
    setFavoriteIds(new Set(nextFavorites));
    if (!selectedBankId && nextBanks[0]) setSelectedBankId(nextBanks[0].id);
  }

  useEffect(() => {
    if (api) {
      void refresh();
    } else {
      setMessage("桌面端接口未加载。请使用 npm run dev 启动 Electron 窗口，不要直接在浏览器里打开 127.0.0.1:5173。");
    }
  }, []);

  async function handleImport() {
    const desktopApi = requireDesktopApi();
    if (!desktopApi) return;
    setMessage("");
    try {
      const result: ImportResult | null = await desktopApi.importJsonl();
      if (!result) return;
      await refresh();
      setSelectedBankId(result.bankId);
      setMessage(`已导入 ${result.bankName}：${result.imported} 题，跳过 ${result.skipped} 行。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导入失败。");
    }
  }

  async function handleDeleteBank(bankId: number) {
    const desktopApi = requireDesktopApi();
    if (!desktopApi) return;
    await desktopApi.deleteBank(bankId);
    setSelectedBankId(null);
    setQuestions([]);
    await refresh();
  }

  async function startPractice(mode: PracticeMode) {
    const desktopApi = requireDesktopApi();
    if (!desktopApi) return;
    if (!selectedBank) {
      setMessage("请先导入题库。");
      return;
    }
    const nextQuestions = await desktopApi.getPracticeQuestions(selectedBank.id, mode);
    setPracticeMode(mode);
    setQuestions(nextQuestions);
    setCurrentIndex(0);
    setSelectedAnswer([]);
    setAnswerResult(null);
    setMessage(nextQuestions.length === 0 ? `${modeLabels[mode]}暂无可用题目。` : "");
    setPage("practice");
  }

  async function toggleAnswer(value: string) {
    if (!currentQuestion || answerResult) return;
    if (currentQuestion.type === "multiple") {
      setSelectedAnswer((answers) => (answers.includes(value) ? answers.filter((answer) => answer !== value) : [...answers, value]));
    } else {
      setSelectedAnswer([value]);
      await submitCurrentAnswer([value]);
    }
  }

  async function submitCurrentAnswer(answerOverride?: string[]) {
    const desktopApi = requireDesktopApi();
    if (!desktopApi) return;
    const answer = answerOverride ?? selectedAnswer;
    if (!currentQuestion || answer.length === 0) return;
    const result = await desktopApi.submitAnswer(currentQuestion.id, answer);
    setAnswerResult(result);
    await refresh();
  }

  async function toggleFavorite() {
    const desktopApi = requireDesktopApi();
    if (!desktopApi) return;
    if (!currentQuestion) return;
    await desktopApi.setFavorite(currentQuestion.id, !favoriteIds.has(currentQuestion.id));
    await refresh();
  }

  function goQuestion(offset: number) {
    const nextIndex = currentIndex + offset;
    if (nextIndex < 0 || nextIndex >= questions.length) return;
    setCurrentIndex(nextIndex);
    setSelectedAnswer([]);
    setAnswerResult(null);
  }

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandMark">题</span>
          <div><strong>题库刷题</strong><small>xsy666</small></div>
        </div>
        <button className={page === "home" ? "nav active" : "nav"} onClick={() => setPage("home")}>首页</button>
        <button className={page === "banks" ? "nav active" : "nav"} onClick={() => setPage("banks")}>题库管理</button>
        <button className={page === "practice" ? "nav active" : "nav"} onClick={() => setPage("practice")}>刷题</button>
      </aside>

      <main className="content">
        {message && <div className="notice">{message}</div>}

        {page === "home" && (
          <section>
            <div className="pageHeader">
              <div><h1>首页</h1><p>导入 JSONL 题库后即可开始顺序、随机、错题和收藏练习。</p></div>
              <button className="primaryButton" onClick={handleImport}>导入 JSONL</button>
            </div>
            <div className="statsGrid">
              <Stat label="题库" value={stats?.bankCount ?? 0} />
              <Stat label="总题数" value={stats?.questionCount ?? 0} />
              <Stat label="已练题" value={stats?.attemptedCount ?? 0} />
              <Stat label="正确率" value={`${stats?.accuracy ?? 0}%`} />
              <Stat label="错题" value={stats?.wrongCount ?? 0} />
              <Stat label="收藏" value={stats?.favoriteCount ?? 0} />
            </div>
            <div className="practiceLauncher">
              <h2>开始练习</h2>
              <BankSelect banks={banks} selectedBankId={selectedBank?.id ?? null} onChange={setSelectedBankId} />
              <div className="modeGrid">
                {(Object.keys(modeLabels) as PracticeMode[]).map((mode) => <button key={mode} onClick={() => void startPractice(mode)}>{modeLabels[mode]}</button>)}
              </div>
            </div>
          </section>
        )}

        {page === "banks" && (
          <section>
            <div className="pageHeader">
              <div><h1>题库管理</h1><p>JSONL 文件导入后会写入本地 SQLite 数据库。</p></div>
              <button className="primaryButton" onClick={handleImport}>导入 JSONL</button>
            </div>
            <div className="bankList">
              {banks.map((bank) => (
                <article className="bankItem" key={bank.id}>
                  <div><strong>{bank.name}</strong><span>{bank.questionCount} 题 · {new Date(bank.createdAt).toLocaleString()}</span></div>
                  <div className="bankActions">
                    <button onClick={() => setSelectedBankId(bank.id)}>选择</button>
                    <button className="dangerButton" onClick={() => void handleDeleteBank(bank.id)}>删除</button>
                  </div>
                </article>
              ))}
              {banks.length === 0 && <div className="empty">还没有题库，先导入一个 JSONL 文件。</div>}
            </div>
          </section>
        )}

        {page === "practice" && (
          <section>
            <div className="pageHeader">
              <div><h1>{modeLabels[practiceMode]}</h1><p>{selectedBank ? selectedBank.name : "未选择题库"}</p></div>
              <div className="practiceHeaderActions">
                <button onClick={() => setPage("home")}>返回</button>
                <BankSelect banks={banks} selectedBankId={selectedBank?.id ?? null} onChange={setSelectedBankId} />
              </div>
            </div>
            {currentQuestion ? (
              <div className="questionPanel">
                <div className="questionMeta">
                  <span>{currentIndex + 1} / {questions.length}</span>
                  <span>{questionTypeLabels[currentQuestion.type]}</span>
                  {visibleTags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <h2>{currentQuestion.question}</h2>
                <div className="optionsList">
                  {(currentQuestion.type === "judge" ? ["正确", "错误"] : currentQuestion.options).map((option, index) => {
                    const value = currentQuestion.type === "judge" ? (index === 0 ? "true" : "false") : optionLetter(index);
                    return (
                      <button key={value} className={selectedAnswer.includes(value) ? "optionButton selected" : "optionButton"} onClick={() => void toggleAnswer(value)}>
                        <strong>{currentQuestion.type === "judge" ? "" : `${value}.`}</strong><span>{option}</span>
                      </button>
                    );
                  })}
                </div>
                {answerResult && (
                  <div className={answerResult.correct ? "answerBox correct" : "answerBox wrong"}>
                    <strong>{answerResult.correct ? "回答正确" : "回答错误"}</strong>
                    {currentQuestion.type === "judge" ? (
                      <p>正确答案：{formatCorrectAnswer(currentQuestion, answerResult.correctAnswer)}</p>
                    ) : (
                      <p>{answerResult.explanation || `答案：${formatCorrectAnswer(currentQuestion, answerResult.correctAnswer)}`}</p>
                    )}
                  </div>
                )}
                <div className="questionActions">
                  <button onClick={() => goQuestion(-1)} disabled={currentIndex === 0}>上一题</button>
                  <button onClick={toggleFavorite}>{favoriteIds.has(currentQuestion.id) ? "取消收藏" : "收藏"}</button>
                  {currentQuestion.type === "multiple" && (
                    <button className="primaryButton" onClick={() => void submitCurrentAnswer()} disabled={selectedAnswer.length === 0 || Boolean(answerResult)}>提交答案</button>
                  )}
                  <button onClick={() => goQuestion(1)} disabled={currentIndex >= questions.length - 1}>下一题</button>
                </div>
              </div>
            ) : (
              <div className="empty">
                <p>请选择题库和练习模式。</p>
                <div className="modeGrid compact">
                  {(Object.keys(modeLabels) as PracticeMode[]).map((mode) => <button key={mode} onClick={() => void startPractice(mode)}>{modeLabels[mode]}</button>)}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return <article className="statCard"><span>{label}</span><strong>{value}</strong></article>;
}

function BankSelect({ banks, selectedBankId, onChange }: { banks: QuestionBank[]; selectedBankId: number | null; onChange: (bankId: number) => void }) {
  return (
    <select value={selectedBankId ?? ""} onChange={(event) => onChange(Number(event.target.value))}>
      {banks.length === 0 && <option value="">暂无题库</option>}
      {banks.map((bank) => <option value={bank.id} key={bank.id}>{bank.name}</option>)}
    </select>
  );
}

export default App;
