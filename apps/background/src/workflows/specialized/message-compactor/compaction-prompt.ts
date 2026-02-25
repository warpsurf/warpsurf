export function buildCompactionSystemPrompt(summaryMaxChars: number): string {
  return (
    'Summarize this browser agent history into a procedural memory. ' +
    'Include: key findings, URLs visited, actions taken and outcomes, errors, current progress, and what remains to be done. ' +
    `Max ${summaryMaxChars} characters. Preserve exact data, URLs, and counts.`
  );
}
