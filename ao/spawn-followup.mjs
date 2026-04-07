export function buildSpawnIssueTitle({ directive, claimPr, issueNumber }) {
  if (claimPr) {
    return `Repair PR #${claimPr}`;
  }

  if (issueNumber) {
    return `Follow-up for issue #${issueNumber}`;
  }

  const trimmed = typeof directive === 'string' ? directive.trim() : '';
  if (!trimmed) {
    return 'AO directive';
  }

  return trimmed.length > 100 ? `${trimmed.slice(0, 97)}...` : trimmed;
}

export function buildSpawnIssueBody({ directive, context, claimPr, issueNumber }) {
  const sections = [];

  if (typeof directive === 'string' && directive.trim()) {
    sections.push([
      '## Instruction from the harness',
      '',
      directive.trim(),
    ].join('\n'));
  }

  if (typeof context === 'string' && context.trim()) {
    sections.push([
      '## Additional context',
      '',
      context.trim(),
    ].join('\n'));
  }

  if (claimPr) {
    sections.push([
      '## Execution requirements',
      '',
      `- Claim and work on PR #${claimPr}.`,
      '- Treat the existing PR branch as the execution target.',
      '- Do not create a second PR for this repair.',
      '- Make code changes and run the relevant checks only.',
      '- Do not commit, push, or open/merge PRs yourself; the AO harness will handle repo operations after your edits.',
    ].join('\n'));
  } else if (issueNumber) {
    sections.push([
      '## Execution requirements',
      '',
      `- This work is related to original issue #${issueNumber}.`,
      '- Make code changes and run the relevant checks only.',
      '- Do not commit, push, or open/merge PRs yourself; the AO harness will handle repo operations after your edits.',
    ].join('\n'));
  }

  return sections.join('\n\n');
}

export function extractSpawnedSessionId(output) {
  if (typeof output !== 'string' || !output.trim()) {
    return null;
  }

  const explicitSession = output.match(/^SESSION=(.+)$/m);
  if (explicitSession?.[1]) {
    return explicitSession[1].trim();
  }

  const runtimeSession = output.match(/Spawning session ([^\s:]+)/);
  if (runtimeSession?.[1]) {
    return runtimeSession[1].trim();
  }

  return null;
}
