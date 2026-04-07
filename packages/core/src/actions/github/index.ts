import type { ActionResult, ActionExecutor } from '../types.js';
import type { ToolDefinition } from '../../config/schema.js';
import { GitHubClient } from './client.js';
import { PR_TOOL_DEFINITIONS, PR_DEFAULTS, prComment, prReview, createPR, mergePR, enablePRAutoMerge, updatePRBranch, getDiff, getPR, listPRs } from './pr.js';
import { REPO_TOOL_DEFINITIONS, REPO_DEFAULTS, createRepo, configureWebhook, updateRepoSettings, createBranch, compareCommits, getWorkflowRuns } from './repo.js';
import { FILES_TOOL_DEFINITIONS, FILES_DEFAULTS, getContents, commitFile, commitBatch, getMultipleFiles } from './files.js';
import { ISSUES_TOOL_DEFINITIONS, ISSUES_DEFAULTS, createIssue, updateIssue, getIssue, listIssues, closeIssue, addLabels, removeLabel } from './issues.js';

// Re-export client for type imports
export { GitHubClient } from './client.js';

export class GitHubExecutor implements ActionExecutor {
  readonly name = 'github';
  private client: GitHubClient;

  constructor() {
    this.client = new GitHubClient();
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      ...FILES_TOOL_DEFINITIONS,
      ...PR_TOOL_DEFINITIONS,
      ...REPO_TOOL_DEFINITIONS,
      ...ISSUES_TOOL_DEFINITIONS,
    ];
  }

  static readonly DEFAULTS: Record<string, Record<string, unknown>> = {
    ...FILES_DEFAULTS,
    ...PR_DEFAULTS,
    ...REPO_DEFAULTS,
    ...ISSUES_DEFAULTS,
  };

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.client.isReady()) {
      return { success: false, error: 'GitHub not initialized: missing GITHUB_TOKEN' };
    }

    switch (action) {
      case 'pr_comment':
        return prComment(this.client, params);
      case 'pr_review':
        return prReview(this.client, params);
      case 'create_issue':
        return createIssue(this.client, params);
      case 'update_issue':
        return updateIssue(this.client, params);
      case 'create_pr':
        return createPR(this.client, params);
      case 'merge_pr':
        return mergePR(this.client, params);
      case 'enable_pr_auto_merge':
        return enablePRAutoMerge(this.client, params);
      case 'update_pr_branch':
        return updatePRBranch(this.client, params);
      case 'create_repo':
        return createRepo(this.client, params);
      case 'configure_webhook':
        return configureWebhook(this.client, params);
      case 'update_repo_settings':
        return updateRepoSettings(this.client, params);
      case 'get_contents':
        return getContents(this.client, params);
      case 'commit_file':
        return commitFile(this.client, params);
      case 'create_branch':
        return createBranch(this.client, params);
      case 'get_diff':
        return getDiff(this.client, params);
      case 'compare_commits':
        return compareCommits(this.client, params);
      case 'close_issue':
        return closeIssue(this.client, params);
      case 'commit_batch':
        return commitBatch(this.client, params);
      case 'get_multiple_files':
        return getMultipleFiles(this.client, params);
      case 'get_issue':
        return getIssue(this.client, params);
      case 'list_issues':
        return listIssues(this.client, params);
      case 'get_pr':
        return getPR(this.client, params);
      case 'list_prs':
        return listPRs(this.client, params);
      case 'get_workflow_runs':
        return getWorkflowRuns(this.client, params);
      case 'add_labels':
        return addLabels(this.client, params);
      case 'remove_label':
        return removeLabel(this.client, params);
      default:
        return { success: false, error: `Unknown GitHub action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.client.healthCheck();
  }
}
