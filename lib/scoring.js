// Scoring logic — kept separate from storage and UI so it can be tested and
// reused. There is deliberately NO assumption that "A" or "B" means anything.
// The "same-brain score" is simply: of the questions you answered that also
// have a saved creator answer, how many matched the creator's answer.
//
// This score has NO medical meaning. It is a light-hearted comparison only.

/**
 * @param {Object<string,"A"|"B">} answers  respondent answers keyed by question id
 * @param {Array<{id:string, creatorAnswer:"A"|"B"|null, enabled:number|boolean}>} questions
 * @returns {{matches:number, total:number, sameBrainPercent:number}}
 */
export function score(answers, questions) {
  let matches = 0;
  let total = 0;

  for (const q of questions) {
    const enabled = q.enabled === true || q.enabled === 1;
    if (!enabled) continue;

    const creator = q.creatorAnswer;
    if (creator !== "A" && creator !== "B") continue; // no creator answer set

    const given = answers[q.id];
    if (given !== "A" && given !== "B") continue; // question not answered

    total += 1;
    if (given === creator) matches += 1;
  }

  const sameBrainPercent = total === 0 ? 0 : Math.round((matches / total) * 100);
  return { matches, total, sameBrainPercent };
}

/**
 * Count how many A vs B answers a respondent gave (across answered questions).
 * @param {Object<string,"A"|"B">} answers
 * @returns {{countA:number, countB:number}}
 */
export function tallyAnswers(answers) {
  let countA = 0;
  let countB = 0;
  for (const v of Object.values(answers)) {
    if (v === "A") countA += 1;
    else if (v === "B") countB += 1;
  }
  return { countA, countB };
}
