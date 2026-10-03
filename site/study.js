// 기존 학습 데이터를 추가 AI 호출 없이 준비도, 추천 순서, 암기 카드로 바꾼다.
const Study = (() => {
  const sum = (xs, fn) => (xs || []).reduce((n, x) => n + fn(x), 0);

  function readiness(courses = [], stats = []) {
    const lectures = sum(courses, c => (c.lectures || []).length);
    const reviewed = sum(courses, c => (c.lectures || []).filter(id => c.reviewed && c.reviewed[id]).length);
    const answered = sum(stats, x => Number(x.a && x.a.answered) || 0);
    const correct = sum(stats, x => Number(x.a && x.a.correct) || 0);
    const wrong = sum(stats, x => ((x.a && x.a.wrong) || []).length);
    const scheduled = courses.some(c => (c.exams || []).length);
    if (!lectures) return { score: 0, lectures, reviewed, answered, correct, wrong, scheduled };
    const score = Math.min(100, Math.round(
      20 + 35 * (reviewed / lectures) + 20 * Math.min(answered / 10, 1) + 20 * (answered ? correct / answered : 0) + (scheduled ? 5 : 0)
    ));
    return { score, lectures, reviewed, answered, correct, wrong, scheduled };
  }

  function plan(courses = [], stats = []) {
    if (!courses.length) return [{ kind: 'course', title: '과목 만들기', detail: '공부할 과목부터 추가하세요.', href: '#/' }];
    const byId = new Map(stats.map(x => [x.c.id, x.a || {}]));
    const out = [];
    for (const c of courses) {
      const a = byId.get(c.id) || { answered: 0, wrong: [] };
      if (!(c.lectures || []).length) {
        out.push({ kind: 'upload', priority: 110, title: `${c.name} 자료 추가`, detail: '첫 강의자료를 올리세요.', href: `#/c/${c.id}/lectures` });
        continue;
      }
      const left = c.lectures.filter(id => !(c.reviewed && c.reviewed[id])).length;
      if (left) out.push({ kind: 'review', priority: 100, title: `${c.name} 복습`, detail: `${left}개 강의가 남았어요.`, href: `#/c/${c.id}/lectures` });
      const wrong = (a.wrong || []).length;
      if (wrong) out.push({ kind: 'wrong', priority: 90, title: `${c.name} 오답`, detail: `${wrong}문제를 다시 풀어보세요.`, href: `#/c/${c.id}/quiz/wrong` });
      if ((a.answered || 0) < 5) out.push({ kind: 'quiz', priority: 80, title: `${c.name} 연습`, detail: '예상 문제를 풀어보세요.', href: `#/c/${c.id}/quiz` });
      if ((c.exams || []).length) out.push({ kind: 'book', priority: 60, title: `${c.name} 시험 자료`, detail: '정리와 오답을 PDF로 묶으세요.', href: `#/c/${c.id}/book` });
    }
    if (!out.length) {
      const c = courses[0];
      out.push({ kind: 'book', priority: 50, title: `${c.name} 정리`, detail: '정리집을 최신 상태로 만들어두세요.', href: `#/c/${c.id}/book` });
    }
    return out.sort((a, b) => b.priority - a.priority).slice(0, 4);
  }

  function cards(lectures = []) {
    const seen = new Set(), out = [];
    lectures.forEach((lecture, index) => {
      const terms = (lecture.summary && lecture.summary.terms) || [];
      for (const item of terms) {
        const key = String(item.term || '').trim().toLocaleLowerCase();
        if (!key || !item.definition || seen.has(key)) continue;
        seen.add(key);
        out.push({ term: item.term.trim(), definition: item.definition.trim(), pages: item.pages || [], lectureNo: index + 1, lecture: lecture.summary.title || `${index + 1}강` });
      }
    });
    return out;
  }

  function clock(seconds) {
    const n = Math.max(0, Math.ceil(Number(seconds) || 0));
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  }

  return { readiness, plan, cards, clock };
})();

if (typeof module !== 'undefined') module.exports = Study;
