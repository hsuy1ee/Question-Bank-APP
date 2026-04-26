import { useEffect, useMemo, useState } from "react";
import type {
  DashboardStats,
  ImportResult,
  PracticeAnswerState,
  PracticeMode,
  PracticeQuestion,
  PracticeSessionRestore,
  QuestionBank,
  SubmitAnswerResult
} from "../shared/types";

type Page = "home" | "banks" | "practice";

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

function FavoriteIcon({
  favorited,
  className = "",
  filled = favorited
}: {
  favorited: boolean;
  className?: string;
  filled?: boolean;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <polygon
        points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
        stroke={favorited ? "#F59E0B" : "#94A3B8"}
        strokeWidth={favorited ? "1.5" : "2"}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={filled && favorited ? "#F59E0B" : "none"}
      />
    </svg>
  );
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
  const [answerStates, setAnswerStates] = useState<Record<number, PracticeAnswerState>>({});
  const [showOverview, setShowOverview] = useState(false);
  const [lastSession, setLastSession] = useState<PracticeSessionRestore | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [showClearHistoryDialog, setShowClearHistoryDialog] = useState(false);

  const currentQuestion = questions[currentIndex];
  const visibleTags = currentQuestion ? currentQuestion.tags.filter((tag) => tag !== questionTypeLabels[currentQuestion.type]) : [];
  const selectedBank = useMemo(() => banks.find((bank) => bank.id === selectedBankId) ?? banks[0], [banks, selectedBankId]);
  const currentTypeProgress = useMemo(() => {
    if (!currentQuestion) return null;
    const sameTypeQuestions = questions.filter((question) => question.type === currentQuestion.type);
    const position = sameTypeQuestions.findIndex((question) => question.id === currentQuestion.id);
    if (position < 0) return null;
    return { current: position + 1, total: sameTypeQuestions.length };
  }, [questions, currentQuestion]);
  const overviewSections = useMemo(() => {
    const orderedTypes: PracticeQuestion["type"][] = ["single", "multiple", "judge"];
    return orderedTypes
      .map((type) => ({
        type,
        items: questions.flatMap((question, index) => (question.type === type ? [{ question, index }] : []))
      }))
      .filter((section) => section.items.length > 0);
  }, [questions]);
  const api = window.quizApi;

  function requireDesktopApi() {
    if (!api) {
      setMessage("桌面端接口未加载。请使用 npm run dev 启动 Electron 窗口，不要直接在浏览器里打开 127.0.0.1:5173。");
      return null;
    }
    return api;
  }

  async function refresh(preferredBankId?: number | null) {
    const desktopApi = requireDesktopApi();
    if (!desktopApi) return;
    const [nextBanks, nextFavorites] = await Promise.all([desktopApi.listBanks(), desktopApi.listFavoriteIds()]);
    const targetBankId = preferredBankId === undefined ? selectedBankId ?? nextBanks[0]?.id ?? null : preferredBankId ?? nextBanks[0]?.id ?? null;
    const [nextStats, nextSession] = await Promise.all([
      desktopApi.getStats(targetBankId ?? undefined),
      targetBankId ? desktopApi.getLastPracticeSession(targetBankId) : Promise.resolve(null)
    ]);
    setBanks(nextBanks);
    setFavoriteIds(new Set(nextFavorites));
    setLastSession(nextSession);
    setStats(nextStats);
    setSelectedBankId(targetBankId);
  }

  async function saveSession(nextIndex = currentIndex, nextAnswerStates = answerStates, nextQuestions = questions, nextMode = practiceMode, bankId = selectedBank?.id) {
    const desktopApi = requireDesktopApi();
    if (!desktopApi || !bankId || nextQuestions.length === 0) return;
    await desktopApi.savePracticeSession({
      bankId,
      mode: nextMode,
      questionIds: nextQuestions.map((question) => question.id),
      currentIndex: nextIndex,
      answerStates: nextAnswerStates
    });
    setLastSession({
      bankId,
      mode: nextMode,
      questionIds: nextQuestions.map((question) => question.id),
      currentIndex: nextIndex,
      answerStates: nextAnswerStates,
      questions: nextQuestions
    });
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
      setSelectedBankId(result.bankId);
      await refresh(result.bankId);
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
    setAnswerStates({});
    setLastSession(null);
    await refresh(null);
  }

  function promptClearPracticeHistory() {
    if (!selectedBank) return;
    setShowClearHistoryDialog(true);
  }

  async function handleClearPracticeHistory() {
    const desktopApi = requireDesktopApi();
    if (!desktopApi || !selectedBank) return;

    await desktopApi.clearPracticeHistory(selectedBank.id);
    setShowClearHistoryDialog(false);
    if (lastSession?.bankId === selectedBank.id) {
      setLastSession(null);
    }
    setQuestions([]);
    setCurrentIndex(0);
    setSelectedAnswer([]);
    setAnswerResult(null);
    setAnswerStates({});
    setShowOverview(false);
    setMessage(`已清空 ${selectedBank.name} 的做题记录。`);
    await refresh(selectedBank.id);
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
    setAnswerStates({});
    setShowOverview(false);
    setMessage(nextQuestions.length === 0 ? `${modeLabels[mode]}暂无可用题目。` : "");
    if (nextQuestions.length > 0) {
      await saveSession(0, {}, nextQuestions, mode, selectedBank.id);
    }
    setPage("practice");
  }

  async function continuePractice() {
    const desktopApi = requireDesktopApi();
    if (!desktopApi) return;
    if (!selectedBank) {
      setMessage("请先选择题库。");
      return;
    }
    const session = await desktopApi.getLastPracticeSession(selectedBank.id);
    if (!session) {
      setMessage(`${selectedBank.name} 没有可继续的练习。`);
      setLastSession(null);
      return;
    }
    const safeIndex = Math.min(session.currentIndex, Math.max(session.questions.length - 1, 0));
    const currentState = session.answerStates[session.questions[safeIndex]?.id];
    setSelectedBankId(session.bankId);
    setPracticeMode(session.mode);
    setQuestions(session.questions);
    setCurrentIndex(safeIndex);
    setAnswerStates(session.answerStates);
    setSelectedAnswer(currentState?.selectedAnswer ?? []);
    setAnswerResult(currentState?.result ?? null);
    setShowOverview(false);
    setMessage("");
    setPage("practice");
    await refresh(session.bankId);
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
    setSelectedAnswer(answer);
    setAnswerResult(result);
    const nextStates = {
      ...answerStates,
      [currentQuestion.id]: {
        selectedAnswer: answer,
        result
      }
    };
    setAnswerStates(nextStates);
    await saveSession(currentIndex, nextStates);
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
    const nextQuestion = questions[nextIndex];
    const nextState = answerStates[nextQuestion.id];
    setCurrentIndex(nextIndex);
    setSelectedAnswer(nextState?.selectedAnswer ?? []);
    setAnswerResult(nextState?.result ?? null);
    void saveSession(nextIndex);
  }

  function jumpToQuestion(index: number) {
    const nextQuestion = questions[index];
    const nextState = answerStates[nextQuestion.id];
    setCurrentIndex(index);
    setSelectedAnswer(nextState?.selectedAnswer ?? []);
    setAnswerResult(nextState?.result ?? null);
    setShowOverview(false);
    void saveSession(index);
  }

  function handleBankChange(bankId: number) {
    setSelectedBankId(bankId);
    void refresh(bankId);
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
              <Stat label="总题数" value={stats?.questionCount ?? 0} />
              <Stat label="已练题" value={stats?.attemptedCount ?? 0} />
              <Stat label="正确率" value={`${(stats?.accuracy ?? 0).toFixed(1)}%`} />
              <Stat label="错题" value={stats?.wrongCount ?? 0} />
              <Stat label="收藏" value={stats?.favoriteCount ?? 0} />
            </div>
            <div className="practiceLauncher">
              <h2>开始练习</h2>
              <p className="selectedBankName">当前题库：{selectedBank?.name ?? "未选择题库"}</p>
              <div className="practicePicker">
                <BankSelect banks={banks} selectedBankId={selectedBank?.id ?? null} onChange={handleBankChange} />
                <button className="primaryButton" onClick={() => void continuePractice()} disabled={!selectedBank || !lastSession}>继续做题</button>
                <button className="dangerButton" onClick={promptClearPracticeHistory} disabled={!selectedBank}>清空记录</button>
              </div>
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
                    <button onClick={() => handleBankChange(bank.id)}>选择</button>
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
                <BankSelect banks={banks} selectedBankId={selectedBank?.id ?? null} onChange={handleBankChange} />
              </div>
            </div>
            {currentQuestion ? (
              <div className="questionPanel">
                <div className="questionMeta">
                  <span>{currentTypeProgress ? `${currentTypeProgress.current} / ${currentTypeProgress.total}` : `${currentIndex + 1} / ${questions.length}`}</span>
                  <span>{questionTypeLabels[currentQuestion.type]}</span>
                  {visibleTags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>
                <h2>{currentQuestion.question}</h2>
                <div className="optionsList">
                  {(currentQuestion.type === "judge" ? ["正确", "错误"] : currentQuestion.options).map((option, index) => {
                    const value = currentQuestion.type === "judge" ? (index === 0 ? "true" : "false") : optionLetter(index);
                    const isSelected = selectedAnswer.includes(value);
                    const isCorrectOption = Boolean(answerResult?.correctAnswer.includes(value));
                    const isMissedCorrect = Boolean(answerResult && currentQuestion.type === "multiple" && !isSelected && isCorrectOption);
                    const isSelectedCorrect = Boolean(answerResult && isCorrectOption && !isMissedCorrect);
                    const isSelectedWrong = Boolean(answerResult && isSelected && !isCorrectOption);
                    const optionClass = [
                      "optionButton",
                      isSelected && !answerResult ? "selected" : "",
                      isSelectedCorrect ? "correctOption" : "",
                      isMissedCorrect ? "missedCorrectOption" : "",
                      isSelectedWrong ? "wrongOption" : ""
                    ].filter(Boolean).join(" ");
                    return (
                      <button key={value} className={optionClass} onClick={() => void toggleAnswer(value)}>
                        <strong>{currentQuestion.type === "judge" ? "" : `${value}.`}</strong><span>{option}</span>
                      </button>
                    );
                  })}
                </div>
                {answerResult && (
                  <div className={answerResult.correct ? "answerBox correct" : "answerBox wrong"}>
                    <strong>{answerResult.correct ? "回答正确" : "回答错误"}</strong>
                    <p>{answerResult.explanation || `答案：${formatCorrectAnswer(currentQuestion, answerResult.correctAnswer)}`}</p>
                  </div>
                )}
                <div className="questionActions">
                  <button onClick={() => goQuestion(-1)} disabled={currentIndex === 0}>上一题</button>
                  <button onClick={() => setShowOverview((value) => !value)}>总览</button>
                  {currentQuestion.type === "multiple" && (
                    <button className="primaryButton" onClick={() => void submitCurrentAnswer()} disabled={selectedAnswer.length === 0 || Boolean(answerResult)}>提交答案</button>
                  )}
                  <button onClick={() => goQuestion(1)} disabled={currentIndex >= questions.length - 1}>下一题</button>
                  <button
                    className={favoriteIds.has(currentQuestion.id) ? "favoriteActionButton active" : "favoriteActionButton"}
                    onClick={toggleFavorite}
                    aria-label={favoriteIds.has(currentQuestion.id) ? "取消收藏" : "收藏"}
                    title={favoriteIds.has(currentQuestion.id) ? "取消收藏" : "收藏"}
                  >
                    <FavoriteIcon
                      favorited={favoriteIds.has(currentQuestion.id)}
                      filled={favoriteIds.has(currentQuestion.id)}
                      className="favoriteActionIcon"
                    />
                  </button>
                </div>
                {showOverview && (
                  <div className="overviewPanel">
                    {overviewSections.map((section) => (
                      <div className="overviewSection" key={section.type}>
                        <h3 className="overviewTypeHeading">{questionTypeLabels[section.type]}</h3>
                        <div className="overviewGrid">
                          {section.items.map(({ question, index }, sectionIndex) => {
                            const state = answerStates[question.id];
                            const isFavorite = favoriteIds.has(question.id);
                            const className = [
                              "overviewButton",
                              index === currentIndex ? "current" : "",
                              state?.result?.correct ? "answeredCorrect" : "",
                              state?.result && !state.result.correct ? "answeredWrong" : ""
                            ].filter(Boolean).join(" ");
                            return (
                              <button className={className} key={question.id} onClick={() => jumpToQuestion(index)}>
                                <span>{sectionIndex + 1}</span>
                                {isFavorite && <FavoriteIcon favorited filled={false} className="favoriteBadge" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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

      {showClearHistoryDialog && selectedBank && (
        <div className="dialogOverlay" onClick={() => setShowClearHistoryDialog(false)}>
          <div className="dialogCard" onClick={(event) => event.stopPropagation()}>
            <div className="dialogIcon" aria-hidden="true">!</div>
            <div className="dialogContent">
              <h3>清空做题记录</h3>
              <p>确认清空题库“{selectedBank.name}”的做题记录吗？</p>
              <p>这会重置已练题、正确率、错题等统计，但不会删除题目和收藏。</p>
            </div>
            <div className="dialogActions">
              <button onClick={() => setShowClearHistoryDialog(false)}>取消</button>
              <button className="dangerSolidButton" onClick={() => void handleClearPracticeHistory()}>确认清空</button>
            </div>
          </div>
        </div>
      )}
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
